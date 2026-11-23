import { defineConfig } from "vitest/config";

// Emulator-backed tests (security rules + handler integration).
// Run through `npm run test:rules:emulator`, which starts the Firestore emulator.
export default defineConfig({
  test: {
    include: ["test/rules/**/*.test.ts", "test/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
