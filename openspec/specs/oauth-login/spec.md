# oauth-login Specification

## Purpose
Defines the behavior of the cz-cli SDK authentication layer (`packages/clickzetta-sdk/src/auth`) when integrating ClickZetta OAuth2 authorization code + PKCE login: initiating login in OAuth mode, exchanging the authorization code for `access_token`/`refresh_token`, rotating and renewing tokens via the refresh token when they expire, querying userinfo with the access_token, and remaining fully compatible with legacy login when the server has not enabled OAuth. The `cz-cli login` command uses browser loopback OAuth as its default entry point; after a successful login it establishes/updates a profile based on userinfo, persists the OAuth token, and configures the LLM. The SDK still retains the explicitly enabled lower-level capability of local callback listening (`CZ_OAUTH_LOCAL_CALLBACK`) for reuse by other flows.

The OAuth client is fixed as `official-cli` (public type, PKCE enforced), `scope = "openid profile offline_access"`, `redirect_uri = "http://127.0.0.1/callback"`, `codeChallengeMethod = "S256"`. No error message or log may output `code_verifier`, the plaintext authorization code, `access_token`, or `refresh_token`.

## Requirements

### Requirement: Initiate login in OAuth mode and generate PKCE

When `loginWithPassword` / `loginWithPat` initiate login against `/clickzetta-portal/user/loginSingle`, they should append an `oauthLoginParam` object to the existing request body, containing `oauthLogin = true`, `clientId = "official-cli"`, `redirectUri = "http://127.0.0.1/callback"`, `scope = "openid profile offline_access"`, `codeChallengeMethod = "S256"`, and the `codeChallenge` computed from a freshly generated PKCE `code_verifier` for each login (`base64url(SHA-256(code_verifier))`, without padding). The `code_verifier` resides in memory only and must not be written to disk or logs.

#### Scenario: Login request carries oauthLoginParam and a valid codeChallenge

- **WHEN** the user calls `loginWithPassword(baseUrl, user, pass, instance)`
- **THEN** the request body sent to `/clickzetta-portal/user/loginSingle` retains `username`/`password`/`instanceName` and appends `oauthLoginParam`, where `oauthLogin=true`, `clientId="official-cli"`, `redirectUri="http://127.0.0.1/callback"`, `scope="openid profile offline_access"`, `codeChallengeMethod="S256"`
- **AND** `oauthLoginParam.codeChallenge` equals the `base64url(SHA-256(...))` of the `code_verifier` sent to `/oauth2/token`

#### Scenario: Each login generates a brand-new, non-reused code_verifier (boundary)

- **WHEN** multiple OAuth logins are initiated consecutively
- **THEN** each generated `code_verifier` has a length within the RFC 7636 range of 43–128 unreserved characters
- **AND** the `code_verifier` values across logins are all distinct and must not be reused across logins

### Requirement: Exchange the authorization code for an OAuth token

When the login response `data.authorizationCode` is non-empty, the CLI should POST to `/oauth2/token` as `application/x-www-form-urlencoded`, with a request body containing `grant_type="authorization_code"`, `code`, `client_id="official-cli"`, `redirect_uri="http://127.0.0.1/callback"`, `code_verifier`. On success it writes `access_token` into `AuthToken.token`, `refresh_token` into `AuthToken.refreshToken`, `expires_in` (seconds) multiplied by 1000 into `expireTimeMs`, and records `obtainedAt`.

#### Scenario: Authorization code exchange succeeds and correctly maps AuthToken

- **WHEN** the login returns `authorizationCode` and `/oauth2/token` returns `access_token`, `refresh_token`, `expires_in=900`
- **THEN** the returned `AuthToken.token` equals `access_token` and `AuthToken.refreshToken` equals `refresh_token`
- **AND** `AuthToken.expireTimeMs` equals `900 * 1000`

#### Scenario: Exchange fails, returns invalid_grant error, and does not leak sensitive values (exception)

- **WHEN** `/oauth2/token` returns `error=invalid_grant` for the authorization code exchange (code expired/already used/validation failed)
- **THEN** the CLI throws an `InterfaceError` indicating the authorization code / validation failure, and does not reuse the same authorization code to exchange again
- **AND** the error message does not contain `code_verifier`, the plaintext authorization code, `access_token`, or `refresh_token`

