import path from "path"
import { Locale } from "opencode/util/locale"
import type { Part, ToolPart } from "@opencode-ai/core/v1/session"

export type PartDescription = {
  icon: string
  title: string
  description?: string
  output?: string
}

function normalizePath(input?: string): string {
  if (!input) return ""
  if (path.isAbsolute(input)) return path.relative(process.cwd(), input) || "."
  return input
}

function describeTool(part: ToolPart): PartDescription {
  const state = part.state
  const input = "input" in state ? (state.input as Record<string, unknown>) : {}

  switch (part.tool) {
    case "bash": {
      const command = typeof input.command === "string" ? input.command : ""
      const output =
        state.status === "completed" && typeof state.output === "string" ? state.output.trim() : undefined
      return { icon: "$", title: command, output }
    }
    case "read": {
      const filePath = typeof input.filePath === "string" ? input.filePath : ""
      const file = normalizePath(filePath)
      const pairs = Object.entries(input).filter(([key, value]) => {
        if (key === "filePath") return false
        return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      })
      const description = pairs.length
        ? `[${pairs.map(([key, value]) => `${key}=${value}`).join(", ")}]`
        : undefined
      return { icon: "→", title: `Read ${file}`, ...(description && { description }) }
    }
    case "write": {
      const filePath = typeof input.filePath === "string" ? input.filePath : ""
      const output = state.status === "completed" && typeof state.output === "string" ? state.output : undefined
      return { icon: "←", title: `Write ${normalizePath(filePath)}`, output }
    }
    case "edit": {
      const filePath = typeof input.filePath === "string" ? input.filePath : ""
      const metadata = "metadata" in state ? (state.metadata as Record<string, unknown> | undefined) : undefined
      const diff = metadata && typeof metadata.diff === "string" ? metadata.diff : undefined
      return { icon: "←", title: `Edit ${normalizePath(filePath)}`, output: diff }
    }
    case "glob":
    case "grep": {
      const pattern = typeof input.pattern === "string" ? input.pattern : ""
      const root = typeof input.path === "string" ? input.path : ""
      const metadata = "metadata" in state ? (state.metadata as Record<string, unknown> | undefined) : undefined
      const num =
        part.tool === "glob"
          ? typeof metadata?.count === "number"
            ? metadata.count
            : undefined
          : typeof metadata?.matches === "number"
            ? metadata.matches
            : undefined
      const inSuffix = root ? `in ${normalizePath(root)}` : ""
      const matchSuffix = num === undefined ? "" : `${num} ${num === 1 ? "match" : "matches"}`
      const description =
        inSuffix && matchSuffix ? `${inSuffix} · ${matchSuffix}` : inSuffix || matchSuffix || undefined
      const verb = part.tool === "glob" ? "Glob" : "Grep"
      return { icon: "✱", title: `${verb} "${pattern}"`, ...(description && { description }) }
    }
    case "webfetch": {
      const url = typeof input.url === "string" ? input.url : ""
      return { icon: "%", title: `WebFetch ${url}` }
    }
    case "codesearch": {
      const query = typeof input.query === "string" ? input.query : ""
      return { icon: "◇", title: `Exa Code Search "${query}"` }
    }
    case "websearch": {
      const query = typeof input.query === "string" ? input.query : ""
      return { icon: "◈", title: `Exa Web Search "${query}"` }
    }
    case "task": {
      const subagent =
        typeof input.subagent_type === "string" && input.subagent_type.trim().length > 0
          ? input.subagent_type
          : "unknown"
      const agent = Locale.titlecase(subagent)
      const desc =
        typeof input.description === "string" && input.description.trim().length > 0 ? input.description : undefined
      const icon =
        state.status === "error"
          ? "✗"
          : state.status === "running" || state.status === "pending"
            ? "•"
            : "✓"
      return {
        icon,
        title: desc ?? `${agent} Task`,
        ...(desc && { description: `${agent} Agent` }),
      }
    }
    case "skill": {
      const name = typeof input.name === "string" ? input.name : ""
      return { icon: "→", title: `Load skill "${name}"` }
    }
    case "todowrite": {
      const rawTodos = Array.isArray(input.todos) ? input.todos : []
      const todos = rawTodos.flatMap((item: unknown) => {
        if (typeof item !== "object" || item === null) return []
        const obj = item as Record<string, unknown>
        const content = typeof obj.content === "string" ? obj.content : ""
        const status = typeof obj.status === "string" ? obj.status : ""
        return [{ content, status }]
      })
      const output = todos.map((item) => `${item.status === "completed" ? "[x]" : "[ ]"} ${item.content}`).join("\n")
      const counts = { completed: 0, in_progress: 0, pending: 0 }
      let active: string | undefined
      for (const t of todos) {
        if (t.status === "completed") counts.completed++
        else if (t.status === "in_progress") {
          counts.in_progress++
          active ??= t.content
        } else counts.pending++
      }
      const summary =
        todos.length === 0
          ? undefined
          : active
            ? `${counts.completed}/${todos.length} done · in-progress: ${active}`
            : `${counts.completed}/${todos.length} done · ${counts.pending} pending`
      return {
        icon: "#",
        title: "Todos",
        ...(summary && { description: summary }),
        output,
      }
    }
    default: {
      const title =
        "title" in state && typeof state.title === "string" && state.title
          ? state.title
          : Object.keys(input).length > 0
            ? JSON.stringify(input)
            : "Unknown"
      return { icon: "⚙", title: `${part.tool} ${title}` }
    }
  }
}

export function describePart(part: Part): PartDescription {
  switch (part.type) {
    case "tool":
      return describeTool(part)
    case "text": {
      const text = part.text.trim()
      const preview = text.length > 96 ? text.slice(0, 93) + "..." : text
      return { icon: "✏", title: preview || "Generating response..." }
    }
    case "reasoning":
      return { icon: "💭", title: "Thinking..." }
    case "step-start":
      return { icon: "▶", title: "Calling LLM..." }
    case "step-finish":
      return { icon: "✓", title: `Step done (${part.reason})` }
    case "retry":
      return { icon: "↻", title: `Retry (attempt ${part.attempt})` }
    case "compaction":
      return { icon: "🗜", title: "Compacting context..." }
    case "patch":
      return { icon: "±", title: `Patch (${part.files.length} files)` }
    case "snapshot":
      return { icon: "◷", title: "Snapshot" }
    case "subtask":
      return { icon: "◔", title: `Subtask: ${part.description}` }
    case "agent":
      return { icon: "@", title: `Agent ${part.name}` }
    case "file":
      return { icon: "📎", title: `File ${part.filename ?? ""}` }
    default:
      return { icon: "·", title: (part as { type: string }).type }
  }
}

export function progressLine(part: Part): string {
  const d = describePart(part)
  return d.description ? `${d.icon} ${d.title} · ${d.description}` : `${d.icon} ${d.title}`
}
