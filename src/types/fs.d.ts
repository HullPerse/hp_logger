// bun-types omits `fd` on fs.WriteStream even though the runtime exposes it
// once the stream opens. Declare it optional so guarded uses (typeof fd ===
// "number") typecheck without casts. If a future bun-types ships a required
// fd, delete this augmentation.
declare module "node:fs" {
  interface WriteStream {
    fd?: number;
  }
}
