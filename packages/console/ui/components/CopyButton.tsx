import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

interface CopyButtonProps {
  value: string;
  /** Shown on hover, so a compact button still explains what it copies. */
  title?: string;
  label?: string;
  className?: string;
}

/**
 * Clipboard write with a transient "copied" state.
 *
 * `navigator.clipboard` needs a secure context; when the console is opened over
 * plain HTTP from another machine it is unavailable, so fall back to a hidden
 * textarea + `execCommand` before giving up.
 */
async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ value, title, label, className = "" }: CopyButtonProps) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (event: React.MouseEvent): Promise<void> => {
      event.stopPropagation();
      const ok = await writeClipboard(value);
      setState(ok ? "copied" : "failed");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 1_500);
    },
    [value],
  );

  const text =
    state === "copied" ? t("action.copied") : state === "failed" ? t("action.copy") : label;

  return (
    <button
      type="button"
      className={`btn btn-sm ${state === "copied" ? "border-ok-line text-ok" : ""} ${className}`}
      onClick={copy}
      title={title ?? value}
      aria-label={title ?? t("action.copyUrl")}
    >
      {state === "idle" ? "⧉" : state === "copied" ? "✓" : "!"}
      {text && <span>{text}</span>}
    </button>
  );
}
