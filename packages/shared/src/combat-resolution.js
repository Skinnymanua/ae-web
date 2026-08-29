/**
 * Ported from manager.OperationExecutor#onAttack/#onCounter, entity.GameCore
 * #canAttack/#canCounter/#destroyUnit, and entity.Unit#gainExperience.
 *
 * This is the glue module: it ties combat.js (damage math), movement.js
 * (range checks), and turn.js (team-destroy/win-condition) into the actual
 * attack -> counter -> death -> team-destroy sequence the original game runs
 * on every combat action.
 *
 * Expected unit instance shape (extends the shape used in combat.js/movement.js):
 *   { id, x, y, team, level, experience, currentHp, standby,
 *     attack, attackType, physicalDefence, magicDefence,   // base stats
 *     hpGrowth, attackGrowth, physicalDefenceGrowth, magicDefenceGrowth, movementGrowth,
 *     maxMovementPoint, currentMovementPoint,
 *     minAttackRange, maxAttackRange, abilities, unitCode, isCrystal }
 */

import { ABILITY, STATUS, getDamage, manhattanRange, hasStatus, attachAttackStatus } from "./combat.js";
import { checkTeamDestroy, addTomb } from "./turn.js";

function hasAbility(unit, abilityId) {
  return unit.abilities?.some((a) => (typeof a === "object" ? a.id === abilityId : a === abilityId));
}

// --- Dynamic stats (base + growth * level, matching Unit#getAttack etc.) ---

export function getMaxHp(unit) {
  return unit.maxHp + unit.hpGrowth * unit.level;
}

export function getEffectiveAttack(unit) {
  return unit.attack + unit.attackGrowth * unit.level;
}

export function getEffectivePhysicalDefence(unit) {
  return unit.physicalDefence + unit.physicalDefenceGrowth * unit.level;
}

export function getEffectiveMagicDefence(unit) {
  return unit.magicDefence + unit.magicDefenceGrowth * unit.level;
}

/** Builds the plain stat object combat.js's getDamage() expects, from a full unit instance. */
export function toCombatStats(unit) {
  return {
    x: unit.x,
    y: unit.y,
    team: unit.team,
    attack: getEffectiveAttack(unit),
    attackType: unit.attackType,
    physicalDefence: getEffectivePhysicalDefence(unit),
    magicDefence: getEffectiveMagicDefence(unit),
    currentHp: unit.currentHp,
    maxHp: getMaxHp(unit),
    abilities: unit.abilities,
    unitCode: unit.unitCode,
    status: unit.status, // read by combat.js's getAttackBonus for the INSPIRED bonus
  };
}

// --- Range / eligibility checks ---------------------------------------

// Ported from Unit#getMinAttackRange/#getMaxAttackRange both returning 0 while
// BLINDED - since canAttack/canCounter both route through isWithinRange (attacker
// for the former, defender for the latter), a blinded unit can neither attack
// nor counter until the blind wears off. A zero-width [0,0] range can never
// match a positive distance to another tile, which is what actually disables it.
export function isWithinRange(unit, x, y) {
  if (hasStatus(unit, STATUS.BLINDED)) return false;
  const range = manhattanRange(unit, { x, y });
  return range >= unit.minAttackRange && range <= unit.maxAttackRange;
}

export function canAttack(game, attacker, defender) {
  if (!attacker || !isWithinRange(attacker, defender?.x ?? -1, defender?.y ?? -1)) return false;
  if (!defender) return false; // an empty tile is never a valid unit-attack target - see canDestroyTile below for the DESTROYER case
  return isEnemyUnit(game, attacker, defender);
}

function isEnemyUnit(game, a, b) {
  const allianceA = game.players[a.team]?.alliance;
  const allianceB = game.players[b.team]?.alliance;
  return a.team >= 0 && b.team >= 0 && allianceA !== allianceB;
}

/**
 * Ported from GameCore#canAttack's defender==null branch: a DESTROYER can
 * target an empty, destroyable tile within its own attack range instead of
 * a unit. No damage roll and no counter - there's nothing there to hit back
 * with. See resolveDestroyTile below for what actually happens.
 */
export function canDestroyTile(attacker, x, y, tile) {
  if (!attacker || !hasAbility(attacker, ABILITY.DESTROYER)) return false;
  if (!isWithinRange(attacker, x, y)) return false;
  return !!tile.destroyable;
}

