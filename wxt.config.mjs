import { defineConfig } from "wxt";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export default defineConfig({
  srcDir: "src",
  publicDir: "src/shared",
  manifestVersion: 3,
  imports: false,
  // Development stays in disposable .output folders and never launches or
  // modifies an existing browser profile automatically.
  webExt: { disabled: true },
  manifest: ({ browser }) => {
    const manifest = JSON.parse(
      readFileSync(new URL(`./src/${browser}/manifest.json`, import.meta.url)),
    );
    delete manifest.content_scripts; // Owned by the WXT content entrypoint.
    delete manifest.manifest_version; // Both targets use manifestVersion above.
    return manifest;
  },
  hooks: {
    "build:publicAssets"(_wxt, files) {
      // Shared JS is imported and bundled, never copied as unused runtime code.
      for (let i = files.length - 1; i >= 0; i--) {
        if (!/\.(css|png)$/.test(files[i].relativeDest)) files.splice(i, 1);
      }
    },
  },
  vite: ({ browser }) => ({
    resolve: {
      alias: {
        "@platform": fileURLToPath(new URL(`./src/${browser}/platform.js`, import.meta.url)),
      },
    },
    build: {
      target: ["firefox115", "chrome110"],
      minify: false,
      sourcemap: true,
      modulePreload: false,
    },
  }),
});
