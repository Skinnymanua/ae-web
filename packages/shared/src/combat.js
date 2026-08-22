/**
 * Ported from net.toyknight.aeii.utils.UnitToolkit#getDamage and its helper
 * methods (getAttackBonus, getPhysicalDefenceBonus, getMagicDefenceBonus,
 * getTileDefenceBonus, getRange). Verified against the original source
 * during extraction — see conversation history / commit notes for the
 * original Java line references if this ever needs re-checking.
 */

export const ATTACK_PHYSICAL = 0;
export const ATTACK_MAGIC = 1;

export const ABILITY = {
  CONQUEROR: 0,
  FIGHTER_OF_THE_SEA: 1,
  FIGHTER_OF_THE_FOREST: 2,
  FIGHTER_OF_THE_MOUNTAIN: 3,
  DESTROYER: 4,
  AIR_FORCE: 5,
  NECROMANCER: 6,
  HEALER: 7,
  CHARGER: 8,
  POISONER: 9,
  REPAIRER: 10,
  UNDEAD: 11,
  MARKSMAN: 12,
  SON_OF_THE_SEA: 13,
  SON_OF_THE_FOREST: 14,
  SON_OF_THE_MOUNTAIN: 15,
  CRAWLER: 16,
  SLOWING_AURA: 17,
  COMMANDER: 18,
  HEAVY_MACHINE: 19,
  ATTACK_AURA: 20,
  BLOODTHIRSTY: 21,
  GUARDIAN: 22,
  REFRESH_AURA: 23,
  LORD_OF_TERROR: 24,
  COUNTER_MADNESS: 25,
  BLINDER: 26,
  REHABILITATION: 27,
  HARD_SKIN: 28,
};

export const TILE_TYPE = { LAND: 0, WATER: 1, FOREST: 2, MOUNTAIN: 3 };

function hasAbility(unit, abilityId) {
  return unit.abilities?.some((a) => (typeof a === "object" ? a.id === abilityId : a === abilityId));
}

export function manhattanRange(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Counts enemy units within `radius` tiles of `unit`. Needs live board state,
 * so it's injected via `context.countEnemiesWithin` rather than hardcoded here.
 * Wire this up once the board/game-state module exists (Step 4).
 */
function countEnemiesWithin(context, unit, radius) {
  if (context?.countEnemiesWithin) {
    return context.countEnemiesWithin(unit, radius);
  }
  return 0;
}

export function getTileDefenceBonus(unit, tile) {
  if (unit.unitCode === "saeth") return 30;
  let bonus = 0;
  if (!hasAbility(unit, ABILITY.AIR_FORCE)) bonus += tile.defenceBonus;
  if (hasAbility(unit, ABILITY.GUARDIAN) && tile.team === unit.team) bonus += 5;
  if (tile.type === TILE_TYPE.FOREST && hasAbility(unit, ABILITY.FIGHTER_OF_THE_FOREST)) bonus += 10;
  if (tile.type === TILE_TYPE.MOUNTAIN && hasAbility(unit, ABILITY.FIGHTER_OF_THE_MOUNTAIN)) bonus += 10;
  if (tile.type === TILE_TYPE.WATER && hasAbility(unit, ABILITY.FIGHTER_OF_THE_SEA)) bonus += 10;
  return bonus;
}

export function getAttackBonus(attacker, defender, attackerTile, context) {
  let bonus = 0;
  if (hasAbility(attacker, ABILITY.FIGHTER_OF_THE_MOUNTAIN) && attackerTile.type === TILE_TYPE.MOUNTAIN) bonus += 10;
  if (hasAbility(attacker, ABILITY.FIGHTER_OF_THE_FOREST) && attackerTile.type === TILE_TYPE.FOREST) bonus += 10;
  if (hasAbility(attacker, ABILITY.FIGHTER_OF_THE_SEA) && attackerTile.type === TILE_TYPE.WATER) bonus += 10;
  if (hasAbility(attacker, ABILITY.MARKSMAN) && hasAbility(defender, ABILITY.AIR_FORCE)) bonus += 15;
  if (hasAbility(attacker, ABILITY.BLOODTHIRSTY)) bonus += 10 * countEnemiesWithin(context, attacker, 2);
  if (attacker.status?.inspired) bonus += 10;
  return bonus;
}

/**
 * @param {object} params
 * @param {object} params.attacker - unit object with x, y, attack, attackType, currentHp, maxHp, abilities, team
 * @param {object} params.defender - same shape as attacker, plus physicalDefence/magicDefence
 * @param {object} params.attackerTile - tile object the attacker stands on (from tiles.json)
 * @param {object} params.defenderTile - tile object the defender stands on
 * @param {boolean} [params.applyRng=true] - whether to apply the +/-2 random offset
 * @param {object} [params.context] - optional { countEnemiesWithin(unit, radius) } for BLOODTHIRSTY
 * @returns {number} final damage, clamped to defender's current HP
 */
export function getDamage({ attacker, defender, attackerTile, defenderTile, applyRng = true, context }) {
  const attackBonus = getAttackBonus(attacker, defender, attackerTile, context);
  const attack = attacker.attack + attackBonus;

  let defenceBonus = getTileDefenceBonus(defender, defenderTile);
  if (attacker.attackType === ATTACK_PHYSICAL && hasAbility(defender, ABILITY.BLOODTHIRSTY)) {
    defenceBonus += 5 * countEnemiesWithin(context, defender, 2);
  }
  const defence =
    attacker.attackType === ATTACK_PHYSICAL
      ? defender.physicalDefence + defenceBonus
      : defender.magicDefence + defenceBonus;

  let damage = Math.max(attack - defence, 0);
  damage = Math.floor((damage * attacker.currentHp) / attacker.maxHp);
  damage = Math.max(damage, 0);

  let percentMod = 1.0;
  const range = manhattanRange(attacker, defender);
  if (range === 1 && hasAbility(attacker, ABILITY.LORD_OF_TERROR) && !hasAbility(defender, ABILITY.LORD_OF_TERROR)) {
    percentMod += 0.5;
  }
  if (range > 1 && hasAbility(defender, ABILITY.HARD_SKIN)) {
    percentMod -= 0.5;
  }
  percentMod = Math.max(percentMod, 0);

  damage = Math.floor(damage * percentMod);
  if (applyRng) damage += Math.floor(Math.random() * 5) - 2;
  damage = Math.max(damage, 0);
  damage = Math.min(damage, defender.currentHp);
  return damage;
}
