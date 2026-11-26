import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    fs: {
      allow: [".."],
    },
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:3001",
        ws: true,
      },
      "/api": {
        target: "http://127.0.0.1:3001",
      },
    },
  },
});
