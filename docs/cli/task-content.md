# Saving task content

`cz-cli task save-content <task> -f script.sql` reads the current draft before
saving and sends back its runtime parameters, including existing IDs, bizdate
configuration, and encrypted references that have no returned value. If the
draft cannot be read or its parameter list is malformed, the command stops
before saving. The legacy `task save` command also preserves the current
parameters and keeps its existing task-type support. Both commands reject drafts
with conflicting task types or parameter lists in the detail response.
Studio-only task types require Studio configuration when using `save-content`.

`--params '{"month":"$[yyyyMM]"}'` merges ordinary parameter values by key. The
command preserves existing IDs, other metadata, and unrelated parameters.
Parameter names must contain a non-whitespace character. Both `save-content` and
`create-setup` reject incomplete objects before making Studio requests. They
still accept complete objects whose quotes were escaped or stripped by Windows
shells. Pass the complete object as one argument. Dotted flags such as
`--params.month` are rejected. Use Studio to change encrypted or referenced
parameters. An empty object leaves the parameters intact. To clear the list, use
`--clear-params`. The two options are mutually exclusive.

The command saves draft script content without writing scheduling fields. The
read and save are separate requests, so concurrent edits can race with a save.
Draft save debug logs redact parameter lists. Command telemetry redacts the
payloads of `--param` and `--params` in argument attributes, including on failed
commands. Errors from the Studio draft read and save endpoints report status
information without displaying server response text that could contain parameter
values. On success, both content-save commands
return a local `Draft saved` acknowledgement and the Studio URL.

`task execute --param key=value --save-params` sends the supplied values with
their original backslashes and quotes in both the ad hoc execution and draft save.
