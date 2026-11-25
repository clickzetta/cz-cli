# Datasource list

`datasource list` returns the datasources a workspace can use. The command, its fields and the checks below are the contract; change them together with the tests.

## Scope

- The request carries the workspace's project id, so the backend filters by workspace. Without it the backend returns every datasource of the tenant.
- Each row has a `scope`:
  - `workspace`: bound to this workspace.
  - `shared`: usable from every workspace.
  - `unknown`: the backend gave no membership for the row. The row is kept, and the command never asserts that it belongs to the workspace.
- The backend matches the project id as a substring of `related_project_ids`, so project `3360001` also matches `60001`. The CLI drops rows whose ids do not contain the project exactly. The backend total still counts them, so `showing X of Y` can overcount and a page can hold fewer rows than `--page-size`. The message says how many rows were dropped.
- Name resolution for the other datasource commands (`catalogs`, `test` and so on) keeps its tenant-wide search; only `list` is scoped.

## Fields

`id`, `name`, `type`, `status`, `url`, `scope`, `tenantId`, `instanceId`, `connectionParams` (a JSON string) and `testFailedReason`.

`url` is the first address-like connection param, in this order: `jdbcUrl`, `url`, `uri`, `bootstrapServers`, `hosts`, `hostPortList`, `hostAndPorts`, `endpoint`, `metaStoreSlbUrl`, `metaStoreUrl`, then `host[:port]`. Lists are joined with commas. HBase, DynamoDB and SharePoint have no address param, so `url` is absent for them.

## Tenant and instance

`--tenant-id` and `--instance-id` are assertions, not selectors. The tenant comes from the login and the instance from `--instance`; the workspace comes from `--workspace` or the profile.

The assertions run after the login identity, the instance and the workspace are resolved, so those requests are still sent. A value that differs from the resolved context fails with `SCOPE_MISMATCH` and the datasource list request is not sent.

## Masking

`connectionParams` and `url` are masked by default (`********`). `--show-secrets` shows the plaintext for that invocation only; the output may then contain credentials.

Sources: [command](../../packages/cz-cli/src/commands/datasource.ts), [scope tests](../../packages/cz-cli/test/datasource-list-scope.test.ts), [masking tests](../../packages/cz-cli/test/datasource-list-secrets.test.ts).
