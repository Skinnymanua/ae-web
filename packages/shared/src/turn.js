/**
 * Ported from net.toyknight.aeii.entity.GameCore, entity.Rule, entity.Player,
 * and manager.Analyzer / GameEventExecutor#onOccupy / #onCheckTeamDestroy.
 *
 * Operates on a plain `game` state object (see shape below) rather than the
 * original's singleton GameCore, so client and server can both run identical
 * logic — client for optimistic UI, server as source of truth.
 *
 * Expected `game` shape:
 *   game.players: [{ team, type, gold, population, alliance }, ...]  (up to 4)
 *   game.teamDestroyed: [bool, bool, bool, bool]
 *   game.currentTeam: number
 *   game.turn: number
 *   game.gameOver: boolean
 *   game.tombs: Array<{x, y, remainingTurn}>  — see addTomb/removeTomb/isTomb/updateTombs below
 *   game.commanderDeaths: {[team]: number}  — read by getUnitPrice's repurchase-cost scaling
 *   game.rule: { castleIncome, villageIncome, commanderIncome, commanderPriceStep,
 *                unitCapacity, enemyClear, castleClear }
 * Plus a `board`-like object exposing castle/village positions and per-team counts —
 * see getCastleCount/getVillagePositions usage below; wire this to your real map
 * module once it exists (Step 4 continued).
 */

import { ABILITY, STATUS, hasStatus, isDebuffStatus, attachStatus, clearStatus, manhattanRange } from "./combat.js";
import { getMaxHp, canRefresh, getRefresherHeal } from "./combat-resolution.js";

function hasAbility(unit, abilityId) {
  return unit.abilities?.some((a) => (typeof a === "object" ? a.id === abilityId : a === abilityId));
}

// --- Tombs -------------------------------------------------------------
// Ported from entity.Tomb + Map#addTomb/#removeTomb/#isTomb/#updateTombs.
// Tracked as game.tombs: Array<{x, y, remainingTurn}>. A tomb marks where a
// unit died (see combat-resolution.js's applyAttack for who actually leaves
// one) and decays by one remainingTurn each new ROUND - all teams have had a
// turn, see nextTurn's onNewRound callback below - vanishing once that goes
// negative. Starting at 1, a tomb survives the round it's created in plus
// exactly one more full round before disappearing, matching
// Tomb#update/Map#updateTombs exactly.

export function addTomb(game, x, y) {
  const existing = game.tombs.find((t) => t.x === x && t.y === y);
  if (existing) {
    existing.remainingTurn = 1; // refresh rather than duplicate
  } else {
    game.tombs.push({ x, y, remainingTurn: 1 });
  }
}

export function removeTomb(game, x, y) {
  game.tombs = game.tombs.filter((t) => !(t.x === x && t.y === y));
}

export function isTomb(game, x, y) {
  return game.tombs.some((t) => t.x === x && t.y === y);
}

export function updateTombs(game) {
  for (const tomb of game.tombs) tomb.remainingTurn -= 1;
  game.tombs = game.tombs.filter((t) => t.remainingTurn >= 0);
}

/**
 * Ported from GameEventExecutor#onStandby's tomb handling: if the
 * standing-by unit is on a tomb tile, the tomb is consumed and the unit is
 * poisoned for 1 turn as a "corpse curse" - unless it's a NECROMANCER, who
 * can stand on (and summon from) graves without being punished for it.
 */
export function applyTombHazard(game, unit) {
  if (!isTomb(game, unit.x, unit.y)) return;
  removeTomb(game, unit.x, unit.y);
  if (!hasAbility(unit, ABILITY.NECROMANCER)) {
    attachStatus(unit, { type: STATUS.POISONED, remainingTurn: 1 });
  }
}

export const PLAYER_TYPE = { NONE: 0 }; // extend as needed (LOCAL/AI/NETWORK etc.) — original had more, add when the lobby/player system is built

// --- Alliance / enmity -------------------------------------------------

export function getAlliance(game, team) {
  const player = game.players[team];
  return team >= 0 && team < 4 && player ? player.alliance : -1;
}

export function isEnemy(game, teamA, teamB) {
  return teamA >= 0 && teamB >= 0 && getAlliance(game, teamA) !== getAlliance(game, teamB);
}

export function isAlly(game, teamA, teamB) {
  return teamA >= 0 && teamB >= 0 && getAlliance(game, teamA) === getAlliance(game, teamB);
}

export function isUnitEnemy(game, unitA, unitB) {
  return !!unitA && !!unitB && isEnemy(game, unitA.team, unitB.team);
}

// --- Team status ---------------------------------------------------------

