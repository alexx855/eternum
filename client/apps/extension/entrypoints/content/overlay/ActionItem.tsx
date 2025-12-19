import { ActionStatus } from "./types";

interface ActionItemProps {
  title: string;
  description: string;
  status: ActionStatus;
  message: string;
  onExecute: () => void;
  disabled?: boolean;
}

export const ActionItem = ({ title, description, status, message, onExecute, disabled }: ActionItemProps) => {
  return (
    <div className={`eternum-action-item ${status}`}>
      <div className="eternum-action-header">
        <div className="eternum-action-info">
          <div className="eternum-action-title">
            {title}
            {status === "success" && <span className="eternum-check-mark">✓</span>}
          </div>
          <div className="eternum-action-desc">{description}</div>
        </div>
        <button
          className="eternum-action-button"
          onClick={onExecute}
          disabled={disabled || status === "loading" || status === "success"}
        >
          {status === "loading" ? "Building..." : status === "success" ? "Done" : "Build"}
        </button>
      </div>
      {message && status === "error" && <div className="eternum-action-message error">{message}</div>}
      {message && status === "loading" && <div className="eternum-action-message">{message}</div>}
    </div>
  );
};
