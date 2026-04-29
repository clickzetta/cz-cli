import { cmd } from "./cmd"
import type { Argv } from "yargs"
import {
  listProfiles,
  getProfile,
  createProfile,
  deleteProfile,
  useProfile,
  updateProfile,
} from "../../profile"

const ProfileListCommand = cmd({
  command: "list",
  describe: "list all configured profiles",
  builder: (yargs: Argv) =>
    yargs.option("show-secret", {
      type: "boolean",
      describe: "show passwords and tokens",
      default: false,
    }),
  async handler(args: { showSecret: boolean }) {
    const data = listProfiles(args.showSecret)
    const names = Object.keys(data.profiles)
    if (names.length === 0) {
      console.log("No profiles configured. Create one with: czagent profile create <name>")
      return
    }
    for (const name of names) {
      const isDefault = name === data.default_profile ? " (default)" : ""
      console.log(`\n${name}${isDefault}`)
      const p = data.profiles[name]
      for (const [k, v] of Object.entries(p)) {
        if (v !== undefined) console.log(`  ${k}: ${v}`)
      }
    }
  },
})

const ProfileShowCommand = cmd({
  command: "show <name>",
  describe: "show a profile's details",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", demandOption: true, describe: "profile name" })
      .option("show-secret", { type: "boolean", default: false, describe: "show passwords and tokens" }),
  async handler(args: { name: string; showSecret: boolean }) {
    const p = getProfile(args.name, args.showSecret)
    if (!p) {
      console.error(`Profile "${args.name}" not found`)
      process.exit(1)
    }
    console.log(args.name)
    for (const [k, v] of Object.entries(p)) {
      if (v !== undefined) console.log(`  ${k}: ${v}`)
    }
  },
})

const ProfileCreateCommand = cmd({
  command: "create <name>",
  describe: "create a new profile",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", demandOption: true, describe: "profile name" })
      .option("username", { type: "string", describe: "username" })
      .option("password", { type: "string", describe: "password" })
      .option("pat", { type: "string", describe: "personal access token" })
      .option("jdbc", { type: "string", describe: "JDBC connection URL" })
      .option("service", { type: "string", describe: "service endpoint" })
      .option("protocol", { type: "string", choices: ["https", "http"], describe: "protocol" })
      .option("instance", { type: "string", describe: "instance name" })
      .option("workspace", { type: "string", describe: "workspace name" })
      .option("schema", { type: "string", describe: "default schema" })
      .option("vcluster", { type: "string", describe: "virtual cluster" })
      .option("skip-verify", { type: "boolean", default: false, describe: "skip connection verification" }),
  async handler(args: any) {
    try {
      createProfile(args.name, args)
      console.log(`Profile "${args.name}" created`)
    } catch (e: any) {
      console.error(e.message)
      process.exit(1)
    }
  },
})

const ProfileDeleteCommand = cmd({
  command: "delete <name>",
  describe: "delete a profile",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", demandOption: true, describe: "profile name" }),
  async handler(args: { name: string }) {
    try {
      deleteProfile(args.name)
      console.log(`Profile "${args.name}" deleted`)
    } catch (e: any) {
      console.error(e.message)
      process.exit(1)
    }
  },
})

const ProfileUseCommand = cmd({
  command: "use <name>",
  describe: "set a profile as default",
  builder: (yargs: Argv) =>
    yargs.positional("name", { type: "string", demandOption: true, describe: "profile name" }),
  async handler(args: { name: string }) {
    try {
      useProfile(args.name)
      console.log(`Default profile set to "${args.name}"`)
    } catch (e: any) {
      console.error(e.message)
      process.exit(1)
    }
  },
})

const ProfileUpdateCommand = cmd({
  command: "update <name> <key> <value>",
  describe: "update a profile field",
  builder: (yargs: Argv) =>
    yargs
      .positional("name", { type: "string", demandOption: true, describe: "profile name" })
      .positional("key", { type: "string", demandOption: true, describe: "field to update" })
      .positional("value", { type: "string", demandOption: true, describe: "new value" }),
  async handler(args: { name: string; key: string; value: string }) {
    try {
      updateProfile(args.name, args.key, args.value)
      console.log(`Updated ${args.name}.${args.key}`)
    } catch (e: any) {
      console.error(e.message)
      process.exit(1)
    }
  },
})

export const ProfileCommand = cmd({
  command: "profile",
  describe: "manage connection profiles",
  builder: (yargs: Argv) =>
    yargs
      .command(ProfileListCommand)
      .command(ProfileShowCommand)
      .command(ProfileCreateCommand)
      .command(ProfileDeleteCommand)
      .command(ProfileUseCommand)
      .command(ProfileUpdateCommand)
      .demandCommand(),
  handler() {},
})
