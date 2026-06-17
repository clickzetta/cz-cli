import * as Clipboard from "./clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string } | null
  clearSelection: () => void
}

export function copy(renderer: Renderer, toast: Toast): boolean {
  const text = renderer.getSelection()?.getSelectedText()
  if (!text) return false

  // Report the character count so the user can tell the copy actually happened,
  // and roughly how much was captured (matches the copy-on-select hint UX).
  const count = [...text].length
  const message = `Copied ${count} ${count === 1 ? "char" : "chars"} to clipboard`

  Clipboard.copy(text)
    .then(() => toast.show({ message, variant: "info" }))
    .catch(toast.error)

  renderer.clearSelection()
  return true
}
