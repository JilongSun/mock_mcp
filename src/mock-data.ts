/**
 * Centralized mock data for all tools, resources, and widgets.
 * All data is fake / generated — no real APIs or databases are used.
 */

// ─── Users ───────────────────────────────────────────────────────────
export interface MockUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "editor" | "viewer" | "developer";
  avatar: string;
  department: string;
  joinedAt: string;
}

export const mockUsers: MockUser[] = [
  { id: "u-001", name: "Alice Chen", email: "alice@mock.dev", role: "admin", avatar: "👩‍💼", department: "Engineering", joinedAt: "2024-01-15" },
  { id: "u-002", name: "Bob Martinez", email: "bob@mock.dev", role: "developer", avatar: "👨‍💻", department: "Engineering", joinedAt: "2024-02-20" },
  { id: "u-003", name: "Carol Wu", email: "carol@mock.dev", role: "editor", avatar: "👩‍🎨", department: "Design", joinedAt: "2024-03-10" },
  { id: "u-004", name: "Dave Johnson", email: "dave@mock.dev", role: "viewer", avatar: "👨‍🔬", department: "Research", joinedAt: "2024-04-05" },
  { id: "u-005", name: "Eva Lindström", email: "eva@mock.dev", role: "developer", avatar: "👩‍🔧", department: "Platform", joinedAt: "2024-05-18" },
  { id: "u-006", name: "Frank Okafor", email: "frank@mock.dev", role: "editor", avatar: "👨‍🎨", department: "Design", joinedAt: "2024-06-22" },
  { id: "u-007", name: "Grace Kim", email: "grace@mock.dev", role: "admin", avatar: "👩‍🚀", department: "Platform", joinedAt: "2024-07-01" },
  { id: "u-008", name: "Henry Patel", email: "henry@mock.dev", role: "viewer", avatar: "👨‍💼", department: "Marketing", joinedAt: "2024-08-14" },
  { id: "u-009", name: "Iris Nakamura", email: "iris@mock.dev", role: "developer", avatar: "👩‍💻", department: "Engineering", joinedAt: "2024-09-03" },
  { id: "u-010", name: "Jack Torres", email: "jack@mock.dev", role: "editor", avatar: "👨‍✈️", department: "Content", joinedAt: "2024-10-11" },
  { id: "u-011", name: "Karen Smith", email: "karen@mock.dev", role: "viewer", avatar: "👩‍🏫", department: "Marketing", joinedAt: "2024-11-20" },
  { id: "u-012", name: "Leo Fernandez", email: "leo@mock.dev", role: "developer", avatar: "👨‍🚒", department: "Platform", joinedAt: "2024-12-05" },
];

// ─── Products ────────────────────────────────────────────────────────
export interface MockProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  stock: number;
  rating: number;
  description: string;
}

export const mockProducts: MockProduct[] = [
  { id: "p-001", name: "Wireless Headphones Pro", category: "Electronics", price: 199.99, currency: "USD", stock: 145, rating: 4.5, description: "Premium noise-cancelling wireless headphones with 30h battery life." },
  { id: "p-002", name: "Ergonomic Office Chair", category: "Furniture", price: 449.00, currency: "USD", stock: 23, rating: 4.8, description: "Adjustable lumbar support, breathable mesh back, 10-year warranty." },
  { id: "p-003", name: "Mechanical Keyboard RGB", category: "Electronics", price: 129.99, currency: "USD", stock: 312, rating: 4.3, description: "Cherry MX Blue switches, per-key RGB lighting, aluminium frame." },
  { id: "p-004", name: "Standing Desk Converter", category: "Furniture", price: 299.00, currency: "USD", stock: 67, rating: 4.2, description: "Height-adjustable, fits most desks, supports dual monitors." },
  { id: "p-005", name: "USB-C Hub 7-in-1", category: "Accessories", price: 49.99, currency: "USD", stock: 520, rating: 4.0, description: "HDMI 4K, 3x USB-A, SD card, USB-C PD passthrough." },
  { id: "p-006", name: "Ultrawide Monitor 34\"", category: "Electronics", price: 599.99, currency: "USD", stock: 41, rating: 4.7, description: "3440x1440, IPS, 144Hz, 1ms, HDR400." },
  { id: "p-007", name: "Desk Lamp with Wireless Charging", category: "Accessories", price: 79.99, currency: "USD", stock: 188, rating: 4.1, description: "LED desk lamp with built-in Qi wireless charger and USB port." },
  { id: "p-008", name: "Laptop Stand Aluminium", category: "Accessories", price: 39.99, currency: "USD", stock: 403, rating: 4.4, description: "Foldable aluminium stand, ergonomic angle, heat dissipation." },
  { id: "p-009", name: "Webcam 4K Pro", category: "Electronics", price: 159.99, currency: "USD", stock: 89, rating: 4.6, description: "4K UHD webcam with auto-focus, built-in ring light, noise-cancelling mics." },
  { id: "p-010", name: "Bookshelf Speakers Pair", category: "Electronics", price: 249.99, currency: "USD", stock: 35, rating: 4.9, description: "120W powered bookshelf speakers, Bluetooth 5.3, rich bass." },
  { id: "p-011", name: "Desk Mat Felt 90x40cm", category: "Accessories", price: 29.99, currency: "USD", stock: 610, rating: 4.0, description: "Premium felt desk mat, non-slip backing, water-resistant." },
  { id: "p-012", name: "Cable Management Kit", category: "Accessories", price: 24.99, currency: "USD", stock: 890, rating: 3.9, description: "Adhesive clips, cable sleeves, and ties for clean desk setup." },
];

