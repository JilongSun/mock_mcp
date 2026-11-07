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
  /** Interface name, useful when a machine has several. */
  iface: string;
}

/** Ranges no client on the network can dial. */
export function isUnroutableAddress(address: string): boolean {
  const [first, second] = address.split(".").map(Number);

  // 169.254.0.0/16 — link-local (APIPA). Self-assigned when there is no DHCP;
  // valid only on the local link, so it is never a stable address to hand out.
  if (first === 169 && second === 254) return true;

  // 198.18.0.0/15 — RFC 2544 benchmarking range. Transparent proxies also use
  // it for their fake-ip tunnel gateway. A /15 spans 198.18.* AND 198.19.*,
  // hence both are matched.
  if (first === 198 && (second === 18 || second === 19)) return true;

  return false;
}

/** Tunnel and virtual interfaces — usable, but rarely what a LAN client wants. */
function isVirtualInterface(iface: string): boolean {
  return /^(utun|tun|tap|ppp|ipsec|bridge|vmnet|vboxnet|docker|veth)/i.test(iface);
}

/**
 * IPv4 addresses other machines can reach. Excludes loopback, link-local and
 * proxy fake-ip addresses, which are not dialable from the outside.
 */
export function listLanAddresses(): LanAddress[] {
  const result: LanAddress[] = [];

  for (const [iface, addresses] of Object.entries(os.networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isUnroutableAddress(entry.address)) continue;
      result.push({ address: entry.address, iface });
    }
  }

  // Physical/primary interfaces keep the order the OS reports them in; tunnel
  // and container interfaces move last so they do not become the default URL.
  return result.sort(
    (a, b) =>
      Number(isVirtualInterface(a.iface)) - Number(isVirtualInterface(b.iface)),
  );
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
