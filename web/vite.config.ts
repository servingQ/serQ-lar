import { defineConfig } from "vite";

// `base: "./"` so the build works under any GitHub Pages path
// (https://<owner>.github.io/serq-lar/).
export default defineConfig({
  base: "./",
  build: { target: "es2022" },
  worker: { format: "es" },
});
