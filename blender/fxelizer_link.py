# 4FXELIZER Link: a Blender add-on that sends the textures you paint to 4FXELIZER and shows its
# PSX-style result on the model while you paint.
#
# Two kinds of link:
# - Image: one image as it is (a Ucupaint layer, or any image you paint on), read straight from
#   Blender's pixels after every stroke (and during strokes).
# - Material channel: what a material's channel adds up to (Ucupaint's combined Color, or whatever
#   feeds Base Color), baked with Cycles in one sample after every stroke.
#
# "Show on model" reroutes the node links of the image (or channel) through an Image node holding
# the 4FXELIZER result. The image you paint on stays the paint target. The original links come back
# before every save, so .blend files never depend on the add-on.
#
# The connection is a local TCP socket to 4FXELIZER (File > Blender Link). The frame format is
# described in 4FXELIZER's src/shared/blenderLink.ts; keep the two in sync.

bl_info = {
    "name": "4FXELIZER Link",
    "author": "4FX",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D View > Sidebar > 4FXELIZER",
    "description": "Live 4FXELIZER preview of the textures you paint",
    "category": "Paint",
}

import json
import select
import socket
import struct
import time
import uuid
import zlib

import bpy
import numpy as np
from bpy.app.handlers import persistent

PROTOCOL = 1
MAGIC = b"FXL1"
PREFIX = struct.Struct("<4sII")
MAX_HEADER = 64 * 1024
MAX_SIDE = 8192
NODE_PREFIX = "4FX "
BAKE_PREFIX = ".4FX bake "
DATA_SPACES = {"Non-Color", "Raw", "Generic Data"}


# ── Connection ─────────────────────────────────────────────────────────────


class Connection:
    """Non-blocking socket to 4FXELIZER, driven from a timer on Blender's main thread."""

    def __init__(self):
        self.sock = None
        self.state = "off"  # off | connecting | connected
        self.app = ""
        self.error = ""
        self.rbuf = bytearray()
        # [uid or None, bytes, offset]
        self.queue = []
        self.last_try = 0.0

    def connect(self, port):
        self.close()
        self.last_try = time.monotonic()
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setblocking(False)
            s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 8 * 1024 * 1024)
            s.connect_ex(("127.0.0.1", port))
        except OSError as e:
            self.error = str(e)
            return
        self.sock = s
        self.state = "connecting"

    def close(self, error=""):
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
        self.sock = None
        self.state = "off"
        self.app = ""
        self.rbuf.clear()
        self.queue.clear()
        if error:
            self.error = error

    def send(self, message, payload=b"", uid=None):
        header = json.dumps(message, separators=(",", ":")).encode()
        frame = PREFIX.pack(MAGIC, len(header), len(payload)) + header + payload
        if uid is not None:
            # A newer texture replaces one that hasn't started going out.
            self.queue = [q for q in self.queue if q[0] != uid or q[2] > 0]
        self.queue.append([uid, frame, 0])

    def busy(self, uid):
        """A texture of this link is still on its way."""
        return any(q[0] == uid for q in self.queue)

    def poll(self):
        """Advances the connection; returns the frames that arrived."""
        if self.state == "connecting":
            _, writable, failed = select.select([], [self.sock], [self.sock], 0)
            if failed or (writable and self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)):
                self.close("4FXELIZER isn't listening. Turn on File > Blender Link there.")
                return []
            if not writable:
                if time.monotonic() - self.last_try > 3:
                    self.close("Timed out connecting to 4FXELIZER.")
                return []
            self.state = "connected"
            self.error = ""
            self.send({"type": "hello", "protocol": PROTOCOL, "app": f"Blender {bpy.app.version_string}", **({"file": bpy.path.basename(bpy.data.filepath)} if bpy.data.filepath else {})})
        if self.state != "connected":
            return []
        try:
            while self.queue:
                item = self.queue[0]
                sent = self.sock.send(memoryview(item[1])[item[2]:])
                item[2] += sent
                if item[2] < len(item[1]):
                    break
                self.queue.pop(0)
        except BlockingIOError:
            pass
        except OSError as e:
            self.close(f"Connection lost: {e}")
            return []
        try:
            while True:
                chunk = self.sock.recv(4 * 1024 * 1024)
                if not chunk:
                    self.close("4FXELIZER closed the connection.")
                    return []
                self.rbuf += chunk
        except BlockingIOError:
            pass
        except OSError as e:
            self.close(f"Connection lost: {e}")
            return []
        return self.read_frames()

    def read_frames(self):
        frames = []
        while len(self.rbuf) >= PREFIX.size:
            magic, header_len, payload_len = PREFIX.unpack_from(self.rbuf)
            if magic != MAGIC or not 0 < header_len <= MAX_HEADER or payload_len > MAX_SIDE * MAX_SIDE * 4:
                self.close("4FXELIZER sent something unexpected.")
                return []
            end = PREFIX.size + header_len + payload_len
            if len(self.rbuf) < end:
                break
            try:
                message = json.loads(bytes(self.rbuf[PREFIX.size:PREFIX.size + header_len]))
            except ValueError:
                self.close("4FXELIZER sent something unexpected.")
                return []
            frames.append((message, bytes(self.rbuf[PREFIX.size + header_len:end])))
            del self.rbuf[:end]
        return frames


