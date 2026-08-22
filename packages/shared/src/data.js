import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");

/**
 * These loaders are for server-side (plain Node) use, where reading the file
 * directly is more portable than relying on native JSON import syntax.
 * In the client (Vite), just import the JSON files directly instead:
 *   import units from "@ae/shared/data/units.json";
 */

export function loadUnits() {
  const raw = JSON.parse(readFileSync(path.join(dataDir, "units.json"), "utf8"));
  return raw.units;
}

export function loadTiles() {
  const raw = JSON.parse(readFileSync(path.join(dataDir, "tiles.json"), "utf8"));
  return raw.tiles;
}
