import fs from "node:fs";
import { readMap } from "../scripts/map-format.js";
import { createBoard, createMovablePositions, createMovePath, createAttackablePositions } from "../packages/shared/src/movement.js";

const tilesData = JSON.parse(fs.readFileSync("./packages/shared/data/tiles.json", "utf8"));
const unitsData = JSON.parse(fs.readFileSync("./packages/shared/data/units.json", "utf8"));

const map = readMap("/home/claude/project_aeii/android/assets/map/campaign/aei_c0.aem");
console.log("Map:", map.width + "x" + map.height, "units:", map.units.length);

const commanderDef = unitsData.units.find((u) => u.isCommander);
const commanderPos = map.units.find((u) => u.unitIndex === commanderDef.index);
const unit = {
  id: "u1",
  x: commanderPos.x,
  y: commanderPos.y,
  team: commanderPos.team,
  currentMovementPoint: commanderDef.movementPoint,
  minAttackRange: commanderDef.minAttackRange,
  maxAttackRange: commanderDef.maxAttackRange,
  abilities: commanderDef.abilities,
  isCrystal: commanderDef.isCrystal,
};

const otherUnits = map.units
  .filter((u) => u !== commanderPos)
  .map((u) => ({ id: `other-${u.x}-${u.y}`, x: u.x, y: u.y, team: u.team, abilities: [] }));

const board = createBoard({
  width: map.width,
  height: map.height,
  tileIndexAt: (x, y) => map.tiles[x][y],
  tileDefs: tilesData.tiles,
  units: [unit, ...otherUnits],
});

const { movable, moveMark } = createMovablePositions(board, unit);
console.log(`Commander at ${unit.x},${unit.y} with ${unit.currentMovementPoint} MP can reach ${movable.size} tiles`);
console.log("Reachable (first 10):", [...movable].slice(0, 10));

const dest = [...movable].find((k) => k !== `${unit.x},${unit.y}`);
if (dest) {
  const [dx, dy] = dest.split(",").map(Number);
  const path = createMovePath(board, unit, moveMark, dx, dy);
  console.log(`Path from ${unit.x},${unit.y} to ${dest}:`, JSON.stringify(path));
}

const attackable = createAttackablePositions(board, unit);
console.log(
  `Attackable positions from current tile (range ${commanderDef.minAttackRange}-${commanderDef.maxAttackRange}):`,
  [...attackable]
);
