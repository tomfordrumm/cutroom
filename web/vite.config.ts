import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Dev: `npm run dev` proxies the API to a running Cutroom (docker compose up).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/media": "http://localhost:8080",
      "/healthz": "http://localhost:8080",
      "/terminal": { target: "ws://localhost:8080", ws: true },
    },
  },
})
