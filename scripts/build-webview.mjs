import { build } from "esbuild";

await build({
  entryPoints: ["src/webview/main.tsx"],
  outfile: "dist/webview/main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "none",
});
