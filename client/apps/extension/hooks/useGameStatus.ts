import { useEffect, useState } from "react";
import { readGameStatus } from "../utils/game-status";

export function useGameStatus() {
  const [status, setStatus] = useState(readGameStatus);

  useEffect(() => {
    const updateStatus = () => setStatus(readGameStatus());
    const observer = new MutationObserver(updateStatus);
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "class"],
      subtree: true,
    });
    updateStatus();
    return () => observer.disconnect();
  }, []);

  return status;
}
