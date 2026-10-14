import { defineConfig } from "vite";

// `base: "./"` so the build works under any GitHub Pages path
// (https://<owner>.github.io/serq-lar/).
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  // React Flow marks its module "use client" for React Server Components, which a static page has none of
  build: {
    target: "es2022",
    rollupOptions: {
      onwarn(w, warn) {
        if (w.code !== "MODULE_LEVEL_DIRECTIVE") warn(w);
      },
    },
  },
});
