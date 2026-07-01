import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";
import "../styles.css";

const propsSchema = z.object({
  query: z.string(),
  role: z.enum(["admin", "editor", "viewer", "developer"]).nullable(),
  results: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: z.enum(["admin", "editor", "viewer", "developer"]),
      avatar: z.string(),
      department: z.string(),
      joinedAt: z.string(),
    })
  ),
  total: z.number(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Display user search results with role filtering in a visual card layout",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

const roleColors: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  editor: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  viewer: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  developer: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const roleIcons: Record<string, string> = {
  admin: "👩‍💼",
  editor: "👩‍🎨",
  viewer: "👨‍🔬",
  developer: "👨‍💻",
};

export default function UserSearchResults() {
  const { props, isPending } = useWidget<Props>();

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </McpUseProvider>
    );
  }

  const { query, role, results, total } = props;

  return (
    <McpUseProvider autoSize>
      <div className="p-4">
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            User Search Results
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {total} user(s) found
            {query && ` matching "${query}"`}
            {role && ` with role "${role}"`}
          </p>
        </div>

        {/* Results */}
        {results.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500">
            <p className="text-3xl mb-2">🔍</p>
            <p>No users found matching your criteria.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {results.map((user) => (
              <div
                key={user.id}
                className="flex items-center gap-4 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:shadow-md transition-shadow"
              >
                {/* Avatar */}
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xl">
                  {user.avatar}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {user.name}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${roleColors[user.role]}`}
                    >
                      {roleIcons[user.role]} {user.role}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {user.email}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-gray-500">
                    <span>🏢 {user.department}</span>
                    <span>📅 Joined {user.joinedAt}</span>
                  </div>
                </div>

                {/* ID badge */}
                <div className="flex-shrink-0">
                  <span className="text-xs text-gray-400 dark:text-gray-500 font-mono bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded">
                    {user.id}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 text-center">
          Mock data — {results.length} of {total} results shown
        </div>
      </div>
    </McpUseProvider>
  );
}
