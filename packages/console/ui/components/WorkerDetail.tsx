import { useI18n } from "../i18n";
import type { RuntimeDto, WorkerDto } from "../../src/types";
import { formatDateTime, formatUptime } from "../format";
import { CopyButton } from "./CopyButton";
import { StatusChip } from "./StatusChip";
import type { WorkerAction } from "./WorkerTable";

interface WorkerDetailProps {
  worker: WorkerDto;
  runtime: RuntimeDto | undefined;
  busy: boolean;
  onAction: (worker: WorkerDto, action: WorkerAction) => void;
  onLogs: (worker: WorkerDto) => void;
  onInspect: (worker: WorkerDto) => void;
  onRemove: (worker: WorkerDto) => void;
  onClose: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <span className="shrink-0 text-[12px] text-ink-faint">{label}</span>
      <span className="min-w-0 break-all text-right text-[12.5px] text-ink-soft">
        {children}
      </span>
    </div>
  );
}

export function WorkerDetail({
  worker,
  runtime,
  busy,
  onAction,
  onLogs,
  onInspect,
  onRemove,
  onClose,
}: WorkerDetailProps) {
  const { t, lang } = useI18n();
  // Includes the window where a stop is still in flight.
  const isUp = worker.alive || worker.status === "stopping";
  const capabilities = runtime?.capabilities ?? [];
  const protocols = runtime?.protocols ?? [];

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l border-line bg-surface shadow-xl sm:w-[460px]">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-ink">{worker.name}</h2>
            <StatusChip status={worker.status} />
          </div>
          <p className="mono mt-1 text-ink-faint">
            {worker.id} · {runtimeLabelFor(runtime, worker)}
          </p>
        </div>
        <button className="btn btn-sm" onClick={onClose}>
          {t("app.close")}
        </button>
      </header>

      <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
        {isUp ? (
          <button className="btn btn-sm" disabled={busy} onClick={() => onAction(worker, "stop")}>
            {t("action.stop")}
          </button>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => onAction(worker, "start")}
          >
            {t("action.start")}
          </button>
        )}
        {/* Restart only makes sense on a live worker: on a stopped one it would
            do exactly what Start does. */}
        {isUp && worker.status !== "stopping" && (
          <button className="btn btn-sm" disabled={busy} onClick={() => onAction(worker, "restart")}>
            {t("action.restart")}
          </button>
        )}
        <button className="btn btn-sm" onClick={() => onLogs(worker)}>
          {t("action.logs")}
        </button>
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
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => onRemove(worker)}>
          {t("action.remove")}
        </button>
        {busy && <span className="self-center text-[12px] text-ink-faint">{t("action.working")}</span>}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <h3 className="text-[11px] uppercase tracking-wider text-ink-faint">
          {t("detail.overview")}
        </h3>
        <div className="mt-2">
          <Row label={t("column.runtime")}>{runtimeLabelFor(runtime, worker)}</Row>
          <Row label={t("column.port")}>
            <span className="mono">{worker.port}</span>
            {worker.portTakenByOther && (
              <span className="ml-2 text-warn">⚠ {t("warning.port")}</span>
            )}
          </Row>
          <Row label={t("detail.host")}>
            <span className="mono">{worker.host}</span>
          </Row>
          <Row label={t("column.pid")}>
            <span className="mono">{worker.pid ?? "—"}</span>
          </Row>
          <Row label={t("column.uptime")}>
            {formatUptime(worker.startedAt, worker.status, t)}
          </Row>
          <Row label={t("detail.desired")}>
            {worker.desiredState === "running"
              ? t("detail.desiredRunning")
              : t("detail.desiredStopped")}
          </Row>
          <Row label={t("detail.group")}>
            <span className="mono">{worker.groupId}</span>
          </Row>
          <Row label={t("detail.createdAt")}>{formatDateTime(worker.createdAt, lang)}</Row>
          <Row label={t("detail.startedAt")}>{formatDateTime(worker.startedAt, lang)}</Row>
          <Row label={t("detail.logFile")}>
            <span className="mono">{worker.logFile}</span>
          </Row>
        </div>

        <div className="mt-6">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-faint">
            {t("detail.urls")}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {worker.urls.map((entry) => (
              <li
                key={entry.url}
                className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-muted px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <span
                    className={`chip mr-1.5 border ${
                      entry.scope === "lan"
                        ? "border-accent-line bg-accent-soft text-accent"
                        : "border-line bg-surface text-ink-faint"
                    }`}
                  >
                    {entry.scope === "lan" ? t("scope.lan") : t("scope.local")}
                  </span>
                  <a
                    className="mono text-[12px] text-accent hover:underline"
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {entry.url}
                  </a>
                  {entry.iface && (
                    <span className="mono ml-1.5 text-ink-faint">({entry.iface})</span>
                  )}
                </div>
                <CopyButton value={entry.url} className="shrink-0" />
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-faint">
            {t("detail.reserved")}
          </h3>
          <span className="chip border border-warn-line bg-warn-soft text-warn">
            {t("detail.planned")}
          </span>
        </div>

        <section className="mt-3 rounded-lg border border-line bg-surface-muted p-3">
          <div className="text-[12.5px] font-medium text-ink-soft">
            {t("detail.capabilities")}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
            {t("detail.capabilitiesHint")}
          </p>
          {capabilities.length === 0 ? (
            <p className="mono mt-2 text-ink-soft">
              {worker.capabilities.length === 0
                ? t("detail.allCapabilities")
                : worker.capabilities.join(", ")}
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {capabilities.map((capability) => (
                <li key={capability.id} className="flex items-center gap-2 text-[12.5px]">
                  <input
                    type="checkbox"
                    disabled
                    defaultChecked={
                      worker.capabilities.length === 0
                        ? capability.defaultEnabled
                        : worker.capabilities.includes(capability.id)
                    }
                  />
                  <span className="text-ink-soft">{capability.label}</span>
                </li>
              ))}
            </ul>
          )}
          {capabilities.length === 0 && (
            <p className="mt-1 text-[12px] text-ink-faint">{t("detail.noneYet")}</p>
          )}
        </section>

        <section className="mt-3 rounded-lg border border-line bg-surface-muted p-3">
          <div className="text-[12.5px] font-medium text-ink-soft">
            {t("detail.protocol")}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">
            {t("detail.protocolHint")}
          </p>
          {protocols.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-soft">
              {t("detail.runtimeDefault")}
              {worker.protocol !== null && (
                <span className="mono ml-2 text-ink-faint">{worker.protocol.mcpVersion}</span>
              )}
            </p>
          ) : (
            <div className="mt-2 flex gap-4">
              {protocols.map((protocol) => (
                <label key={protocol.id} className="flex items-center gap-2 text-[12.5px]">
                  <input
                    type="radio"
                    name={`protocol-${worker.id}`}
                    disabled
                    defaultChecked={worker.protocol?.mcpVersion === protocol.id}
                  />
                  <span className={protocol.available ? "text-ink-soft" : "text-ink-faint"}>
                    {protocol.label}
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}

function runtimeLabelFor(runtime: RuntimeDto | undefined, worker: WorkerDto): string {
  return runtime?.label ?? worker.runtimeLabel;
}