export function isTeamAlive(game, team) {
  const player = game.players[team];
  return team >= 0 && team < 4 && !!player && player.type !== PLAYER_TYPE.NONE && !game.teamDestroyed[team];
}

export function isCommanderAlive(units, team) {
  return units.some((u) => u.team === team && hasAbility(u, ABILITY.COMMANDER));
}

export function getCommander(units, team) {
  return units.find((u) => u.team === team && hasAbility(u, ABILITY.COMMANDER)) ?? null;
}

// --- Economy ---------------------------------------------------------------

/**
 * @param {object} mapInfo - { castleTeams: number[], villageTeams: number[] }
 *   i.e. the team owner (or -1) of every castle/village tile on the board.
 *   Precompute this from your board's tiles once per turn (or incrementally on capture).
 */
export function calcIncome(game, units, mapInfo, team) {
  let income = 0;
  for (const owner of mapInfo.castleTeams) {
    if (owner === team) income += game.rule.castleIncome;
  }
  for (const owner of mapInfo.villageTeams) {
    if (owner === team) income += game.rule.villageIncome;
  }
  income += getCommanderIncome(game, units, team);
  return income;
}

function getCommanderIncome(game, units, team) {
  if (!isCommanderAlive(units, team)) return 0;
  const commander = getCommander(units, team);
  return game.rule.commanderIncome * (commander.level + 1);
}

export function gainIncome(game, units, mapInfo, team) {
  const income = calcIncome(game, units, mapInfo, team);
  game.players[team].gold += income;
  return income;
}

// --- Buying units ------------------------------------------------------

export function canAddPopulation(game, team, additional) {
  const player = game.players[team];
  return player.type !== PLAYER_TYPE.NONE && player.population + additional <= game.rule.unitCapacity;
}

/**
 * @param {object} unitDef - entry from units.json (the *definition*, not an instance)
 * @param {object|null} existingCommander - the team's current commander instance, if any
 *   (needed because a commander's repurchase price scales with commanderPriceStep)
 */
export function getUnitPrice(game, unitDef, team, existingCommander) {
  if (unitDef.isCommander) {
    // a living commander can't be re-bought
    return existingCommander ? -1 : unitDef.price + game.rule.commanderPriceStep * (game.commanderDeaths?.[team] ?? 0);
  }
  return unitDef.price;
}

export function canBuy(game, units, unitDef, team, existingCommander) {
  const price = getUnitPrice(game, unitDef, team, existingCommander);
  return (
    price >= 0 &&
    // Skeleton and crystal are scenario/summoned unit types, not army roster
    // entries - both are priced 0 in units.json, which without this check would
    // let the buy menu list them as free-to-place regular units.
    !unitDef.isSkeleton &&
    !unitDef.isCrystal &&
    isTeamAlive(game, team) &&
    game.players[team].gold >= price &&
    (canAddPopulation(game, team, unitDef.occupancy) || unitDef.isCommander)
  );
}

// --- Capture / occupy ----------------------------------------------------

/**
 * Resolves an occupy action: returns the tile's new index after capture by `team`,
 * or null if the tile isn't capturable. Caller is responsible for actually writing
 * the new index into the board and re-deriving mapInfo's castle/village ownership.
 */
export function resolveCapture(tile, team) {
  if (!tile.capturable || !tile.capturedTileList) return null;
  return tile.capturedTileList[team] ?? null;
}

export function canOccupy(game, conqueror, tile) {
  if (!conqueror || tile.team === conqueror.team) return false;
  if (!tile.capturable) return false;
  if (tile.castle && hasAbility(conqueror, ABILITY.COMMANDER)) return true;
  if (tile.village && hasAbility(conqueror, ABILITY.CONQUEROR)) return true;
  return false;
}

/**
 * Ported from GameCore#canRepair: repairer needs REPAIRER ability, and the
 * tile it's standing on must be repairable - in practice only ever true for
 * a tile that's already been destroyed (see DESTROYER, not yet ported) and
 * has a repairedTileIndex to swap back to (see tiles.json).
 */
export function canRepair(unit, tile) {
  return !!unit && hasAbility(unit, ABILITY.REPAIRER) && !!tile.repairable;
}

/**
 * Ported from GameEventExecutor#onRepair: the new tile index to swap to, or
 * null if repair isn't valid. For a destroyed village this resets it to the
 * NEUTRAL (uncaptured) tile, not back to whichever team had captured it
 * before destruction - repair restores function, not ownership; the tile
 * needs occupying again afterward, same as any other neutral village.
 */
export function resolveRepair(unit, tile) {
  if (!canRepair(unit, tile)) return null;
  return tile.repairedTileIndex ?? null;
}

