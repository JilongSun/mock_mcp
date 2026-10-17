import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Dev UI runs on Vite and proxies the API to the console backend. */
const BACKEND_PORT = Number(process.env.CONSOLE_PORT ?? 8790);
const BACKEND_HOST = process.env.CONSOLE_HOST ?? "127.0.0.1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://${BACKEND_HOST}:${BACKEND_PORT}`,
        changeOrigin: false,
      },
    },
  },
});
