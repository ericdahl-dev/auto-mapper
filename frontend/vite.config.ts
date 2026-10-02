import { defineConfig } from "vite";

const ENGINE = "http://127.0.0.1:8765";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": ENGINE,
      "/ws": { target: ENGINE, ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        editor: "index.html",
        output: "output.html",
      },
    },
  },
});