/**
 * Ported from OperationExecutor#onAttack's defender==null branch +
 * GameEventExecutor#onTileDestroy: the new tile index to swap to (caller
 * applies it, same convention as turn.js's resolveCapture/resolveRepair),
 * and grants ATTACK_EXPERIENCE to the attacker - never KILL_EXPERIENCE,
 * there's no unit death involved. Returns null if destroying isn't valid.
 */
export function resolveDestroyTile(rule, attacker, x, y, tile) {
  if (!canDestroyTile(attacker, x, y, tile)) return null;
  gainExperience(attacker, rule.attackExperience, rule.maxLevel);
  return tile.destroyedTileIndex ?? null;
}

export function canCounter(game, attacker, defender) {
  if (defender.currentHp <= 0 || !isEnemyUnit(game, defender, attacker)) return false;
  if (hasAbility(defender, ABILITY.COUNTER_MADNESS)) {
    return manhattanRange(defender, attacker) <= 2;
  }
  return isWithinRange(defender, attacker.x, attacker.y) && manhattanRange(defender, attacker) === 1;
}

// --- Support (custom addition - NOT part of the original 29 abilities; see
// combat.js's ABILITY.SUPPORT comment) -----------------------------------

/**
 * The Druid's Support ability: targets an ally that has ALREADY gone
 * standby this turn (already finished acting) - Support reactivates a spent
 * unit for a bonus move, it's not a way to boost someone who hasn't acted
 * yet. Target also can't be a CHARGER (already gets its own bonus move -
 * see combat.js's canMoveAgain), can't be the commander, and can't be a
 * higher level than the supporting Druid. Note this naturally rules out
 * self-targeting too: the Druid using Support is always mid-action itself
 * (not yet standby), so it can never satisfy its own check.
 */
export function canSupport(game, supporter, target) {
  if (!supporter || !target) return false;
  if (!hasAbility(supporter, ABILITY.SUPPORT)) return false;
  if (isEnemyUnit(game, supporter, target)) return false;
  if (!target.standby) return false;
  if (hasAbility(target, ABILITY.CHARGER)) return false;
  if (hasAbility(target, ABILITY.COMMANDER)) return false;
  return target.level <= supporter.level;
}

/**
 * Resets target's movement to its full max and clears its standby flag,
 * letting it act again this turn - a full reset, not leftover points like
 * CHARGER's bonus move. Mutates target in place.
 */
export function resolveSupport(game, supporter, target) {
  if (!canSupport(game, supporter, target)) {
    throw new Error("resolveSupport: support not allowed (check canSupport before calling)");
  }
  target.currentMovementPoint = target.maxMovementPoint;
  target.standby = false;
  return { supporterId: supporter.id, targetId: target.id };
}

// --- Healing -----------------------------------------------------------

// Ported from GameCore#canHealReachTarget: a non-AIR_FORCE healer can't reach
// an AIR_FORCE target (flyers) - an AIR_FORCE healer can reach anyone. Shared
// by both canHeal and canRefresh below, matching the source.
function canHealReachTarget(healer, target) {
  return hasAbility(healer, ABILITY.AIR_FORCE) || !hasAbility(target, ABILITY.AIR_FORCE);
}

// Ported from GameCore#canReceiveHeal: UNDEAD can't receive a normal heal
// (see canHeal below - it gets damaged instead), neither can a POISONED unit
// (cure that first), nor one already above its own max HP (see
// getHealerHeal's overflow note) until it drops back to <= max.
function canReceiveHeal(target) {
  return !hasAbility(target, ABILITY.UNDEAD) && !hasStatus(target, STATUS.POISONED) && target.currentHp <= getMaxHp(target);
}

/**
 * Ported from GameCore#canHeal(healer, target). Self-targeting is always
 * allowed regardless of range/minAttackRange - see GameState#getHealablePositions,
 * which computes candidates via getAttackablePositions(..., includeSelf=true).
 *
 * The UNDEAD branch deliberately has no enemy/range check here, matching the
 * source exactly - callers are expected to only ever offer in-range targets
 * (see getHealablePositions), same division of responsibility as the
 * original's hasAllyCanHealWithinRange.
 */
export function canHeal(game, healer, target) {
  if (!healer || !target) return false;
  if (!hasAbility(healer, ABILITY.HEALER) || !canHealReachTarget(healer, target)) return false;
  if (canReceiveHeal(target)) {
    return !isEnemyUnit(game, healer, target) || healer.id === target.id;
  }
  return hasAbility(target, ABILITY.UNDEAD);
}

