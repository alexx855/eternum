import { type ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";

interface ShadowDialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  headerAccessory?: ReactNode;
  className?: string;
  contentClassName?: string;
  closeLabel?: string;
}

function eventPathIncludesNode(event: Event, node: Node) {
  return event.composedPath().includes(node);
}

export function ShadowDialog({
  open,
  onClose,
  children,
  title,
  subtitle,
  headerAccessory,
  className,
  contentClassName,
  closeLabel = "Close dialog",
}: ShadowDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    if (!panel) return;

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (eventPathIncludesNode(event, panel)) return;

      onCloseRef.current();
    };

    panel.ownerDocument.addEventListener("pointerdown", handleDocumentPointerDown, true);

    return () => {
      panel.ownerDocument.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    if (!panel) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onCloseRef.current();
      }
    };

    const ownerWindow = panel.ownerDocument.defaultView ?? window;
    ownerWindow.addEventListener("keydown", handleEscape);
    panel.addEventListener("keydown", handleEscape);

    return () => {
      ownerWindow.removeEventListener("keydown", handleEscape);
      panel.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[999999] flex items-center justify-center p-4 text-foreground">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "pointer-events-auto relative flex max-h-[calc(100vh-2rem)] w-[min(760px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 flex-col">
            <h2 id={titleId} className="truncate text-lg font-semibold">
              {title}
            </h2>
            {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerAccessory}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              title={closeLabel}
              aria-label={closeLabel}
            >
              <X data-icon="inline-start" />
            </Button>
          </div>
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto", contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
