import { fileURLToPath } from "url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // `.claude/` is agent scratch space, ignored globally rather than by this
    // repo. A git worktree under it is a whole second copy of the tree, and
    // there's no `include` here to keep discovery inside `src/`.
    exclude: [...configDefaults.exclude, "**/playwright/**", "**/.claude/**"],
    // Mirrors the `paths` in tsconfig.json, so modules under test can be
    // imported exactly as the app imports them.
    alias: {
      "~/": fileURLToPath(new URL("./src/", import.meta.url)),
      "@server/": fileURLToPath(new URL("./src/server/", import.meta.url)),
    },
    setupFiles: ["dotenv/config"],
  },
});
