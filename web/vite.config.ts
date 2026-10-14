import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// The serQ the page was built from, as a tag: the one Cargo.lock pins, or,
// with SERQ_DIR set (local work, scripts/build-wasm.sh), that checkout's
// `git describe` (with commits past the tag when it is ahead). serq::VERSION
// is Cargo's version, which serQ's pre-release tags do not bump
// (v0.1.6-alpha.3 says 0.1.5), so the page names the tag instead.
// Stopgap: docs/upstream.md U11.
function serqRef(): string {
  const dir = process.env.SERQ_DIR;
  if (dir) {
    return execFileSync("git", ["describe", "--tags", "--always"], { cwd: dir, encoding: "utf8" }).trim();
  }
  const lock = readFileSync(new URL("../Cargo.lock", import.meta.url), "utf8");
  const tag = /name = "serq"\n[^[]*?source = "git\+[^"?]*\?tag=([^"#]+)#/.exec(lock)?.[1];
  if (!tag) throw new Error("Cargo.lock pins no serq tag (crates/serq-wasm/Cargo.toml)");
  return tag;
}

// `base: "./"` so the build works under any GitHub Pages path
// (https://<owner>.github.io/serq-lar/).
export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
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
