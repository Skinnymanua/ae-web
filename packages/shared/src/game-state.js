/**
 * Owns the actual game state: board (tiles + unit positions), players, rule
 * config, and turn/game status. Everything else in @ae/shared (combat.js,
 * movement.js, turn.js, combat-resolution.js) is pure logic operating on
 * plain data; this module is where that data actually lives and is the one
 * object both client and server should import and drive.
 *
 * Default rule values match entity.Rule#getDefaultRule() in the original.
 */

import {
  createBoard,
  createMovablePositions,
  createMovePath,
  createAttackablePositions,
  canUnitMove,
  getMovementPointCost,
} from "./movement.js";
import { canAttack, canCounter, applyAttack } from "./combat-resolution.js";
import { calcIncome, canBuy, getUnitPrice, canOccupy, resolveCapture, nextTurn, isTeamAlive, checkTeamDestroy } from "./turn.js";

export const DEFAULT_RULE = {
  castleIncome: 100,
  villageIncome: 50,
  commanderIncome: 50,
  killExperience: 60,
  attackExperience: 30,
  counterExperience: 10,
  commanderPriceStep: 100,
  unitCapacity: 15, // POPULATION_PRESET[0]
  enemyClear: true,
  castleClear: true,
};

let nextUnitId = 1;
function generateUnitId() {
  return `unit-${nextUnitId++}`;
}

/**
 * Builds a full unit instance (the shape combat-resolution.js expects) from a
 * units.json definition entry plus its board placement.
 */
export function instantiateUnit(unitDef, { team, x, y, id }) {
  return {
    id: id ?? generateUnitId(),
    unitIndex: unitDef.index,
    unitCode: unitDef.unitCode ?? `unit-${unitDef.index}`,
    team,
    x,
    y,
    level: 0,
    experience: 0,
    standby: false,
    price: unitDef.price,
    occupancy: unitDef.occupancy,
    attack: unitDef.attack,
    attackType: unitDef.attackType,
    physicalDefence: unitDef.physicalDefence,
    magicDefence: unitDef.magicDefence,
    maxHp: unitDef.maxHp,
    currentHp: unitDef.maxHp,
    hpGrowth: unitDef.growth.hp,
    attackGrowth: unitDef.growth.attack,
    physicalDefenceGrowth: unitDef.growth.physicalDefence,
    magicDefenceGrowth: unitDef.growth.magicDefence,
    movementGrowth: unitDef.growth.movement,
    maxMovementPoint: unitDef.movementPoint,
    currentMovementPoint: unitDef.movementPoint,
    minAttackRange: unitDef.minAttackRange,
    maxAttackRange: unitDef.maxAttackRange,
    abilities: unitDef.abilities,
    isCommander: unitDef.isCommander,
    isCrystal: unitDef.isCrystal,
  };
}

/**
 * Attack range reachable from any tile in `movable`, excluding tiles already
 * in `movable` itself (those get the plain move-range highlight instead).
 * Shared by getThreatPositions (preview-mode movable) and
 * getMoveAndAttackPositions (real, blocking-respecting movable) below - the
 * two differ only in how `movable` itself was computed.
 */
function computeExtendedAttackPositions(board, unit, movable) {
  const extendedAttack = new Set();
  for (const key of movable) {
    const [mx, my] = key.split(",").map(Number);
    for (const pos of createAttackablePositions(board, { ...unit, x: mx, y: my })) {
      if (!movable.has(pos)) extendedAttack.add(pos);
    }
  }
  return extendedAttack;
}

export class GameState {
  /**
   * @param {object} params
   * @param {object} params.mapData - output of map-format.js's readMap()
   * @param {object[]} params.unitDefs - units.json's `.units` array
   * @param {object[]} params.tileDefs - tiles.json's `.tiles` array
   * @param {object[]} params.players - [{ team, type, alliance, gold }, ...]
   * @param {object} [params.rule] - overrides merged over DEFAULT_RULE
   */
  constructor({ mapData, unitDefs, tileDefs, players, rule = {} }) {
    this.width = mapData.width;
    this.height = mapData.height;
    this.tileDefs = tileDefs;
    this.unitDefs = unitDefs;
    // mutable copy — capture events rewrite entries in place
    this.tileIndices = mapData.tiles.map((col) => [...col]);

    this.units = mapData.units.map((placement) => {
      const def = unitDefs.find((u) => u.index === placement.unitIndex);
      return instantiateUnit(def, { team: placement.team, x: placement.x, y: placement.y });
    });

    this.players = players.map((p) => ({ population: 0, gold: 0, ...p }));
    for (const player of this.players) {
      player.population = this.units
        .filter((u) => u.team === player.team)
        .reduce((sum, u) => sum + u.occupancy, 0);
    }

    this.rule = { ...DEFAULT_RULE, ...rule };
    this.teamDestroyed = [false, false, false, false];
    this.currentTeam = players[0]?.team ?? 0;
    this.turn = 1;
    this.gameOver = false;

    this._syncTileRefs();
  }