### Requirement: Refresh Token rotation and renewal

When the cached token is judged expired per `EXPIRED_FACTOR = 0.8` and a `refreshToken` is held, `getToken` should prefer to renew by calling `/oauth2/token` with `grant_type="refresh_token"`, `refresh_token`, `client_id="official-cli"`, rather than going through a full login again. On successful renewal it should overwrite the old value with the new `refresh_token` returned by the server's rotation, and all subsequent renewals use the latest value. On renewal failure (e.g. `invalid_grant`) it should clear the cache and fall back to a full login.

#### Scenario: Expired token is renewed and rotated via refresh_token

- **WHEN** the cached token is expired and holds `refresh-1`, and `getToken` is called again
- **THEN** the CLI calls `/oauth2/token` with `grant_type=refresh_token` carrying `refresh-1`, without triggering a new portal login
- **AND** after successful renewal, the cached `refreshToken` is replaced with the latest value returned by the server, and the next renewal uses that latest value

#### Scenario: Renewal failure falls back to full login (exception)

- **WHEN** the cached token is expired and the refresh renewal returns `invalid_grant`
- **THEN** the CLI clears the invalid cache and performs a full portal login as a fallback
- **AND** ultimately returns the new token obtained via the fallback login

### Requirement: Query UserInfo

The CLI should be able to call `GET /oauth2/userinfo` with `Authorization: Bearer <access_token>` to obtain the current user's information and parse the returned fields; during processing and display it must not output sensitive fields such as `access_token` or `refresh_token`.

#### Scenario: Successfully obtain userinfo with a Bearer token

- **WHEN** `fetchUserInfo(baseUrl, accessToken)` is called with a valid `access_token`
- **THEN** the request carries the `Authorization: Bearer <access_token>` header and requests `/oauth2/userinfo`
- **AND** returns the parsed user information fields

#### Scenario: An invalid access_token returns invalid_token and does not leak the token (exception)

- **WHEN** `/oauth2/userinfo` returns `error=invalid_token` because the token is invalid
- **THEN** the CLI throws an `InterfaceError` indicating an authentication failure
- **AND** the error message does not contain the plaintext value of `access_token`

### Requirement: Backward compatibility with legacy login

When `oauthLoginParam` is not carried, or the server does not return a non-empty `authorizationCode` in the OAuth-mode login response, the CLI should retain the legacy token returned by the login and must not call `/oauth2/token`. The public signatures of `loginWithPat` and `loginWithPassword` remain compatible; in legacy mode `AuthToken` does not contain `refreshToken`, and the existing retry, backoff, and instance configuration error detection logic is unchanged.

#### Scenario: Retain the legacy token when there is no authorizationCode

- **WHEN** login succeeds but the response `data.authorizationCode` is empty
- **THEN** the returned `AuthToken.token` equals the legacy token returned by the portal
- **AND** the number of calls to `/oauth2/token` is 0, and `AuthToken.refreshToken` is undefined

#### Scenario: Re-login rather than renew when only an expired legacy token is held (boundary)

- **WHEN** the cache holds only an expired legacy token (no `refreshToken`) and `getToken` is called again
- **THEN** the CLI performs a full portal login to obtain a new token
- **AND** never calls `/oauth2/token` throughout

### Requirement: SDK local callback listening as an explicitly enabled lower-level capability

The CLI should implement a local loopback callback listening flow (`waitForAuthorizationCode`, which receives and validates `?code=&state=` once on `127.0.0.1`). This lower-level capability is gated by the switch `CZ_OAUTH_LOCAL_CALLBACK` (set to `1` or `true`), controlling whether the SDK password/PAT login flow engages local listening during login; when the switch is not enabled, this flow must not start any local listening port. The browser entry point of the `cz-cli login` command does not depend on this switch (see the "`cz-cli login` command integrates browser login" requirement): regardless of whether the switch is enabled, `cz-cli login` uses the browser loopback authorization flow by default.

#### Scenario: SDK password/PAT flow does not start local listening when the switch is not enabled

