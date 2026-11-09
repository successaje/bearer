import { defineConfig } from "vitest/config";

/** Testnet checks hit public RPCs and spend testnet NEAR, so they never run with `pnpm test`. */
export default defineConfig({
  test: { include: ["spike/*.testnet.ts"], testTimeout: 180_000, hookTimeout: 60_000, fileParallelism: false },
});
