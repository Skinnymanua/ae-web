/**
 * AI opponent turn logic - an original JS design covering the same job as
 * the Java original's robot/Robot.java + robot/Action.java (pick a unit,
 * decide its best move/attack/heal/occupy/repair/summon or advance it
 * toward something useful, then recruit with any gold left over), but
 * restructured to fit this project's stateless/functional shared-module
 * style rather than ported line-by-line - the original ran as a
 * multi-frame UI-thread state machine (SELECT/MOVE/ACTION/REMOVE) driven
 * by GameManager's render loop; there's no render loop here, so this
 * exposes one pure decision function per step instead (see
 * chooseRobotStep below) that a caller drives in a plain loop, re-deriving
 * `units`/`board` from the live GameState between calls the same way
 * server/src/actions.js already does for a human player's actions.
 *
 * Deliberately simplified vs the original, noted here rather than at each
 * call site: no precomputed "which of my tiles is under threat" map (see
 * Robot#createTileThreatStatus/isThreatened - skipped, so this AI won't
 * pull a unit back to guard a village/castle an enemy commander/conqueror
 * is closing in on), no "static/immobile unit" special case (unnecessary
 * here - a unit with 0 movement naturally gets a single-tile movable set
 * from movement.js's createMovablePositions, so it's handled by the same
 * general path as everyone else), and "move toward a target I can't reach
 * this turn" picks whichever of my own reachable tiles is closest to it by
 * Manhattan distance rather than the original's real pathfinding-based
 * getNextPositionToTarget - close enough for open ground, less clever
 * around obstacles.
 *
 * @typedef {object} RobotContext
 * @property {object} game - the live GameState instance (or a plain object
 *   with the same shape) - passed straight through to combat.js/turn.js/
 *   combat-resolution.js helpers that expect it.
 * @property {object} rule - game.rule, broken out since several
 *   combat-resolution.js calls take it separately from `game`.
 * @property {Unit[]} units - all units currently on the board.
 * @property {object} board - from movement.js's createBoard, built fresh
 *   from `units` by the caller before each chooseRobotStep call (stale
 *   between calls otherwise, once a move/attack/recruit changes the board).
 * @property {object} mapInfo - { castlePositions: {x,y,team}[], villagePositions: {x,y,team}[] }
 * @property {number} team - which team the robot is playing.
 */

import { ABILITY, getDamage } from "./combat.js";
import { canAttack, canCounter, canHeal, canSupport, toCombatStats } from "./combat-resolution.js";
import { canOccupy, canRepair, canBuy, isCommanderAlive, getCommander, isTomb } from "./turn.js";
import { createMovablePositions, createMovePath, createPositionsWithinRange, isEnemy as isEnemyUnit } from "./movement.js";

function hasAbility(unit, abilityId) {
  return unit.abilities?.some((a) => (typeof a === "object" ? a.id === abilityId : a === abilityId));
}