conn = Connection()


# ── Runtime state (not saved) ──────────────────────────────────────────────

# uid → time.monotonic() when it should be sent
due = {}
# uid → crc of the pixels last sent (skips sending the same pixels again)
sent_crc = {}
# uid → time.monotonic() of the last send (the update rate spaces them out)
last_sent = {}
# uids whose result arrived in this session (only those are shown on the model)
fresh = set()
# what a link last reported ("Baked in 0.2 s", errors)
status = {}
# own edits (result pixels, preview nodes, bakes) show up as node tree updates shortly after: those
# don't count as changes
ignore_trees_until = 0.0
busy = False
# a brush stroke is under way (a press in paint mode, until the painted image updates)
stroke = {"active": False, "since": 0.0, "last": 0.0}
last_ensure = 0.0


def prefs():
    addon = bpy.context.preferences.addons.get(__name__)
    return addon.preferences if addon else None


def links():
    scene = bpy.context.scene
    return scene.fx4_links if scene else []


def find_link(uid):
    return next((l for l in links() if l.uid == uid), None)


def own_image(image):
    return image.name.startswith(BAKE_PREFIX) or image.get("fx4_result", False)


def update_mode():
    p = prefs()
    return p.update_mode if p else "LIVE"


def update_rate():
    """Least time between two updates of a link (seconds)."""
    p = prefs()
    return float(p.update_rate) if p else 0.1


def mark(link, delay=0.0):
    t = time.monotonic() + delay
    due[link.uid] = min(due.get(link.uid, t), t)


def mark_all():
    for link in links():
        sent_crc.pop(link.uid, None)
        mark(link)


def touched_trees():
    global ignore_trees_until
    ignore_trees_until = time.monotonic() + 0.5


def redraw():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type in {"VIEW_3D", "IMAGE_EDITOR"}:
                area.tag_redraw()


# ── Node trees ─────────────────────────────────────────────────────────────


def tree_closure(tree, seen=None):
    """A node tree and the groups inside it, recursively."""
    seen = set() if seen is None else seen
    if tree is None or tree.name in seen:
        return []
    seen.add(tree.name)
    out = [tree]
    for node in tree.nodes:
        if node.type == "GROUP" and node.node_tree:
            out += tree_closure(node.node_tree, seen)
    return out


def shader_trees():
    trees = [m.node_tree for m in bpy.data.materials if m.node_tree]
    return trees + [g for g in bpy.data.node_groups if g.bl_idname == "ShaderNodeTree"]


def socket_by_id(sockets, identifier):
    return next((s for s in sockets if s.identifier == identifier), None)


def ucupaint_node(material):
    if not material or not material.node_tree:
        return None
    for node in material.node_tree.nodes:
        tree = getattr(node, "node_tree", None)
        yp = getattr(tree, "yp", None) if tree else None
        if node.type == "GROUP" and yp is not None and getattr(yp, "is_ypaint_node", False):
            return node
    return None


def channel_choices(material):
    """(node name, output identifier, label) of each channel a material link can bake."""
    if not material or not material.node_tree:
        return []
    yp = ucupaint_node(material)
    if yp:
        return [(yp.name, o.identifier, o.name) for o in yp.outputs if o.enabled and not o.name.endswith(" Alpha")]
    out = []
    for node in material.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            for name in ("Base Color", "Emission Color", "Roughness", "Metallic"):
                sock = node.inputs.get(name)
                if sock and sock.is_linked:
                    link = sock.links[0]
                    out.append((link.from_node.name, link.from_socket.identifier, name))
    return out


def channel_sockets(link):
    """The channel's output and, with Ucupaint's alpha on, its alpha output."""
    tree = link.material.node_tree if link.material else None
    node = tree.nodes.get(link.node_name) if tree else None
    color = socket_by_id(node.outputs, link.socket_id) if node else None
    alpha = node.outputs.get(f"{color.name} Alpha") if color else None
    return node, color, (alpha if alpha is not None and alpha.enabled else None)


def is_data_channel(link):
    _, color, _ = channel_sockets(link)
    return color is not None and color.type != "RGBA"


# ── Pixels ─────────────────────────────────────────────────────────────────


