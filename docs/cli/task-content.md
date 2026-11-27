# Saving task content

`cz-cli task save-content <task> -f script.sql` reads the current draft before
saving and sends back its runtime parameters, including existing IDs, bizdate
configuration, and encrypted references that have no returned value. If the
draft cannot be read or its parameter list is malformed, the command stops
before saving.

`--params '{"month":"$[yyyyMM]"}'` merges ordinary parameter values by key. The
command preserves existing IDs, other metadata, and unrelated parameters. Use
Studio to change encrypted or referenced parameters. An empty object leaves the
parameters intact. If you previously used `--params '{}'` to clear the list, use
`--clear-params` instead. The two options are mutually exclusive.

The command saves draft script content without writing scheduling fields. The
read and save are separate requests, so concurrent edits can race with a save.
