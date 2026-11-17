# Studio tasks

Type: current behavior; status: implemented locally; Jira: ZS-19743.

## Elasticsearch to Lakehouse setup

For single-table Elasticsearch sources, `task integration setup` checks whether the Lakehouse target exists. An existing table is retained. For an absent table, the CLI calls the authority `getDdl` endpoint with the Elasticsearch source and Lakehouse target types, rewrites the target name, and executes that DDL before requesting the paired source/sink column metadata.

The server owns source-to-Lakehouse type conversion, including unsigned numeric precision. The CLI does not infer Lakehouse types from Elasticsearch type names. A source metadata, schema/table existence lookup, or table creation error stops setup before task content is saved. Failed existence lookups propagate as errors; only a successful empty lookup means the object is absent. After creation, the paired metadata endpoint reads the actual target schema to generate the column mapping.

This behavior relies on the common datasource library loaded by authority. Deploy the matching library and authority build before checking an updated type conversion such as `unsigned_long` to `DECIMAL(20,0)`. A CLI build alone cannot fix server-side type inference. Kafka setup retains its existing metadata path.
