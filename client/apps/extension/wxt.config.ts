import react from "@vitejs/plugin-react";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "wxt";

export default defineConfig({
  vite: () => ({
    plugins: [react(), wasm(), topLevelAwait()],
  }),
  manifest: ({ mode }) => ({
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: [
      "*://*.realms.world/*",
      ...(mode === "development" ? ["https://localhost/*"] : []),
    ],
    // No default_popup means action.onClicked will fire
    action: {
      default_title: "Eternum Extension",
    },
    web_accessible_resources: [
      {
        resources: ["main-world.js"],
        matches: [
          "*://*.realms.world/*",
          ...(mode === "development" ? ["https://localhost/*"] : []),
        ],
      },
    ],
  }),
});
