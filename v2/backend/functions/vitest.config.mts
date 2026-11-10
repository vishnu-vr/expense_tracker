import { defineConfig } from "vitest/config";

// Unit tests: pure functions only, no emulator, no network.
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
