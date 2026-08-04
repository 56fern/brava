import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { externalizeDepsPlugin } from "electron-vite";
import { build } from "vite";

const root = process.cwd();

await build({
  configFile: false,
  plugins: [externalizeDepsPlugin()],
  build: {
    outDir: resolve(root, "dist/main"), emptyOutDir: true,
    ssr: resolve(root, "src/main/index.ts"),
    rollupOptions: { external: ["electron", /^node:/], output: { format: "es", entryFileNames: "index.js" } },
  },
});

await build({
  configFile: false,
  plugins: [externalizeDepsPlugin()],
  build: {
    outDir: resolve(root, "dist/preload"), emptyOutDir: true,
    ssr: resolve(root, "src/preload/index.ts"),
    rollupOptions: { external: ["electron", /^node:/], output: { format: "cjs", entryFileNames: "index.cjs" } },
  },
});

await build({
  configFile: false,
  root: resolve(root, "src/renderer"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(root, "dist/renderer"), emptyOutDir: true,
    rollupOptions: { input: resolve(root, "src/renderer/index.html") },
  },
});
