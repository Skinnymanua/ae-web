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

import { ABILITY, getDamage, manhattanRange } from "./combat.js";
import { checkTeamDestroy } from "./turn.js";

const LEVEL_EXPERIENCE = [0, 100, 300, 600];
const MAX_LEVEL = 3;

export { LEVEL_EXPERIENCE, MAX_LEVEL };

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
  };
}

// --- Range / eligibility checks ---------------------------------------

export function isWithinRange(unit, x, y) {
  const range = manhattanRange(unit, { x, y });
  return range >= unit.minAttackRange && range <= unit.maxAttackRange;
}

export function canAttack(game, attacker, defender) {
  if (!attacker || !isWithinRange(attacker, defender?.x ?? -1, defender?.y ?? -1)) return false;
  if (!defender) return false; // tile-destroy targeting (DESTROYER ability) not ported yet — see note below
  return isEnemyUnit(game, attacker, defender);
}

function isEnemyUnit(game, a, b) {
  const allianceA = game.players[a.team]?.alliance;
  const allianceB = game.players[b.team]?.alliance;
  return a.team >= 0 && b.team >= 0 && allianceA !== allianceB;
}

export function canCounter(game, attacker, defender) {
  if (defender.currentHp <= 0 || !isEnemyUnit(game, defender, attacker)) return false;
  if (hasAbility(defender, ABILITY.COUNTER_MADNESS)) {
    return manhattanRange(defender, attacker) <= 2;
  }
  return isWithinRange(defender, attacker.x, attacker.y) && manhattanRange(defender, attacker) === 1;
}

// --- Experience / leveling ------------------------------------------------

function levelForExperience(experience) {
  let level = 0;
  for (; level <= MAX_LEVEL; level++) {
    if (experience < LEVEL_EXPERIENCE[level]) {
      return Math.max(level - 1, 0);
    }
  }
  return MAX_LEVEL;
}

/** Mutates `unit`, returns true if this pushed it to a new level (HP/MP bump on level-up). */
export function gainExperience(unit, experience) {
  if (unit.level >= MAX_LEVEL) return false;
  const oldLevel = unit.level;
  unit.experience += experience;
  unit.level = levelForExperience(unit.experience);
  const levelAdvance = unit.level - oldLevel;
  if (levelAdvance > 0) {
    unit.currentHp += unit.hpGrowth * levelAdvance;
    unit.currentMovementPoint += unit.movementGrowth * levelAdvance;
    return true;
  }
  return false;
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

  let counterDamage = null;
  if (defender.currentHp <= 0) {
    destroyedUnitIds.push(defender.id);
    events.push({ type: "UNIT_DESTROY", unitId: defender.id, killedBy: attacker.id });
    gainExperience(attacker, rule.killExperience);
    events.push({ type: "GAIN_EXPERIENCE", unitId: attacker.id, amount: rule.killExperience });
  } else {
    gainExperience(attacker, rule.attackExperience);
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

      if (attacker.currentHp <= 0) {
        destroyedUnitIds.push(attacker.id);
        events.push({ type: "UNIT_DESTROY", unitId: attacker.id, killedBy: defender.id });
        gainExperience(defender, rule.killExperience);
        events.push({ type: "GAIN_EXPERIENCE", unitId: defender.id, amount: rule.killExperience });
      } else {
        gainExperience(defender, rule.counterExperience);
        events.push({ type: "GAIN_EXPERIENCE", unitId: defender.id, amount: rule.counterExperience });
      }
    }
  }

  return { attackDamage, counterDamage, destroyedUnitIds, events };
}

/**
 * Full turn-level wrapper: resolves the attack, removes destroyed units from
 * `units`, bumps a dead commander's repurchase price (COMMANDER_PRICE_STEP),
 * and runs the team-destroy/win-condition check for any team that just lost
 * its last unit or commander. Mutates `units` (removes dead entries) and `game`.
 */
export function applyAttack(game, rule, units, mapInfo, attackerId, defenderId) {
  const attacker = units.find((u) => u.id === attackerId);
  const defender = units.find((u) => u.id === defenderId);
  const result = resolveAttack(game, rule, attacker, defender);

  for (const deadId of result.destroyedUnitIds) {
    const deadUnit = units.find((u) => u.id === deadId);
    if (!deadUnit) continue;
    if (hasAbility(deadUnit, ABILITY.COMMANDER)) {
      deadUnit._commanderPrice = (deadUnit._commanderPrice ?? deadUnit.price ?? 0) + rule.commanderPriceStep;
    }
  }

  const remaining = units.filter((u) => !result.destroyedUnitIds.includes(u.id));
  units.length = 0;
  units.push(...remaining);

  const affectedTeams = new Set([attacker.team, defender.team]);
  for (const team of affectedTeams) {
    checkTeamDestroy(game, units, mapInfo, team);
  }

  return result;
}
