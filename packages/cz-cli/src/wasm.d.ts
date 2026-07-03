// Ambient declaration for `.wasm` imports with `{ type: "file" }` attribute.
// opencode resolves these via its browser customConditions; cz-cli typechecks
// opencode internals through the @/* path map and needs this shim.
declare module "*.wasm" {
  const path: string
  export default path
}