/**
 * Ported from UnitToolkit#getHealerHeal: HEALER_BASE_HEAL + 10/level for a
 * normal target - deliberately NOT clamped to the target's max HP here (see
 * resolveHeal below), letting a Paladin push an ally above their usual max;
 * see GameState#standby's overflow-clamp for when that gets trimmed back
 * down. Against an UNDEAD target this becomes 1.5x that amount as damage
 * instead (holy magic hurts them).
 */
export function getHealerHeal(rule, healer, target) {
  if (!hasAbility(healer, ABILITY.HEALER)) return 0;
  const heal = rule.healerBaseHeal + 10 * healer.level;
  return hasAbility(target, ABILITY.UNDEAD) ? -Math.round(heal * 1.5) : heal;
}

// Ported from GameCore#canRefresh - a SEPARATE, independent check from the
// status-cleanse REFRESH_AURA also does (see turn.js's applyAuraEffects,
// which uses isDebuffStatus/!targetIsEnemy for that instead, matching
// GameEventExecutor#onStandby's canClean). This one gates the HP change:
// reachable, not already overflowing max HP, and either an ally OR an
// UNDEAD enemy (Spirit's aura can damage a nearby enemy skeleton/ghost).
export function canRefresh(game, refresher, target) {
  if (!refresher || !target) return false;
  if (!canHealReachTarget(refresher, target)) return false;
  if (target.currentHp > getMaxHp(target)) return false;
  return !isEnemyUnit(game, refresher, target) || hasAbility(target, ABILITY.UNDEAD);
}

/** Ported from UnitToolkit#getRefresherHeal: REFRESH_BASE_HEAL + 5/level,
 * same UNDEAD-becomes-damage flip as getHealerHeal above. */
export function getRefresherHeal(rule, refresher, target) {
  const heal = rule.refreshBaseHeal + refresher.level * 5;
  return hasAbility(target, ABILITY.UNDEAD) ? -heal : heal;
}

/**
 * Resolves a heal action: computes the heal (or heal-as-damage for an
 * UNDEAD target) via getHealerHeal, applies it, and grants experience -
 * ATTACK_EXPERIENCE normally, or KILL_EXPERIENCE if the heal-as-damage
 * finishes off an UNDEAD target. Ported from OperationExecutor#onHeal.
 *
 * A living target's new HP is deliberately NOT clamped to their max (see
 * getHealerHeal's docstring) - only the death case clamps, to exactly 0.
 * Does NOT remove a destroyed target from the board - caller does that
 * using destroyedUnitIds, same convention as resolveAttack.
 */
export function resolveHeal(game, rule, healer, target) {
  if (!canHeal(game, healer, target)) {
    throw new Error("resolveHeal: heal not allowed (check canHeal before calling)");
  }
  const heal = getHealerHeal(rule, healer, target);
  const destroyedUnitIds = [];
  const events = [];

  if (target.currentHp + heal <= 0) {
    const change = -target.currentHp; // actual delta applied: down to exactly 0
    target.currentHp = 0;
    events.push({ type: "HEAL", healerId: healer.id, targetId: target.id, change });
    destroyedUnitIds.push(target.id);
    events.push({ type: "UNIT_DESTROY", unitId: target.id, killedBy: healer.id });
    gainExperience(healer, rule.killExperience, rule.maxLevel);
    events.push({ type: "GAIN_EXPERIENCE", unitId: healer.id, amount: rule.killExperience });
  } else {
    target.currentHp += heal;
    events.push({ type: "HEAL", healerId: healer.id, targetId: target.id, change: heal });
    gainExperience(healer, rule.attackExperience, rule.maxLevel);
    events.push({ type: "GAIN_EXPERIENCE", unitId: healer.id, amount: rule.attackExperience });
  }

  return { heal, destroyedUnitIds, events };
}

// --- Experience / leveling ------------------------------------------------

// Ported from Unit's hardcoded LEVEL_EXPERIENCE = {0, 100, 300, 600} (levels
// 0-3, the original's fixed cap) - generalized into a formula so a game's
// rule.maxLevel (see game-state.js's DEFAULT_RULE) can raise that cap. The
// original's own 4 entries are exactly the triangular-number pattern
// cumulative-100*k-per-level produces (100, 100+200=300, 300+300=600), so
// this reproduces them exactly at maxLevel=3 and extends the SAME pattern
// beyond it rather than inventing a different curve.
function levelExperienceTable(maxLevel) {
  const table = [0];
  for (let n = 1; n <= maxLevel; n++) {
    table.push(table[n - 1] + 100 * n);
  }
  return table;
}

