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
  posKey,
} from "./movement.js";
import { canAttack, canCounter, applyAttack, isWithinRange, canHeal, applyHeal, getMaxHp } from "./combat-resolution.js";
import { ABILITY } from "./combat.js";
import {
  calcIncome,
  canBuy,
  getUnitPrice,
  canOccupy,
  resolveCapture,
  nextTurn,
  isTeamAlive,
  checkTeamDestroy,
  applyAuraEffects,
  applyTombHazard,
  isTomb,
  removeTomb,
  updateTombs,
} from "./turn.js";

function hasAbility(unit, abilityId) {
  return unit.abilities?.some((a) => (typeof a === "object" ? a.id === abilityId : a === abilityId));
}

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
  healerBaseHeal: 40, // Rule.HEALER_BASE_HEAL - see combat-resolution.js's getHealerHeal
  refreshBaseHeal: 10, // Rule.REFRESH_BASE_HEAL - see combat-resolution.js's getRefresherHeal
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
    status: null, // { type, remainingTurn } | null - see combat.js's STATUS/attachStatus
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
    this.tombs = (mapData.tombs ?? []).map((t) => ({ ...t }));
    this.commanderDeaths = {}; // {[team]: number} - read by turn.js's getUnitPrice for repurchase-cost scaling

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

  /** `includeSelf`: adds the unit's own tile to the range set regardless of
   * minAttackRange - needed for heal-targeting, where self-heal is always
   * allowed (see GameState#getHealablePositions below and
   * movement.js's createAttackablePositions). */
  getAttackablePositions(unitId, includeSelf = false) {
    const unit = this.getUnit(unitId);
    return createAttackablePositions(this._board(), unit, includeSelf);
  }

  canAttack(attackerId, defenderId) {
    return canAttack(this, this.getUnit(attackerId), this.getUnit(defenderId));
  }

  /** Positions within healerId's own attack range - PLUS its own tile,
   * self-heal is always allowed - that hold a valid heal target: an ally (or
   * itself) not already overflowing max HP, or an UNDEAD enemy (heal becomes
   * damage against them). Ported from GameManager#hasAllyCanHealWithinRange,
   * generalized to return the full set rather than just a boolean. Empty for
   * a non-HEALER, since canHeal always fails for those regardless of target. */
  getHealablePositions(healerId) {
    const positions = this.getAttackablePositions(healerId, true);
    const result = new Set();
    for (const key of positions) {
      const [x, y] = key.split(",").map(Number);
      const target = this.getUnitAt(x, y);
      if (target && canHeal(this, this.getUnit(healerId), target)) result.add(key);
    }
    return result;
  }

  canHeal(healerId, targetId) {
    return canHeal(this, this.getUnit(healerId), this.getUnit(targetId));
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

  /** Resolves a full heal action (heal, or heal-as-damage against an UNDEAD
   * target - possibly lethal, win-condition check included). See
   * combat-resolution.js's applyHeal/resolveHeal for the split logic. */
  heal(healerId, targetId) {
    const result = applyHeal(this, this.rule, this.units, this._mapInfo(), healerId, targetId);
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

  /**
   * Marks unitId's turn as done and applies whatever aura it has (see
   * turn.js's applyAuraEffects) to every unit within 2 tiles - ported from
   * GameEventExecutor#onStandby, which runs this exact scan on EVERY unit
   * going standby, not just aura-bearers (applyAuraEffects' own ability
   * checks gate whether anything actually happens). This is the single
   * place standby should be set from - the client used to just mutate
   * unit.standby directly, which skipped the aura scan entirely.
   *
   * Also runs the tomb hazard check (turn.js's applyTombHazard) for the same
   * reason: standing on a grave and going standby is what triggers it in the
   * original, whether or not the unit has anything to do with necromancy.
   *
   * And clamps the standing-by unit's own HP down to max if it's currently
   * overflowing - ported from OperationExecutor#onStandby's overflow check:
   * a Paladin's heal (see combat-resolution.js's getHealerHeal) can push an
   * ally above their normal max HP; the first time THAT unit goes standby
   * again, the excess is trimmed off, regardless of what action it just took.
   */
  standby(unitId) {
    const unit = this.getUnit(unitId);
    if (!unit) return;
    unit.standby = true;

    const maxHp = getMaxHp(unit);
    if (unit.currentHp > maxHp) unit.currentHp = maxHp;

    const { destroyedUnitIds } = applyAuraEffects(this, this.rule, this.units, unit);
    applyTombHazard(this, unit);

    if (destroyedUnitIds.length) {
      // REFRESH_AURA's heal-as-damage (see applyAuraEffects) can kill a
      // nearby UNDEAD enemy - same death bookkeeping as attack()/heal(),
      // just without a single "attacker/defender" pair to key the team check
      // off of, since anyone within range could have been hit.
      const affectedTeams = new Set(
        destroyedUnitIds.map((id) => this.units.find((u) => u.id === id)?.team).filter((t) => t !== undefined)
      );
      const remaining = this.units.filter((u) => !destroyedUnitIds.includes(u.id));
      this.units.length = 0;
      this.units.push(...remaining);
      for (const team of affectedTeams) {
        checkTeamDestroy(this, this.units, this._mapInfo(), team);
      }
      this._syncTileRefs();
    }
  }

  /** Positions within summonerId's own attack range that currently hold an
   * unoccupied tomb - what the UI highlights when entering summon-target
   * mode, and what gates whether the Summon action-bar button shows at all
   * (see ui/actionBar.js's showActionBar). Ported from
   * GameManager#hasTombWithinRange, generalized to return the full set
   * rather than just a boolean - empty for a non-NECROMANCER, since
   * canSummon (below) always fails for those regardless of position. */
  getSummonablePositions(summonerId) {
    const positions = this.getAttackablePositions(summonerId);
    const result = new Set();
    for (const key of positions) {
      const [x, y] = key.split(",").map(Number);
      if (this.canSummon(summonerId, x, y)) result.add(key);
    }
    return result;
  }

  /** Ported from GameCore#canSummon: summonerId must have NECROMANCER, (x, y)
   * must hold a tomb with nothing currently standing on it, and (x, y) must
   * be within the summoner's own attack range (isWithinRange - the same
   * range check attacks use, so a BLINDED necromancer can't summon either,
   * same as it can't attack). */
  canSummon(summonerId, x, y) {
    const summoner = this.getUnit(summonerId);
    if (!summoner || !hasAbility(summoner, ABILITY.NECROMANCER)) return false;
    if (!isWithinRange(summoner, x, y)) return false;
    if (!isTomb(this, x, y)) return false;
    if (this.getUnitAt(x, y)) return false;
    return true;
  }

  /**
   * Ported from GameEventExecutor#onSummon: consumes the tomb at (x, y) and
   * creates a new Skeleton (units.json's isSkeleton flag) for the
   * summoner's team there. Skeletons carry POISONER + UNDEAD (see
   * units.json) - a raised skeleton poisons what it hits, and won't leave
   * another tomb if it's killed again.
   *
   * Deliberately free: no gold or population cost, matching the original,
   * which routes this through createUnit directly rather than buyUnit -
   * summoning isn't purchasing, it's the necromancer's whole point.
   */
  summon(summonerId, x, y) {
    if (!this.canSummon(summonerId, x, y)) return null;
    const summoner = this.getUnit(summonerId);
    removeTomb(this, x, y);
    const skeletonDef = this.unitDefs.find((u) => u.isSkeleton);
    const unit = instantiateUnit(skeletonDef, { team: summoner.team, x, y });
    unit._tile = this.getTileAt(x, y);
    this.units.push(unit);
    return unit;
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

  /** Whether `team` currently has a living commander on the board. */
  hasLivingCommander(team) {
    return this.units.some((u) => u.team === team && u.isCommander);
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

  /** Shared builder for the not-yet-purchased "as if spawned here" unit both
   * getSpawnMovablePositions and getSpawnMovePath below simulate against -
   * kept as one place so the two stay in sync on what a purchased unit's
   * stats actually look like pre-existence. */
  _spawnTempUnit(unitDefIndex, x, y, team) {
    const unitDef = this.unitDefs.find((u) => u.index === unitDefIndex);
    return {
      id: "__pending_purchase__",
      team,
      x,
      y,
      currentMovementPoint: unitDef.movementPoint,
      abilities: unitDef.abilities,
      isCrystal: unitDef.isCrystal,
    };
  }

  /**
   * Movement options for a not-yet-purchased unit as if it had just spawned
   * at castle (x, y) - lets the buy UI show the same movable/attack
   * highlighting a real unit selection gets, and lets canPlacePurchase below
   * decide whether a purchase is even legal, all before the unit exists in
   * this.units.
   *
   * If (x, y) is already occupied - the king standing on his own castle is
   * the only case the buy menu ever allows this for, see canBuyHere in
   * ui/actionBar.js - the spawn tile itself is correctly excluded from
   * `movable` by createMovablePositions' normal occupancy check (a
   * different unit already being there blocks it same as any other
   * destination), while the flood-fill still explores outward from it to
   * find tiles the new unit could actually reach.
   */
  getSpawnMovablePositions(unitDefIndex, x, y, team) {
    const tempUnit = this._spawnTempUnit(unitDefIndex, x, y, team);
    const board = this._board();
    const { movable, moveMark } = createMovablePositions(board, tempUnit, { game: this });
    const extendedAttack = computeExtendedAttackPositions(board, tempUnit, movable);
    return { movable, moveMark, extendedAttack };
  }

  /**
   * Step-by-step path a not-yet-purchased unit would walk from castle (x, y)
   * to (destX, destY) - the same shape GameState#getMovePath returns for a
   * real unit, computed the same way getSpawnMovablePositions is. Used
   * purely to drive the walk animation when a purchase can't land on the
   * castle tile itself (see input/boardInput.js's handleBuyPlacementClick);
   * must be computed before the unit actually exists, since afterward it
   * would just block its own starting tile.
   */
  getSpawnMovePath(unitDefIndex, x, y, team, destX, destY) {
    const tempUnit = this._spawnTempUnit(unitDefIndex, x, y, team);
    const { moveMark } = createMovablePositions(this._board(), tempUnit, { game: this });
    return createMovePath(this._board(), tempUnit, moveMark, destX, destY);
  }

  /**
   * Whether unitDefIndex has anywhere legal to end up if bought at castle
   * (x, y) right now. Always true for an empty castle (the castle tile
   * itself counts). False only when the castle is occupied - by the king,
   * per canBuyHere's gating - and every tile the new unit could reach from
   * there is also blocked, e.g. the king pinned down with no room to
   * retreat: there's simply nowhere for the purchase to go.
   */
  canPlacePurchase(unitDefIndex, x, y, team) {
    return this.getSpawnMovablePositions(unitDefIndex, x, y, team).movable.size > 0;
  }

  /**
   * Buys a unit for `team` and places it at (destX, destY) - either directly
   * on the owned castle at (castleX, castleY) when that tile is itself the
   * destination and still empty, or - when the castle is occupied by the
   * unit already standing there (the king) - anywhere that unit could reach
   * from the castle, per getSpawnMovablePositions. Validates gold/population,
   * that (castleX, castleY) is really an owned castle, and that (destX,
   * destY) is actually reachable from it; returns null and changes nothing
   * on any failure.
   */
  buyUnitAt(unitDefIndex, team, castleX, castleY, destX, destY) {
    const tile = this.getTileAt(castleX, castleY);
    if (!tile.castle || tile.team !== team) return null;
    if (!this.canBuyUnit(unitDefIndex, team)) return null;
    const { movable } = this.getSpawnMovablePositions(unitDefIndex, castleX, castleY, team);
    if (!movable.has(posKey(destX, destY)) || this.getUnitAt(destX, destY)) return null;
    const unitDef = this.unitDefs.find((u) => u.index === unitDefIndex);
    const commander = this.units.find((u) => u.team === team && u.isCommander);
    const price = getUnitPrice(this, unitDef, team, commander);
    const player = this.players.find((p) => p.team === team);
    player.gold -= price;
    const unit = instantiateUnit(unitDef, { team, x: destX, y: destY });
    unit._tile = this.getTileAt(destX, destY);
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
    const result = nextTurn(this, this.units, () => updateTombs(this));

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