// --- Win condition -------------------------------------------------------

/**
 * @param {object} mapInfo - same shape as calcIncome's, plus castleCounts: { [team]: number }
 */
export function isTeamDestroyed(game, units, mapInfo, team) {
  let unitCheck = true;
  if (game.rule.enemyClear) {
    unitCheck = !units.some((u) => u.team === team);
  }
  let castleCheck = true;
  if (game.rule.castleClear) {
    castleCheck = (mapInfo.castleCounts[team] ?? 0) <= 0;
  }
  return unitCheck && castleCheck;
}

/** Returns the winning alliance id, or -1 if the game isn't decided yet. */
export function getWinnerAlliance(game) {
  let alliance = -1;
  for (let team = 0; team < 4; team++) {
    const player = game.players[team];
    if (!player) continue;
    if (alliance === -1) {
      if (isTeamAlive(game, team)) alliance = player.alliance;
    } else if (isTeamAlive(game, team) && player.alliance !== alliance) {
      return -1;
    }
  }
  return alliance;
}

/**
 * Call after any event that could eliminate a team (unit destroyed, castle
 * captured): checks that team's destroy condition and updates game state.
 * Only meaningful in skirmish/multiplayer games with a defined rule set.
 */
export function checkTeamDestroy(game, units, mapInfo, team) {
  if (team < 0) return;
  if (isTeamDestroyed(game, units, mapInfo, team)) {
    game.teamDestroyed[team] = true;
    const winnerAlliance = getWinnerAlliance(game);
    if (winnerAlliance >= 0) {
      game.gameOver = true;
    }
  }
}

// --- Turn rotation -----------------------------------------------------

// Ported from UnitToolkit#getTerrainHeal. Neutral tiles (team -1, e.g. temples)
// heal anyone; team-owned tiles (captured villages/castles) only heal units that
// aren't enemies of the owner — critically, an ENEMY unit standing on a captured
// tile gets 0, never a negative amount. `game` here is the full GameState instance
// (nextTurn is always called with `this` from GameState#endTurn), so getTileAt and
// isEnemy (below) are both safe to use despite this module's "plain game shape"
// header comment describing a more decoupled future state.
function getTerrainHeal(game, unit, tile) {
  if (hasAbility(unit, ABILITY.BLOODTHIRSTY)) return 0;

  let heal = 0;
  if (tile.team === -1) {
    heal += tile.hpRecovery;
  } else if (!isEnemy(game, unit.team, tile.team)) {
    heal += tile.hpRecovery;
  }

  if (hasAbility(unit, ABILITY.SON_OF_THE_MOUNTAIN) && tile.type === 3) heal += 10;
  if (hasAbility(unit, ABILITY.SON_OF_THE_FOREST) && tile.type === 2) heal += 10;
  if (hasAbility(unit, ABILITY.SON_OF_THE_SEA) && tile.type === 1) heal += 10;

  return heal;
}

// Ported from Unit#getMovementPoint returning a flat 1 while SLOWED, overriding
// the unit's real movement stat entirely (not a reduction from it) - and
// Unit#resetMovementPoint calling that status-aware getter, which is what this
// mirrors for the per-turn reset.
export function resetUnitForTurn(game, unit) {
  unit.currentMovementPoint = hasStatus(unit, STATUS.SLOWED) ? 1 : unit.maxMovementPoint;
  unit.standby = false;
}

// Ported from UnitToolkit.validateHpChange — clamps an hp delta so
// currentHp+change never leaves [0, maxHp], and returns the (possibly
// smaller) actual delta rather than the requested one.
function validateHpChange(unit, change) {
  const originHp = unit.currentHp;
  let changedHp = originHp + change;
  const maxHp = getMaxHp(unit);
  if (changedHp > maxHp) changedHp = maxHp;
  if (changedHp < 0) changedHp = 0;
  return changedHp - originHp;
}

// House-rule deviation from the original: in project_aeii, siege damage fires
// relative to getNextTeam() at the moment the SQUATTER'S OWN team clicks End
// Turn (see OperationExecutor#onNextTurn — it's computed synchronously as part
// of whichever team is currently ending its turn, using the incoming team as
// the reference point). In a 2-team match that means the -50 always lands the
// instant the squatter hands off to the castle owner, one transition earlier
// than feels right here — this port instead applies it a half-round later, at
// the START OF THE SQUATTER'S OWN NEXT TURN, so a unit has to have survived a
// full round sitting on the enemy castle before it's punished for it.
const CASTLE_SIEGE_DAMAGE = 50;
function getCastleSiegeChange(game, unit, tile) {
  if (isEnemy(game, unit.team, tile.team) && tile.castle) {
    return -CASTLE_SIEGE_DAMAGE;
  }
  return 0;
}