def read_rgba8(image):
    """An image's pixels as RGBA8, rows top to bottom (Blender's go bottom up)."""
    w, h = image.size
    buf = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(buf)
    px = buf.reshape(h, w, 4)
    if image.is_float and not image.colorspace_settings.is_data:
        # Float images hold scene-linear values; 4FXELIZER works on sRGB-encoded ones.
        rgb = np.clip(px[..., :3], 0.0, 1.0)
        px[..., :3] = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    return np.ascontiguousarray((np.clip(px, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)[::-1])


def write_result(link, width, height, payload):
    """Puts 4FXELIZER's result into the link's result image."""
    name = link.result_name or f"{link.name} 4FX"
    image = bpy.data.images.get(name)
    if image is None or not image.get("fx4_result") or image.source != "GENERATED":
        image = bpy.data.images.new(name, width, height, alpha=True)
        image["fx4_result"] = True
        link.result_name = image.name
    if tuple(image.size) != (width, height):
        image.scale(width, height)
    image.colorspace_settings.name = "Non-Color" if link.source == "CHANNEL" and is_data_channel(link) else "sRGB"
    px = np.frombuffer(payload, np.uint8).reshape(height, width, 4)[::-1].astype(np.float32) / 255.0
    image.pixels.foreach_set(px.ravel())
    image.update()
    touched_trees()
    fresh.add(link.uid)
    ensure_preview(link)
    redraw()


# ── Baking a material channel ──────────────────────────────────────────────


def bake_image(name, size, data):
    image = bpy.data.images.get(name)
    if image is None or tuple(image.size) != (size, size):
        if image:
            bpy.data.images.remove(image)
        image = bpy.data.images.new(name, size, size, alpha=True)
    image.colorspace_settings.name = "Non-Color" if data else "sRGB"
    return image


def channel_size(link):
    if link.bake_size:
        return link.bake_size
    # Auto: the largest image the material uses (Ucupaint layers), else 1024.
    sides = [max(n.image.size) for t in tree_closure(link.material.node_tree) for n in t.nodes if n.type == "TEX_IMAGE" and n.image and not own_image(n.image)]
    return int(min(max(sides, default=1024) or 1024, 4096))


def bake_channel(link):
    """Bakes the channel with Cycles (emission, one sample); returns RGBA8 rows top to bottom."""
    global busy
    ob, mat = link.object, link.material
    if ob is None or mat is None or ob.type != "MESH":
        raise RuntimeError("Pick the object and material again.")
    if ob.name not in bpy.context.view_layer.objects or not ob.visible_get():
        raise RuntimeError(f"{ob.name} must be visible to bake.")
    if ob.mode == "EDIT":
        raise RuntimeError("Leave Edit Mode to bake.")
    if mat.name not in [s.material.name for s in ob.material_slots if s.material]:
        raise RuntimeError(f"{ob.name} doesn't use {mat.name}.")
    node, color, alpha = channel_sockets(link)
    if color is None:
        raise RuntimeError("The channel is gone. Link it again.")

    size = channel_size(link)
    data = color.type != "RGBA"
    target = bake_image(f"{BAKE_PREFIX}{link.uid}", size, data)
    alpha_target = bake_image(f"{BAKE_PREFIX}{link.uid} alpha", size, True) if alpha else None
    scratch = bake_image(f"{BAKE_PREFIX}scratch", 8, True)

    scene = bpy.context.scene
    if not hasattr(scene, "cycles"):
        raise RuntimeError("Baking needs the Cycles add-on turned on.")
    render, bake = scene.render, scene.render.bake
    saved = {
        "engine": render.engine,
        "samples": scene.cycles.samples,
        "adaptive": scene.cycles.use_adaptive_sampling,
        "denoise": scene.cycles.use_denoising,
        "margin": bake.margin,
        "margin_type": bake.margin_type,
        "use_clear": bake.use_clear,
        "selected_to_active": bake.use_selected_to_active,
        "target": bake.target,
    }
    tree = mat.node_tree
    temp = []  # (tree, node)
    restore_active = []  # (tree, node)
    restore_outputs = []
    slot = mat.paint_active_slot
    busy = True
    started = time.perf_counter()
    try:
        try:
            render.engine = "CYCLES"
        except TypeError:
            raise RuntimeError("Baking needs the Cycles add-on turned on.")
        scene.cycles.samples = 1
        scene.cycles.use_adaptive_sampling = False
        scene.cycles.use_denoising = False
        bake.margin = link.bake_margin
        bake.margin_type = "EXTEND"
        bake.use_clear = True
        bake.use_selected_to_active = False
        bake.target = "IMAGE_TEXTURES"

        emission = tree.nodes.new("ShaderNodeEmission")
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        image_node = tree.nodes.new("ShaderNodeTexImage")
        temp += [(tree, emission), (tree, output), (tree, image_node)]
        restore_active.append((tree, tree.nodes.active))
        restore_outputs = [n for n in tree.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output and n != output]
        tree.links.new(emission.outputs[0], output.inputs["Surface"])
        output.is_active_output = True
        # Other materials on the object bake into a scratch image instead of their own.
        for other in {s.material for s in ob.material_slots if s.material and s.material != mat and s.material.node_tree}:
            t = other.node_tree
            n = t.nodes.new("ShaderNodeTexImage")
            n.image = scratch
            temp.append((t, n))
            restore_active.append((t, t.nodes.active))
            t.nodes.active = n

        def run(source, into):
            for l in list(emission.inputs["Color"].links):
                tree.links.remove(l)
            tree.links.new(source, emission.inputs["Color"])
            image_node.image = into
            tree.nodes.active = image_node
            window = bpy.context.window or bpy.context.window_manager.windows[0]
            with bpy.context.temp_override(window=window, object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob]):
                kwargs = {"type": "EMIT", "margin": link.bake_margin, "use_clear": True, "target": "IMAGE_TEXTURES"}
                if link.uv_map:
                    kwargs["uv_layer"] = link.uv_map
                # No undo step: Ctrl+Z must undo your strokes, not the bake.
                bpy.ops.object.bake("EXEC_DEFAULT", False, **kwargs)

        run(color, target)
        if alpha_target:
            run(alpha, alpha_target)
    finally:
        for t, n in temp:
            t.nodes.remove(n)
        for n in restore_outputs:
            n.is_active_output = True
        for t, n in restore_active:
            if n is not None:
                t.nodes.active = n
        if mat.paint_active_slot != slot and slot < len(mat.texture_paint_images):
            mat.paint_active_slot = slot
        for key, value in saved.items():
            try:
                if key == "engine":
                    render.engine = value
                elif key in ("samples", "adaptive", "denoise"):
                    setattr(scene.cycles, {"samples": "samples", "adaptive": "use_adaptive_sampling", "denoise": "use_denoising"}[key], value)
                else:
                    setattr(bake, {"selected_to_active": "use_selected_to_active"}.get(key, key), value)
            except (TypeError, AttributeError):
                pass
        busy = False
        touched_trees()

    px = read_rgba8(target)
    if alpha_target:
        px[..., 3] = read_rgba8(alpha_target)[..., 0]
    status[link.uid] = f"Baked {size}×{size} in {time.perf_counter() - started:.2f} s"
    return px


