import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom/client", () => ({ default: { createRoot: () => ({ render: state.render }) } }));
vi.mock("../entrypoints/content/overlay/LiveClientOverlay", () => ({ LiveClientOverlay: () => null }));
vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { onMessage: { hasListener: () => false, addListener: vi.fn() }, sendMessage: async () => ({}) },
  },
}));
vi.mock("wxt/sandbox", () => ({ defineContentScript: (definition: unknown) => definition }));
vi.mock("wxt/client", () => ({
  injectScript: async () => {},
  createShadowRootUi: async (_context: unknown, options: { onMount: (container: unknown) => unknown }) => ({
    mount: () => options.onMount({ appendChild: () => {} }),
  }),
}));
const originalConsole = { ...console };
afterEach(() => {
  Object.assign(console, originalConsole);
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("renders again when an already-mounted lobby navigates into a game without reloading", async () => {
  const documentTarget = new EventTarget();
  Object.assign(documentTarget, {
    querySelectorAll: () => [],
    createElement: () => ({ appendChild: () => {}, getRootNode: () => documentTarget }),
  });
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("Document", EventTarget);
  vi.stubGlobal("ShadowRoot", class extends EventTarget {});
  const page = new EventTarget();
  Object.assign(page, { location: { pathname: "/" } });
  vi.stubGlobal("window", page);
  const handlers = new Map<string, () => void>();
  const ctx = {
    addEventListener: (_target: unknown, name: string, handler: () => void) => handlers.set(name, handler),
  };
  const { default: content } = await import("../entrypoints/content/index");
  await content.main(ctx as never);
  await vi.waitFor(() => expect(state.render).toHaveBeenCalledTimes(1));
  const changeRoute = handlers.get("wxt:locationchange");
  expect(changeRoute).toBeTypeOf("function");

  Object.assign(page, { location: { pathname: "/g/chain/39/map" } });
  changeRoute!();
  expect(state.render).toHaveBeenCalledTimes(2);
  Object.assign(page, { location: { pathname: "/" } });
  changeRoute!();
  expect(state.render).toHaveBeenCalledTimes(3);
});