// ─── Orders ──────────────────────────────────────────────────────────
export interface MockOrder {
  id: string;
  customer: string;
  items: { productId: string; name: string; quantity: number; price: number }[];
  total: number;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  placedAt: string;
  shippedAt: string | null;
}

export const mockOrders: MockOrder[] = [
  { id: "ord-1001", customer: "Alice Chen", items: [{ productId: "p-001", name: "Wireless Headphones Pro", quantity: 1, price: 199.99 }], total: 199.99, status: "delivered", placedAt: "2024-12-01", shippedAt: "2024-12-02" },
  { id: "ord-1002", customer: "Bob Martinez", items: [{ productId: "p-003", name: "Mechanical Keyboard RGB", quantity: 1, price: 129.99 }, { productId: "p-005", name: "USB-C Hub 7-in-1", quantity: 2, price: 49.99 }], total: 229.97, status: "shipped", placedAt: "2024-12-05", shippedAt: "2024-12-06" },
  { id: "ord-1003", customer: "Carol Wu", items: [{ productId: "p-002", name: "Ergonomic Office Chair", quantity: 1, price: 449.00 }], total: 449.00, status: "processing", placedAt: "2024-12-08", shippedAt: null },
  { id: "ord-1004", customer: "Dave Johnson", items: [{ productId: "p-007", name: "Desk Lamp with Wireless Charging", quantity: 1, price: 79.99 }, { productId: "p-012", name: "Cable Management Kit", quantity: 3, price: 24.99 }], total: 154.96, status: "pending", placedAt: "2024-12-10", shippedAt: null },
  { id: "ord-1005", customer: "Eva Lindström", items: [{ productId: "p-006", name: "Ultrawide Monitor 34\"", quantity: 1, price: 599.99 }], total: 599.99, status: "delivered", placedAt: "2024-12-12", shippedAt: "2024-12-13" },
  { id: "ord-1006", customer: "Frank Okafor", items: [{ productId: "p-009", name: "Webcam 4K Pro", quantity: 1, price: 159.99 }], total: 159.99, status: "cancelled", placedAt: "2024-12-14", shippedAt: null },
  { id: "ord-1007", customer: "Grace Kim", items: [{ productId: "p-010", name: "Bookshelf Speakers Pair", quantity: 1, price: 249.99 }, { productId: "p-008", name: "Laptop Stand Aluminium", quantity: 1, price: 39.99 }], total: 289.98, status: "shipped", placedAt: "2024-12-15", shippedAt: "2024-12-16" },
  { id: "ord-1008", customer: "Henry Patel", items: [{ productId: "p-011", name: "Desk Mat Felt 90x40cm", quantity: 2, price: 29.99 }, { productId: "p-012", name: "Cable Management Kit", quantity: 1, price: 24.99 }], total: 84.97, status: "delivered", placedAt: "2024-12-18", shippedAt: "2024-12-19" },
  { id: "ord-1009", customer: "Iris Nakamura", items: [{ productId: "p-004", name: "Standing Desk Converter", quantity: 1, price: 299.00 }], total: 299.00, status: "processing", placedAt: "2024-12-20", shippedAt: null },
  { id: "ord-1010", customer: "Jack Torres", items: [{ productId: "p-001", name: "Wireless Headphones Pro", quantity: 1, price: 199.99 }, { productId: "p-009", name: "Webcam 4K Pro", quantity: 1, price: 159.99 }], total: 359.98, status: "pending", placedAt: "2024-12-22", shippedAt: null },
  { id: "ord-1011", customer: "Karen Smith", items: [{ productId: "p-003", name: "Mechanical Keyboard RGB", quantity: 1, price: 129.99 }], total: 129.99, status: "shipped", placedAt: "2024-12-24", shippedAt: "2024-12-25" },
  { id: "ord-1012", customer: "Leo Fernandez", items: [{ productId: "p-005", name: "USB-C Hub 7-in-1", quantity: 5, price: 49.99 }], total: 249.95, status: "delivered", placedAt: "2024-12-26", shippedAt: "2024-12-27" },
];

