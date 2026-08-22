#!/usr/bin/env node
/**
 * Extracts game data from the original project_aeii (Ancient Empires Reloaded) Java source
 * into clean JSON files for the web rewrite.
 *
 * Source formats (reverse-engineered from core/src/net/toyknight/aeii):
 *   - Units:  core/resources/data/units/unit_N.json  -> already JSON, just re-keyed/validated
 *   - Tiles:  core/resources/data/tiles/tile_N.dat    -> whitespace-delimited positional fields,
 *             parsed exactly as net.toyknight.aeii.utils.TileFactory#loadTileData does.
 *
 * Usage: node extract-game-data.js <path-to-project_aeii-repo> <output-dir>
 */

const fs = require("fs");
const path = require("path");

const ABILITY_NAMES = [
  "CONQUEROR", "FIGHTER_OF_THE_SEA", "FIGHTER_OF_THE_FOREST", "FIGHTER_OF_THE_MOUNTAIN",
  "DESTROYER", "AIR_FORCE", "NECROMANCER", "HEALER", "CHARGER", "POISONER",
  "REPAIRER", "UNDEAD", "MARKSMAN", "SON_OF_THE_SEA", "SON_OF_THE_FOREST",
  "SON_OF_THE_MOUNTAIN", "CRAWLER", "SLOWING_AURA", "COMMANDER", "HEAVY_MACHINE",
  "ATTACK_AURA", "BLOODTHIRSTY", "GUARDIAN", "REFRESH_AURA", "LORD_OF_TERROR",
  "COUNTER_MADNESS", "BLINDER", "REHABILITATION", "HARD_SKIN"
];

const TILE_TYPE_NAMES = ["LAND", "WATER", "FOREST", "MOUNTAIN"];

function readLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// Scanner-style token reader: java.util.Scanner tokenizes across newlines/whitespace,
// so we flatten all tokens rather than relying on strict one-value-per-line.
function makeTokenReader(filePath) {
  const tokens = fs
    .readFileSync(filePath, "utf8")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  let i = 0;
  return {
    nextInt: () => parseInt(tokens[i++], 10),
    nextBoolean: () => {
      const v = tokens[i++];
      return v === "true";
    },
    hasNext: () => i < tokens.length,
  };
}

function extractUnits(repoRoot, outDir) {
  const unitsDir = path.join(repoRoot, "core/resources/data/units");
  const config = JSON.parse(fs.readFileSync(path.join(unitsDir, "unit_config.json"), "utf8"));

  const units = [];
  for (let index = 0; index < config.unit_count; index++) {
    const raw = JSON.parse(fs.readFileSync(path.join(unitsDir, `unit_${index}.json`), "utf8"));
    units.push({
      index,
      price: raw.price,
      occupancy: raw.occupancy,
      maxHp: raw.max_hp,
      attack: raw.attack,
      attackType: raw.attack_type, // 0 = physical, 1 = magic (confirm against Unit.java before combat port)
      physicalDefence: raw.physical_defence,
      magicDefence: raw.magic_defence,
      movementPoint: raw.movement_point,
      abilities: raw.abilities.map((a) => ({ id: a, name: ABILITY_NAMES[a] || `UNKNOWN_${a}` })),
      growth: {
        hp: raw.hp_growth,
        attack: raw.attack_growth,
        physicalDefence: raw.physical_defence_growth,
        magicDefence: raw.magic_defence_growth,
        movement: raw.movement_growth,
      },
      minAttackRange: raw.min_attack_range,
      maxAttackRange: raw.max_attack_range,
      isCommander: index === config.commander_index,
      isSkeleton: index === config.skeleton_index,
      isCrystal: index === config.crystal_index,
    });
  }

  const out = {
    unitCount: config.unit_count,
    commanderIndex: config.commander_index,
    skeletonIndex: config.skeleton_index,
    crystalIndex: config.crystal_index,
    units,
  };
  fs.writeFileSync(path.join(outDir, "units.json"), JSON.stringify(out, null, 2));
  console.log(`Extracted ${units.length} units -> units.json`);
}

function extractTiles(repoRoot, outDir) {
  const tilesDir = path.join(repoRoot, "core/resources/data/tiles");
  const tileCount = parseInt(fs.readFileSync(path.join(tilesDir, "tile_config.dat"), "utf8").trim(), 10);

  const tiles = [];
  for (let index = 0; index < tileCount; index++) {
    const filePath = path.join(tilesDir, `tile_${index}.dat`);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ! missing tile_${index}.dat, skipping`);
      continue;
    }
    const r = makeTokenReader(filePath);

    const defenceBonus = r.nextInt();
    const stepCost = r.nextInt();
    const hpRecovery = r.nextInt();
    const type = r.nextInt();

    const tile = {
      index,
      defenceBonus,
      stepCost,
      hpRecovery,
      type,
      typeName: TILE_TYPE_NAMES[type] || `UNKNOWN_${type}`,
    };

    tile.topTileIndex = r.nextInt();
    tile.team = r.nextInt();

    const accessTileCount = r.nextInt();
    tile.accessTileList = [];
    for (let n = 0; n < accessTileCount; n++) {
      tile.accessTileList.push(r.nextInt());
    }

    tile.capturable = r.nextBoolean();
    if (tile.capturable) {
      tile.capturedTileList = [];
      for (let t = 0; t < 5; t++) tile.capturedTileList.push(r.nextInt());
    }

    tile.destroyable = r.nextBoolean();
    if (tile.destroyable) {
      tile.destroyedTileIndex = r.nextInt();
    }

    tile.repairable = r.nextBoolean();
    if (tile.repairable) {
      tile.repairedTileIndex = r.nextInt();
    }

    tile.animated = r.nextBoolean();
    if (tile.animated) {
      tile.animationTileIndex = r.nextInt();
    }

    tile.miniMapIndex = r.nextInt();
    tile.castle = r.nextBoolean();
    tile.village = r.nextBoolean();
    if (r.hasNext()) {
      tile.temple = r.nextBoolean();
    } else {
      tile.temple = false;
    }

    tiles.push(tile);
  }

  fs.writeFileSync(path.join(outDir, "tiles.json"), JSON.stringify({ tileCount: tiles.length, tiles }, null, 2));
  console.log(`Extracted ${tiles.length} tiles -> tiles.json`);
}

function main() {
  const [, , repoRootArg, outDirArg] = process.argv;
  if (!repoRootArg || !outDirArg) {
    console.error("Usage: node extract-game-data.js <path-to-project_aeii-repo> <output-dir>");
    process.exit(1);
  }
  const repoRoot = path.resolve(repoRootArg);
  const outDir = path.resolve(outDirArg);
  fs.mkdirSync(outDir, { recursive: true });

  extractUnits(repoRoot, outDir);
  extractTiles(repoRoot, outDir);
}

main();
