import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
    sequence: { concurrent: false }
  }
});
