const globals = {
  "ContentScriptContext": true,
  "ExtensionProvider": true,
  "InvalidMatchPattern": true,
  "MatchPattern": true,
  "MigrationError": true,
  "browser": true,
  "buildPolicies": true,
  "cn": true,
  "createIframeUi": true,
  "createIntegratedUi": true,
  "createShadowRootUi": true,
  "defineAppConfig": true,
  "defineBackground": true,
  "defineConfig": true,
  "defineContentScript": true,
  "defineUnlistedScript": true,
  "defineWxtPlugin": true,
  "fakeBrowser": true,
  "getMessages": true,
  "injectScript": true,
  "leftPadHex": true,
  "normalizeHex": true,
  "normalizeSelector": true,
  "patchManifestWithFactory": true,
  "storage": true,
  "strip0x": true,
  "toLowerHex": true,
  "useAppConfig": true,
  "useExtensionStore": true
}

export default {
  name: "wxt/auto-imports",
  languageOptions: {
    globals,
    sourceType: "module",
  },
};
