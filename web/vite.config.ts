import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The serQ the page was built from, as a tag (with commits past it when the
// checkout is ahead, as in local work against ../serQ's main). serq::VERSION
// is Cargo's version, which serQ's pre-release tags do not bump
// (v0.1.6-alpha.3 says 0.1.5), so the page names the checkout instead.
// Stopgap: docs/upstream.md U11.
function serqRef(): string {
  try {
    return execFileSync("git", ["describe", "--tags", "--always"], {
      cwd: new URL("../../serQ", import.meta.url),
      encoding: "utf8",
    }).trim();
  } catch {
    return readFileSync(new URL("../SERQ_REF", import.meta.url), "utf8").trim();
  }
}

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
  define: { __SERQ_REF__: JSON.stringify(serqRef()) },
});
