import type { Argv } from "yargs"

export const CLICKZETTA_PROFILE_DESCRIPTION =
  "ClickZetta connection profile to use (overrides default_profile in profiles.toml)"

export const CLICKZETTA_PROFILE_OPTION = {
  type: "string",
  describe: CLICKZETTA_PROFILE_DESCRIPTION,
} as const

export const CLICKZETTA_PROFILE_OPTION_NAMES = ["profile", "p"] as const

export function withClickZettaProfileOption<T>(
  yargs: Argv<T>,
  describe = CLICKZETTA_PROFILE_DESCRIPTION,
) {
  return yargs.option("profile", {
    ...CLICKZETTA_PROFILE_OPTION,
    describe,
  }).alias("profile", "p")
}
