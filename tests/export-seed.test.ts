import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";
import { buildSeed } from "@/mock/seed";
import { TABLE_NAMES } from "@/mock/tables";

/**
 * Writes the demo data as one JSON file per database table (seed-data/<table>.json) so the Laravel
 * DatabaseSeeder can load exactly the rows the frontend was built and tested against.
 */
test("export seed tables", () => {
  const t = buildSeed(new Date());
  const dir = path.resolve(__dirname, "../seed-data");
  mkdirSync(dir, { recursive: true });
  const summary: Record<string, number> = {};
  for (const name of TABLE_NAMES) {
    if (name === "api_tokens" || name === "idempotency_keys") continue;
    const rows = t[name] as unknown[];
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rows, null, 1));
    summary[name] = rows.length;
  }
  writeFileSync(path.join(dir, "_summary.json"), JSON.stringify(summary, null, 2));
  console.log(summary);
});
