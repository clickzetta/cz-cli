function resolveAppBase(baseUrl: string): string {
  let base = baseUrl.replace(/^https?:\/\//, "")
  if (base.endsWith("/api")) return base.slice(0, -4) + "/app"
  return base.replace("-api.", "-app.").replace("api.", "app.")
}

export function studioUrl(sc: { instanceName: string; baseUrl: string; workspaceName: string }, fileId: number): string {
  return `https://${sc.instanceName}.${resolveAppBase(sc.baseUrl)}/ide?workspace_name=${encodeURIComponent(sc.workspaceName)}&fileId=${fileId}`
}

export function opsUrl(sc: { instanceName: string; baseUrl: string }, runId: number): string {
  return `https://${sc.instanceName}.${resolveAppBase(sc.baseUrl)}/ops/taskInst/${runId}`
}
