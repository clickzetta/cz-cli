/**
 * redirect-url.ts — port of cz_mcp/common/redirect_url_utils.py
 *
 * Python → TS mapping:
 *   redirect_url_utils.py:14-47   _build_ide_studio_url()  → buildIdeStudioUrl()
 *   redirect_url_utils.py:49-83   _build_ops_studio_url()  → buildOpsStudioUrl()
 *   redirect_url_utils.py:85-119  _build_dqc_studio_url()  → buildDqcStudioUrl()
 *
 * Divergences:
 *   - Python uses urlencode from urllib.parse; TS uses URLSearchParams.
 *   - Python's loguru logger replaced by console.warn.
 *   - Python reads base_url via read_web_url(env); TS accepts it as a parameter
 *     (callers pass config.baseUrl directly, matching the TS StudioConfig shape).
 */

import type { StudioConfig } from "../config/profile.js"

// redirect_url_utils.py:14-47
export function buildIdeStudioUrl(
  config: StudioConfig,
  dataTaskId: number,
): string | null {
  try {
    const baseUrl = config.baseUrl
    const workspaceName = config.workspace
    const instance = config.instance

    if (!baseUrl || !workspaceName || !instance) {
      console.warn("Cannot build Studio URL: missing baseUrl, workspace or instance")
      return null
    }

    const cleanBase = baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    const params = new URLSearchParams({
      workspace_name: workspaceName,
      fileId: String(dataTaskId),
    })
    return `https://${instance}.${cleanBase}/ide?${params.toString()}`
  } catch (e) {
    console.warn(`Error building Studio URL: ${e}`)
    return null
  }
}

// redirect_url_utils.py:49-83
export function buildOpsStudioUrl(
  config: StudioConfig,
  id: number,
  subPageName: string,
): string | null {
  try {
    const baseUrl = config.baseUrl
    const workspaceName = config.workspace
    const instance = config.instance

    if (!baseUrl || !workspaceName || !instance) {
      console.warn("Cannot build Studio URL: missing baseUrl, workspace or instance")
      return null
    }

    const cleanBase = baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    return `https://${instance}.${cleanBase}/ops/${subPageName}/${id}`
  } catch (e) {
    console.warn(`Error building Studio URL: ${e}`)
    return null
  }
}

// redirect_url_utils.py:85-119
export function buildDqcStudioUrl(
  config: StudioConfig,
  objectName: string,
): string | null {
  try {
    const baseUrl = config.baseUrl
    const projectId = config.projectId
    const instance = config.instance

    if (!baseUrl || !projectId || !instance) {
      console.warn("Cannot build Studio URL: missing baseUrl, projectId or instance")
      return null
    }

    const cleanBase = baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    return (
      `https://${instance}.${cleanBase}/dqc` +
      `?listType=qualityRule&objectName=${objectName}` +
      `&workspaceId=${projectId}&projectId=${projectId}&env=prod`
    )
  } catch (e) {
    console.warn(`Error building Studio URL: ${e}`)
    return null
  }
}
