/**
 * Ported from net.toyknight.aeii.manager.PositionGenerator and
 * UnitToolkit#getMovementPointCost / GameCore#canUnitMove / GameCore#canMoveThrough.
 *
 * Operates on a "board" abstraction rather than the original's tightly-coupled
 * GameManager/GameCore singleton, so it can run identically on client (prediction/
 * preview) and server (authoritative validation).
 *
 * One deliberate deviation from the original: the Java code identifies "the same
 * unit" by (position + unitCode string). We use a unique `id` per unit instance
 * instead, since an authoritative multiplayer server needs stable unit identity
 * across turns anyway (unitCode alone doesn't disambiguate two units of the same
 * type on the board).
 */

import { ABILITY, TILE_TYPE } from "./combat.js";

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

function hasAbility(unit, abilityId) {
  return unit.abilities?.some((a) => (typeof a === "object" ? a.id === abilityId : a === abilityId));
}

function isSameUnit(a, b) {
  return !!a && !!b && a.id === b.id;
}

export function posKey(x, y) {
  return `${x},${y}`;
}

/**
 * Minimal board interface expected by every function below:
 *   board.width, board.height
 *   board.isWithinMap(x, y) -> boolean
 *   board.tileAt(x, y) -> tile object (shape matches tiles.json entries)
 *   board.unitAt(x, y) -> unit object or null
 */
export function createBoard({ width, height, tileIndexAt, tileDefs, units }) {
  const unitGrid = Array.from({ length: width }, () => new Array(height).fill(null));
  for (const u of units) {
    unitGrid[u.x][u.y] = u;
  }
  return {
    width,
    height,
    isWithinMap(x, y) {
      return x >= 0 && x < width && y >= 0 && y < height;
    },
    tileAt(x, y) {
      return tileDefs[tileIndexAt(x, y)];
    },
    unitAt(x, y) {
      return unitGrid[x]?.[y] ?? null;
    },
  };
}

export function getMovementPointCost(unit, tile) {
  let cost = tile.stepCost;
  const type = tile.type;
  if (hasAbility(unit, ABILITY.AIR_FORCE)) cost = 1;
  if (
    hasAbility(unit, ABILITY.CRAWLER) &&
    (type === TILE_TYPE.LAND || type === TILE_TYPE.FOREST || type === TILE_TYPE.MOUNTAIN)
  ) {
    cost = 1;
  }
  if (hasAbility(unit, ABILITY.FIGHTER_OF_THE_SEA) && type === TILE_TYPE.WATER) cost = 1;
  if (hasAbility(unit, ABILITY.FIGHTER_OF_THE_FOREST) && type === TILE_TYPE.FOREST) cost = 1;
  if (hasAbility(unit, ABILITY.FIGHTER_OF_THE_MOUNTAIN) && type === TILE_TYPE.MOUNTAIN) cost = 1;
  if (unit.isCrystal && type === TILE_TYPE.MOUNTAIN && tile.stepCost >= 3) cost = 99;
  return cost;
}

/**
 * Enmity depends on team *alliance*, not raw team number (see turn.js's
 * getAlliance/isEnemy — GameCore#isEnemy in the original). If a `game` object
 * (with .players[].alliance) is passed, real alliance rules apply; otherwise
 * this falls back to "different team = enemy", which is only correct for
 * games with no shared alliances (fine for 1v1, wrong for team games).
 */
export function isEnemy(unitA, unitB, game) {
  if (game) {
    const allianceA = game.players[unitA.team]?.alliance;
    const allianceB = game.players[unitB.team]?.alliance;
    return unitA.team >= 0 && unitB.team >= 0 && allianceA !== allianceB;
  }
  return unitA.team !== unitB.team;
}

export function canMoveThrough(unit, targetUnit, game) {
  return (
    targetUnit === null ||
    !isEnemy(unit, targetUnit, game) ||
    (hasAbility(unit, ABILITY.AIR_FORCE) && !hasAbility(targetUnit, ABILITY.AIR_FORCE))
  );
}

export function canUnitMove(board, unit, destX, destY) {
  const destUnit = board.unitAt(destX, destY);
  return destUnit === null || isSameUnit(unit, destUnit);
}

