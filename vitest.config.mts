import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

if (process.env.GITHUB_ACTIONS === "true" && !process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required in GitHub Actions so PostgreSQL tests cannot be silently skipped.",
  );
}

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
