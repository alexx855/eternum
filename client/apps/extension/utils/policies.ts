/* eslint-disable @typescript-eslint/no-explicit-any */
import { toSessionPolicies } from "@cartridge/controller";
import { getMessages } from "./signing-policy";

const getContractByName = (manifest: any, namespace: string, name: string) => {
  const tag = `${namespace}-${name}`;
  const contract = manifest.contracts.find((contract: any) => contract.tag === tag);
  if (!contract) {
    console.warn(`Contract ${tag} not found in manifest`);
    return { address: "0x0" };
  }
  return contract;
};

export const buildPolicies = (manifest: any, chain: string) => {
  // Simplified policies for the demo features
  return toSessionPolicies({
    contracts: {
      [getContractByName(manifest, "s1_eternum", "production_systems").address]: {
        methods: [
          {
            name: "create_building",
            entrypoint: "create_building",
          },
        ],
      },
      [getContractByName(manifest, "s1_eternum", "troop_management_systems").address]: {
        methods: [
          {
            name: "explorer_create",
            entrypoint: "explorer_create",
          },
          {
            name: "guard_add",
            entrypoint: "guard_add",
          },
        ],
      },
      // Add more as needed
      [getContractByName(manifest, "s1_eternum", "realm_systems").address]: {
        methods: [{ name: "create", entrypoint: "create" }],
      },
    },
    messages: getMessages(chain),
  });
};