# ── Sending ────────────────────────────────────────────────────────────────


def send_link(link):
    """Reads (or bakes) a link's texture and sends it; True when sent or unchanged."""
    if link.source == "IMAGE":
        image = link.image
        if image is None:
            status[link.uid] = "The image is gone."
            return True
        if image.source == "TILED":
            status[link.uid] = "UDIM images aren't supported."
            return True
        w, h = image.size
        if not w or not h or max(w, h) > MAX_SIDE:
            status[link.uid] = "The image has no pixels." if not w else f"Images up to {MAX_SIDE}² only."
            return True
        px = read_rgba8(image)
    else:
        try:
            px = bake_channel(link)
        except (RuntimeError, ReferenceError) as e:
            status[link.uid] = str(e)
            return True
    data = px.tobytes()
    crc = zlib.crc32(data)
    if sent_crc.get(link.uid) == crc:
        return True
    sent_crc[link.uid] = crc
    h, w = px.shape[:2]
    conn.send({"type": "texture", "id": link.uid, "name": link.name, "width": w, "height": h}, data, uid=link.uid)
    if link.source == "IMAGE":
        status[link.uid] = f"Sent {w}×{h}"
    return True


def receive(message, payload):
    if message.get("type") == "hello":
        conn.app = f"{message.get('app', '4FXELIZER')} {message.get('version', '')}".strip()
        mark_all()
    elif message.get("type") == "output":
        link = find_link(message.get("id"))
        w, h = message.get("width"), message.get("height")
        if link and isinstance(w, int) and isinstance(h, int) and len(payload) == w * h * 4:
            write_result(link, w, h, payload)


def tick():
    global last_ensure
    p = prefs()
    now = time.monotonic()
    if conn.state == "off" and p and p.auto_connect and len(links()) and now - conn.last_try > 2:
        conn.connect(p.port)
    if conn.state != "off":
        for message, payload in conn.poll():
            receive(message, payload)
    if conn.state == "connected":
        mode, rate = update_mode(), update_rate()
        # While painting, also during the stroke (images only: baking takes too long for that).
        if stroke["active"]:
            if now - stroke["since"] > 30:
                stroke["active"] = False
            elif mode == "LIVE" and now - stroke["last"] >= rate:
                stroke["last"] = now
                for link in links():
                    if link.source == "IMAGE" and link.auto_update and not conn.busy(link.uid):
                        mark(link)
        for link in list(links()):
            if link.uid in due and due[link.uid] <= now and not conn.busy(link.uid) and now - last_sent.get(link.uid, 0.0) >= rate:
                del due[link.uid]
                last_sent[link.uid] = now
                try:
                    send_link(link)
                except Exception as e:  # never let the timer die
                    status[link.uid] = f"Couldn't send: {e}"
    if now - last_ensure > 1.0:
        last_ensure = now
        ensure_previews()
    return 0.02 if conn.state != "off" else 0.5


# ── Change detection ───────────────────────────────────────────────────────


@persistent
def on_depsgraph(scene, depsgraph):
    if busy or not len(links()):
        return
    images, trees = set(), set()
    for update in depsgraph.updates:
        id_ = update.id
        if isinstance(id_, bpy.types.Image):
            if not own_image(id_):
                images.add(id_.name)
        elif isinstance(id_, (bpy.types.NodeTree, bpy.types.Material)):
            trees.add(id_.name if isinstance(id_, bpy.types.NodeTree) else (id_.node_tree.name if id_.node_tree else ""))
    if images:
        # A painted image updates when a stroke ends.
        stroke["active"] = False
    if update_mode() == "MANUAL":
        return
    count_trees = time.monotonic() > ignore_trees_until
    p = prefs()
    for link in links():
        if not link.auto_update:
            continue
        if link.source == "IMAGE":
            if link.image and link.image.name in images:
                mark(link)
        elif link.material and link.material.node_tree:
            closure = tree_closure(link.material.node_tree)
            used = {n.image.name for t in closure for n in t.nodes if n.type == "TEX_IMAGE" and n.image}
            if images & used or (count_trees and trees & {t.name for t in closure}):
                mark(link, p.bake_delay if p else 0.3)


@persistent
def on_undo(*_):
    if update_mode() != "MANUAL":
        mark_all()
    ensure_previews()


