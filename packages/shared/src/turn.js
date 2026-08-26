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
 *   game.rule: { castleIncome, villageIncome, commanderIncome, commanderPriceStep,
 *                unitCapacity, enemyClear, castleClear }
 * Plus a `board`-like object exposing castle/village positions and per-team counts —
 * see getCastleCount/getVillagePositions usage below; wire this to your real map
 * module once it exists (Step 4 continued).
 */

import { ABILITY } from "./combat.js";
import { getMaxHp } from "./combat-resolution.js";

function hasAbility(unit, abilityId) {
  return unit.abilities?.some((a) => (typeof a === "object" ? a.id === abilityId : a === abilityId));
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

export function resetUnitForTurn(game, unit) {
  unit.currentMovementPoint = unit.maxMovementPoint;
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

/**
 * Advances to the next living team's turn, resetting the outgoing team's units,
 * then — for the INCOMING team's own units — applies terrain heal, plus castle
 * siege damage for any of them squatting on an enemy-owned castle (see
 * getCastleSiegeChange's note above for why this fires on the squatter's own
 * turn rather than OperationExecutor#onNextTurn's original schedule).
 *
 * Mutates `game` and each affected unit's currentHp. Does NOT remove destroyed
 * units or run the team-destroy check — same division of responsibility as
 * combat-resolution.js's resolveAttack/applyAttack: this returns what happened
 * (hpChanges, destroyedUnitIds), and the caller (GameState#endTurn) is
 * responsible for removing dead units and calling checkTeamDestroy, exactly
 * like applyAttack does for combat.
 *
 * @returns {{hpChanges: Array<{unitId, x, y, change}>, destroyedUnitIds: string[]}}
 */
export function nextTurn(game, units, onNewRound) {
  for (const unit of units) {
    if (unit.team === game.currentTeam) resetUnitForTurn(game, unit);
  }
    do {
    if (game.currentTeam < 3) {
      game.currentTeam++;
    } else {
      game.currentTeam = 0;
      onNewRound?.(); // original calls map.updateTombs() here — wire up once tomb/undead mechanics are ported
    }
  } while (!isTeamAlive(game, game.currentTeam));
  game.turn++;

  // Hp changes run for the INCOMING team's own units only, after the switch
  // above — this was previously bundled into resetUnitForTurn and run for the
  // outgoing team before the switch, which made healing visibly land at the
  // start of the next (often enemy) team's turn instead of at the start of
  // the healed team's own turn, and never checked siege damage at all. Both
  // terrain heal and castle siege now key off the SAME "is this my own turn
  // starting" check — a unit on an enemy castle just gets 0 heal (per
  // getTerrainHeal's own isEnemy gate) plus -50 siege instead.
  const hpChanges = [];
  const destroyedUnitIds = [];
  for (const unit of units) {
    if (unit.team !== game.currentTeam) continue;
    const tile = game.getTileAt(unit.x, unit.y);
    const change = validateHpChange(unit, getTerrainHeal(game, unit, tile) + getCastleSiegeChange(game, unit, tile));
    if (change !== 0) {
      unit.currentHp += change;
      hpChanges.push({ unitId: unit.id, x: unit.x, y: unit.y, change });
      if (unit.currentHp <= 0) destroyedUnitIds.push(unit.id);
    }
  }

  return { hpChanges, destroyedUnitIds };
}