import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { LogsResponseDto, WorkerDto } from "../../src/types";
import { api } from "../api";
import { stripAnsi } from "../format";

const REFRESH_MS = 2_000;
const LINE_LIMIT = 300;

export function LogViewer({ worker, onClose }: { worker: WorkerDto; onClose: () => void }) {
  const { t } = useI18n();
  const [logs, setLogs] = useState<LogsResponseDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const response = await api.logs(worker.id, LINE_LIMIT);
        if (!cancelled) {
          setLogs(response);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [worker.id]);

  useEffect(() => {
    if (!follow) return;
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [logs, follow]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(36,41,47,0.18)] p-4">
      <div className="card flex max-h-[80vh] w-full max-w-4xl flex-col overflow-hidden">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              {t("logs.title")}
              <span className="chip border border-accent-line bg-accent-soft text-accent">
                <span className="dot dot-pulse bg-accent" />
                {t("logs.live")}
              </span>
            </h2>
            <p className="mono mt-1 truncate text-ink-faint">
              {worker.name} · {worker.logFile}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
              <input
                type="checkbox"
                checked={follow}
                onChange={(event) => setFollow(event.target.checked)}
              />
              {t("action.follow")}
            </label>
            <button className="btn btn-sm" onClick={onClose}>
              {t("app.close")}
            </button>
          </div>
        </header>

        <div ref={scroller} className="flex-1 overflow-auto bg-surface-muted px-5 py-3">
          {logs === null || logs.lines.length === 0 ? (
            <p className="text-[12.5px] text-ink-faint">
              {logs?.totalLines === null ? t("logs.missing") : t("logs.empty")}
            </p>
          ) : (
            <pre className="log-view text-ink-soft">
              {logs.lines.map(stripAnsi).join("\n")}
            </pre>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line px-5 py-2.5 text-[12px] text-ink-faint">
          <span>
            {logs && logs.lines.length > 0 && logs.truncated
              ? t("logs.truncated", { count: logs.lines.length })
              : `${logs?.lines.length ?? 0} lines`}
          </span>
          {failed && <span className="text-danger">{t("app.loadFailed")}</span>}
        </footer>
      </div>
    </div>
  );
}
