import { McpUseProvider, useWidget, useWidgetTheme, type WidgetMetadata } from "mcp-use/react";
import { useState } from "react";
import { z } from "zod";
import "../styles.css";

const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  type: z.enum(["restaurant", "park", "museum", "cafe", "hotel", "shopping", "landmark"]),
  rating: z.number(),
  address: z.string(),
});

const propsSchema = z.object({
  centerLat: z.number(),
  centerLng: z.number(),
  radius: z.number(),
  locations: z.array(locationSchema),
  total: z.number(),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Visual map-like widget showing nearby points of interest with colored pins",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;
type LocationRow = Props["locations"][number];

const typeConfig: Record<string, { label: string; color: string; bg: string; darkBg: string; icon: string }> = {
  restaurant: { label: "Restaurant", color: "#ef4444", bg: "rgba(239,68,68,0.15)", darkBg: "rgba(239,68,68,0.25)", icon: "🍽️" },
  park: { label: "Park", color: "#22c55e", bg: "rgba(34,197,94,0.15)", darkBg: "rgba(34,197,94,0.25)", icon: "🌳" },
  museum: { label: "Museum", color: "#a855f7", bg: "rgba(168,85,247,0.15)", darkBg: "rgba(168,85,247,0.25)", icon: "🏛️" },
  cafe: { label: "Café", color: "#f59e0b", bg: "rgba(245,158,11,0.15)", darkBg: "rgba(245,158,11,0.25)", icon: "☕" },
  hotel: { label: "Hotel", color: "#3b82f6", bg: "rgba(59,130,246,0.15)", darkBg: "rgba(59,130,246,0.25)", icon: "🏨" },
  shopping: { label: "Shopping", color: "#ec4899", bg: "rgba(236,72,153,0.15)", darkBg: "rgba(236,72,153,0.25)", icon: "🛍️" },
  landmark: { label: "Landmark", color: "#f97316", bg: "rgba(249,115,22,0.15)", darkBg: "rgba(249,115,22,0.25)", icon: "📍" },
};

const GRID_COLS = 20;
const GRID_ROWS = 14;

/**
 * Maps a real lat/lng coordinate to a grid position.
 * All mock locations are in NYC (~40.70–40.79 lat, ~-74.01 to -73.96 lng).
 * We normalize them onto the CSS grid.
 */
function toGridPosition(lat: number, lng: number, centerLat: number, centerLng: number) {
  // Use a fixed bounding box for NYC mock data
  const latMin = 40.700;
  const latMax = 40.790;
  const lngMin = -74.010;
  const lngMax = -73.960;

  const col = Math.round(((lng - lngMin) / (lngMax - lngMin)) * (GRID_COLS - 1));
  const row = Math.round(((latMax - lat) / (latMax - latMin)) * (GRID_ROWS - 1));

  return {
    col: Math.max(0, Math.min(GRID_COLS - 1, col)),
    row: Math.max(0, Math.min(GRID_ROWS - 1, row)),
  };
}

export default function LocationMap() {
  const { props, isPending } = useWidget<Props>();
  const theme = useWidgetTheme();
  const [selectedLocation, setSelectedLocation] = useState<LocationRow | null>(null);
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-lg" />
          </div>
        </div>
      </McpUseProvider>
    );
  }

  const { centerLat, centerLng, radius, locations, total } = props;
  const isDark = theme === "dark";

  return (
    <McpUseProvider autoSize>
      <div className="p-4">
        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            📍 Nearby Locations
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Around ({centerLat.toFixed(4)}, {centerLng.toFixed(4)}) · {radius}km radius · {total} found
          </p>
        </div>

        <div className="flex gap-4">
          {/* Map grid */}
          <div className="flex-1">
            <div
              className="relative rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600"
              style={{
                backgroundColor: isDark ? "#1e293b" : "#e8f4e8",
                backgroundImage: isDark
                  ? "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)"
                  : "linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)",
                backgroundSize: `${100 / GRID_COLS}% ${100 / GRID_ROWS}%`,
              }}
            >
              {/* Grid container with aspect ratio */}
              <div style={{ aspectRatio: `${GRID_COLS}/${GRID_ROWS}`, position: "relative" }}>
                {/* Center crosshair */}
                {(() => {
                  const center = toGridPosition(centerLat, centerLng, centerLat, centerLng);
                  return (
                    <div
                      style={{
                        position: "absolute",
                        left: `${(center.col / GRID_COLS) * 100}%`,
                        top: `${(center.row / GRID_ROWS) * 100}%`,
                        transform: "translate(-50%, -50%)",
                        zIndex: 10,
                      }}
                    >
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          border: "3px solid #3b82f6",
                          backgroundColor: "rgba(59,130,246,0.3)",
                          boxShadow: "0 0 8px rgba(59,130,246,0.5)",
                        }}
                        title={`Center: (${centerLat.toFixed(4)}, ${centerLng.toFixed(4)})`}
                      />
                    </div>
                  );
                })()}

                {/* Location pins */}
                {locations.map((loc) => {
                  const pos = toGridPosition(loc.lat, loc.lng, centerLat, centerLng);
                  const tc = typeConfig[loc.type];
                  const isSelected = selectedLocation?.id === loc.id;
                  const isHovered = hoveredPin === loc.id;

                  return (
                    <div
                      key={loc.id}
                      role="button"
                      tabIndex={0}
                      onMouseEnter={() => setHoveredPin(loc.id)}
                      onMouseLeave={() => setHoveredPin(null)}
                      onClick={() => setSelectedLocation(isSelected ? null : loc)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedLocation(isSelected ? null : loc); } }}
                      style={{
                        position: "absolute",
                        left: `${(pos.col / GRID_COLS) * 100}%`,
                        top: `${(pos.row / GRID_ROWS) * 100}%`,
                        transform: "translate(-50%, -50%)",
                        zIndex: isSelected || isHovered ? 5 : 2,
                        cursor: "pointer",
                        transition: "transform 0.15s ease",
                      }}
                    >
                      {/* Pin dot */}
                      <div
                        style={{
                          width: isSelected ? 18 : isHovered ? 16 : 12,
                          height: isSelected ? 18 : isHovered ? 16 : 12,
                          borderRadius: "50%",
                          backgroundColor: tc.color,
                          border: isSelected ? "3px solid white" : "2px solid rgba(255,255,255,0.8)",
                          boxShadow: isSelected
                            ? `0 0 10px ${tc.color}, 0 2px 6px rgba(0,0,0,0.3)`
                            : isHovered
                              ? `0 0 6px ${tc.color}, 0 1px 3px rgba(0,0,0,0.2)`
                              : "0 1px 3px rgba(0,0,0,0.2)",
                          transition: "all 0.15s ease",
                        }}
                      />

                      {/* Tooltip on hover */}
                      {(isHovered || isSelected) && (
                        <div
                          style={{
                            position: "absolute",
                            left: "50%",
                            bottom: "100%",
                            transform: "translateX(-50%)",
                            marginBottom: 8,
                            backgroundColor: isDark ? "#1f2937" : "white",
                            color: isDark ? "#f3f4f6" : "#1f2937",
                            border: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                            borderRadius: 6,
                            padding: "4px 8px",
                            fontSize: 11,
                            whiteSpace: "nowrap",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                            zIndex: 20,
                            pointerEvents: "none",
                          }}
                        >
                          {tc.icon} {loc.name}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "4px 12px",
                  padding: "8px 12px",
                  borderTop: `1px solid ${isDark ? "#374151" : "#e5e7eb"}`,
                  backgroundColor: isDark ? "rgba(30,41,59,0.8)" : "rgba(255,255,255,0.8)",
                }}
              >
                {Object.entries(typeConfig).map(([key, tc]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: tc.color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: isDark ? "#9ca3af" : "#6b7280" }}>
                      {tc.icon} {tc.label}
                    </span>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: "2px solid #3b82f6",
                      backgroundColor: "rgba(59,130,246,0.2)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: isDark ? "#9ca3af" : "#6b7280" }}>Center</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar: selected location details */}
          {selectedLocation && (
            <div className="w-56 flex-shrink-0">
              <div
                className="rounded-lg border p-4"
                style={{
                  borderColor: isDark ? "#374151" : "#e5e7eb",
                  backgroundColor: isDark ? "#1f2937" : "white",
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm" style={{ color: isDark ? "#f3f4f6" : "#1f2937" }}>
                    {typeConfig[selectedLocation.type].icon} {selectedLocation.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSelectedLocation(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-sm leading-none"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-2 text-xs">
                  <div>
                    <span style={{ color: isDark ? "#9ca3af" : "#9ca3af" }}>Type: </span>
                    <span style={{ color: typeConfig[selectedLocation.type].color, fontWeight: 500 }}>
                      {typeConfig[selectedLocation.type].label}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: isDark ? "#9ca3af" : "#9ca3af" }}>Rating: </span>
                    <span style={{ color: isDark ? "#f3f4f6" : "#1f2937" }}>
                      {"⭐".repeat(Math.round(selectedLocation.rating))} {selectedLocation.rating}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: isDark ? "#9ca3af" : "#9ca3af" }}>Address: </span>
                    <span style={{ color: isDark ? "#f3f4f6" : "#1f2937" }}>{selectedLocation.address}</span>
                  </div>
                  <div>
                    <span style={{ color: isDark ? "#9ca3af" : "#9ca3af" }}>Coordinates: </span>
                    <span className="font-mono" style={{ color: isDark ? "#f3f4f6" : "#1f2937" }}>
                      {selectedLocation.lat.toFixed(4)}, {selectedLocation.lng.toFixed(4)}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: isDark ? "#9ca3af" : "#9ca3af" }}>ID: </span>
                    <span className="font-mono text-gray-400">{selectedLocation.id}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 text-center">
          Click a colored pin to see location details · All data is mock
        </div>
      </div>
    </McpUseProvider>
  );
}