- **WHEN** SDK password/PAT login runs without `CZ_OAUTH_LOCAL_CALLBACK` set (or with a value other than `1`/`true`)
- **THEN** `isLocalCallbackEnabled()` returns false
- **AND** that login flow does not call `waitForAuthorizationCode` and does not occupy any local port

#### Scenario: Once enabled, can parse the authorization code and validate state (boundary)

- **WHEN** `CZ_OAUTH_LOCAL_CALLBACK=1` is set and `waitForAuthorizationCode` is explicitly called to receive a callback request carrying `code` with a matching `state`
- **THEN** the method resolves with the parsed authorization code and closes the listener
- **AND** when the callback lacks `code` or `state` does not match, the method rejects and closes the listener, without leaking the authorization code value

### Requirement: Cross-process persistence of the Refresh Token

When login or refresh succeeds and yields an OAuth `AuthToken` containing a `refreshToken`, the CLI should persist `token` (access_token), `refreshToken`, `expireTimeMs`, `obtainedAt`, `instanceId`, `userId` under the current profile's entry in `~/.clickzetta/profiles.toml` (an OAuth subtable), reusing the existing atomic write and `0o600` permission mechanism, and must not write the token to any log. When a new process initiates an operation that requires a token: if the persisted token is judged not expired per `EXPIRED_FACTOR = 0.8`, it is reused directly, without re-login and without calling `/oauth2/token`; if it is expired but contains a `refreshToken`, that refresh token is used to call `/oauth2/token` for renewal, and the rotated new value is written back to the persistent store; on renewal failure (e.g. `invalid_grant`), the persisted OAuth token for that profile is cleared and it falls back to a full login. Persistence is isolated by profile + instance: the OAuth token slot is keyed by **instance** (no longer accompanied by pat/username), and tokens of different profiles/instances are not cross-used. The OAuth token represents the user's own login identity; removing or rotating pat/username must not orphan an already-persisted token slot. This mechanism is injected into the SDK authentication layer via an optional `tokenStore` interface on `ConnectionConfig`; when this interface is not injected, the behavior degrades to the existing pure in-memory cache, preserving backward compatibility.

#### Scenario: A persisted, non-expired token is reused directly in a new process

- **WHEN** a profile-backed `tokenStore` is injected, the persisted access_token is not expired, and a new process calls `getToken`
- **THEN** the CLI reuses the persisted access_token directly, calling neither `/clickzetta-portal/user/loginSingle` nor `/oauth2/token`
- **AND** does not write a new token entry to profiles.toml

#### Scenario: Persisted refresh token renewal fails and falls back to full login (exception)

- **WHEN** the persisted token is expired and the CLI calls `/oauth2/token` with the persisted refresh token for renewal, which returns `error=invalid_grant`
- **THEN** the CLI clears the persisted OAuth token entry for that profile in profiles.toml and falls back to performing a full portal login
- **AND** error handling and logging do not output `code_verifier`, the plaintext authorization code, `access_token`, or `refresh_token`

### Requirement: Persisted OAuth token as a SQL authentication credential

Commands that require a token, such as `cz-cli sql`, perform an authentication pre-check in `getExecContext`: when the resolved profile has neither a pat nor username/password, but a loadable persisted OAuth token exists under its OAuth slot for the corresponding instance (obtained via the injected `tokenStore.load()`), the CLI should treat that persisted OAuth token as a sufficient authentication credential and proceed directly into the token retrieval / execution flow, without throwing a missing-credential error (`NO_CREDENTIALS` / an error beginning with "Authentication required"). When there is neither a pat/username nor a persisted OAuth token, the CLI should still throw an error beginning with "Authentication required" (mapped by error classification to `NO_CREDENTIALS`), and guide toward `--pat`/`--username`/`--password` or `cz-cli login` (browser OAuth, or `--credential <b64>`).

#### Scenario: A pure OAuth profile executes SQL with a persisted token without reporting NO_CREDENTIALS

- **WHEN** a profile has no pat and no username/password, but a persisted OAuth token exists under its OAuth slot for the corresponding instance, and running `cz-cli sql` triggers the `getExecContext` authentication pre-check
- **THEN** the pre-check passes, does not throw a missing-credential error beginning with "Authentication required", and uses that persisted OAuth token for authentication directly

#### Scenario: Still report authentication missing when there is neither a credential nor an OAuth token (boundary)

