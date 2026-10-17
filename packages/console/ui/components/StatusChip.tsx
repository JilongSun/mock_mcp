import { useI18n, type MessageKey } from "../i18n";
import type { WorkerStatusDto } from "../../src/types";

const STYLES: Record<
  WorkerStatusDto,
  { className: string; dot: string; pulse?: boolean; key: MessageKey }
> = {
  running: {
    className: "text-ok bg-ok-soft border-ok-line",
    dot: "bg-ok",
    key: "status.running",
  },
  starting: {
    className: "text-accent bg-accent-soft border-accent-line",
    dot: "bg-accent",
    pulse: true,
    key: "status.starting",
  },
  unresponsive: {
    className: "text-danger bg-danger-soft border-danger-line",
    dot: "bg-danger",
    key: "status.unresponsive",
  },
  stopping: {
    className: "text-warn bg-warn-soft border-warn-line",
    dot: "bg-warn",
    pulse: true,
    key: "status.stopping",
  },
  stopped: {
    className: "text-ink-soft bg-surface-muted border-line",
    dot: "bg-ink-faint",
    key: "status.stopped",
  },
  exited: {
    className: "text-danger bg-danger-soft border-danger-line",
    dot: "bg-danger",
    key: "status.exited",
  },
};

export function StatusChip({ status }: { status: WorkerStatusDto }) {
  const { t } = useI18n();
  const style = STYLES[status];

  return (
    <span className={`chip border ${style.className}`}>
      <span className={`dot ${style.dot} ${style.pulse ? "dot-pulse" : ""}`} />
      {t(style.key)}
    </span>
  );
}
