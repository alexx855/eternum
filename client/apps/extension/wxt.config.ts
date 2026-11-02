import react from "@vitejs/plugin-react";
import { resolve } from "path";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "wxt";

// Force Vite to resolve workspace packages to their pre-compiled dist output.
// Without this, Vite follows pnpm symlinks to source TS and transpiles per-file,
// which drops enum IIFE wrappers during Rollup's tree-shaking (content script IIFE build).
// Only alias packages that have runtime value imports (type-only imports are erased).
const workspaceAliases = [
  { find: /^@bibliothecadao\/types$/, replacement: resolve(__dirname, "../../../packages/types/dist/index.js") },
  {
    find: /^@bibliothecadao\/types\/terrain$/,
    replacement: resolve(__dirname, "../../../packages/types/dist/terrain.js"),
  },
];

const extensionClientMatches = [
  "*://realms.world/*",
  "*://*.realms.world/*",
  "*://play.realms.party/*",
  "*://play.jcndata.com/*",
  "*://localhost/*",
  "*://127.0.0.1/*",
];

export default defineConfig({
  // Shared game modules have their own storage variables; never inject extension APIs into them.
  imports: false,
  runner: {
    disabled: true,
  },
  vite: () => ({
    plugins: [react(), wasm(), topLevelAwait()],
    resolve: { alias: workspaceAliases },
  }),
  manifest: () => ({
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: extensionClientMatches,
    // No default_popup means action.onClicked will fire
    action: {
      default_title: "Eternum Extension",
    },
    web_accessible_resources: [
      {
        resources: ["main-world.js"],
        matches: extensionClientMatches,
      },
    ],
  }),
});