@persistent
def on_load(*_):
    due.clear()
    sent_crc.clear()
    last_sent.clear()
    fresh.clear()
    status.clear()
    conn.close()
    # Previews never reach a saved file, but one saved by an older session may still have them.
    for link in links():
        remove_preview(link.uid)
    bpy.app.timers.register(start_watch, first_interval=0.1)


@persistent
def on_save_pre(*_):
    for link in links():
        remove_preview(link.uid)


@persistent
def on_save_post(*_):
    ensure_previews()


class FX4_OT_watch(bpy.types.Operator):
    """Notices brush presses in paint modes, so links update during strokes"""

    bl_idname = "fx4.watch"
    bl_label = "4FX Stroke Watch"
    bl_options = {"INTERNAL"}

    def invoke(self, context, event):
        context.window_manager.modal_handler_add(self)
        return {"RUNNING_MODAL"}

    def modal(self, context, event):
        if event.type in {"LEFTMOUSE", "PEN"}:
            painting = context.mode == "PAINT_TEXTURE" or any(
                a.type == "IMAGE_EDITOR" and a.spaces.active.ui_mode == "PAINT" for w in context.window_manager.windows for a in w.screen.areas
            )
            if event.value == "PRESS" and painting:
                stroke.update(active=True, since=time.monotonic(), last=time.monotonic())
            elif event.value == "RELEASE":
                stroke["active"] = False
        return {"PASS_THROUGH"}


watching = []


def start_watch():
    """Starts the stroke watch in every window (handlers end when a file loads)."""
    watching.clear()
    for window in bpy.context.window_manager.windows:
        try:
            with bpy.context.temp_override(window=window):
                bpy.ops.fx4.watch("INVOKE_DEFAULT")
            watching.append(window)
        except RuntimeError:
            pass
    return None


# ── Showing the result on the model ────────────────────────────────────────


def taps(link):
    """(tree, node, [(output, result output name)]) whose links the result takes over."""
    if link.source == "IMAGE":
        if not link.image:
            return []
        return [
            (t, n, [(n.outputs["Color"], "Color"), (n.outputs["Alpha"], "Alpha")])
            for t in shader_trees()
            for n in t.nodes
            if n.type == "TEX_IMAGE" and n.image == link.image and not n.get("fx4_link")
        ]
    node, color, alpha = channel_sockets(link)
    if not color:
        return []
    return [(link.material.node_tree, node, [(color, "Color")] + ([(alpha, "Alpha")] if alpha else []))]


def result_node(tree, link, source):
    for n in tree.nodes:
        if n.get("fx4_link") == link.uid and n.get("fx4_from") == source.name and n.type == "TEX_IMAGE":
            return n
    n = tree.nodes.new("ShaderNodeTexImage")
    n.name = n.label = f"{NODE_PREFIX}{link.name}"
    n["fx4_link"] = link.uid
    n["fx4_from"] = source.name
    n["fx4_links"] = "[]"
    n.location = (source.location.x, source.location.y - 280)
    n.hide = True
    if source.type == "TEX_IMAGE":
        n.projection = source.projection
        n.extension = source.extension
        vector = source.inputs["Vector"]
        if vector.is_linked:
            tree.links.new(vector.links[0].from_socket, n.inputs["Vector"])
    elif link.uv_map:
        uv = tree.nodes.new("ShaderNodeUVMap")
        uv.uv_map = link.uv_map
        uv["fx4_link"] = link.uid
        uv["fx4_from"] = source.name
        uv.location = (n.location.x - 200, n.location.y)
        uv.hide = True
        tree.links.new(uv.outputs["UV"], n.inputs["Vector"])
    return n


def apply_preview(link):
    image = bpy.data.images.get(link.result_name) if link.result_name else None
    if image is None:
        return
    for tree, source, outputs in taps(link):
        node = None
        for output, name in outputs:
            moved = [l for l in output.links if not l.to_node.get("fx4_link")]
            if not moved:
                continue
            node = node or result_node(tree, link, source)
            record = json.loads(node["fx4_links"])
            for l in moved:
                entry = [output.identifier, l.to_node.name, l.to_socket.identifier]
                if entry not in record:
                    record.append(entry)
                to_socket = l.to_socket
                tree.links.remove(l)
                tree.links.new(node.outputs[name], to_socket)
            node["fx4_links"] = json.dumps(record)
            touched_trees()
        node = node or next((n for n in tree.nodes if n.get("fx4_link") == link.uid and n.get("fx4_from") == source.name and n.type == "TEX_IMAGE"), None)
        if node:
            if node.image != image:
                node.image = image
            wanted = "Closest" if link.sharp else (source.interpolation if source.type == "TEX_IMAGE" else "Linear")
            if node.interpolation != wanted:
                node.interpolation = wanted


def remove_preview(uid):
    """Puts back the links a link's preview took over and removes its nodes."""
    for tree in shader_trees():
        ours = [n for n in tree.nodes if n.get("fx4_link") == uid]
        for n in ours:
            source = tree.nodes.get(n.get("fx4_from", ""))
            if n.type == "TEX_IMAGE" and source:
                for out_id, to_name, to_id in json.loads(n.get("fx4_links", "[]")):
                    out = socket_by_id(source.outputs, out_id)
                    to_node = tree.nodes.get(to_name)
                    to_socket = socket_by_id(to_node.inputs, to_id) if to_node else None
                    # Unless something else was connected there meanwhile.
                    if out and to_socket and all(l.from_node in ours for l in to_socket.links):
                        tree.links.new(out, to_socket)
        for n in ours:
            tree.nodes.remove(n)
        if ours:
            touched_trees()


