import { McpUseProvider, useCallTool, useWidget, type WidgetMetadata } from "mcp-use/react";
import { useEffect, useState } from "react";
import { z } from "zod";
import "../lib/mcp-apps-only";
import "../styles.css";

const orderStatusSchema = z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]);

const orderSchema = z.object({
  id: z.string(),
  customer: z.string(),
  items: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      quantity: z.number(),
      price: z.number(),
    })
  ),
  total: z.number(),
  status: orderStatusSchema,
  placedAt: z.string(),
  shippedAt: z.string().nullable(),
});

const propsSchema = z.object({
  orders: z.array(orderSchema),
  total: z.number(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Manage mock orders interactively — change order status directly from the widget",
  props: propsSchema,
  exposeAsTool: false,
};

const updateResultSchema = z.object({
  order: orderSchema,
  previousStatus: orderStatusSchema,
  note: z.string(),
});

type Props = z.infer<typeof propsSchema>;
type Order = Props["orders"][number];
type OrderStatus = z.infer<typeof orderStatusSchema>;

const statusConfig: Record<OrderStatus, { label: string; color: string; icon: string }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", icon: "⏳" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", icon: "🔄" },
  shipped: { label: "Shipped", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300", icon: "📦" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", icon: "✅" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", icon: "❌" },
};

/** Status each order moves to when its advance button is pressed. */
const advanceStatus: Record<OrderStatus, OrderStatus | null> = {
  pending: "processing",
  processing: "shipped",
  shipped: "delivered",
  delivered: null,
  cancelled: null,
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

/**
 * Hosts may hand us a fresh props object on every render. Comparing the visible shape keeps the
 * sync effect from bouncing state back and forth.
 */
function sameOrders(a: Order[], b: Order[]): boolean {
  return a.length === b.length && a.every((order, i) => order.id === b[i].id && order.status === b[i].status);
}

export default function OrderActions() {
  const { props, isPending, sendFollowUpMessage } = useWidget<Props>();
  const { callTool } = useCallTool("update-order-status");

  const [orders, setOrders] = useState<Order[]>([]);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Re-seed from props so the widget resets whenever the host delivers a new tool result.
  // Bailing out on an unchanged list avoids a setState/re-render loop if props are recreated.
  useEffect(() => {
    const incoming = props.orders;
    if (!incoming) return;
    setOrders((prev) => (sameOrders(prev, incoming) ? prev : incoming));
  }, [props.orders]);

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </McpUseProvider>
    );
  }

  const changeStatus = (order: Order, status: OrderStatus) => {
    setBusyOrderId(order.id);
    setFeedback(null);

    callTool(
      { orderId: order.id, status },
      {
        onSuccess: (result) => {
          const parsed = updateResultSchema.safeParse(result?.structuredContent);
          if (parsed.success) {
            const updated = parsed.data.order;
            setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
            setFeedback({ tone: "success", text: parsed.data.note });
          } else {
            setFeedback({ tone: "success", text: `Order ${order.id} updated to "${status}".` });
          }
        },
        onError: (err) => {
          setFeedback({
            tone: "error",
            text: err instanceof Error ? err.message : `Failed to update order ${order.id}.`,
          });
        },
        onSettled: () => setBusyOrderId(null),
      }
    );
  };

  const summarize = () => {
    const summary = orders.map((o) => `${o.id} (${o.customer}): ${o.status}`).join(", ");
    sendFollowUpMessage(
      `Summarize the current state of these orders and flag anything that needs attention: ${summary}`
    );
  };

  return (
    <McpUseProvider autoSize>
      <div className="p-4">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Order Manager</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {orders.length} of {props.total} order(s) shown · pick an action to update the mock order
            </p>
          </div>
          <button
            type="button"
            onClick={summarize}
            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            ✨ Ask AI
          </button>
        </div>

        {/* Result of the last action */}
        {feedback && (
          <div
            className={`mb-3 px-3 py-2 text-xs rounded-lg ${
              feedback.tone === "success"
                ? "bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300"
                : "bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300"
            }`}
          >
            {feedback.tone === "success" ? "✅ " : "⚠️ "}
            {feedback.text}
          </div>
        )}

        {/* Orders */}
        {orders.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500">
            <p className="text-3xl mb-2">📭</p>
            <p>No orders to manage.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const sc = statusConfig[order.status];
              const next = advanceStatus[order.status];
              const isBusy = busyOrderId === order.id;
              const canCancel = order.status !== "delivered" && order.status !== "cancelled";

              return (
                <div
                  key={order.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{order.id}</span>
                      <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                        {order.customer}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${sc.color}`}
                      >
                        {sc.icon} {sc.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                      <span>📦 {order.items.length} item(s)</span>
                      <span>{formatCurrency(order.total)}</span>
                      {order.shippedAt && <span>🚚 {order.shippedAt}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {next && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => changeStatus(order, next)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        {isBusy ? "Working..." : `→ ${statusConfig[next].label}`}
                      </button>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => changeStatus(order, "cancelled")}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 text-center">
          Actions call <span className="font-mono">update-order-status</span> — mock data, resets on restart
        </div>
      </div>
    </McpUseProvider>
  );
}
