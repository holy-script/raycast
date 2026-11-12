import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  test: {
    // Agent worktrees live inside the repo and contain full copies of the
    // test suite; discovering them would run every test several times.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.qoder/**"],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
