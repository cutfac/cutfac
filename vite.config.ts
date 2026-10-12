import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = `http://localhost:${process.env.FACTORY_PORT ?? 4317}`;

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: { proxy: { "/api": server, "/files": server } },
});
