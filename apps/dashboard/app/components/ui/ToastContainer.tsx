"use client";

import { useEffect } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastContainerProps {
  type?: ToastType;
  title?: string;
  message?: string;
  duration?: number;
  position?:
    | "top-right"
    | "top-left"
    | "bottom-right"
    | "bottom-left"
    | "top-center"
    | "bottom-center"
    | "center";
  /** Controls visibility (parent-managed) */
  visible?: boolean;
  /** Called when the toast wants to close */
  onClose?: () => void;
}

export function ToastContainer({
  type = "info",
  title = "",
  message,
  duration = 5,
  position = "top-right",
  visible = true,
  onClose,
}: ToastContainerProps) {
  // Auto-dismiss logic
  useEffect(() => {
    if (!visible || duration <= 0) return;

    const timeoutId = window.setTimeout(() => {
      onClose?.();
    }, duration * 1000);

    return () => window.clearTimeout(timeoutId);
  }, [visible, duration, onClose]);

  if (!visible || !title) return null;

  const styles: Record<
    ToastType,
    { bg: string; border: string; title: string }
  > = {
    success: {
      bg: "bg-success-100",
      border: "border-success-500",
      title: "text-success-700",
    },
    error: {
      bg: "bg-error-100",
      border: "border-error-500",
      title: "text-error-700",
    },
    warning: {
      bg: "bg-warning-100",
      border: "border-warning-500",
      title: "text-warning-700",
    },
    info: {
      bg: "bg-info-100",
      border: "border-info-500",
      title: "text-info-700",
    },
  };

  const { bg, border, title: titleColor } = styles[type];

  const positionClasses: Record<NonNullable<typeof position>, string> = {
    "top-right": "top-40px right-4",
    "top-left": "top-40px left-4",
    "bottom-right": "bottom-40px right-4",
    "bottom-left": "bottom-40px left-4",
    "top-center": "top-40px left-1/2 -translate-x-1/2",
    "bottom-center": "bottom-40px left-1/2 -translate-x-1/2",
    center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
  };

  const maxWidthClass = position === "center" ? "max-w-sm" : "max-w-md";

  return (
    <div
      className={`fixed ${positionClasses[position]} z-[9999] pointer-events-none p-4 ${maxWidthClass}`}
      role="status"
      aria-live="polite"
    >
      <div
        className={`${bg} ${border} border-2 shadow-md rounded-[1.5rem] px-8 py-4 pr-12 animate-slide-in-right backdrop-blur-sm pointer-events-auto max-w-sm relative`}
      >
        {/* Close button */}
        <button
          type="button"
          aria-label="Close notification"
          onClick={() => onClose?.()}
          className={`${border} absolute right-4 text-xs top-2 text-black font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-gray-400`}
        >
          ✕
        </button>

        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className={`${titleColor} font-semibold text-sm leading-tight`}>
              {title}
            </p>

            {message && (
              <p className="text-gray-800 text-xs mt-1 leading-normal">
                {message}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
