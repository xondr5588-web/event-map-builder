import { defineConfig } from "vite";
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "public" ? [{
    name: "public-recovery-only",
    transformIndexHtml: { order: "pre", handler: (html) =>
      html.replace(/<body>[\s\S]*<\/body>/, '<body><script type="module" src="./src/public-entry.js"></script></body>') },
  }] : [],
  build: { target: "es2022" },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
}));
