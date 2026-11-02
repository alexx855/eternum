import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const REQUEST = "ETERNUM_LIVE_GAME_REQUEST";
const RESPONSE = "ETERNUM_LIVE_GAME_RESPONSE";

for (const target of ["chrome-mv3", "firefox-mv2"]) {
  try {
    await checkPageBridge(target);
    console.log(JSON.stringify({ target, check: "page-bridge", status: "passed" }));
  } catch (error) {
    console.error(JSON.stringify({ target, check: "page-bridge", status: "failed", error: String(error) }));
    process.exitCode = 1;
  }
}

async function checkPageBridge(target) {
  const source = await readFile(new URL(`../.output/${target}/main-world.js`, import.meta.url), "utf8");
  const page = new JSDOM('<div aria-label="Game clock"><span>10m left</span></div>', {
    url: "http://localhost/g/chain/39/map",
    runScripts: "outside-only",
  });
  try {
    const { window } = page;
    // jsdom omits fetch; native SDK imports bind it even when the bridge only reads page facts.
    window.fetch = async () => {
      throw new Error("A snapshot must not make a network request");
    };
    installGameFixture(window);
    window.eval(source);
    window.eval(source);
    let responses = 0;
    window.document.addEventListener(RESPONSE, () => responses++);
    const snapshot = await requestSnapshot(window);
    assert.equal(snapshot.blocker, null);
    assert.equal(snapshot.realms[0].id, 10);
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot.realms[0].troopBalances)), [
      { resourceId: 26, balance: "50000000000" },
    ]);
    await requestSnapshot(window);
    assert.equal(responses, 2, "Reinjection must not install duplicate action listeners");
  } finally {
    page.window.close();
  }
}

function installGameFixture(window) {
  const rows = {
    Structure: [
      { game_id: 39, entity_id: 10n, owner: 1n, base: { category: 1, level: 0 }, metadata: { realm_id: 123 } },
    ],
    ResourceBalance: [{ game_id: 39, entity_id: 10n, resource_type: 26, balance: 50_000_000_000n }],
  };
  const context = {
    network: {
      provider: {
        gameId: 39,
        contracts: { world: "0x123" },
        provider: { channel: { nodeUrl: "https://rpc.example" } },
      },
    },
    account: { account: { address: "0x1" } },
    systemCalls: {},
    store: { inGame: (model) => rows[model] ?? [], subscriptionScope: () => ({ known: true }) },
  };
  window.document.querySelector('[aria-label="Game clock"]').__reactFiber$fixture = {
    return: { memoizedProps: { value: context } },
  };
}

function requestSnapshot(window) {
  return new Promise((resolve, reject) => {
    const id = window.crypto.randomUUID();
    const cleanup = () => {
      clearTimeout(timer);
      window.document.removeEventListener(RESPONSE, receive);
    };
    const receive = (event) => {
      if (event.detail.id !== id) return;
      cleanup();
      if (event.detail.error) reject(new Error(event.detail.error));
      else resolve(event.detail.snapshot);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Packaged page bridge did not respond"));
    }, 5_000);
    window.document.addEventListener(RESPONSE, receive);
    window.document.dispatchEvent(new window.CustomEvent(REQUEST, { detail: { id, action: { kind: "snapshot" } } }));
  });
}
