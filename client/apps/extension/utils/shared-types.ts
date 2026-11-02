/**
 * Shared types used across extension contexts (main-world, content scripts)
 */

/**
 * Connection metadata at the page-provider boundary.
 */
export interface WorldProfileBase {
  toriiBaseUrl: string;
  rpcUrl: string;
  worldAddress: string;
  contractsBySelector?: Record<string, string>;
  contractsByName?: Record<string, string>;
  heraldBaseUrl?: string;
  gameId?: number;
  nativeStoreReady?: boolean;
}

/**
 * Full profile with all metadata, used in UI components.
 */
export interface WorldProfile extends WorldProfileBase {
  name: string;
  chain: string;
  fetchedAt: number;
}
