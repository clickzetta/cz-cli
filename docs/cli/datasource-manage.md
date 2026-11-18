# Datasource create, delete and upload-file

`datasource create`, `delete` and `upload-file` manage datasources of the current workspace. Credentials pass through these commands, so the handling below is part of the contract; change it together with the tests.

## create

`datasource create <name> --type <type> --params-file <file> [--description <text>]`

- The datasource is bound to the current workspace only. It is not opened to other workspaces.
- The connection params come from a JSON file, or from stdin with `--params-file -`. They are never read from argv, so credentials stay out of shell history and process lists.
- `dsName` and `dsDesc` in the params file are replaced by the command's name and description, so the top-level fields and the connection params of one request never disagree. The description is also written into the connection params, because the Studio edit page fills its form from them.
- The command does not test connectivity. Run `datasource test` afterwards.

### Credential handling

- Credentials are sent as given and the backend stores them unencrypted. The Studio web page encrypts them before saving (`ENCv2:` values); this command does not. Reading works either way, because a value without the `ENCv2:` prefix that does not decrypt is used as it is. This is the current backend behavior and was accepted as the documented limitation on 2026-11-18; encrypting in the CLI needs the datasource public key, which only the OpenAPI `getPublicKey` call returns and that call requires an AK/SK.
- When the params contain credential fields, the command writes a warning to stderr. The warning never contains a value.
- `--debug` logs the request path and headers but not the body (`body=<redacted>`). The request itself is unchanged.
- A params file that is not a JSON object fails with `INVALID_PARAMS` and a fixed message. The parser's own error is never shown, because it can quote the value it stopped at.
- `datasource list` masks credentials by default; `--show-secrets` shows them.

## delete

`datasource delete <datasource> [-y]` asks for confirmation unless `-y` is given. The backend refuses when tasks still use the datasource. On the dev environment the admin service answers 404 to the task-usage check, so the delete fails there; this is a backend deployment issue.

## upload-file

`datasource upload-file <path> [--expire-seconds <n>]` uploads a file such as a CA certificate and prints its URL, for the file fields of a datasource (for example `truststorePath`).

Only the base name of the local file goes over the wire. The file's bytes are copied into the upload: a `File` wrapped around a `BunFile` is sent under the full local path on Bun 1.3.14. The SDK sends `FormData` bodies as multipart, without the JSON content type.

Sources: [commands](../../packages/cz-cli/src/commands/datasource.ts), [debug redaction](../../packages/clickzetta-sdk/src/studio/client.ts), [command tests](../../packages/cz-cli/test/datasource-create-command.test.ts), [upload on the wire](../../packages/cz-cli/test/datasource-upload-wire.test.ts), [multipart](../../packages/clickzetta-sdk/test/multipart.test.ts).
