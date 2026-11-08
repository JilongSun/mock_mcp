import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import type { InspectorDto, WorkerDto } from "../../src/types";
import { ApiError, api } from "../api";
import { CopyButton } from "./CopyButton";
import { StatusChip } from "./StatusChip";

interface InspectorPanelProps {
  worker: WorkerDto;
  onClose: () => void;
}

type State =
  | { status: "loading" }
  | { status: "ready"; data: InspectorDto }
  | { status: "error"; message: string };

/**
 * Full-screen MCP inspector, embedded from the worker's own `/inspector`.
 *
 * The URL comes from the API rather than being built here: it must match the
 * host the browser used to reach the console, otherwise a remote browser would
 * try to connect to its own loopback.
 */
export function InspectorPanel({ worker, onClose }: InspectorPanelProps) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    api
      .inspector(worker.id)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof ApiError ? err.message : String(err),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [worker.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const unavailable = state.status === "ready" && !state.data.available ? state.data : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="text-sm font-semibold text-ink">{t("inspector.title")}</h2>
          <StatusChip status={worker.status} />
          <span className="mono truncate text-ink-faint">
            {worker.name} · :{worker.port}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {state.status === "ready" && state.data.url && (
            <>
              <span className="mono hidden max-w-[380px] truncate text-ink-faint lg:inline">
                {state.data.url}
              </span>
              <CopyButton value={state.data.url} className="!px-1 !py-0" />
              <a className="btn btn-sm" href={state.data.url} target="_blank" rel="noreferrer">
                {t("action.openNewTab")}
              </a>
            </>
          )}
          <button className="btn btn-sm" onClick={onClose}>
            {t("app.close")}
          </button>
        </div>
      </header>

      {unavailable && (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="card max-w-lg px-6 py-8 text-center">
            <p className="text-[12.5px] leading-relaxed text-ink-soft">
              {t(REASON_TEXT[unavailable.reason ?? "unreachable"])}
            </p>
          </div>
        </div>
      )}

      {state.status === "loading" && (
        <div className="flex flex-1 items-center justify-center text-[12.5px] text-ink-faint">
          {t("inspector.loading")}
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="card max-w-lg px-6 py-8 text-center">
            <p className="text-[12.5px] text-danger">{state.message}</p>
          </div>
        </div>
      )}

      {state.status === "ready" && state.data.available && state.data.url && (
        <iframe
          key={state.data.url}
          src={state.data.url}
          title={`${worker.name} inspector`}
          className="w-full flex-1 border-0 bg-white"
        />
      )}
    </div>
  );
}

const REASON_TEXT: Record<NonNullable<InspectorDto["reason"]>, MessageKey> = {
  "not-running": "inspector.notRunning",
  "not-built": "inspector.notBuilt",
  "remote-loopback": "inspector.remoteLoopback",
  unreachable: "inspector.unreachable",
};
