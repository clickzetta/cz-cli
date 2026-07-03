// cz_change: ClickZetta flag env-alias shim.
//
// ClickZetta exposes its flags as CLICKZETTA_*, while opencode reads OPENCODE_*.
// This mirrors every CLICKZETTA_<X> env var to OPENCODE_<X>. Imported first in
// boot.ts so it runs before any opencode module (whose flag getters read
// process.env) is evaluated.
//
// Only mirrors when the upstream name is unset, so an explicit OPENCODE_* wins.
for (const [key, value] of Object.entries(process.env)) {
  if (value === undefined) continue
  if (!key.startsWith("CLICKZETTA_")) continue
  const upstream = "OPENCODE_" + key.slice("CLICKZETTA_".length)
  if (process.env[upstream] === undefined) process.env[upstream] = value
}
