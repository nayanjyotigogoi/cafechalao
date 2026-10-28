import { defineConfig } from "vitest/config";
import path from "node:path";

/** Runs only the seed exporter (npm run seed:export). */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node", include: ["tests/export-seed.test.ts"] },
});