// Ported from Rule.POISON_DAMAGE. UNDEAD units are healed by poison instead of
// hurt by it (OperationExecutor#onNextTurn: `if (UNDEAD) change += POISON_DAMAGE;
// else change = -POISON_DAMAGE;`) - note the asymmetry: for everyone else poison
// OVERRIDES whatever terrain heal/siege change was already computed for the turn
// (poison suppresses passive healing entirely), but for UNDEAD it ADDS on top,
// stacking with heal. See applyPoisonChange below for where this gets applied.
const POISON_DAMAGE = 10;

/**
 * Combines poison with the terrain-heal/siege `baseChange` already computed
 * for `unit`, per the override/add asymmetry described above. Does NOT touch
 * unit.status - the caller ticks/clears that separately, after this turn's hp
 * change has already been computed from the status as it stood coming in.
 */
function applyPoisonChange(unit, baseChange) {
  const isPoisoned = hasStatus(unit, STATUS.POISONED) && unit.status.remainingTurn > 0;
  if (!isPoisoned) return baseChange;
  if (hasAbility(unit, ABILITY.UNDEAD)) return baseChange + POISON_DAMAGE;
  return -POISON_DAMAGE;
}

/**
 * Ported from OperationExecutor#onNextTurn's REHABILITATION handling: +25%
 * of max HP every turn, stacking on top of whatever terrain heal/siege/
 * poison already computed. Applied AFTER poison specifically, matching the
 * original's exact ordering - a REHABILITATION unit that's also poisoned
 * still gets this bonus added on top of the poison override, before the
 * combined total goes through validateHpChange's clamp.
 */
function applyRehabilitation(unit, change) {
  if (!hasAbility(unit, ABILITY.REHABILITATION)) return change;
  return change + Math.floor(getMaxHp(unit) / 4);
}

/**
 * Ported from GameEventExecutor#onNextTurn's per-unit status handling, run
 * for each of the INCOMING team's own units alongside the hp-change loop
 * below: a debuff (poison/slow/blind) clears outright if the unit is
 * standing on a temple, otherwise its remainingTurn ticks down by one and
 * clears once it goes negative. Mutates unit.status in place.
 */
function tickStatus(unit, tile) {
  if (!unit.status) return;
  if (tile.temple && isDebuffStatus(unit.status)) {
    clearStatus(unit);
    return;
  }
  unit.status.remainingTurn -= 1;
  if (unit.status.remainingTurn < 0) clearStatus(unit);
}

/**
 * Ported from GameEventExecutor#onStandby's aura scan (status effects) PLUS
 * OperationExecutor#onStandby's REFRESH_AURA heal computation - two separate
 * checks in the original for the same ability (see canClean vs canRefresh),
 * both folded in here since they run at the same trigger point. Run whenever
 * ANY unit goes standby (see GameState#standby), not just aura-bearers - the
 * ability checks below gate whether anything actually happens.
 *
 * - ATTACK_AURA inspires every ally within 2 tiles (+10 attack, see
 *   combat.js's getAttackBonus).
 * - SLOWING_AURA does the same to enemies (movement capped to 1 - see
 *   resetUnitForTurn above) unless they carry SLOWING_AURA themselves.
 * - REFRESH_AURA does two independent things to anyone in range: cleanses a
 *   debuff from an ally (regardless of HP), and separately heals - or, per
 *   canRefresh, damages an UNDEAD enemy caught in range - anyone not already
 *   overflowing max HP, which can kill them.
 *
 * Range is manhattan distance, not adjacency - "within 2 tiles", matching
 * PositionGenerator#createPositionsWithinRange(x, y, 0, 2). Mutates the
 * affected units' .status/.currentHp in place.
 *
 * @returns {{destroyedUnitIds: string[]}} anyone REFRESH_AURA's heal-as-damage
 *   finished off - caller (GameState#standby) is responsible for removing
 *   them and running the team-destroy check, same convention as
 *   combat-resolution.js's resolveAttack/resolveHeal.
 */