- **WHEN** a profile has neither a pat/username/password nor any persisted OAuth token, and running `cz-cli sql` triggers the authentication pre-check
- **THEN** the CLI throws an error beginning with "Authentication required" (mapped to `NO_CREDENTIALS`), and guides toward `--pat`/`--username`/`--password` or `cz-cli login` (browser OAuth, or `--credential <b64>`)

### Requirement: Browser loopback authorization flow (dynamic redirect_uri)

When the switch `CZ_OAUTH_LOCAL_CALLBACK` is enabled, the CLI should follow the standard OAuth browser loopback authorization flow: first start a one-time HTTP listener on `127.0.0.1` at a random port assigned by the system, and generate a dynamic `redirect_uri = "http://127.0.0.1:<port>/callback"` based on the actual port; serialize `oauthLoginParam` (containing `oauthLogin=true`, `clientId`, the dynamic `redirectUri`, `scope`, `codeChallenge`, `codeChallengeMethod="S256"`, a random `state`) to JSON and base64-encode it, appending it as the query parameter `oauthLoginParam` to the accounts login page URL, then open the system default browser to that URL and print the URL in the terminal for manual opening; after a successful front-end login it redirects back to `http://127.0.0.1:<port>/callback?code=...&state=...`, and the local listener, after validating that `state` matches the value it initiated with, extracts `code` and closes the listener; the CLI then calls `/oauth2/token` to exchange for a token using **exactly** the same dynamic `redirect_uri`, `client_id`, `code_verifier` as in the listening phase. The `redirect_uri` is no longer hardcoded to a fixed `http://127.0.0.1/callback`, and the token exchange endpoint accepts the `redirect_uri` passed in by the caller. Throughout the flow, `code_verifier`, the plaintext authorization code, `access_token`, and `refresh_token` must not be output to logs, and `state` is used only for one-time validation. When the switch is not enabled, the existing default path is preserved, with no local listener started and no browser opened.

#### Scenario: The dynamic redirect_uri is byte-identical in the authorize URL and at token exchange

- **WHEN** the browser loopback flow is enabled, the local listener is ready on random port `<port>`, and `redirect_uri = "http://127.0.0.1:<port>/callback"` is generated accordingly
- **THEN** the `redirectUri` in the `oauthLoginParam` appended to the accounts login page (after base64-JSON decoding) equals that dynamic `redirect_uri`
- **AND** after the front-end redirect yields `code`, the `redirect_uri` carried when calling `/oauth2/token` is byte-identical to the `redirectUri` inside the authorize URL, and equals `http://127.0.0.1:<actual listening port>/callback`

#### Scenario: A state mismatch or callback timeout fails without exchanging a token (exception)

- **WHEN** the `state` in the callback received by the local listener does not match the random `state` generated at initiation, or no callback is received within the timeout
- **THEN** the CLI aborts the login and returns a clear error, closing the local listener
- **AND** does not continue to call `/oauth2/token` with an errored or forged `code`, and the error message does not output `code_verifier`, the plaintext authorization code, `access_token`, or `refresh_token`

### Requirement: `cz-cli login` adaptive login entry point (default browser OAuth, builds profile + configures LLM)

The CLI should provide a top-level command `cz-cli login` as a unified adaptive authentication entry point, reusing the global connection parameters (`--profile`/`--instance`/`--service`, etc.) to resolve the current `ConnectionConfig`, and dispatch by argv:

- **`--credential <b64>`** → new-user credential path: decode the base64(JSON) credential, use it to create the profile specified by `--name` (default `default`), set it as the default profile, and configure the ClickZetta LLM based on the `apiKey`/`aimeshEndpointBaseUrl` in the credential; when the credential is invalid or the profile already exists, error with `INVALID_CREDENTIAL`/`PROFILE_EXISTS` respectively and do not persist.
- **`--pat`, `--username`/`--password`, `--login-method`, `--login`** (explicit non-interactive credentials or portal-discovery signals) → delegate to the shared non-interactive/portal-discovery configuration flow (the same implementation as the `setup` alias), covering CI/agent and username/password portal discovery.
- **Default (without any of the above credential flags)** → browser loopback authorization flow (see the "Browser loopback authorization flow" requirement), automatically launching the system browser and printing the authorize URL in the terminal. `--browser` is retained as a hidden no-op (the browser is already the default) and is no longer an enabling switch; the browser entry point of `cz-cli login` does not error or refuse login due to a missing `--browser` or an unset `CZ_OAUTH_LOCAL_CALLBACK`.

