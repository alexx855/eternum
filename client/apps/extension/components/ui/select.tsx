import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

interface SelectOption {
  value: string;
  label: string;
}

interface ShadowSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  placeholder?: string;
  ariaLabel?: string;
}

export function ShadowSelect({
  value,
  onValueChange,
  options,
  disabled,
  className,
  contentClassName,
  placeholder = "Select...",
  ariaLabel,
}: ShadowSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: Event) => {
      if (containerRef.current && e.target instanceof Node && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") setOpen(false);
    };

    // Listen on the shadow root (or document if not in shadow DOM)
    // This avoids Radix's problem of document-level listeners + event retargeting
    const root = containerRef.current?.getRootNode() ?? document;
    root.addEventListener("pointerdown", handleClickOutside);
    root.addEventListener("keydown", handleEscape);

    return () => {
      root.removeEventListener("pointerdown", handleClickOutside);
      root.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute left-0 top-full z-50 mt-1 min-w-[8rem] w-full overflow-hidden rounded-md border",
            "bg-popover text-popover-foreground shadow-md animate-in fade-in-80",
            contentClassName,
          )}
        >
          <div className="p-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus:bg-accent focus:text-accent-foreground",
                  option.value === value && "bg-accent/50",
                )}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
