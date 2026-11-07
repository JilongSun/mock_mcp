/**
 * Bind hosts and client-facing URLs.
 *
 * A worker (or the console) can bind one of two hosts:
 *
 *   127.0.0.1  loopback only — reachable from this machine
 *   0.0.0.0    every interface — reachable from the LAN
 *
 * `0.0.0.0` is a bind address, not an address a client can use, so the URLs we
 * show (and the base URL we hand to mcp-use) must be derived from the machine's
 * LAN addresses instead.
 */

import os from "node:os";

export const LOOPBACK_HOST = "127.0.0.1";
export const WILDCARD_HOST = "0.0.0.0";
export const ALLOWED_HOSTS = [LOOPBACK_HOST, WILDCARD_HOST] as const;

export type BindHost = (typeof ALLOWED_HOSTS)[number];

export function isWildcardHost(host: string): boolean {
  return host === WILDCARD_HOST || host === "::" || host === "";
}

export function isLoopbackHost(host: string): boolean {
  return host === LOOPBACK_HOST || host === "localhost" || host === "::1";
}

export function isAllowedHost(host: string): host is BindHost {
  return (ALLOWED_HOSTS as readonly string[]).includes(host);
}

export interface LanAddress {
  address: string;
  /** Interface name, e.g. `en0` — useful when a machine has several. */
  iface: string;
}

/**
 * IPv4 addresses other machines can reach. Excludes loopback and link-local
 * (`169.254.x.x`, which is not routable in practice).
 */
export function listLanAddresses(): LanAddress[] {
  const result: LanAddress[] = [];

  for (const [iface, addresses] of Object.entries(os.networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      result.push({ address: entry.address, iface });
    }
  }

  // Prefer the interface that carries the default route: `en0`/`eth0` before
  // docker/vpn bridges, so a laptop with several adapters shows the useful one.
  const preferred = /^(en0|eth0|wlan0|en1|Wi-Fi)$/i;
  return result.sort((a, b) => {
    const aPreferred = preferred.test(a.iface) ? 0 : 1;
    const bPreferred = preferred.test(b.iface) ? 0 : 1;
    return aPreferred - bPreferred;
  });
}

/** The address a LAN client should use, or `null` when the machine is offline. */
export function primaryLanAddress(): string | null {
  return listLanAddresses()[0]?.address ?? null;
}

export type AccessScope = "local" | "lan";

export interface AccessUrl {
  url: string;
  /** `local` = only this machine; `lan` = other machines on the network. */
  scope: AccessScope;
  /** Network interface the LAN address belongs to. */
  iface?: string;
}

/**
 * URLs a client can use for a service bound to `host:port`.
 *
 * With a wildcard bind the LAN addresses come first, because they are the ones
 * that only exist in this case and are what the user is normally after.
 */
export function accessUrls(host: string, port: number, path = ""): AccessUrl[] {
  const suffix = path === "" ? "" : path.startsWith("/") ? path : `/${path}`;

  if (!isWildcardHost(host)) {
    return [{ url: `http://${host}:${port}${suffix}`, scope: "local" }];
  }

  const urls: AccessUrl[] = listLanAddresses().map((entry) => ({
    url: `http://${entry.address}:${port}${suffix}`,
    scope: "lan" as const,
    iface: entry.iface,
  }));

  urls.push({ url: `http://${LOOPBACK_HOST}:${port}${suffix}`, scope: "local" });
  return urls;
}

/**
 * The base URL handed to mcp-use via `MCP_URL`.
 *
 * mcp-use bakes this into the widget HTML (`window.__getFile`) and into server
 * metadata, so it must be an address clients can actually reach. For a wildcard
 * bind that is a LAN address — using `localhost` would make the widgets of every
 * remote client fetch assets from the client itself.
 */
export function resolveMcpUrl(host: string, port: number): string {
  if (!isWildcardHost(host)) return `http://${host}:${port}`;
  return `http://${primaryLanAddress() ?? "localhost"}:${port}`;
}
