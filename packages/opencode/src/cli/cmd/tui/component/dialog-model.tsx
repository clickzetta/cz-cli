import { createMemo, createSignal } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { DialogVariant } from "./dialog-variant"
import { useKeybind } from "../context/keybind"
import * as fuzzysort from "fuzzysort"

export function useConnected() {
  const sync = useSync()
  return createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
}

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const keybind = useKeybind()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()

  const hasLlmEntries = createMemo(() => sync.data.llm_entries.length > 0)
  const showExtra = createMemo(() => (connected() || hasLlmEntries()) && !props.providerID)
  const llmOptionKey = (entryName: string, providerID: string, modelID: string) => `llm:${entryName}:${providerID}:${modelID}`

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = showExtra() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((x) => x.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: `${category}:${provider.id}:${model.id}`,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const llmEntries = sync.data.llm_entries

    const providerOptions = llmEntries.flatMap((entry) => {
      const provider = sync.data.provider.find((x) => x.id === entry.name)

      if (!entry.model && entry.provider === "clickzetta" && provider) {
        return Object.entries(provider.models)
          .filter(([_, info]) => info.status !== "deprecated")
          .map(([modelID, info]) => ({
            key: llmOptionKey(entry.name, entry.name, modelID),
            value: { providerID: entry.name, modelID },
            title: info.name ?? modelID,
            description: undefined as string | undefined,
            category: entry.name,
            disabled: false,
            footer: undefined as string | undefined,
            onSelect() {
              onSelect(entry.name, modelID)
            },
          }))
      }

      const modelInfo = entry.model ? provider?.models[entry.model] : undefined
      const modelID = entry.model ?? Object.keys(provider?.models ?? {})[0] ?? ""
      const defaultModelInfo = !entry.model && provider ? provider.models[modelID] : undefined
      const title = entry.model
        ? (modelInfo?.name ?? entry.model)
        : ((defaultModelInfo?.name ?? modelID) || entry.provider)
      return [{
        key: llmOptionKey(entry.name, entry.name, modelID),
        value: { providerID: entry.name, modelID },
        title,
        description: undefined as string | undefined,
        category: entry.name,
        disabled: false,
        footer: undefined as string | undefined,
        onSelect() {
          onSelect(entry.name, modelID)
        },
      }]
    })

    const moaProvider = sync.data.provider.find((x) => x.id === "moa")
    if (moaProvider) {
      for (const [modelID, info] of Object.entries(moaProvider.models)) {
        providerOptions.push({
          key: llmOptionKey(moaProvider.id, moaProvider.id, modelID),
          value: { providerID: moaProvider.id, modelID },
          title: info.name ?? modelID,
          description: undefined as string | undefined,
          category: moaProvider.name,
          disabled: false,
          footer: undefined as string | undefined,
          onSelect() {
            onSelect(moaProvider.id, modelID)
          },
        })
      }
    }

    if (needle) {
      return fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
    }

    if (llmEntries.length > 0) {
      return providerOptions
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((x) => x.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  const currentKey = createMemo(() => {
    const current = local.model.current()
    if (!current) return undefined
    return llmOptionKey(current.providerID, current.providerID, current.modelID)
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      keybind={[
        {
          keybind: keybind.all.model_favorite_toggle?.[0],
          title: "Favorite",
          disabled: !showExtra(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      currentKey={currentKey()}
      current={local.model.current()}
    />
  )
}
