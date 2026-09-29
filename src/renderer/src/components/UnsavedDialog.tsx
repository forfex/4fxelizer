import { answerUnsaved } from '@/projectActions'
import { useApp } from '@/store'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'

/** Asks whether to save the open project's changes before it's replaced or the window closes. */
export function UnsavedDialog() {
  const question = useApp((s) => s.unsavedPrompt)
  return (
    <Dialog open={question !== null} onOpenChange={(open) => !open && answerUnsaved('cancel')}>
      <DialogContent title="Unsaved changes" className="w-[min(420px,90vw)]">
        <div className="flex flex-col gap-4">
          <p>{question}</p>
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button variant="primary" autoFocus onClick={() => answerUnsaved('save')}>
              Save
            </Button>
            <Button onClick={() => answerUnsaved('discard')}>Don't save</Button>
            <Button onClick={() => answerUnsaved('cancel')}>Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