After the default browser path successfully obtains a token, the CLI should call `/oauth2/userinfo` to query the current user's information, and backfill its `userId` (falling back to parsing `sub`) and `instanceId` (`instanceList[0].id`) into the `AuthToken` to be persisted (overwriting only when they are valid positive integers). When the target profile does not exist, the CLI should first establish that profile based on userinfo (creating it is the core path of "superseding setup"), and **flatly map** the useful fields from userinfo to the top level of that profile entry, each to its canonical location: the connection context `service`/`protocol`/`instance`/`workspace`/`schema`/`vcluster`/`user_id`, the `account_id`/`account_name` mapped from `account_id`/`accountName`, and `aimeshEndpointBaseUrl` written under its original name (the same field the `--credential` path writes, for reuse by `clickzetta-rotation`/`ai-gateway`); among these, `instance` prefers userinfo's `instanceName` (falling back to `instanceList[0].name`). The CLI does **not** separately store the full userinfo response body as a `[profiles.<name>.userinfo]` subtable: each consumer's required fields have a top-level canonical home (connection fields + `aimeshEndpointBaseUrl`, with `apiKey` going into `llm.json`), and archiving it verbatim would only duplicate storage and introduce drift risk, so fields with no top-level home and no current consumer, such as `instanceList`/`gatewayMapping`/`sub`/`preferred_username`/`name`, are all discarded. The CLI should also configure the ClickZetta LLM based on userinfo's `apiKey`/`aimeshEndpointBaseUrl` (skipping LLM configuration when `apiKey` is missing). It then persists the token via that profile's token store (see the "Cross-process persistence of the Refresh Token" requirement), using the final `instance` as the token slot key (by instance only, without pat/username), sets that profile as the default profile, and outputs the success result (containing `logged_in`/`instance`/`workspace`/`user_id`/`llm_configured`/`expires_in_ms`), without echoing sensitive values such as `access_token` or `refresh_token`. A `/oauth2/userinfo` query failure (e.g. `invalid_token`, network error) is treated as non-fatal: the login completes with the already-exchanged token retained, the connection context is not written back, the LLM is not configured, the overall login must not fail, and token plaintext must not be output to logs (at most the userinfo field names are output under `CZ_OAUTH_DEBUG`). If login fails (`state` mismatch, timeout, token exchange failure, etc.), the CLI should return a clear error and exit with a non-zero code, without persisting any token. The CLI does not remove the legacy portal token fallback for when the server has not enabled OAuth (see the "Backward compatibility with legacy login" requirement): OAuth is an alternative interactive entry point, not a removal of legacy authentication.

#### Scenario: Default browser login succeeds, persists the token, and the output contains no sensitive values

- **WHEN** `cz-cli login` (without any credential flag) runs and the browser loopback flow successfully exchanges for an OAuth token
- **THEN** the CLI persists that token (including `access_token`, `refreshToken`, `expireTimeMs`, `userId`) via the current profile's token store, and outputs a login-success result
- **AND** the success output does not contain the plaintext value of `access_token` or `refresh_token`, the exit code is 0, and there is no need to pass `--browser` or set `CZ_OAUTH_LOCAL_CALLBACK`

#### Scenario: Default browser login builds a profile from scratch and configures the LLM

- **WHEN** the target profile does not yet exist when `cz-cli login` runs, the browser login succeeds, and `/oauth2/userinfo` returns a response body containing `instanceName`/`workspaceName`/`apiKey`/`aimeshEndpointBaseUrl`
- **THEN** the CLI establishes that profile based on userinfo (with complete connection fields), sets it as the default profile, and writes an LLM entry with `provider="clickzetta"`, `api_key` (from `apiKey`), `base_url` (from `aimeshEndpointBaseUrl`) into `llm.json`
- **AND** the `llm_configured` in the success output is `true`, and it does not echo the plaintext of `apiKey`/`access_token`/`refresh_token`

