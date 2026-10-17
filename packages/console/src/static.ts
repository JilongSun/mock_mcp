/** Static file serving for the built UI, with SPA fallback. */

import path from "node:path";
import type { ServerResponse } from "node:http";
import { sendFile, sendJson } from "./http.js";

export interface StaticHandler {
  (res: ServerResponse, pathname: string): boolean;
}

export function createStaticHandler(uiDir: string): StaticHandler {
  const root = path.resolve(uiDir);
  const indexFile = path.join(root, "index.html");

  return (res, pathname) => {
    const decoded = decodeURIComponent(pathname);
    const candidate = path.resolve(root, `.${decoded}`);

    // Never serve anything outside the build output directory.
    const insideRoot = candidate === root || candidate.startsWith(`${root}${path.sep}`);
    if (insideRoot && path.extname(candidate) !== "" && sendFile(res, candidate)) {
      return true;
    }

    if (sendFile(res, indexFile)) return true;

    sendJson(res, 503, {
      error: {
        code: "UI_NOT_BUILT",
        message: "The console UI is not built yet. Run `pnpm console:build` (or use `pnpm console:dev`).",
      },
    });
    return true;
  };
}
