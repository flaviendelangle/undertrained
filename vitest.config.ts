import { fileURLToPath } from "url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/playwright/**"],
    // Mirrors the `paths` in tsconfig.json, so modules under test can be
    // imported exactly as the app imports them.
    alias: {
      "~/": fileURLToPath(new URL("./src/", import.meta.url)),
      "@server/": fileURLToPath(new URL("./src/server/", import.meta.url)),
    },
    setupFiles: ["dotenv/config"],
  },
});