#### Scenario: The `--credential` path builds a profile + configures the LLM, equivalent to the original setup (new user)

- **WHEN** `cz-cli login --credential <b64> --name <name>` runs and the credential contains `instanceName`/`accessToken`/`apiKey`/`aimeshEndpointBaseUrl`
- **THEN** the CLI creates the `<name>` profile (with `instance`/`workspace`/`schema`/`vcluster`/`pat`/`service`/`protocol` and other fields consistent with the credential), sets it as default, and configures the ClickZetta LLM in `llm.json`, with exit code 0, without initiating the browser loopback flow
- **AND (boundary)** when the credential base64/JSON is invalid it errors with `INVALID_CREDENTIAL`, and when the target profile already exists it errors with `PROFILE_EXISTS`; in both cases it does not persist and does not overwrite an existing profile

#### Scenario: userinfo backfills identity and connection context and writes back to the profile

- **WHEN** after the browser login successfully exchanges a token, `/oauth2/userinfo` returns `userId=110000011361`, `instanceList[0].id=159973`, `instanceName="89b94150"`, `workspaceName="quick_start"`, `schema="public"`, `virtualCluster="DEFAULT_AP"`
- **THEN** the `AuthToken.userId` to be persisted is backfilled to `110000011361`, `AuthToken.instanceId` is backfilled to `159973`, and `service`/`protocol`/`instance` (taking `89b94150`)/`workspace`/`schema`/`vcluster`/`user_id` are written back to the current profile entry
- **AND** the token is persisted under the final instance slot key `89b94150` (by instance only, without pat/username), and a subsequent `resolveConnectionConfig` can recover that token accordingly

#### Scenario: userinfo is flatly mapped to the profile top level without a separate userinfo subtable

- **WHEN** after a successful browser login, `/oauth2/userinfo` returns a complete response body (containing `aimeshEndpointBaseUrl`, `apiKey`, `account_id=112407`, `accountName="wynptmks"`, along with fields such as the `instanceList` object array and the `gatewayMapping` JSON string)
- **THEN** the CLI SHALL write the useful fields flatly into their respective canonical locations at the top level of the current profile entry: the connection fields, `account_id`/`account_name`, and `aimeshEndpointBaseUrl` written under its original name; `apiKey` is written into `llm.json`; the write reuses the atomic write and `0o600` permission mechanism
- **AND** the CLI SHALL NOT create a `[profiles.<name>.userinfo]` subtable under the profile entry; fields with no top-level home such as `instanceList`/`gatewayMapping`/`sub`/`preferred_username`/`name` are discarded
- **AND (boundary/security)** sensitive values such as `apiKey` are stored only in the `0o600` file, and do not appear in the login-success output or any log; the write does not touch that profile's `oauth` subtable or other unrelated fields

#### Scenario: Login still succeeds when the userinfo query fails (boundary)

- **WHEN** the browser login successfully exchanges a token, but the subsequent `/oauth2/userinfo` returns `error=invalid_token` (HTTP 401) or a network error
- **THEN** the CLI still completes the login with the already-exchanged token, `userId`/`instanceId` remain at the default value 0, and the userinfo-derived connection context is not written back
- **AND** the overall login does not fail because of the userinfo failure, and the log does not output the plaintext of `access_token`/`refresh_token`

#### Scenario: Explicit non-interactive credentials delegate to the shared configuration flow rather than the browser (boundary)

- **WHEN** `cz-cli login --pat <PAT>` (or `--username`/`--password`, `--login-method`, `--login`) runs
- **THEN** the CLI delegates to the shared non-interactive/portal-discovery configuration flow (the same implementation as the `setup` alias), does not initiate the browser loopback flow, and does not open the system browser
- **AND** the profile-building / validation behavior of that path is byte-identical to when executed via `setup` (the same underlying logic)

#### Scenario: Browser login failure exits non-zero and does not persist (exception)

- **WHEN** `cz-cli login` runs the default browser path but the loopback flow throws due to a `state` mismatch, callback timeout, or token exchange failure
- **THEN** the CLI returns a clear error and exits with a non-zero code
- **AND** does not write any token to the profile's token store, and the error message does not output `code_verifier`, the plaintext authorization code, `access_token`, or `refresh_token`
