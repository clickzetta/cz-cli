# Task scheduling

`task save-cron` and `task save-config` (alias `save-schedule`) accept
`--schedule-created-type 1|2`: `1` activates the schedule the next day (T+1),
while `2` activates it after publishing. Saving configuration does not publish it.

```sh
cz-cli task save-cron my_task --cron '0 30 2 * * ? *' --schedule-created-type 1
cz-cli task save-config my_task --schedule-created-type 2
```

Omitting the option preserves the saved `scheduleCreatedType`; a new configuration
without a saved mode defaults to `2`. The SDK config writers accept
`scheduleCreatedType` and default to `2` when omitted. Callers editing existing
configurations must pass their saved value.

`task create-setup` accepts the same option for its optional cron configuration
save; supplying the option requires `--cron`. `task flow node-save-config` also accepts it and preserves the node's saved
mode when omitted. Invalid or repeated values fail before network access.
Draft-only `task create` does not set this field; select the mode when saving scheduling configuration.