def ensure_preview(link):
    if link.show and link.uid in fresh:
        apply_preview(link)
    else:
        remove_preview(link.uid)


def ensure_previews():
    for link in links():
        try:
            ensure_preview(link)
        except ReferenceError:
            pass


# ── Properties ─────────────────────────────────────────────────────────────


def on_show(self, context):
    ensure_preview(self)
    redraw()


def on_settings(self, context):
    sent_crc.pop(self.uid, None)
    mark(self)


class FX4Link(bpy.types.PropertyGroup):
    uid: bpy.props.StringProperty()
    name: bpy.props.StringProperty(name="Name", update=on_settings)
    source: bpy.props.EnumProperty(
        name="Source",
        items=[
            ("IMAGE", "Image", "One image as it is (a Ucupaint layer, or any image you paint on)", "IMAGE_DATA", 0),
            ("CHANNEL", "Material channel", "What the material's channel adds up to, baked with Cycles", "MATERIAL", 1),
        ],
    )
    image: bpy.props.PointerProperty(type=bpy.types.Image, name="Image", update=on_settings)
    object: bpy.props.PointerProperty(type=bpy.types.Object, name="Object", update=on_settings)
    material: bpy.props.PointerProperty(type=bpy.types.Material, name="Material", update=on_settings)
    node_name: bpy.props.StringProperty()
    socket_id: bpy.props.StringProperty()
    channel_label: bpy.props.StringProperty()
    uv_map: bpy.props.StringProperty(name="UV Map", description="UV map to bake with (empty: the active render one)", update=on_settings)
    bake_size: bpy.props.IntProperty(name="Bake size", description="Side of the baked texture (0: the largest image the material uses)", default=0, min=0, max=4096, update=on_settings)
    bake_margin: bpy.props.IntProperty(name="Margin", description="Pixels the bake extends past UV islands, so downscaling doesn't pull in the background", default=16, min=0, max=64, update=on_settings)
    auto_update: bpy.props.BoolProperty(name="Auto update", description="Send after every stroke or change", default=True)
    show: bpy.props.BoolProperty(name="Show on model", description="Show 4FXELIZER's result on the model in place of the image or channel", default=True, update=on_show)
    sharp: bpy.props.BoolProperty(name="Sharp pixels", description="Show the result with nearest-pixel filtering", default=True, update=on_show)
    result_name: bpy.props.StringProperty()


class FX4Preferences(bpy.types.AddonPreferences):
    bl_idname = __name__

    port: bpy.props.IntProperty(name="Port", description="Same as Settings > Blender link in 4FXELIZER", default=47811, min=1024, max=65535)
    auto_connect: bpy.props.BoolProperty(name="Connect automatically", description="Connect whenever 4FXELIZER is listening and a link exists", default=True)
    update_mode: bpy.props.EnumProperty(
        name="Update",
        description="When links send their texture",
        items=[
            ("LIVE", "While painting", "During strokes too (material channels update when you lift the brush)", "BRUSH_DATA", 0),
            ("LIFT", "When you lift the brush", "Once a stroke ends, and after other changes", "MOUSE_LMB", 1),
            ("MANUAL", "Only with Send Now", "Nothing is sent until you press Send Now", "HAND", 2),
        ],
        default="LIVE",
    )
    update_rate: bpy.props.EnumProperty(
        name="Rate",
        description="Least time between two updates of a link",
        items=[
            ("0", "Instant", "As fast as 4FXELIZER keeps up"),
            ("0.1", "100 ms", ""),
            ("0.25", "250 ms", ""),
            ("0.5", "500 ms", ""),
            ("1", "1 s", ""),
            ("2", "2 s", ""),
        ],
        default="0.1",
    )
    bake_delay: bpy.props.FloatProperty(name="Bake delay", description="Seconds after the last change before a material channel bakes", default=0.25, min=0.0, max=5.0)

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "port")
        layout.prop(self, "auto_connect")
        draw_update(layout, self)
        layout.prop(self, "bake_delay")


def draw_update(layout, p):
    col = layout.column(align=True)
    col.prop(p, "update_mode", text="")
    row = col.row(align=True)
    row.active = p.update_mode != "MANUAL"
    row.prop(p, "update_rate", text="Rate")


# ── Operators ──────────────────────────────────────────────────────────────


def painted_image(context):
    """The image the brush paints on now (paint slot or canvas), else Ucupaint's active layer image."""
    ts = context.scene.tool_settings.image_paint
    ob = context.object
    mat = ob.active_material if ob else None
    if ob and ob.mode == "TEXTURE_PAINT":
        if ts.mode == "IMAGE" and ts.canvas:
            return ts.canvas
        if mat and 0 <= mat.paint_active_slot < len(mat.texture_paint_images):
            return mat.texture_paint_images[mat.paint_active_slot]
    yp_node = ucupaint_node(mat)
    if yp_node:
        yp = yp_node.node_tree.yp
        if 0 <= yp.active_layer_index < len(yp.layers):
            layer = yp.layers[yp.active_layer_index]
            group = yp_node.node_tree.nodes.get(layer.group_node)
            tree = group.node_tree if group else None
            if tree and layer.source_group:
                inner = tree.nodes.get(layer.source_group)
                tree = inner.node_tree if inner else tree
            source = tree.nodes.get(layer.source) if tree else None
            if source is not None and getattr(source, "image", None):
                return source.image
    space = context.space_data
    if space and space.type == "IMAGE_EDITOR" and space.image:
        return space.image
    return None


