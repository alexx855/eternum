import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname) } },
  test: {
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      include: ["utils/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "entrypoints/**/*.{ts,tsx}"],
      reporter: ["text", "json-summary"],
    },
  },
});
