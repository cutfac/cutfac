import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { version } from "./package.json" with { type: "json" };

const server = `http://localhost:${process.env["FACTORY_PORT"] ?? 4317}`;

export default defineConfig({
  root: "web",
  // `.env` files sit next to package.json, not in `web/`.
  envDir: "..",
  define: { "import.meta.env.APP_VERSION": JSON.stringify(version) },
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { proxy: { "/api": server, "/files": server } },
});