def new_link(context, name):
    link = context.scene.fx4_links.add()
    link.uid = uuid.uuid4().hex
    link.name = name
    context.scene.fx4_link_index = len(context.scene.fx4_links) - 1
    p = prefs()
    if conn.state == "off" and p:
        conn.connect(p.port)
    return link


class FX4_OT_link_image(bpy.types.Operator):
    """Send an image (the one you paint on) to 4FXELIZER and show its result on the model"""

    bl_idname = "fx4.link_image"
    bl_label = "Link Image"
    bl_options = {"REGISTER", "UNDO"}

    image: bpy.props.StringProperty(name="Image")

    def invoke(self, context, event):
        image = painted_image(context)
        self.image = image.name if image else ""
        return context.window_manager.invoke_props_dialog(self)

    def draw(self, context):
        self.layout.prop_search(self, "image", bpy.data, "images")

    def execute(self, context):
        image = bpy.data.images.get(self.image)
        if image is None or own_image(image):
            self.report({"ERROR"}, "Pick an image to link.")
            return {"CANCELLED"}
        existing = next((l for l in links() if l.source == "IMAGE" and l.image == image), None)
        if existing:
            self.report({"INFO"}, f"{image.name} is linked already.")
            return {"CANCELLED"}
        link = new_link(context, image.name)
        link.source = "IMAGE"
        link.image = image
        mark(link)
        return {"FINISHED"}


# Blender keeps no reference to dynamic enum strings: they must outlive the callback.
_channel_items = []


def channel_items(self, context):
    mat = context.object.active_material if context.object else None
    _channel_items[:] = [(f"{node}\t{sock}", label, f"{mat.name}: {label}") for node, sock, label in channel_choices(mat)] or [("", "No channel found", "")]
    return _channel_items


class FX4_OT_link_channel(bpy.types.Operator):
    """Bake a material channel (Ucupaint's combined result) after every stroke and send it to 4FXELIZER"""

    bl_idname = "fx4.link_channel"
    bl_label = "Link Material Channel"
    bl_options = {"REGISTER", "UNDO"}

    channel: bpy.props.EnumProperty(name="Channel", items=channel_items)

    @classmethod
    def poll(cls, context):
        ob = context.object
        return ob is not None and ob.type == "MESH" and ob.active_material is not None

    def invoke(self, context, event):
        return context.window_manager.invoke_props_dialog(self)

    def execute(self, context):
        ob = context.object
        mat = ob.active_material
        if not self.channel:
            self.report({"ERROR"}, "The material has no Ucupaint node, and nothing feeds its Principled BSDF.")
            return {"CANCELLED"}
        node, sock = self.channel.split("\t")
        label = next((l for n, s, l in channel_choices(mat) if n == node and s == sock), sock)
        if any(l.source == "CHANNEL" and l.material == mat and l.node_name == node and l.socket_id == sock for l in links()):
            self.report({"INFO"}, "That channel is linked already.")
            return {"CANCELLED"}
        link = new_link(context, f"{mat.name} {label}")
        link.source = "CHANNEL"
        link.object = ob
        link.material = mat
        link.node_name = node
        link.socket_id = sock
        link.channel_label = label
        mark(link)
        return {"FINISHED"}


class FX4_OT_unlink(bpy.types.Operator):
    """Remove the link (4FXELIZER keeps its texture tab)"""

    bl_idname = "fx4.unlink"
    bl_label = "Remove Link"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        scene = context.scene
        i = scene.fx4_link_index
        if not 0 <= i < len(scene.fx4_links):
            return {"CANCELLED"}
        link = scene.fx4_links[i]
        remove_preview(link.uid)
        if conn.state == "connected":
            conn.send({"type": "unlink", "id": link.uid})
        for key in (due, sent_crc, last_sent, status):
            key.pop(link.uid, None)
        fresh.discard(link.uid)
        image = bpy.data.images.get(link.result_name) if link.result_name else None
        if image and image.get("fx4_result") and image.users == 0:
            bpy.data.images.remove(image)
        for name in (f"{BAKE_PREFIX}{link.uid}", f"{BAKE_PREFIX}{link.uid} alpha"):
            if bpy.data.images.get(name):
                bpy.data.images.remove(bpy.data.images[name])
        scene.fx4_links.remove(i)
        scene.fx4_link_index = min(i, len(scene.fx4_links) - 1)
        redraw()
        return {"FINISHED"}


class FX4_OT_send(bpy.types.Operator):
    """Send the link again now"""

    bl_idname = "fx4.send"
    bl_label = "Send Now"

    def execute(self, context):
        scene = context.scene
        if 0 <= scene.fx4_link_index < len(scene.fx4_links):
            link = scene.fx4_links[scene.fx4_link_index]
            sent_crc.pop(link.uid, None)
            mark(link)
        return {"FINISHED"}