// ─── Locations (for Map widget) ──────────────────────────────────────
export interface MockLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: "restaurant" | "park" | "museum" | "cafe" | "hotel" | "shopping" | "landmark";
  rating: number;
  address: string;
}

export const mockLocations: MockLocation[] = [
  { id: "loc-001", name: "Golden Dragon Restaurant", lat: 40.7128, lng: -74.0060, type: "restaurant", rating: 4.5, address: "150 Mott St, New York, NY" },
  { id: "loc-002", name: "Central Park", lat: 40.7829, lng: -73.9654, type: "park", rating: 4.9, address: "Central Park, New York, NY" },
  { id: "loc-003", name: "Metropolitan Museum of Art", lat: 40.7794, lng: -73.9632, type: "museum", rating: 4.8, address: "1000 5th Ave, New York, NY" },
  { id: "loc-004", name: "Blue Bottle Coffee", lat: 40.7200, lng: -73.9970, type: "cafe", rating: 4.3, address: "150 Greenwich St, New York, NY" },
  { id: "loc-005", name: "The Plaza Hotel", lat: 40.7644, lng: -73.9745, type: "hotel", rating: 4.7, address: "768 5th Ave, New York, NY" },
  { id: "loc-006", name: "Brooklyn Bridge", lat: 40.7061, lng: -73.9969, type: "landmark", rating: 4.8, address: "Brooklyn Bridge, New York, NY" },
  { id: "loc-007", name: "SoHo Shopping District", lat: 40.7242, lng: -74.0016, type: "shopping", rating: 4.4, address: "SoHo, New York, NY" },
  { id: "loc-008", name: "Joe's Pizza", lat: 40.7308, lng: -74.0002, type: "restaurant", rating: 4.6, address: "7 Carmine St, New York, NY" },
  { id: "loc-009", name: "Washington Square Park", lat: 40.7308, lng: -73.9973, type: "park", rating: 4.5, address: "Washington Square, New York, NY" },
  { id: "loc-010", name: "MoMA", lat: 40.7614, lng: -73.9776, type: "museum", rating: 4.7, address: "11 W 53rd St, New York, NY" },
  { id: "loc-011", "name": "Stumptown Coffee", lat: 40.7350, lng: -73.9900, type: "cafe", rating: 4.2, address: "30 W 8th St, New York, NY" },
  { id: "loc-012", name: "Times Square", lat: 40.7580, lng: -73.9855, type: "landmark", rating: 4.3, address: "Times Square, New York, NY" },
  { id: "loc-013", name: "Fifth Avenue Shopping", lat: 40.7630, lng: -73.9730, type: "shopping", rating: 4.5, address: "5th Ave, New York, NY" },
  { id: "loc-014", name: "The Standard Hotel", lat: 40.7410, lng: -74.0078, type: "hotel", rating: 4.4, address: "848 Washington St, New York, NY" },
  { id: "loc-015", name: "Katz's Delicatessen", lat: 40.7223, lng: -73.9874, type: "restaurant", rating: 4.6, address: "205 E Houston St, New York, NY" },
];

// ─── Documents ───────────────────────────────────────────────────────
export interface MockDocument {
  id: string;
  title: string;
  content: string;
  type: "report" | "memo" | "guide" | "spec";
  author: string;
  createdAt: string;
  tags: string[];
}

