import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Lang } from "./i18n";
import type {
  MetaDto,
  RuntimeDto,
  WorkerDto,
  WorkersResponseDto,
} from "../src/types";
import { ApiError, api } from "./api";
import { formatClock } from "./format";
import { LogViewer } from "./components/LogViewer";
import { NewWorkerForm } from "./components/NewWorkerForm";
import { SummaryCards } from "./components/SummaryCards";
import { WorkerDetail } from "./components/WorkerDetail";
import { WorkerTable, type WorkerAction } from "./components/WorkerTable";

const DEFAULT_POLL_MS = 2_000;

export default function App() {
  const { t, lang, setLang } = useI18n();

  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [runtimes, setRuntimes] = useState<RuntimeDto[]>([]);
  const [data, setData] = useState<WorkersResponseDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logsId, setLogsId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Re-render once a second so uptimes keep ticking between polls.
  const [, setTick] = useState(0);

  const pollMs = meta?.pollIntervalMs ?? DEFAULT_POLL_MS;

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await api.workers();
      setData(response);
      setUpdatedAt(new Date());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [metaResponse, runtimesResponse] = await Promise.all([
          api.meta(),
          api.runtimes(),
        ]);
        setMeta(metaResponse);
        setRuntimes(runtimesResponse.runtimes);
      } catch {
        // The worker list below reports connectivity problems.
      }
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, pollMs);
    return () => clearInterval(timer);
  }, [autoRefresh, pollMs, refresh]);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  const selected = useMemo(
    () => data?.workers.find((worker) => worker.id === selectedId) ?? null,
    [data, selectedId],
  );
  const logsWorker = useMemo(
    () => data?.workers.find((worker) => worker.id === logsId) ?? null,
    [data, logsId],
  );

  const runAction = useCallback(
    async (worker: WorkerDto, action: WorkerAction): Promise<void> => {
      setBusyId(worker.id);
      setActionError(null);
      try {
        const response = await api.action(worker.id, action);
        if (response.warnings && response.warnings.length > 0) {
          setActionError(response.warnings.join("; "));
        }
        await refresh();
      } catch (err) {
        setActionError(
          t("error.action", { message: err instanceof ApiError ? err.message : String(err) }),
        );
      } finally {
        setBusyId(null);
      }
    },
    [refresh, t],
  );

  const removeWorker = useCallback(
    async (worker: WorkerDto): Promise<void> => {
      if (!window.confirm(t("action.removeConfirm", { name: worker.name, port: worker.port }))) {
        return;
      }
      setBusyId(worker.id);
      setActionError(null);
      try {
        await api.remove(worker.id);
        if (selectedId === worker.id) setSelectedId(null);
        if (logsId === worker.id) setLogsId(null);
        await refresh();
      } catch (err) {
        setActionError(
          t("error.action", { message: err instanceof ApiError ? err.message : String(err) }),
        );
      } finally {
        setBusyId(null);
      }
    },
    [logsId, refresh, selectedId, t],
  );

  const ports = data?.summary.ports ?? [];

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent-line bg-accent-soft text-[13px] font-semibold text-accent">
              MW
            </span>
            <div>
              <h1 className="text-[15px] font-semibold text-ink">{t("app.title")}</h1>
              <p className="text-[12px] text-ink-faint">{t("app.subtitle")}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-[12px] text-ink-faint lg:inline">
              {data ? t("app.updatedAt", { time: formatClock(updatedAt?.toISOString() ?? null, lang) }) : t("app.loading")}
            </span>
            <button
              className="btn btn-sm"
              onClick={() => setAutoRefresh((value) => !value)}
              title={autoRefresh ? t("app.autoRefreshOn") : t("app.autoRefreshOff")}
            >
              <span className={`dot ${autoRefresh ? "bg-ok" : "bg-ink-faint"}`} />
              {autoRefresh ? t("app.autoRefreshOn") : t("app.autoRefreshOff")}
            </button>
            <button className="btn btn-sm" onClick={() => void refresh()}>
              {t("app.refresh")}
            </button>
            <div className="flex overflow-hidden rounded-md border border-line-strong">
              {(["zh", "en"] as Lang[]).map((option) => (
                <button
                  key={option}
                  className={`px-2.5 py-1 text-[12px] transition-colors ${
                    lang === option
                      ? "bg-accent-soft text-[#43607f]"
                      : "bg-surface text-ink-faint hover:text-ink-soft"
                  }`}
                  onClick={() => setLang(option)}
                >
                  {option === "zh" ? "中文" : "EN"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-6 py-5 pb-16">
        {loadError && (
          <div className="card flex items-center justify-between gap-4 border-danger-line bg-danger-soft px-4 py-3">
            <div className="text-[12.5px] text-danger">
              {t("app.loadFailed")} <span className="mono">{loadError}</span>
            </div>
            <button className="btn btn-sm" onClick={() => void refresh()}>
              {t("app.retry")}
            </button>
          </div>
        )}

        {actionError && (
          <div className="card flex items-center justify-between gap-4 border-warn-line bg-warn-soft px-4 py-3">
            <div className="text-[12.5px] text-warn">{actionError}</div>
            <button className="btn btn-sm" onClick={() => setActionError(null)}>
              {t("app.close")}
            </button>
          </div>
        )}

        <SummaryCards summary={data?.summary ?? null} />

        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">{t("workers.heading")}</h2>
            <p className="text-[12px] text-ink-faint">
              {t("workers.count", { count: data?.summary.total ?? 0 })}
              <span className="mx-2 text-line-strong">|</span>
              {t("summary.ports")}:{" "}
              <span className="mono">
                {ports.length > 0 ? ports.join(", ") : t("summary.none")}
              </span>
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm((value) => !value)}
          >
            {t("workers.new")}
          </button>
        </div>

        {showForm && (
          <NewWorkerForm
            runtimes={runtimes}
            onCancel={() => setShowForm(false)}
            onCreated={async (created) => {
              setShowForm(false);
              await refresh();
              if (created.length > 0) setSelectedId(created[0].id);
            }}
          />
        )}

        {data === null ? (
          <div className="card px-6 py-12 text-center text-[12.5px] text-ink-faint">
            {t("app.loading")}
          </div>
        ) : (
          <WorkerTable
            workers={data.workers}
            selectedId={selectedId}
            busyId={busyId}
            onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
            onAction={runAction}
            onLogs={(worker) => setLogsId(worker.id)}
            onRemove={removeWorker}
          />
        )}

        {meta && (
          <footer className="pt-2 text-[11.5px] leading-relaxed text-ink-faint">
            <div>
              registry: <span className="mono">{meta.runDir}/workers.json</span>
            </div>
            <div>
              api: <span className="mono">{meta.host}:{meta.port}/api</span> · poll{" "}
              <span className="mono">{meta.pollIntervalMs}ms</span>
            </div>
          </footer>
        )}
      </main>

      {selected && (
        <>
          <div
            className="fixed inset-0 z-20 bg-[rgba(36,41,47,0.12)]"
            onClick={() => setSelectedId(null)}
          />
          <WorkerDetail
            worker={selected}
            runtime={runtimes.find((entry) => entry.id === selected.runtime)}
            busy={busyId === selected.id}
            onAction={runAction}
            onLogs={(worker) => setLogsId(worker.id)}
            onRemove={removeWorker}
            onClose={() => setSelectedId(null)}
          />
        </>
      )}

      {logsWorker && (
        <LogViewer worker={logsWorker} onClose={() => setLogsId(null)} />
      )}
    </div>
  );
}
