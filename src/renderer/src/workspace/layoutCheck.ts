// Checks a stored dockview layout before it is restored. dockview doesn't check component names
// itself: an unknown one (a panel renamed or removed in a later version, a hand-edited settings
// file) only fails when React renders it, which would blank the app on every start.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Why `layout` can't be restored, or null when it can: every panel must use a known content
 * component (and a known tab component, if any), and the panel `required` must be there.
 */
export function layoutProblem(
  layout: unknown,
  known: { components: readonly string[]; tabComponents: readonly string[]; required: string }
): string | null {
  if (!isObject(layout) || !isObject(layout.grid) || !isObject(layout.panels)) return 'not a panel layout'
  for (const [id, panel] of Object.entries(layout.panels)) {
    if (!isObject(panel)) return `panel "${id}" is malformed`
    const { contentComponent, tabComponent } = panel
    if (typeof contentComponent !== 'string' || !known.components.includes(contentComponent)) {
      return `panel "${id}" uses an unknown component`
    }
    if (tabComponent !== undefined && (typeof tabComponent !== 'string' || !known.tabComponents.includes(tabComponent))) {
      return `panel "${id}" uses an unknown tab`
    }
  }
  if (!isObject(layout.panels[known.required])) return `the "${known.required}" panel is missing`
  return null
}
