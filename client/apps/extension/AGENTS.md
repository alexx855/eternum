# Extension Agent Instructions

## Boundaries

- Keep extension work inside `client/apps/extension` unless the user explicitly asks otherwise. Read shared core and
  game-client source to reuse their implementations; keep the root lockfile unchanged for extension-only work.
- Preserve `DIRECTION_OPTIONS` labels and enum mapping unless the game coordinate orientation changes.

## Architecture

- The isolated content script mounts `LiveClientOverlay` in a Shadow DOM. It sends requests to the page-world
  `live-game-bridge`; only that bridge reads the game provider and submits guarded client system calls.
- `page-game-context` isolates React provider discovery. Current entity facts come from the page's native store;
  `game-data` holds display arithmetic and adapter types. Keep game state out of extension storage.
- Build orders use the shared core parser, default, goal catalog, and `buildBlitzRealmSuggestions`. The extension stores
  one imported official JSON order. Legacy preset storage remains untouched and is never executed.
- The order preview and execution share `page-build-order`. Recompute before sending, take one action per click, and
  wait for matching native facts. Army controls share the bridge's account, game, and confirmation guards.
- `main-world.ts` installs the bridge once and forwards logs; automatic movement lives in the bridge.

## Verification

Use the extension's package scripts for tests, type checking, and packaging, plus the root's required checks. Workspace
runtime imports may read built `dist` output: refresh the consumed package's build when source changes make that output
stale. Extension CI builds workspace packages before packaging.

## WXT

- Keep imports explicit. WXT auto-imports are disabled because they can inject extension storage into shared game code.
- Runtime `@bibliothecadao/types` imports are aliased to its built output. Following the pnpm link to TS source can drop
  enum IIFE wrappers in the content-script build. Keep that alias when changing package resolution.

## Debugging

Main-world logs appear in the page console. Content logs cross `ETERNUM_CONTENT_LOG`; background logs are inspected
through the extension's service worker in `chrome://extensions`.
