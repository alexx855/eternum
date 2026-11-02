import type { WorldProfile, WorldProfileBase } from "./shared-types";
import { isExtensionClientHostname } from "./extension-client-url";
import { scopedExtensionLogMessage } from "./logging";
import { isRecord } from "./type-guards";

const configLogMessage = (message: string) => scopedExtensionLogMessage("config", message);

function isInGame(): boolean {
  return isExtensionClientHostname(window.location.hostname);
}

function toStringRecord(v: unknown): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(v)) {
    if (typeof val === "string") result[key] = val;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function loadActiveProfile(): { profile: Record<string, unknown>; name: string } | null {
  const activeWorldName = localStorage.getItem("ACTIVE_WORLD_NAME");
  const profilesRaw = localStorage.getItem("WORLD_PROFILES");
  if (!activeWorldName || !profilesRaw) return null;

  let profiles: unknown;
  try {
    profiles = JSON.parse(profilesRaw);
  } catch {
    console.warn(configLogMessage("Failed to parse WORLD_PROFILES from localStorage"));
    return null;
  }

  if (!isRecord(profiles)) return null;
  const profile = profiles[activeWorldName];
  if (!isRecord(profile)) return null;

  return { profile, name: activeWorldName };
}

function parseWorldProfile(): WorldProfile | null {
  if (!isInGame()) return null;
  const loaded = loadActiveProfile();
  if (loaded) {
    const { profile, name } = loaded;

    if (typeof profile.worldAddress !== "string") return null;

    const nextProfile: WorldProfile = {
      toriiBaseUrl: typeof profile.toriiBaseUrl === "string" ? profile.toriiBaseUrl : "",
      heraldBaseUrl: typeof profile.heraldBaseUrl === "string" ? profile.heraldBaseUrl : undefined,
      gameId: typeof profile.gameId === "number" ? profile.gameId : undefined,
      rpcUrl: typeof profile.rpcUrl === "string" ? profile.rpcUrl : "",
      worldAddress: profile.worldAddress,
      name: typeof profile.name === "string" ? profile.name : name,
      chain: typeof profile.chain === "string" ? profile.chain : "",
      fetchedAt: typeof profile.fetchedAt === "number" ? profile.fetchedAt : 0,
      contractsBySelector: toStringRecord(profile.contractsBySelector),
      contractsByName: toStringRecord(profile.contractsByName),
    };

    return nextProfile;
  }

  return null;
}

export function parseWorldProfileBase(): WorldProfileBase | null {
  const profile = parseWorldProfile();
  if (!profile) return null;

  return {
    toriiBaseUrl: profile.toriiBaseUrl,
    rpcUrl: profile.rpcUrl,
    worldAddress: profile.worldAddress,
    contractsBySelector: profile.contractsBySelector,
    contractsByName: profile.contractsByName,
    heraldBaseUrl: profile.heraldBaseUrl,
    gameId: profile.gameId,
  };
}
