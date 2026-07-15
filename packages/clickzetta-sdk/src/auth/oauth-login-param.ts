import {
  OAUTH_CLIENT_ID,
  OAUTH_CODE_CHALLENGE_METHOD,
  OAUTH_SCOPE,
} from "./oauth-constants.js"

/**
 * The `oauthLoginParam` object sent to the portal (`/user/loginSingle`) and
 * serialized into the browser authorize URL. `state` is optional and only
 * present in the browser loopback flow (requirement 10.3); the credential
 * path omits it.
 */
export interface OauthLoginParam {
  oauthLogin: true
  clientId: string
  redirectUri: string
  scope: string
  codeChallenge: string
  codeChallengeMethod: string
  state?: string
}

/**
 * Build the `oauthLoginParam` payload. The fixed fields (`oauthLogin`,
 * `clientId`, `scope`, `codeChallengeMethod`) come from constants; the
 * caller supplies the dynamic `redirectUri`, `codeChallenge`, and optional
 * `state`. `state` is only included when provided so the credential path
 * stays byte-equivalent to its previous payload.
 */
export function buildOauthLoginParam(input: {
  redirectUri: string
  codeChallenge: string
  state?: string
}): OauthLoginParam {
  return {
    oauthLogin: true,
    clientId: OAUTH_CLIENT_ID,
    redirectUri: input.redirectUri,
    scope: OAUTH_SCOPE,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: OAUTH_CODE_CHALLENGE_METHOD,
    ...(input.state === undefined ? {} : { state: input.state }),
  }
}

/**
 * Base64-encode the JSON form of an {@link OauthLoginParam} for use as the
 * `oauthLoginParam` query parameter on the accounts authorize URL.
 */
export function encodeOauthLoginParam(param: OauthLoginParam): string {
  return Buffer.from(JSON.stringify(param)).toString("base64")
}
