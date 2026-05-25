import { isDeepEqual } from "remeda"

export function resolveDialogSelectOptionKey<T>(option: { key?: string; value: T }) {
  return option.key ?? JSON.stringify(option.value)
}

export function findDialogSelectOptionIndex<T>(
  options: Array<{ key?: string; value: T }>,
  input: { current?: T; currentKey?: string },
) {
  if (input.currentKey) {
    const keyed = options.findIndex((option) => resolveDialogSelectOptionKey(option) === input.currentKey)
    if (keyed >= 0) return keyed
  }
  if (input.current === undefined) return -1
  return options.findIndex((option) => isDeepEqual(option.value, input.current))
}

export function isDialogSelectOptionCurrent<T>(
  option: { key?: string; value: T },
  input: { current?: T; currentKey?: string },
) {
  if (input.currentKey) return resolveDialogSelectOptionKey(option) === input.currentKey
  if (input.current === undefined) return false
  return isDeepEqual(option.value, input.current)
}

export function isDialogSelectOptionActive<T>(
  option: { key?: string; value: T },
  selected: { key?: string; value: T } | undefined,
) {
  if (!selected) return false
  return resolveDialogSelectOptionKey(option) === resolveDialogSelectOptionKey(selected)
}
