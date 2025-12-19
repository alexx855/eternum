/**
 * Main World Script - runs in the page's main world context
 * This script can access window.starknet_controller which is injected by Cartridge Controller
 * It relays controller state to the content script via CustomEvents
 */

import { getContractByName, NAMESPACE } from "@bibliothecadao/provider";
import { CallData } from "starknet";
import { defineUnlistedScript } from "wxt/sandbox";
import baseManifest from "../../../../contracts/game/manifest_mainnet.json";
import { patchManifestWithFactory } from "../utils/manifest-patcher";

interface ControllerState {
  address: string | null;
  username: string | null;
  connected: boolean;
}

interface BuildingCall {
  entity_id: number;
  directions: number[];
  building_type: number;
}

// Dispatch controller state to content script
const dispatchControllerState = (state: ControllerState) => {
  document.dispatchEvent(
    new CustomEvent("ETERNUM_CONTROLLER_STATE", {
      detail: state,
    }),
  );
};

// Check for controller and extract state
const checkController = async (): Promise<ControllerState> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const controller = (window as any).starknet_controller;

    if (controller?.account?.address) {
      let username: string | null = null;
      try {
        username = await controller.username?.();
      } catch {
        // Username fetch failed, continue without it
      }

      return {
        address: controller.account.address,
        username,
        connected: true,
      };
    }
  } catch (e) {
    console.log("[Eternum Extension] Main world controller check failed:", e);
  }

  return {
    address: null,
    username: null,
    connected: false,
  };
};

// Broadcast controller state
const broadcastControllerState = async () => {
  const state = await checkController();
  dispatchControllerState(state);
};

// Get production_systems contract address using manifest + factory patching
const getProductionSystemsAddress = (): string | null => {
  try {
    const activeWorldName = localStorage.getItem("ACTIVE_WORLD_NAME");
    const profilesRaw = localStorage.getItem("WORLD_PROFILES");

    if (activeWorldName && profilesRaw) {
      const profiles = JSON.parse(profilesRaw);
      const activeProfile = profiles[activeWorldName];

      if (activeProfile?.contractsBySelector && activeProfile?.worldAddress) {
        // Patch the base manifest with addresses from the game's factory data
        const patchedManifest = patchManifestWithFactory(
          baseManifest,
          activeProfile.worldAddress,
          activeProfile.contractsBySelector,
        );

        // Use getContractByName to find production_systems
        const productionSystemsTag = `${NAMESPACE}-production_systems`;
        const address = getContractByName(patchedManifest, productionSystemsTag);
        console.log("[Eternum Extension] Found production_systems:", address);
        return address;
      }
    }
  } catch (e) {
    console.error("[Eternum Extension] Failed to get contract address:", e);
  }
  return null;
};

export default defineUnlistedScript(() => {
  // Start polling for controller state
  broadcastControllerState();
  setInterval(broadcastControllerState, 2000);

  // Listen for requests from content script to refresh state
  document.addEventListener("ETERNUM_REQUEST_CONTROLLER_STATE", () => {
    broadcastControllerState();
  });

  // Listen for building creation requests from content script
  document.addEventListener("ETERNUM_CREATE_BUILDINGS", async (event) => {
    const customEvent = event as CustomEvent<{
      buildingCalls: BuildingCall[];
    }>;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const controller = (window as any).starknet_controller;

      if (!controller?.account) {
        throw new Error("Controller not connected");
      }

      // Get the production_systems contract address
      const productionSystemsAddress = getProductionSystemsAddress();
      if (!productionSystemsAddress) {
        throw new Error("Production systems contract not found. Make sure you're on the game page.");
      }

      console.log("[Eternum Extension] Production systems address:", productionSystemsAddress);
      console.log("[Eternum Extension] Building calls:", customEvent.detail.buildingCalls.length);

      // Build the transaction calls using CallData.compile for proper serialization
      const calls = customEvent.detail.buildingCalls.map((bc) => ({
        contractAddress: productionSystemsAddress,
        entrypoint: "create_building",
        calldata: CallData.compile([bc.entity_id, bc.directions, bc.building_type, false]),
      }));

      console.log("[Eternum Extension] First call:", JSON.stringify(calls[0]));

      const result = await controller.account.execute(calls, { version: 3 });

      console.log("[Eternum Extension] Building transaction result:", result);

      document.dispatchEvent(
        new CustomEvent("ETERNUM_BUILDING_RESULT", {
          detail: { success: true, transactionHash: result.transaction_hash },
        }),
      );
    } catch (error) {
      console.error("[Eternum Extension] Building transaction failed:", error);
      document.dispatchEvent(
        new CustomEvent("ETERNUM_BUILDING_RESULT", {
          detail: { success: false, error: String(error) },
        }),
      );
    }
  });
});