class FX4_OT_connect(bpy.types.Operator):
    """Connect to 4FXELIZER (File > Blender Link must be on there)"""

    bl_idname = "fx4.connect"
    bl_label = "Connect"

    def execute(self, context):
        p = prefs()
        if p:
            p.auto_connect = True
        conn.connect(p.port if p else 47811)
        return {"FINISHED"}


class FX4_OT_disconnect(bpy.types.Operator):
    """Disconnect from 4FXELIZER (links stay; connect again to resume)"""

    bl_idname = "fx4.disconnect"
    bl_label = "Disconnect"

    def execute(self, context):
        p = prefs()
        if p:
            p.auto_connect = False
        conn.close()
        return {"FINISHED"}


# ── Interface ──────────────────────────────────────────────────────────────


class FX4_UL_links(bpy.types.UIList):
    def draw_item(self, context, layout, data, link, icon, active_data, active_prop, index):
        row = layout.row(align=True)
        row.label(text=link.name, icon="IMAGE_DATA" if link.source == "IMAGE" else "MATERIAL")
        row.prop(link, "show", text="", icon="HIDE_OFF" if link.show else "HIDE_ON", emboss=False)


class FX4Panel:
    bl_region_type = "UI"
    bl_category = "4FXELIZER"
    bl_label = "4FXELIZER Link"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        box = layout.box()
        row = box.row()
        if conn.state == "connected":
            row.label(text=conn.app or "Connected", icon="LINKED")
            row.operator("fx4.disconnect", text="", icon="X")
        elif conn.state == "connecting":
            row.label(text="Connecting…", icon="SORTTIME")
        else:
            row.label(text="Not connected", icon="UNLINKED")
            row.operator("fx4.connect")
            if conn.error:
                box.label(text=conn.error, icon="INFO")
        p = prefs()
        if p:
            draw_update(box, p)

        col = layout.column(align=True)
        col.operator("fx4.link_image", icon="IMAGE_DATA")
        col.operator("fx4.link_channel", icon="MATERIAL")

        if not len(scene.fx4_links):
            return
        layout.template_list("FX4_UL_links", "", scene, "fx4_links", scene, "fx4_link_index", rows=2)
        if not 0 <= scene.fx4_link_index < len(scene.fx4_links):
            return
        link = scene.fx4_links[scene.fx4_link_index]
        col = layout.column()
        if link.source == "IMAGE":
            col.prop(link, "image")
        else:
            col.label(text=f"{link.material.name if link.material else '?'} › {link.channel_label}", icon="MATERIAL")
            col.prop(link, "object")
            col.prop(link, "bake_size")
            col.prop(link, "bake_margin")
            if link.object and link.object.type == "MESH":
                col.prop_search(link, "uv_map", link.object.data, "uv_layers", icon="GROUP_UVS")
        col.prop(link, "auto_update")
        row = col.row(align=True)
        row.prop(link, "show")
        row.prop(link, "sharp")
        if link.uid in status:
            col.label(text=status[link.uid])
        row = layout.row(align=True)
        row.operator("fx4.send", icon="FILE_REFRESH")
        row.operator("fx4.unlink", icon="TRASH")


class FX4_PT_view3d(FX4Panel, bpy.types.Panel):
    bl_space_type = "VIEW_3D"
    bl_idname = "FX4_PT_view3d"


class FX4_PT_image(FX4Panel, bpy.types.Panel):
    bl_space_type = "IMAGE_EDITOR"
    bl_idname = "FX4_PT_image"


# ── Registration ───────────────────────────────────────────────────────────

CLASSES = (
    FX4Link,
    FX4Preferences,
    FX4_OT_watch,
    FX4_OT_link_image,
    FX4_OT_link_channel,
    FX4_OT_unlink,
    FX4_OT_send,
    FX4_OT_connect,
    FX4_OT_disconnect,
    FX4_UL_links,
    FX4_PT_view3d,
    FX4_PT_image,
)

HANDLERS = (
    (bpy.app.handlers.depsgraph_update_post, on_depsgraph),
    (bpy.app.handlers.undo_post, on_undo),
    (bpy.app.handlers.redo_post, on_undo),
    (bpy.app.handlers.load_post, on_load),
    (bpy.app.handlers.save_pre, on_save_pre),
    (bpy.app.handlers.save_post, on_save_post),
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.fx4_links = bpy.props.CollectionProperty(type=FX4Link)
    bpy.types.Scene.fx4_link_index = bpy.props.IntProperty()
    for handlers, fn in HANDLERS:
        handlers.append(fn)
    bpy.app.timers.register(tick, first_interval=0.5, persistent=True)
    bpy.app.timers.register(start_watch, first_interval=0.5)


def unregister():
    if bpy.app.timers.is_registered(tick):
        bpy.app.timers.unregister(tick)
    for handlers, fn in HANDLERS:
        if fn in handlers:
            handlers.remove(fn)
    try:
        for link in links():
            remove_preview(link.uid)
    except AttributeError:
        pass
    conn.close()
    del bpy.types.Scene.fx4_links
    del bpy.types.Scene.fx4_link_index
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
