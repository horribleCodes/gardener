import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3847" },
  },
  build: {
    outDir: "../dist-client",
    emptyOutDir: true,
  },
});