function levelForExperience(experience, maxLevel) {
  const table = levelExperienceTable(maxLevel);
  let level = 0;
  for (; level <= maxLevel; level++) {
    if (experience < table[level]) {
      return Math.max(level - 1, 0);
    }
  }
  return maxLevel;
}

/** Mutates `unit`, returns true if this pushed it to a new level (HP/MP bump
 * on level-up). `maxLevel` should always be the current game's rule.maxLevel
 * (default 3, matching the original's hardcoded cap - see DEFAULT_RULE). */
export function gainExperience(unit, experience, maxLevel) {
  if (unit.level >= maxLevel) return false;
  const oldLevel = unit.level;
  unit.experience += experience;
  unit.level = levelForExperience(unit.experience, maxLevel);
  const levelAdvance = unit.level - oldLevel;
  if (levelAdvance > 0) {
    unit.currentHp += unit.hpGrowth * levelAdvance;
    unit.currentMovementPoint += unit.movementGrowth * levelAdvance;
    return true;
  }
  return false;
}

/** Ported from Unit#getCurrentExperience: XP accumulated since reaching the
 * unit's current level (not the running total - see unit.experience for
 * that). Used for the "current/needed" XP display - see getLevelUpExperience
 * below and ui/statsPanel.js. */
export function getCurrentExperience(unit, maxLevel) {
  const table = levelExperienceTable(maxLevel);
  return unit.experience - table[unit.level];
}

/** Ported from Unit#getLevelUpExperience: XP still needed to reach the next
 * level, or -1 if already at maxLevel (matching the original's exact
 * sentinel - RightPanelRenderer shows "-/-" for this case). */
export function getLevelUpExperience(unit, maxLevel) {
  if (unit.level >= maxLevel) return -1;
  const table = levelExperienceTable(maxLevel);
  return table[unit.level + 1] - table[unit.level];
}

// --- Attack resolution -----------------------------------------------------

/**
 * Resolves one full attack exchange: initial attack, then a counter if the
 * defender survives and is in range. Mutates unit HP/experience/level in place.
 * Does NOT remove dead units from the board — caller does that using the
 * `destroyed` unit ids returned here (keeps this module board-agnostic).
 *
 * @returns {{
 *   attackDamage: number,
 *   counterDamage: number | null,
 *   destroyedUnitIds: string[],
 *   events: Array<{type: string, [key: string]: any}>
 * }}
 */
export function resolveAttack(game, rule, attacker, defender) {
  const events = [];
  const destroyedUnitIds = [];

  if (!canAttack(game, attacker, defender)) {
    throw new Error("resolveAttack: attack not allowed (check canAttack before calling)");
  }

  const attackDamage = getDamage({
    attacker: toCombatStats(attacker),
    defender: toCombatStats(defender),
    attackerTile: attacker._tile,
    defenderTile: defender._tile,
    applyRng: true,
  });

  defender.currentHp = Math.max(defender.currentHp - attackDamage, 0);
  events.push({ type: "ATTACK", attackerId: attacker.id, defenderId: defender.id, damage: attackDamage, counter: false });
  // Ported from GameEventExecutor#onAttack calling UnitToolkit.attachAttackStatus
  // right after applying damage - fires on every landed hit regardless of
  // whether it killed, so a POISONER/BLINDER's status still attaches even on
  // a blow that finishes the target off (harmless there, but matches source).
  attachAttackStatus(attacker, defender);

  let counterDamage = null;
  if (defender.currentHp <= 0) {
    destroyedUnitIds.push(defender.id);
    events.push({ type: "UNIT_DESTROY", unitId: defender.id, killedBy: attacker.id });
    gainExperience(attacker, rule.killExperience, rule.maxLevel);
    events.push({ type: "GAIN_EXPERIENCE", unitId: attacker.id, amount: rule.killExperience });
  } else {
    gainExperience(attacker, rule.attackExperience, rule.maxLevel);
    events.push({ type: "GAIN_EXPERIENCE", unitId: attacker.id, amount: rule.attackExperience });

    if (canCounter(game, attacker, defender)) {
      counterDamage = getDamage({
        attacker: toCombatStats(defender),
        defender: toCombatStats(attacker),
        attackerTile: defender._tile,
        defenderTile: attacker._tile,
        applyRng: true,
      });
      attacker.currentHp = Math.max(attacker.currentHp - counterDamage, 0);
      events.push({ type: "ATTACK", attackerId: defender.id, defenderId: attacker.id, damage: counterDamage, counter: true });
      // Same on-hit status attachment as the initial attack above, roles
      // swapped - a counter is a real hit too, so a defender who's also a
      // POISONER/BLINDER can inflict its status right back on the attacker.
      attachAttackStatus(defender, attacker);

      if (attacker.currentHp <= 0) {
        destroyedUnitIds.push(attacker.id);
        events.push({ type: "UNIT_DESTROY", unitId: attacker.id, killedBy: defender.id });
        gainExperience(defender, rule.killExperience, rule.maxLevel);
        events.push({ type: "GAIN_EXPERIENCE", unitId: defender.id, amount: rule.killExperience });
      } else {
        gainExperience(defender, rule.counterExperience, rule.maxLevel);
        events.push({ type: "GAIN_EXPERIENCE", unitId: defender.id, amount: rule.counterExperience });
      }
    }
  }

  return { attackDamage, counterDamage, destroyedUnitIds, events };
}

