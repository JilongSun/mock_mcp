import { useI18n, type MessageKey } from "../i18n";
import type { WorkersSummaryDto } from "../../src/types";

const CARDS: { key: MessageKey; field: keyof WorkersSummaryDto; tone: string }[] = [
  { key: "summary.total", field: "total", tone: "bg-ink-faint" },
  { key: "summary.running", field: "running", tone: "bg-ok" },
  { key: "summary.starting", field: "starting", tone: "bg-accent" },
  { key: "summary.unresponsive", field: "unresponsive", tone: "bg-danger" },
  { key: "summary.stopping", field: "stopping", tone: "bg-warn" },
  { key: "summary.stopped", field: "stopped", tone: "bg-ink-faint" },
  { key: "summary.exited", field: "exited", tone: "bg-danger" },
];

export function SummaryCards({ summary }: { summary: WorkersSummaryDto | null }) {
  const { t } = useI18n();

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
      {CARDS.map((card) => {
        const value = summary ? (summary[card.field] as number) : 0;
        const dimmed = summary === null || (card.field !== "total" && value === 0);
        return (
          <div key={card.key} className="card px-3.5 py-3">
            <div className="flex items-center gap-1.5">
              <span className={`dot ${dimmed ? "bg-line-strong" : card.tone}`} />
              <span className="text-[11px] uppercase tracking-wider text-ink-faint">
                {t(card.key)}
              </span>
            </div>
            <div
              className={`mt-1.5 text-2xl font-semibold tabular-nums ${
                dimmed ? "text-ink-faint" : "text-ink"
              }`}
            >
              {value}
            </div>
          </div>
        );
      })}
    </section>
  );
}