export function applyAuraEffects(game, rule, units, unit) {
  const hasAnyAura =
    hasAbility(unit, ABILITY.ATTACK_AURA) || hasAbility(unit, ABILITY.SLOWING_AURA) || hasAbility(unit, ABILITY.REFRESH_AURA);
  if (!hasAnyAura) return { destroyedUnitIds: [] };

  const destroyedUnitIds = [];
  for (const target of units) {
    if (target.id === unit.id || manhattanRange(unit, target) > 2) continue;
    const targetIsEnemy = isEnemy(game, unit.team, target.team);

    if (hasAbility(unit, ABILITY.ATTACK_AURA) && !targetIsEnemy) {
      attachStatus(target, { type: STATUS.INSPIRED, remainingTurn: 0 });
    }
    if (hasAbility(unit, ABILITY.SLOWING_AURA) && targetIsEnemy && !hasAbility(target, ABILITY.SLOWING_AURA)) {
      attachStatus(target, { type: STATUS.SLOWED, remainingTurn: 1 });
    }
    if (hasAbility(unit, ABILITY.REFRESH_AURA)) {
      if (!targetIsEnemy && isDebuffStatus(target.status)) {
        clearStatus(target);
      }
      if (canRefresh(game, unit, target)) {
        const heal = getRefresherHeal(rule, unit, target);
        target.currentHp += heal;
        if (target.currentHp <= 0) {
          target.currentHp = 0;
          if (!destroyedUnitIds.includes(target.id)) destroyedUnitIds.push(target.id);
        }
      }
    }
  }
  return { destroyedUnitIds };
}

/**
 * Advances to the next living team's turn, resetting the outgoing team's units,
 * then — for the INCOMING team's own units — applies terrain heal, castle
 * siege damage for any of them squatting on an enemy-owned castle (see
 * getCastleSiegeChange's note above for why this fires on the squatter's own
 * turn rather than OperationExecutor#onNextTurn's original schedule),
 * poison damage (or healing, for UNDEAD) per applyPoisonChange above, and a
 * REHABILITATION bonus (maxHp/4, stacking on top of all of the above) per
 * applyRehabilitation above. Each affected unit's status (poison/slow/
 * blind/inspire) then ticks down or clears via tickStatus, using the same
 * "is this my own turn starting" gate as everything else in this loop.
 *
 * Mutates `game` and each affected unit's currentHp/status. Does NOT remove destroyed
 * units or run the team-destroy check — same division of responsibility as
 * combat-resolution.js's resolveAttack/applyAttack: this returns what happened
 * (hpChanges, destroyedUnitIds), and the caller (GameState#endTurn) is
 * responsible for removing dead units and calling checkTeamDestroy, exactly
 * like applyAttack does for combat.
 *
 * @returns {{hpChanges: Array<{unitId, x, y, change}>, destroyedUnitIds: string[]}}
 */
export function nextTurn(game, units, onNewRound) {
  do {
    if (game.currentTeam < 3) {
      game.currentTeam++;
    } else {
      game.currentTeam = 0;
      onNewRound?.(); // called once every team has had a turn - see GameState#endTurn's call site for updateTombs(this)
    }
  } while (!isTeamAlive(game, game.currentTeam));
  game.turn++;

  // Movement/standby reset, hp changes (terrain heal, castle siege, poison),
  // and status ticking all run for the INCOMING team's own units only, here
  // after the switch above — the movement/standby reset used to run for the
  // OUTGOING team just before the switch instead (see resetUnitForTurn's
  // call site history), which was harmless for plain movement/standby alone
  // (nothing reads either again until that team's own next turn regardless
  // of which side of the switch the reset landed on) but broke SLOWED the
  // moment an aura could apply it mid-round: the movement cap needs the
  // status as it stands when the affected team's own turn actually starts,
  // exactly like heal/siege/poison below already key off that same "is this
  // my own turn starting" check.
  const hpChanges = [];
  const destroyedUnitIds = [];
  for (const unit of units) {
    if (unit.team !== game.currentTeam) continue;
    resetUnitForTurn(game, unit);
    const tile = game.getTileAt(unit.x, unit.y);
    const baseChange = getTerrainHeal(game, unit, tile) + getCastleSiegeChange(game, unit, tile);
    const change = validateHpChange(unit, applyRehabilitation(unit, applyPoisonChange(unit, baseChange)));
    if (change !== 0) {
      unit.currentHp += change;
      hpChanges.push({ unitId: unit.id, x: unit.x, y: unit.y, change });
      if (unit.currentHp <= 0) destroyedUnitIds.push(unit.id);
    }
    // Status ticks AFTER this turn's hp change is computed above - poison
    // damage this turn uses remainingTurn as it stood BEFORE the decrement,
    // matching the original's two-step split (OperationExecutor#onNextTurn
    // computes hp_changes first; GameEventExecutor#onNextTurn's updateStatus()
    // is a separate, later step for the same turn transition).
    tickStatus(unit, tile);
  }

  return { hpChanges, destroyedUnitIds };
}