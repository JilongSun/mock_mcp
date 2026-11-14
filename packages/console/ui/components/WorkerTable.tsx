import { useI18n } from "../i18n";
import type { WorkerDto } from "../../src/types";
import { formatUptime } from "../format";
import { CopyButton } from "./CopyButton";
import { StatusChip } from "./StatusChip";

export type WorkerAction = "start" | "stop" | "restart";

interface WorkerTableProps {
  workers: WorkerDto[];
  selectedId: string | null;
  busyId: string | null;
  onSelect: (id: string) => void;
  onAction: (worker: WorkerDto, action: WorkerAction) => void;
  onLogs: (worker: WorkerDto) => void;
  onInspect: (worker: WorkerDto) => void;
  onRemove: (worker: WorkerDto) => void;
}

export function WorkerTable({
  workers,
  selectedId,
  busyId,
  onSelect,
  onAction,
  onLogs,
  onInspect,
  onRemove,
}: WorkerTableProps) {
  const { t } = useI18n();

  if (workers.length === 0) {
    return (
      <div className="card px-6 py-12 text-center">
        <p className="text-sm font-medium text-ink-soft">{t("workers.empty.title")}</p>
        <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-ink-faint">
          {t("workers.empty.hint")}
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="grid-table">
        <thead>
          <tr>
            <th>{t("column.name")}</th>
            <th>{t("column.runtime")}</th>
            <th>{t("column.port")}</th>
            <th>{t("column.pid")}</th>
            <th>{t("column.status")}</th>
            <th>{t("column.uptime")}</th>
            <th className="text-right">{t("column.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {workers.map((worker) => {
            const busy = busyId === worker.id;
            // A worker counts as "up" while it has a process, including the
            // window where a stop is still in flight.
            const isUp = worker.alive || worker.status === "stopping";
            return (
              <tr
                key={worker.id}
                className={worker.id === selectedId ? "is-selected" : ""}
                onClick={() => onSelect(worker.id)}
              >
                <td>
                  <div className="font-medium text-ink">{worker.name}</div>
                  <div className="mono text-ink-faint">{worker.id}</div>
                </td>
                <td>
                  <span className="chip border border-line bg-surface-muted text-ink-soft">
                    {worker.runtimeLabel}
                  </span>
                </td>
                <td>
                  <div className="flex items-center gap-1.5">
                    <span className="mono text-ink-soft">{worker.port}</span>
                    {worker.portTakenByOther && (
                      <span
                        className="cursor-help text-warn"
                        title={t("warning.portConflict")}
                      >
                        ⚠
                      </span>
                    )}
                    {worker.host === "0.0.0.0" && (
                      <span className="chip border border-accent-line bg-accent-soft text-accent">
                        <span className="dot bg-accent" />
                        {t("summary.lan")}
                      </span>
                    )}
                  </div>
                  {worker.urls[0] && (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="mono max-w-[230px] truncate text-ink-faint">
                        {worker.urls[0].url}
                      </span>
                      <CopyButton value={worker.urls[0].url} className="!px-1 !py-0" />
                    </div>
                  )}
                </td>
                <td className="mono text-ink-soft">{worker.pid ?? "—"}</td>
                <td>
                  <StatusChip status={worker.status} />
                </td>
                <td className="text-ink-soft">{formatUptime(worker.startedAt, worker.status, t)}</td>
                <td>
                  <div
                    className="flex items-center justify-end gap-1.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {busy ? (
                      <span className="text-[12px] text-ink-faint">{t("action.working")}</span>
                    ) : (
                      <>
                        {isUp ? (
                          <button
                            className="btn btn-sm"
                            onClick={() => onAction(worker, "stop")}
                          >
                            {t("action.stop")}
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => onAction(worker, "start")}
                          >
                            {t("action.start")}
                          </button>
                        )}
                        {/* Restart only makes sense on a live worker: on a stopped
                            one it would do exactly what Start does. */}
                        {isUp && worker.status !== "stopping" && (
                          <button
                            className="btn btn-sm"
                            onClick={() => onAction(worker, "restart")}
                          >
                            {t("action.restart")}
                          </button>
                        )}
                        <button className="btn btn-sm" onClick={() => onLogs(worker)}>
                          {t("action.logs")}
                        </button>
                        {/* Disabled rather than opening a panel that can only
                            report an error: the inspector needs a listening
                            worker whose build includes it. */}
                        <span
                          title={
                            !worker.listening
                              ? t("inspector.disabledNotRunning")
                              : !worker.inspectorBuilt
                                ? t("inspector.disabledNotBuilt")
                                : undefined
                          }
                        >
                          <button
                            className="btn btn-sm btn-primary"
                            disabled={!worker.listening || !worker.inspectorBuilt}
                            onClick={() => onInspect(worker)}
                          >
                            {t("action.inspector")}
                          </button>
                        </span>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => onRemove(worker)}
                        >
                          {t("action.remove")}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