  // --- Internal helpers ---------------------------------------------------

  _syncTileRefs() {
    for (const unit of this.units) {
      unit._tile = this.getTileAt(unit.x, unit.y);
    }
  }

  _board() {
    return createBoard({
      width: this.width,
      height: this.height,
      tileIndexAt: (x, y) => this.tileIndices[x][y],
      tileDefs: this.tileDefs,
      units: this.units,
    });
  }

  /** Derives castle/village ownership summary needed by turn.js's income/win-condition functions. */
  _mapInfo() {
    const castleTeams = [];
    const villageTeams = [];
    const castleCounts = {};
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = this.getTileAt(x, y);
        if (tile.castle) {
          castleTeams.push(tile.team);
          if (tile.team >= 0) castleCounts[tile.team] = (castleCounts[tile.team] ?? 0) + 1;
        }
        if (tile.village) villageTeams.push(tile.team);
      }
    }
    return { castleTeams, villageTeams, castleCounts };
  }

  // --- Queries --------------------------------------------------------------

  getTileAt(x, y) {
    return this.tileDefs[this.tileIndices[x][y]];
  }

  getUnitAt(x, y) {
    return this.units.find((u) => u.x === x && u.y === y) ?? null;
  }

  getUnit(unitId) {
    return this.units.find((u) => u.id === unitId) ?? null;
  }

  getUnitsForTeam(team) {
    return this.units.filter((u) => u.team === team);
  }

  getMovablePositions(unitId) {
    const unit = this.getUnit(unitId);
    const { movable, moveMark } = createMovablePositions(this._board(), unit, { game: this });
    return { positions: movable, moveMark };
  }

  /**
   * Preview-mode movable positions (ignores occupancy/blocking, matching the original's
   * beginPreviewPhase(true)) plus the attack range reachable from any of those tiles —
   * used to show an enemy or already-acted unit's full threat range when selected for
   * stats only. Not in the original (which only ever previews movement, no attack range),
   * but a reasonable extension given we already compute both pieces.
   */
  getThreatPositions(unitId) {
    const unit = this.getUnit(unitId);
    const board = this._board();
    const { movable } = createMovablePositions(board, unit, { preview: true });
    const extendedAttack = computeExtendedAttackPositions(board, unit, movable);
    return { movable, extendedAttack };
  }

  /**
   * Real (non-preview, blocking-respecting) movable positions for unitId, plus
   * the attack range reachable from any of those tiles - the same "move range
   * + attack-beyond-move" combination getThreatPositions shows for an enemy's
   * threat preview, but grounded in tiles the unit can actually reach right
   * now rather than preview mode. Used when the player selects their own unit
   * to move it, so they can see attack options beyond the move-range tiles
   * before committing to a destination.
   */
  getMoveAndAttackPositions(unitId) {
    const unit = this.getUnit(unitId);
    const { positions: movable } = this.getMovablePositions(unitId);
    const extendedAttack = computeExtendedAttackPositions(this._board(), unit, movable);
    return { movable, extendedAttack };
  }

  getMovePath(unitId, destX, destY) {
    const unit = this.getUnit(unitId);
    const { moveMark } = this.getMovablePositions(unitId);
    return createMovePath(this._board(), unit, moveMark, destX, destY);
  }

  getAttackablePositions(unitId) {
    const unit = this.getUnit(unitId);
    return createAttackablePositions(this._board(), unit);
  }

  canAttack(attackerId, defenderId) {
    return canAttack(this, this.getUnit(attackerId), this.getUnit(defenderId));
  }

  // --- Mutating actions -------------------------------------------------

  /** Moves a unit along a path (as returned by getMovePath), consuming movement points. */
  moveUnit(unitId, path) {
    const unit = this.getUnit(unitId);
    if (!unit || path.length === 0) return false;
    const board = this._board();
    for (let i = 1; i < path.length; i++) {
      const { x, y } = path[i];
      const tile = this.getTileAt(x, y);
      unit.currentMovementPoint -= getMovementPointCost(unit, tile);
    }
    const dest = path[path.length - 1];
    if (!canUnitMove(board, unit, dest.x, dest.y)) return false;
    unit.x = dest.x;
    unit.y = dest.y;
    unit._tile = this.getTileAt(dest.x, dest.y);
    return true;
  }

  _movementCost(unit, tile) {
    return getMovementPointCost(unit, tile);
  }

  /** Resolves a full attack (+ counter, death, win-condition check). See combat-resolution.js. */
  attack(attackerId, defenderId) {
    const result = applyAttack(this, this.rule, this.units, this._mapInfo(), attackerId, defenderId);
    this._syncTileRefs();
    return result;
  }

  /** Captures a castle/village tile for the conqueror's team. */
  occupy(unitId, x, y) {
    const unit = this.getUnit(unitId);
    const tile = this.getTileAt(x, y);
    if (!canOccupy(this, unit, tile)) return false;
    const newIndex = resolveCapture(tile, unit.team);
    if (newIndex === null) return false;
    this.tileIndices[x][y] = newIndex;
    this._syncTileRefs();
    return true;
  }

  canOccupy(unitId, x, y) {
    const unit = this.getUnit(unitId);
    const tile = this.getTileAt(x, y);
    return canOccupy(this, unit, tile);
  }

  /** Grants a team its per-turn income (castle + village + commander income). */
  collectIncome(team) {
    const income = calcIncome(this, this.units, this._mapInfo(), team);
    const player = this.players.find((p) => p.team === team);
    if (player) player.gold += income;
    return income;
  }

  canBuyUnit(unitDefIndex, team) {
    const unitDef = this.unitDefs.find((u) => u.index === unitDefIndex);
    const commander = this.units.find((u) => u.team === team && u.isCommander);
    return canBuy(this, this.units, unitDef, team, commander);
  }

  getUnitPriceFor(unitDefIndex, team) {
    const unitDef = this.unitDefs.find((u) => u.index === unitDefIndex);
    const commander = this.units.find((u) => u.team === team && u.isCommander);
    return getUnitPrice(this, unitDef, team, commander);
  }

  /** Castle tiles owned by `team` that are currently empty — valid buy-placement spots. */
  getBuyPositions(team) {
    const positions = [];
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = this.getTileAt(x, y);
        if (tile.castle && tile.team === team && !this.getUnitAt(x, y)) {
          positions.push({ x, y });
        }
      }
    }
    return positions;
  }

  isCastleAccessible(x, y, team) {
    const tile = this.getTileAt(x, y);
    return tile.castle && tile.team === team && !this.getUnitAt(x, y);
  }

  /** Query-only check — does NOT capture the tile, just reports whether `unitId` could. */
  canOccupyTile(unitId, x, y) {
    const unit = this.getUnit(unitId);
    const tile = this.getTileAt(x, y);
    return canOccupy(this, unit, tile);
  }

  /** Buys and places a new unit for `team` at (x, y). Validates gold/population AND that (x,y) is an owned, empty castle tile. */
  buyUnit(unitDefIndex, team, x, y) {
    const unitDef = this.unitDefs.find((u) => u.index === unitDefIndex);
    const commander = this.units.find((u) => u.team === team && u.isCommander);
    if (!this.canBuyUnit(unitDefIndex, team)) return null;
    if (!this.isCastleAccessible(x, y, team)) return null;
    const price = getUnitPrice(this, unitDef, team, commander);
    const player = this.players.find((p) => p.team === team);
    player.gold -= price;
    const unit = instantiateUnit(unitDef, { team, x, y });
    unit._tile = this.getTileAt(x, y);
    this.units.push(unit);
    player.population += unitDef.occupancy;
    return unit;
  }

  /**
   * Ends the current team's turn, advances to the next living team, applies
   * terrain heal + castle siege damage (see turn.js's nextTurn), removes any
   * units that died from it, runs the team-destroy check for affected teams,
   * and grants the new current team its income.
   *
   * Returns the hp-change/destroy events too (same shape as attack()'s
   * result) so the client can animate them — see ui HpChangeAnimator port.
   */
  endTurn() {
    const result = nextTurn(this, this.units);

    if (result.destroyedUnitIds.length) {
      const affectedTeams = new Set(
        result.destroyedUnitIds.map((id) => this.units.find((u) => u.id === id)?.team).filter((t) => t !== undefined)
      );
      const remaining = this.units.filter((u) => !result.destroyedUnitIds.includes(u.id));
      this.units.length = 0;
      this.units.push(...remaining);
      this._syncTileRefs();
      const mapInfo = this._mapInfo();
      for (const team of affectedTeams) {
        checkTeamDestroy(this, this.units, mapInfo, team);
      }
    }

    this.collectIncome(this.currentTeam);
    return { currentTeam: this.currentTeam, ...result };
  }

  isCurrentTeam(team) {
    return this.currentTeam === team && isTeamAlive(this, team);
  }
}