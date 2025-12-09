import { defineConfig } from "wxt";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  vite: () => ({
    plugins: [react(), wasm(), topLevelAwait()],
  }),
  manifest: {
    permissions: ["storage", "activeTab"],
    host_permissions: ["*://*.realms.world/*"],
  },
});
