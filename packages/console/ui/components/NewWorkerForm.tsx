import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { RuntimeDto, WorkerDto } from "../../src/types";
import { ApiError, api } from "../api";

interface NewWorkerFormProps {
  runtimes: RuntimeDto[];
  /** LAN addresses of this machine; empty disables the LAN option. */
  lanAddresses: { address: string; iface: string }[];
  onCreated: (workers: WorkerDto[]) => void;
  onCancel: () => void;
}

export function NewWorkerForm({
  runtimes,
  lanAddresses,
  onCreated,
  onCancel,
}: NewWorkerFormProps) {
  const { t } = useI18n();
  const [runtimeId, setRuntimeId] = useState(runtimes[0]?.id ?? "v1");
  const [host, setHost] = useState("127.0.0.1");
  const [autoPort, setAutoPort] = useState(true);
  const [port, setPort] = useState(String(runtimes[0]?.defaultPort ?? 8760));
  const [count, setCount] = useState("1");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plannedPorts, setPlannedPorts] = useState<number[]>([]);

  const runtime = runtimes.find((entry) => entry.id === runtimeId);

  const hostHint =
    host === "0.0.0.0"
      ? lanAddresses.length > 0
        ? lanAddresses.map((entry) => entry.address).join(", ")
        : t("form.hostNoLan")
      : t("form.hostHint");

  useEffect(() => {
    if (runtime && port === "") setPort(String(runtime.defaultPort));
  }, [runtime, port]);

  // Preview which ports auto-assignment would pick, so nobody is surprised by it.
  useEffect(() => {
    if (!autoPort || runtime === undefined) {
      setPlannedPorts([]);
      return;
    }
    let cancelled = false;
    api
      .nextPorts(runtime.id, Math.max(1, Number(count) || 1))
      .then((response) => {
        if (!cancelled) setPlannedPorts(response.ports);
      })
      .catch(() => {
        if (!cancelled) setPlannedPorts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [autoPort, runtime, count]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    const parsedCount = Number(count);
    if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 20) {
      setError(t("form.countError"));
      return;
    }

    let requestedPort: number | "auto" = "auto";
    if (!autoPort) {
      const parsedPort = Number(port);
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
        setError(t("form.rangeError"));
        return;
      }
      requestedPort = parsedPort;
    }

    setSubmitting(true);
    try {
      const response = await api.createWorkers({
        runtime: runtimeId,
        host,
        port: requestedPort,
        count: parsedCount,
        ...(name.trim() === "" ? {} : { name: name.trim() }),
      });
      onCreated(response.workers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card p-4" onSubmit={submit}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{t("form.title")}</h2>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          {t("form.cancel")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint">
            {t("form.runtime")}
          </span>
          <select
            className="input"
            value={runtimeId}
            onChange={(event) => setRuntimeId(event.target.value)}
          >
            {runtimes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint">
            {t("form.host")}
          </span>
          <select
            className="input"
            value={host}
            onChange={(event) => setHost(event.target.value)}
          >
            <option value="127.0.0.1">{t("form.hostLocal")}</option>
            <option value="0.0.0.0" disabled={lanAddresses.length === 0}>
              {t("form.hostLan")}
            </option>
          </select>
          <span className="mt-1.5 block text-[11.5px] leading-snug text-ink-faint">
            {hostHint}
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint">
            {t("form.count")}
          </span>
          <input
            className="input"
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(event) => setCount(event.target.value)}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint">
            {t("form.port")}
          </span>
          <input
            className="input"
            type="number"
            min={1}
            max={65_535}
            value={autoPort ? "" : port}
            placeholder={autoPort ? t("form.portAuto") : ""}
            disabled={autoPort}
            onChange={(event) => setPort(event.target.value)}
          />
          <label className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-soft">
            <input
              type="checkbox"
              checked={autoPort}
              onChange={(event) => setAutoPort(event.target.checked)}
            />
            {t("form.portAuto")}
          </label>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-wider text-ink-faint">
            {t("form.name")}
          </span>
          <input
            className="input"
            value={name}
            placeholder={t("form.nameHint")}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-ink-faint">
          {t("form.hint")}
          {plannedPorts.length > 0 && (
            <span className="mono ml-2 text-ink-soft">
              → {plannedPorts.join(", ")}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {error && <span className="text-[12.5px] text-danger">{error}</span>}
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? t("form.submitting") : t("form.submit")}
          </button>
        </div>
      </div>
    </form>
  );
}
