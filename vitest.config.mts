import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 20000,
    setupFiles: [path.resolve(import.meta.dirname, "./tests/setup.ts")],
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", ".git"],
  },
});