export const mockDocuments: MockDocument[] = [
  { id: "doc-001", title: "Q4 Engineering Report", content: "Engineering metrics for Q4: 98% uptime, 45 deploys, 12 incidents resolved.", type: "report", author: "Alice Chen", createdAt: "2024-12-01", tags: ["engineering", "quarterly", "metrics"] },
  { id: "doc-002", title: "Design System v2 Spec", content: "Updated component library with 60+ components, dark mode support, accessibility AA.", type: "spec", author: "Carol Wu", createdAt: "2024-11-15", tags: ["design", "spec", "components"] },
  { id: "doc-003", title: "Onboarding Guide", content: "Step-by-step onboarding guide for new team members covering tools, processes, and contacts.", type: "guide", author: "Grace Kim", createdAt: "2024-10-20", tags: ["onboarding", "guide", "hr"] },
  { id: "doc-004", title: "Platform Migration Memo", content: "Migration to new infrastructure: timeline Q1 2025, phased rollout, rollback plan included.", type: "memo", author: "Eva Lindström", createdAt: "2024-12-10", tags: ["platform", "migration", "memo"] },
  { id: "doc-005", title: "Security Audit Report", content: "Annual security audit findings: 2 critical, 5 high, 12 medium. Remediation in progress.", type: "report", author: "Leo Fernandez", createdAt: "2024-12-05", tags: ["security", "audit", "report"] },
  { id: "doc-006", title: "API Documentation Guide", content: "RESTful API conventions: versioning, error codes, pagination, authentication patterns.", type: "guide", author: "Iris Nakamura", createdAt: "2024-09-28", tags: ["api", "documentation", "guide"] },
  { id: "doc-007", title: "Q3 Marketing Report", content: "Marketing performance: 250K impressions, 15% CTR, 8% conversion, $120K revenue.", type: "report", author: "Henry Patel", createdAt: "2024-10-01", tags: ["marketing", "quarterly", "metrics"] },
  { id: "doc-008", title: "Accessibility Spec v1", content: "WCAG 2.1 AA compliance requirements for all customer-facing products.", type: "spec", author: "Frank Okafor", createdAt: "2024-08-14", tags: ["accessibility", "spec", "a11y"] },
];

// ─── Knowledge Base ──────────────────────────────────────────────────
export interface MockKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: string;
}

export const mockKnowledgeBase: MockKnowledgeEntry[] = [
  { id: "kb-001", title: "How to reset your password", content: "Navigate to Settings → Security → Reset Password. You'll receive an email with a reset link valid for 15 minutes.", category: "account" },
  { id: "kb-002", title: "API rate limits", content: "Free tier: 100 req/min. Pro tier: 1000 req/min. Enterprise: custom. Headers: X-RateLimit-Remaining, X-RateLimit-Reset.", category: "api" },
  { id: "kb-003", title: "Supported file formats", content: "Import: CSV, JSON, XML, Parquet. Export: CSV, JSON, PDF, PNG. Max file size: 50MB.", category: "general" },
  { id: "kb-004", title: "Two-factor authentication setup", content: "Go to Security → 2FA → Enable. Use an authenticator app (Google Authenticator, Authy) or SMS verification.", category: "account" },
  { id: "kb-005", title: "Webhook configuration", content: "Settings → Integrations → Webhooks. Add endpoint URL, select events. Secret key used for HMAC-SHA256 signature verification.", category: "api" },
  { id: "kb-006", title: "Data retention policy", content: "Standard plan: 90 days. Premium: 1 year. Enterprise: custom. Deleted items are soft-deleted for 30 days before permanent removal.", category: "general" },
  { id: "kb-007", title: "SDK installation guide", content: "npm install @mock/sdk or pip install mock-sdk. Initialize with your API key from Settings → API Keys.", category: "api" },
  { id: "kb-008", title: "Billing and invoices", content: "Billing → Invoices. Download PDF invoices. Update payment method under Billing → Payment Methods.", category: "account" },
];

// ─── Server Status ───────────────────────────────────────────────────
export interface MockServerStatus {
  uptime: number; // seconds
  version: string;
  requestCount: number;
  activeConnections: number;
  memoryUsageMB: number;
  cpuPercent: number;
  lastRestart: string;
}

export function getMockServerStatus(): MockServerStatus {
  return {
    uptime: Math.floor(process.uptime()),
    version: "1.0.0-mock",
    requestCount: Math.floor(Math.random() * 10000) + 5000,
    activeConnections: Math.floor(Math.random() * 50) + 5,
    memoryUsageMB: Math.floor(Math.random() * 200) + 100,
    cpuPercent: Math.floor(Math.random() * 40) + 10,
    lastRestart: new Date(Date.now() - 86400000 * 3).toISOString(),
  };
}

// ─── Helper: Pagination ─────────────────────────────────────────────
export function paginate<T>(items: T[], page: number, pageSize: number): { data: T[]; total: number; page: number; pageSize: number; totalPages: number } {
  const total = items.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize);
  return { data, total, page, pageSize, totalPages };
}
