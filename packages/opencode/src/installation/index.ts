import { Effect, Layer, Schema, Context } from "effect"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "../flag/flag"
import { InstallationChannel, InstallationVersion } from "./version"
import {
  installMethodFromExecPath,
  latestVersionForMethod,
  performUpgrade,
  type InstallMethod,
} from "@/update/bootstrap"

export type Method = InstallMethod

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

export const USER_AGENT = `cz-cli/${InstallationChannel}/${InstallationVersion}/${Flag.CLICKZETTA_CLIENT}`

export function isPreview() {
  return InstallationChannel !== "nightly"
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
  readonly latest: (method?: Method, channel?: string) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string, channel?: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Installation") {}

export const layer: Layer.Layer<Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const methodImpl = Effect.fn("Installation.method")(function* () {
        return installMethodFromExecPath(process.execPath)
      })

      const latestImpl = Effect.fn("Installation.latest")(function* (installMethod?: Method, channel?: string) {
        const method = installMethod ?? (yield* methodImpl())
        return yield* Effect.tryPromise({
          try: () => latestVersionForMethod(method, fetch, channel),
          catch: (error) => new UpgradeFailedError({ stderr: error instanceof Error ? error.message : String(error) }),
        }).pipe(Effect.orElseSucceed(() => InstallationVersion))
      })

      const upgradeImpl = Effect.fn("Installation.upgrade")(function* (method: Method, target: string, channel?: string) {
        return yield* Effect.tryPromise({
          try: () => performUpgrade(method, target, fetch, channel),
          catch: (error) => new UpgradeFailedError({ stderr: error instanceof Error ? error.message : String(error) }),
        })
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
