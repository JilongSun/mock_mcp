import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { useState } from "react";
import { z } from "zod";
import "../styles.css";

const orderItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.number(),
  price: z.number(),
});

const orderSchema = z.object({
  id: z.string(),
  customer: z.string(),
  items: z.array(orderItemSchema),
  total: z.number(),
  status: z.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
  placedAt: z.string(),
  shippedAt: z.string().nullable(),
});

const propsSchema = z.object({
  orders: z.array(orderSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Display paginated order list with status badges and expandable items",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  pending: { label: "Pending", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300", icon: "⏳" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300", icon: "🔄" },
  shipped: { label: "Shipped", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300", icon: "📦" },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300", icon: "✅" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300", icon: "❌" },
};

export default function OrderList() {
  const { props, isPending } = useWidget<Props>();
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
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

  const { orders, page, pageSize, total, totalPages } = props;

  const toggleExpand = (orderId: string) => {
    setExpandedOrder(expandedOrder === orderId ? null : orderId);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  };

  return (
    <McpUseProvider autoSize>
      <div className="p-4">
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Orders
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages} · {total} total orders
          </p>
        </div>

        {/* Order table */}
        {orders.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500">
            <p className="text-3xl mb-2">📭</p>
            <p>No orders found.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => {
              const sc = statusConfig[order.status];
              const isExpanded = expandedOrder === order.id;

              return (
                <div
                  key={order.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800/50 overflow-hidden"
                >
                  {/* Order row */}
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(order.id)}
                  >
                    {/* Order ID */}
                    <span className="font-mono text-sm text-gray-900 dark:text-gray-100 w-28 flex-shrink-0">
                      {order.id}
                    </span>

                    {/* Customer */}
                    <span className="text-sm text-gray-700 dark:text-gray-300 w-32 flex-shrink-0 truncate">
                      {order.customer}
                    </span>

                    {/* Items count */}
                    <span className="text-xs text-gray-400 dark:text-gray-500 w-20 flex-shrink-0">
                      {order.items.length} item(s)
                    </span>

                    {/* Total */}
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 w-24 flex-shrink-0">
                      {formatCurrency(order.total)}
                    </span>

                    {/* Status badge */}
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${sc.color} flex-shrink-0`}
                    >
                      {sc.icon} {sc.label}
                    </span>

                    {/* Date */}
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ml-auto">
                      {formatDate(order.placedAt)}
                    </span>

                    {/* Expand indicator */}
                    <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </button>

                  {/* Expanded items */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 px-4 py-3">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-400 dark:text-gray-500 uppercase">
                            <th className="pb-2">Product ID</th>
                            <th className="pb-2">Name</th>
                            <th className="pb-2 text-right">Qty</th>
                            <th className="pb-2 text-right">Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map((item) => (
                            <tr key={item.productId} className="border-t border-gray-200 dark:border-gray-700">
                              <td className="py-2 text-xs font-mono text-gray-400">{item.productId}</td>
                              <td className="py-2 text-gray-700 dark:text-gray-300">{item.name}</td>
                              <td className="py-2 text-right text-gray-600 dark:text-gray-400">×{item.quantity}</td>
                              <td className="py-2 text-right text-gray-900 dark:text-gray-100">{formatCurrency(item.price)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {order.shippedAt && (
                        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                          🚚 Shipped: {formatDate(order.shippedAt)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination info */}
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 text-center">
          Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total} orders · Page {page}/{totalPages}
        </div>
      </div>
    </McpUseProvider>
  );
}
