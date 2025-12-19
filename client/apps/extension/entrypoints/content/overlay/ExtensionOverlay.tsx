import { useCallback, useEffect, useState } from "react";
import { storage } from "wxt/storage";
import {
  BuildingCall,
  fetchPlayerStructures,
  filterRealms,
  generateFoodAndLaborCalls,
  generateResourceMinesCalls,
} from "../../../utils/torii-api";
import { ActionItem } from "./ActionItem";
import { ActionState } from "./types";

interface WorldProfile {
  name: string;
  chain: string;
  toriiBaseUrl: string;
  worldAddress: string;
  contractsBySelector: Record<string, string>;
  fetchedAt: number;
}

interface ControllerState {
  address: string | null;
  username: string | null;
  connected: boolean;
}

interface ExtensionOverlayProps {
  config: WorldProfile | null;
  initialControllerState: ControllerState;
}

type ActionId = "food-labor" | "mines";

export const ExtensionOverlay = ({ config, initialControllerState }: ExtensionOverlayProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [controllerState, setControllerState] = useState<ControllerState>(initialControllerState);
  const [isLoading, setIsLoading] = useState(!initialControllerState.connected);
  
  // State for actions
  const [activeAction, setActiveAction] = useState<ActionId | null>(null);
  const [actionStates, setActionStates] = useState<Record<ActionId, ActionState>>({
    "food-labor": { status: "idle", message: "" },
    "mines": { status: "idle", message: "" },
  });

  const requestControllerState = useCallback(() => {
    document.dispatchEvent(new CustomEvent("ETERNUM_REQUEST_CONTROLLER_STATE"));
  }, []);

   // Load completed state from storage
  useEffect(() => {
    const loadState = async () => {
      if (!controllerState.address || !config?.worldAddress) return;
      
      const foodLaborDone = await storage.getItem<boolean>(`local:action-food-labor-${controllerState.address}-${config.worldAddress}`);
      const minesDone = await storage.getItem<boolean>(`local:action-mines-${controllerState.address}-${config.worldAddress}`);

      setActionStates(prev => ({
        "food-labor": { 
          status: foodLaborDone ? "success" : prev["food-labor"].status, 
          message: prev["food-labor"].message 
        },
        "mines": { 
          status: minesDone ? "success" : prev["mines"].status, 
          message: prev["mines"].message 
        },
      }));
    };
    loadState();
  }, [controllerState.address, config?.worldAddress]);

  useEffect(() => {
    const handleControllerStateChange = ((event: CustomEvent<ControllerState>) => {
      setControllerState(event.detail);
      setIsLoading(false);
    }) as EventListener;

    const handleToggle = () => {
      setIsVisible((prev) => {
        if (!prev) requestControllerState();
        return !prev;
      });
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsVisible(false);
    };

    const handleBuildingResult = ((event: CustomEvent<{ success: boolean; transactionHash?: string; error?: string }>) => {
      if (!activeAction) return;

      const newState: ActionState = {
        status: event.detail.success ? "success" : "error",
        message: event.detail.success
          ? `Success! Tx: ${event.detail.transactionHash?.slice(0, 10)}...`
          : event.detail.error || "Transaction failed",
      };

      setActionStates(prev => ({
        ...prev,
        [activeAction]: newState
      }));

      if (event.detail.success && controllerState.address && config?.worldAddress) {
        // Persist success
        storage.setItem(`local:action-${activeAction}-${controllerState.address}-${config.worldAddress}`, true);
      }

      setActiveAction(null);
    }) as EventListener;

    document.addEventListener("eternum-controller-state-changed", handleControllerStateChange);
    document.addEventListener("eternum-toggle-overlay", handleToggle);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("ETERNUM_BUILDING_RESULT", handleBuildingResult);

    return () => {
      document.removeEventListener("eternum-controller-state-changed", handleControllerStateChange);
      document.removeEventListener("eternum-toggle-overlay", handleToggle);
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("ETERNUM_BUILDING_RESULT", handleBuildingResult);
    };
  }, [requestControllerState, activeAction, controllerState.address, config?.worldAddress]);

  const truncateAddress = (addr: string) =>
    addr.length <= 16 ? addr : `${addr.slice(0, 10)}...${addr.slice(-6)}`;

  const executeAction = async (actionId: ActionId) => {
    if (!config?.toriiBaseUrl || !controllerState.address) {
      setActionStates(prev => ({ ...prev, [actionId]: { status: "error", message: "Missing config or address" } }));
      return;
    }

    setActiveAction(actionId);
    setActionStates(prev => ({ ...prev, [actionId]: { status: "loading", message: "Fetching realms..." } }));

    try {
      const structures = await fetchPlayerStructures(config.toriiBaseUrl, controllerState.address);
      const realms = filterRealms(structures);

      if (realms.length === 0) {
        setActionStates(prev => ({ ...prev, [actionId]: { status: "error", message: "No realms found" } }));
        setActiveAction(null);
        return;
      }

      setActionStates(prev => ({ 
        ...prev, 
        [actionId]: { status: "loading", message: `Found ${realms.length} realm(s). Creating buildings...` } 
      }));

      let buildingCalls: BuildingCall[] = [];
      if (actionId === "food-labor") {
        buildingCalls = generateFoodAndLaborCalls(realms);
      } else if (actionId === "mines") {
        buildingCalls = generateResourceMinesCalls(realms);
      }

      document.dispatchEvent(new CustomEvent("ETERNUM_CREATE_BUILDINGS", { detail: { buildingCalls } }));
    } catch (error) {
      setActionStates(prev => ({ ...prev, [actionId]: { status: "error", message: String(error) } }));
      setActiveAction(null);
    }
  };

  const handleReset = async () => {
    if (!controllerState.address || !config?.worldAddress) return;
    
    await storage.removeItem(`local:action-food-labor-${controllerState.address}-${config.worldAddress}`);
    await storage.removeItem(`local:action-mines-${controllerState.address}-${config.worldAddress}`);
    
    setActionStates({
      "food-labor": { status: "idle", message: "" },
      "mines": { status: "idle", message: "" },
    });
  };

  return (
    <div className={`eternum-overlay-container ${isVisible ? "visible" : ""}`}>
      <div className="eternum-overlay-panel">
        <div className="eternum-overlay-header">
          <div className="eternum-overlay-title-section">
            <h1 className="eternum-overlay-title">{config?.name || "Eternum Extension"}</h1>
            {config?.chain && <span className="eternum-overlay-subtitle">{config.chain}</span>}
          </div>
          <div className="eternum-overlay-controls">
            <button className="eternum-reset-button" onClick={handleReset} title="Reset Progress">
              Reset All
            </button>
            <button className="eternum-overlay-close" onClick={() => setIsVisible(false)} title="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="eternum-overlay-content">
          {isLoading ? (
            <div className="eternum-loading">Loading...</div>
          ) : !controllerState.connected ? (
            <div className="eternum-not-connected">
              <p>No Controller connected</p>
              <p style={{ fontSize: "13px" }}>Please login to the game first, then reopen this panel.</p>
            </div>
          ) : (
            <>
              <div className="eternum-account-section">
                {controllerState.username && <div className="eternum-account-username">{controllerState.username}</div>}
                <div className="eternum-account-label">Connected Account</div>
                <div className="eternum-account-address" title={controllerState.address || ""}>
                  {truncateAddress(controllerState.address || "")}
                </div>
              </div>

              <div className="eternum-actions-section">
                <h3 className="eternum-section-title">Quick Actions</h3>
                
                <ActionItem 
                  title="Phase 1: Food & Labor"
                  description="Build 2 Farms and 1 Workers Hut on all realms."
                  status={actionStates["food-labor"].status}
                  message={actionStates["food-labor"].message}
                  onExecute={() => executeAction("food-labor")}
                  disabled={!!activeAction}
                />

                <ActionItem 
                  title="Phase 2: Resource Mines"
                  description="Build Wood, Coal, and Copper mines on all realms."
                  status={actionStates["mines"].status}
                  message={actionStates["mines"].message}
                  onExecute={() => executeAction("mines")}
                  disabled={!!activeAction}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