/**
 * Shared death handling for anything that can destroy units (attack,
 * heal-as-damage-to-undead below): bumps a dead commander's repurchase
 * price, or leaves a tomb for anyone else who wasn't already UNDEAD. Ported
 * from GameCore#destroyUnit's commander-price/tomb branches. Mutates `game`
 * only - does not remove anyone from `units` (caller does that).
 */
function handleUnitDeaths(game, units, destroyedUnitIds) {
  for (const deadId of destroyedUnitIds) {
    const deadUnit = units.find((u) => u.id === deadId);
    if (!deadUnit) continue;
    if (hasAbility(deadUnit, ABILITY.COMMANDER)) {
      game.commanderDeaths = game.commanderDeaths ?? {};
      game.commanderDeaths[deadUnit.team] = (game.commanderDeaths[deadUnit.team] ?? 0) + 1;
    } else if (!hasAbility(deadUnit, ABILITY.UNDEAD)) {
      addTomb(game, deadUnit.x, deadUnit.y);
    }
  }
}

/**
 * Full turn-level wrapper: resolves the attack, removes destroyed units from
 * `units`, bumps a dead commander's repurchase price (via
 * game.commanderDeaths — see getUnitPrice in turn.js) or leaves a tomb for
 * anyone else who wasn't already UNDEAD, and runs the team-destroy/
 * win-condition check for any team that just lost its last unit or
 * commander. Mutates `units` (removes dead entries) and `game`.
 */
export function applyAttack(game, rule, units, mapInfo, attackerId, defenderId) {
  const attacker = units.find((u) => u.id === attackerId);
  const defender = units.find((u) => u.id === defenderId);
  const result = resolveAttack(game, rule, attacker, defender);

  handleUnitDeaths(game, units, result.destroyedUnitIds);

  const remaining = units.filter((u) => !result.destroyedUnitIds.includes(u.id));
  units.length = 0;
  units.push(...remaining);

  const affectedTeams = new Set([attacker.team, defender.team]);
  for (const team of affectedTeams) {
    checkTeamDestroy(game, units, mapInfo, team);
  }

  return result;
}

/**
 * Full turn-level wrapper for healing, mirroring applyAttack exactly:
 * resolves the heal (see resolveHeal), runs the same death handling as
 * combat (only reachable here if an UNDEAD target dies to heal-as-damage -
 * see resolveHeal), removes any dead unit, and checks both teams for
 * destruction (a Healer can target its own team OR an UNDEAD enemy, so
 * either side could theoretically be the one affected).
 */
export function applyHeal(game, rule, units, mapInfo, healerId, targetId) {
  const healer = units.find((u) => u.id === healerId);
  const target = units.find((u) => u.id === targetId);
  const result = resolveHeal(game, rule, healer, target);

  handleUnitDeaths(game, units, result.destroyedUnitIds);

  const remaining = units.filter((u) => !result.destroyedUnitIds.includes(u.id));
  units.length = 0;
  units.push(...remaining);

  const affectedTeams = new Set([healer.team, target.team]);
  for (const team of affectedTeams) {
    checkTeamDestroy(game, units, mapInfo, team);
  }

  return result;
}
