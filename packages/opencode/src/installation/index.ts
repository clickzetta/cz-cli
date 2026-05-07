import { Effect, Layer, Schema, Context } from "effect"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "../flag/flag"
import { InstallationChannel, InstallationVersion } from "./version"

export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export const Event = {
  Updated: BusEvent.define(
    "installation.updated",
    z.object({
      version: z.string(),
    }),
  ),
}

export const Info = z
  .object({
    version: z.string(),
    latest: z.string(),
  })
  .meta({
    ref: "InstallationInfo",
  })
export type Info = z.infer<typeof Info>

export const USER_AGENT = `cz-cli/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT}`

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {}

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Installation") {}

export const layer: Layer.Layer<Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const methodImpl = Effect.fn("Installation.method")(function* () {
        return "unknown" as Method
      })

      // TODO: version check disabled — czcli has no update channel yet.
      // When ready, point latest() at clickzetta/cz-code GitHub Releases.
      const latestImpl = Effect.fn("Installation.latest")(function* (_installMethod?: Method) {
        return InstallationVersion
      }, Effect.orDie)

      // TODO: self-upgrade disabled — czcli is distributed via zip/tar.gz, no in-place upgrade path yet.
      const upgradeImpl = Effect.fn("Installation.upgrade")(function* (_m: Method, _target: string) {
        return yield* new UpgradeFailedError({ stderr: "In-place upgrade is not supported. Please download the latest release from GitHub." })
      })

      return Service.of({
        info: Effect.fn("Installation.info")(function* () {
          return {
            version: InstallationVersion,
            latest: yield* latestImpl(),
          }
        }),
        method: methodImpl,
        latest: latestImpl,
        upgrade: upgradeImpl,
      })
    }),
  )

export const defaultLayer = layer

export * as Installation from "."