/**
 * Flood-fills reachable tiles from the unit's current position, respecting
 * per-tile movement cost and blocking rules. Returns both the set of reachable
 * positions and the raw moveMark grid (needed by createMovePath for backtracking).
 *
 * @param {boolean} preview - if true, ignores occupancy/blocking (used for UI
 *   "what could I reach" hints); if false, applies real move/block rules.
 */
export function createMovablePositions(board, unit, { preview = false, game } = {}) {
  const moveMark = Array.from({ length: board.width }, () => new Array(board.height).fill(-Infinity));
  const movable = new Set();

  let currentSteps = [{ x: unit.x, y: unit.y, mp: unit.currentMovementPoint }];

  while (currentSteps.length > 0) {
    const nextSteps = [];
    for (const step of currentSteps) {
      const { x, y, mp } = step;
      if (mp > moveMark[x][y]) {
        moveMark[x][y] = mp;
        if (preview || canUnitMove(board, unit, x, y)) {
          movable.add(posKey(x, y));
        }
      }
      for (let i = 0; i < 4; i++) {
        const nx = x + DX[i];
        const ny = y + DY[i];
        if (!board.isWithinMap(nx, ny)) continue;
        const tile = board.tileAt(nx, ny);
        const cost = getMovementPointCost(unit, tile);
        const mpLeft = mp - cost;
        if (cost <= mp && mpLeft > moveMark[nx][ny]) {
          const targetUnit = board.unitAt(nx, ny);
          if (preview || canMoveThrough(unit, targetUnit, game)) {
            nextSteps.push({ x: nx, y: ny, mp: mpLeft });
          }
        }
      }
    }
    currentSteps = nextSteps;
  }

  return { movable, moveMark };
}

/**
 * Reconstructs the actual step-by-step path to a destination by backtracking
 * through the moveMark grid produced by createMovablePositions — greedily
 * stepping to whichever neighbor has the highest remaining-movement mark.
 */
export function createMovePath(board, unit, moveMark, destX, destY) {
  const path = [];
  const startX = unit.x;
  const startY = unit.y;
  if ((startX !== destX || startY !== destY) && moveMark[destX][destY] > -Infinity) {
    buildPath(board, moveMark, destX, destY, startX, startY, path);
  }
  return path;
}

function buildPath(board, moveMark, curX, curY, startX, startY, path) {
  path.unshift({ x: curX, y: curY });
  if (curX !== startX || curY !== startY) {
    let nextX = 0;
    let nextY = 0;
    let nextMark = -Infinity;
    for (let i = 0; i < 4; i++) {
      const tx = curX + DX[i];
      const ty = curY + DY[i];
      if (!board.isWithinMap(tx, ty)) continue;
      if (tx === startX && ty === startY) {
        nextX = tx;
        nextY = ty;
        nextMark = Infinity;
      } else {
        const mark = moveMark[tx][ty];
        if (mark > nextMark) {
          nextX = tx;
          nextY = ty;
          nextMark = mark;
        }
      }
    }
    buildPath(board, moveMark, nextX, nextY, startX, startY, path);
  }
}

/** Diamond-shaped ring of positions between minRange and maxRange (Manhattan distance). */
export function createPositionsWithinRange(board, x, y, minRange, maxRange) {
  const positions = new Set();
  for (let ar = minRange; ar <= maxRange; ar++) {
    for (let dx = -ar; dx <= ar; dx++) {
      const dy = dx >= 0 ? ar - dx : -ar - dx;
      if (board.isWithinMap(x + dx, y + dy)) positions.add(posKey(x + dx, y + dy));
      if (dy !== 0 && board.isWithinMap(x + dx, y - dy)) positions.add(posKey(x + dx, y - dy));
    }
  }
  return positions;
}

export function createAttackablePositions(board, unit, includeSelf = false) {
  const positions = createPositionsWithinRange(board, unit.x, unit.y, unit.minAttackRange, unit.maxAttackRange);
  if (includeSelf) positions.add(posKey(unit.x, unit.y));
  return positions;
}
