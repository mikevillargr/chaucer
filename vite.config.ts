import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and no screen clearing; `--mode mock` serves the UI with
// the in-browser mock backend for previewing on the VPS.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  define: { __MOCK__: JSON.stringify(mode === "mock") },
  server: { port: 3010, strictPort: true, allowedHosts: true },
  test: { environment: "jsdom", globals: true, setupFiles: ["src/test/setup.ts"] },
}));
