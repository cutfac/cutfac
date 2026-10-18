import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { version } from "./package.json" with { type: "json" };

const server = `http://localhost:${process.env["CUTFAC_PORT"] ?? 4317}`;

export default defineConfig({
  root: "web",
  // `.env` files sit next to package.json, not in `web/`.
  envDir: "..",
  define: { "import.meta.env.APP_VERSION": JSON.stringify(version) },
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    // Keep the board's own Host, so the server sees its requests as same-origin.
    proxy: {
      "/api": { target: server, changeOrigin: false },
      "/files": { target: server, changeOrigin: false },
    },
  },
});
