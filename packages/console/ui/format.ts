import type { Lang, MessageKey } from "./i18n";
import type { WorkerStatusDto } from "../src/types";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const UPTIME_UNITS: { limit: number; key: MessageKey; divisor: number }[] = [
  { limit: 60_000, key: "uptime.seconds", divisor: 1_000 },
  { limit: 3_600_000, key: "uptime.minutes", divisor: 60_000 },
  { limit: 86_400_000, key: "uptime.hours", divisor: 3_600_000 },
  { limit: Number.POSITIVE_INFINITY, key: "uptime.days", divisor: 86_400_000 },
];

/** Uptime of a worker, computed from its last start so the UI can tick locally. */
export function formatUptime(
  startedAt: string | null,
  status: WorkerStatusDto,
  t: Translate,
): string {
  if (startedAt === null || status === "stopped" || status === "exited") {
    return t("uptime.none");
  }

  const elapsed = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const unit = UPTIME_UNITS.find((entry) => elapsed < entry.limit) ?? UPTIME_UNITS[3];
  return t(unit.key, { value: Math.max(1, Math.floor(elapsed / unit.divisor)) });
}

export function formatClock(iso: string | null, lang: Lang): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDateTime(iso: string | null, lang: Lang): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Workers log with colors; the browser shows the escape codes literally. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
}