function manhattan(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function parsePosKey(key) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

/** Shallow clone with a different (x, y) - for scoring "what if this unit
 * were standing here" without touching the real unit on the board, same
 * purpose as the original's UnitFactory.cloneUnit(selected_unit) + setX/setY. */
function unitAt(unit, x, y) {
  return { ...unit, x, y };
}

// --- Picking which unit acts next -----------------------------------------

/**
 * Priority order for "which of my units goes next", roughly matching the
 * original's select(): support-aura units first (so allies going standby
 * later this turn are already buffed/debuffing before they commit), then
 * healers (same reasoning - heal before the healer's own targets might
 * move/die), then anyone standing on a castle (usually the commander -
 * getting it moving early leaves more of the turn to react to what the
 * commander finds), then everyone else in whatever order `units` holds them.
 */
export function selectActingUnit(units, team, mapInfo) {
  const mine = units.filter((u) => u.team === team && !u.standby);
  if (mine.length === 0) return null;

  const byAbility = (abilityId) => mine.find((u) => hasAbility(u, abilityId));
  const auraSupport = byAbility(ABILITY.REFRESH_AURA) ?? byAbility(ABILITY.ATTACK_AURA) ?? byAbility(ABILITY.SLOWING_AURA);
  if (auraSupport) return auraSupport;

  const healer = byAbility(ABILITY.HEALER) ?? byAbility(ABILITY.SUPPORT);
  if (healer) return healer;

  const onOwnCastle = mine.find((u) =>
    mapInfo.castlePositions.some((c) => c.team === team && c.x === u.x && c.y === u.y)
  );
  if (onOwnCastle) return onOwnCastle;

  return mine[0];
}

// --- Scoring a single candidate action -------------------------------------

/** Expected damage this unit would deal attacking `defender` from
 * (fromX, fromY), with no RNG applied (getDamage's applyRng: false) - a
 * stable estimate is what a planning heuristic wants, not one particular
 * roll. */
function estimateDamage(board, attacker, fromX, fromY, defender) {
  return getDamage({
    attacker: toCombatStats(unitAt(attacker, fromX, fromY)),
    defender: toCombatStats(defender),
    attackerTile: board.tileAt(fromX, fromY),
    defenderTile: board.tileAt(defender.x, defender.y),
    applyRng: false,
  });
}

/**
 * Scores one candidate action for the unit currently being planned.
 * Higher is better; 0 or negative means "not worth doing" (the caller
 * filters those out - see planUnitTurn below). Occupy heavily outweighs
 * everything else (capturing a castle/village is usually the single best
 * thing a unit can do with its turn), attacks are scored on the trade
 * (damage/kill dealt vs counter damage risked), and heal/support scale
 * with how much they help their target.
 */
function scoreAction(ctx, action) {
  const { game, board } = ctx;
  switch (action.type) {
    case "occupy": {
      const tile = board.tileAt(action.x, action.y);
      if (tile.castle) return 2000;
      if (tile.village) return 1000;
      return 0;
    }
    case "repair":
      return 500;
    case "summon":
      return 100;
    case "support": {
      const target = board.unitAt(action.targetX, action.targetY);
      if (!target) return 0;
      // Rough "how much does this help" proxy: target's own offensive
      // value, same intuition as the heal score below - a support buff on
      // a unit that's about to do a lot of damage anyway is worth more
      // than one on a weak unit.
      return target.attack ?? 20;
    }
    case "heal": {
      const target = board.unitAt(action.targetX, action.targetY);
      if (!target) return 0;
      const missingHp = Math.max(0, (target.maxHp ?? target.currentHp) - target.currentHp);
      if (missingHp === 0) return 0;
      return missingHp * 3;
    }
    case "attack": {
      const attacker = ctx.selectedUnit;
      const defender = board.unitAt(action.targetX, action.targetY);
      if (!defender) return 0;
      const damage = estimateDamage(board, attacker, action.x, action.y, defender);
      const wouldKill = damage >= defender.currentHp;
      let score = damage * 10 + (wouldKill ? defender.price ?? 500 : 0);
      const movedAttacker = unitAt(attacker, action.x, action.y);
      if (!wouldKill && canCounter(game, movedAttacker, defender)) {
        const counterDamage = estimateDamage(board, defender, defender.x, defender.y, movedAttacker);
        score -= counterDamage * 10;
      }
      return score;
    }
    default:
      return 0;
  }
}

/**
 * Every action `unit` could take from `fromX, fromY` (a tile it can reach
 * this turn) - attack/heal/support any unit in range, occupy/repair the
 * tile it would be standing on, summon from a tomb in range. Mirrors the
 * original's per-reachable-tile action enumeration inside calculateAction,
 * just split into its own function.
 */
function actionsFrom(ctx, unit, fromX, fromY) {
  const { game, board } = ctx;
  const actions = [];

  const targets = createPositionsWithinRange(board, fromX, fromY, unit.minAttackRange ?? 1, unit.maxAttackRange ?? 1);
  for (const key of targets) {
    const { x: tx, y: ty } = parsePosKey(key);
    const target = board.unitAt(tx, ty);
    if (!target) {
      if (isTomb(game, tx, ty) && hasAbility(unit, ABILITY.NECROMANCER)) {
        actions.push({ type: "summon", x: fromX, y: fromY, targetX: tx, targetY: ty });
      }
      continue;
    }
    const movedUnit = unitAt(unit, fromX, fromY);
    if (isEnemyUnit(unit, target, game) && canAttack(game, movedUnit, target)) {
      actions.push({ type: "attack", x: fromX, y: fromY, targetX: tx, targetY: ty, targetId: target.id });
    } else if (!isEnemyUnit(unit, target, game)) {
      if (hasAbility(unit, ABILITY.HEALER) && canHeal(game, movedUnit, target)) {
        actions.push({ type: "heal", x: fromX, y: fromY, targetX: tx, targetY: ty, targetId: target.id });
      }
      if (hasAbility(unit, ABILITY.SUPPORT) && canSupport(game, movedUnit, target)) {
        actions.push({ type: "support", x: fromX, y: fromY, targetX: tx, targetY: ty, targetId: target.id });
      }
    }
  }

  const tile = board.tileAt(fromX, fromY);
  const movedUnit = unitAt(unit, fromX, fromY);
  if (canOccupy(game, movedUnit, tile)) actions.push({ type: "occupy", x: fromX, y: fromY });
  if (canRepair(movedUnit, tile)) actions.push({ type: "repair", x: fromX, y: fromY });

  return actions;
}

// --- Falling back to "move toward something useful" -----------------------

function nearestPosition(fromX, fromY, positions) {
  let best = null;
  let bestDist = Infinity;
  for (const p of positions) {
    const d = manhattan(fromX, fromY, p.x, p.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Whichever of the unit's own reachable tiles gets it closest to
 * (targetX, targetY) - the "can't get there this turn, so make progress"
 * fallback described in this file's header comment. */
function closestMovableTo(movable, originX, originY, targetX, targetY) {
  let best = { x: originX, y: originY };
  let bestDist = manhattan(originX, originY, targetX, targetY);
  for (const key of movable) {
    const { x, y } = parsePosKey(key);
    const d = manhattan(x, y, targetX, targetY);
    if (d < bestDist) {
      bestDist = d;
      best = { x, y };
    }
  }
  return best;
}

function findAdvanceTarget(ctx, unit) {
  const { game, units, mapInfo, team } = ctx;

  if (hasAbility(unit, ABILITY.CONQUEROR)) {
    const capturable = mapInfo.villagePositions.filter((v) => v.team !== team);
    const nearest = nearestPosition(unit.x, unit.y, capturable);
    if (nearest) return nearest;
  }

  if (hasAbility(unit, ABILITY.COMMANDER)) {
    const capturable = mapInfo.castlePositions.filter((c) => c.team !== team);
    const nearest = nearestPosition(unit.x, unit.y, capturable);
    if (nearest) return nearest;
  }

  const enemies = units.filter((u) => isEnemyUnit(unit, u, game));
  const enemyCommander = enemies.find((u) => hasAbility(u, ABILITY.COMMANDER));
  const target = enemyCommander ?? nearestEnemyUnit(unit, enemies);
  return target ? { x: target.x, y: target.y } : null;
}

function nearestEnemyUnit(unit, enemies) {
  let best = null;
  let bestDist = Infinity;
  for (const enemy of enemies) {
    const d = manhattan(unit.x, unit.y, enemy.x, enemy.y);
    if (d < bestDist) {
      bestDist = d;
      best = enemy;
    }
  }
  return best;
}

// --- One unit's full turn: move (if any) + act -----------------------------

/**
 * Plans everything one already-selected unit does this turn: the best
 * scoring action reachable from anywhere it can move to, or - if nothing
 * scores above 0 - a move toward the nearest useful target (capturable
 * village/castle for a CONQUEROR/COMMANDER, otherwise the nearest enemy,
 * preferring their commander), or standing still if there's nowhere
 * useful to go. Returns an array of 1-2 network actions in the exact
 * `{type, params}` shape server/src/actions.js's ACTIONS table expects
 * (moveUnit, then attack/heal/support/occupy/repair/summon/standby) - the
 * caller applies them in order, same as a human player's own two-step
 * move-then-act.
 */
export function planUnitTurn(ctx, unit) {
  const { board } = ctx;
  const origin = { x: unit.x, y: unit.y };
  const { movable, moveMark } = createMovablePositions(board, unit, { game: ctx.game });

  ctx.selectedUnit = unit;
  let best = null;
  let bestScore = 0;
  for (const key of movable) {
    const { x, y } = parsePosKey(key);
    for (const action of actionsFrom(ctx, unit, x, y)) {
      const score = scoreAction(ctx, action);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
  }

  const actions = [];
  let destination = origin;

  if (best) {
    destination = { x: best.x, y: best.y };
  } else {
    const target = findAdvanceTarget(ctx, unit);
    if (target) destination = closestMovableTo(movable, origin.x, origin.y, target.x, target.y);
  }

  if (destination.x !== origin.x || destination.y !== origin.y) {
    const path = createMovePath(board, unit, moveMark, destination.x, destination.y);
    actions.push({ type: "moveUnit", params: { unitId: unit.id, path } });
  }

  // Every action type needs an explicit follow-up standby - none of
  // attack/heal/support/occupy/repair/summon mark the unit standby on
  // their own (see game-state.js's standby() docstring: it's the one place
  // that happens, since it also runs the aura scan/tomb hazard check every
  // standby needs regardless of what action preceded it). Without this,
  // the unit stays selectable and chooseRobotStep would just plan another
  // action for it next step instead of moving on.
  if (best) actions.push(actionFromPlan(unit, best));
  actions.push({ type: "standby", params: { unitId: unit.id } });

  return actions;
}

/** Converts one of actionsFrom's internal candidate shapes into the
 * `{type, params}` network-action shape server/src/actions.js's ACTIONS
 * table expects - the same shape a human player's own attack/heal/support/
 * occupy/repair/summon click produces. */
function actionFromPlan(unit, action) {
  switch (action.type) {
    case "attack":
      return { type: "attack", params: { attackerId: unit.id, defenderId: action.targetId } };
    case "heal":
      return { type: "heal", params: { healerId: unit.id, targetId: action.targetId } };
    case "support":
      return { type: "support", params: { supporterId: unit.id, targetId: action.targetId } };
    case "occupy":
      return { type: "occupy", params: { unitId: unit.id, x: action.x, y: action.y } };
    case "repair":
      return { type: "repair", params: { unitId: unit.id, x: action.x, y: action.y } };
    case "summon":
      return { type: "summon", params: { summonerId: unit.id, x: action.targetX, y: action.targetY } };
    default:
      return { type: "standby", params: { unitId: unit.id } };
  }
}

// --- Recruiting --------------------------------------------------------

/**
 * A castle `team` owns with nobody standing on it, if any - where a new
 * unit would be recruited. Picks the first one found; the original had a
 * distance-based tiebreaker (compareRecruitPosition) between multiple open
 * castles, skipped here as a minor refinement, not a behavior this AI
 * depends on.
 */
function findOpenRecruitCastle(ctx) {
  const { board, mapInfo, team } = ctx;
  return mapInfo.castlePositions.find((c) => c.team === team && !board.unitAt(c.x, c.y));
}

/**
 * Picks which unit to buy and buys it, if affordable - always the
 * commander first if it's dead and buyable, otherwise whichever unit the
 * team can afford that best answers the current battlefield: a HEALER if
 * an ally is significantly hurt and the team has none, a CONQUEROR if
 * there's an unclaimed village and the team has none, otherwise the most
 * expensive affordable unit favoring the attack type (physical/magic) the
 * enemy defends against worse on average - simplified from the original's
 * full ability_map preference scoring (Robot#getPreferredRecruitment), but
 * covers the same three priorities in the same order.
 */
export function planRecruit(ctx) {
  const { game, units, team } = ctx;
  const castle = findOpenRecruitCastle(ctx);
  if (!castle) return null;

  const commander = getCommander(units, team);
  if (!isCommanderAlive(units, team)) {
    const commanderDef = ctx.unitDefs.find((u) => u.isCommander);
    // canBuy - not a flat gold>=price check - since a commander's real
    // repurchase price scales up each time one of the team's commanders
    // has died (turn.js's getUnitPrice/commanderPriceStep); it also
    // covers isTeamAlive and (harmlessly, since commanders bypass it -
    // see canBuy's own `|| unitDef.isCommander`) population.
    if (commanderDef && canBuy(game, units, commanderDef, team, commander)) {
      return { type: "buyUnitAt", params: { unitIndex: commanderDef.index, team, castleX: castle.x, castleY: castle.y, destX: castle.x, destY: castle.y } };
    }
    return null;
  }

  const mine = units.filter((u) => u.team === team);
  const enemies = units.filter((u) => isEnemyUnit({ team }, u, game));
  const needsHealer = mine.some((u) => u.currentHp < (u.maxHp ?? u.currentHp) * 0.7) && !mine.some((u) => hasAbility(u, ABILITY.HEALER));
  const needsConqueror =
    ctx.mapInfo.villagePositions.some((v) => v.team !== team) && !mine.some((u) => hasAbility(u, ABILITY.CONQUEROR));

  const avgPhysicalDef = average(enemies.map((u) => toCombatStats(u).physicalDefence));
  const avgMagicDef = average(enemies.map((u) => toCombatStats(u).magicDefence));
  const preferredAttackType = avgPhysicalDef <= avgMagicDef ? 0 : 1;

  // canBuy, not a flat gold>=price check - it's the same gate a human
  // recruiting through the buy menu goes through (game-state.js's own
  // canBuyUnit calls this exact function), so the robot can never end up
  // "choosing" a unit the engine would actually reject: population
  // capacity (canAddPopulation), isSkeleton/isCrystal exclusion, and gold
  // are all covered by this one call instead of being re-derived (and,
  // previously, re-derived WRONG - population wasn't checked at all) here.
  const affordable = ctx.unitDefs.filter((def) => !def.isCommander && canBuy(game, units, def, team, commander));
  if (affordable.length === 0) return null;

  let pick =
    (needsHealer && affordable.find((def) => def.abilities?.some((a) => a.id === ABILITY.HEALER))) ||
    (needsConqueror && affordable.find((def) => def.abilities?.some((a) => a.id === ABILITY.CONQUEROR))) ||
    affordable.filter((def) => def.attackType === preferredAttackType).sort((a, b) => b.price - a.price)[0] ||
    affordable.sort((a, b) => b.price - a.price)[0];

  if (!pick) return null;
  return { type: "buyUnitAt", params: { unitIndex: pick.index, team, castleX: castle.x, castleY: castle.y, destX: castle.x, destY: castle.y } };
}

function average(numbers) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

// --- Top-level driver -------------------------------------------------

/**
 * One step of the robot's turn: acts through the next selectable unit, or -
 * once every unit has gone standby - tries to recruit, or - once nothing
 * else is left to do - ends the turn. The caller is responsible for
 * applying the returned actions (via the same GameState methods/
 * server/src/actions.js's ACTIONS table a human player's actions go
 * through) and rebuilding `ctx.units`/`ctx.board` before the next call, so
 * this always plans against the board as it actually stands - same
 * requirement server/src/actions.js already has for any action.
 *
 * @returns {{actions: Array<{type, params}>}}
 */
export function chooseRobotStep(ctx) {
  const unit = selectActingUnit(ctx.units, ctx.team, ctx.mapInfo);
  if (unit) {
    return { actions: planUnitTurn(ctx, unit) };
  }

  const recruitAction = planRecruit(ctx);
  if (recruitAction) {
    return { actions: [recruitAction] };
  }

  return { actions: [{ type: "endTurn", params: {} }] };
}
