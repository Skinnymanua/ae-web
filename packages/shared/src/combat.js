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
  // Not part of the original 29 abilities (0-28) - a custom addition for
  // this port's Druid. See combat-resolution.js's canSupport/getSupportTargetPositions
  // for the full rules.
  SUPPORT: 29,
};

export const TILE_TYPE = { LAND: 0, WATER: 1, FOREST: 2, MOUNTAIN: 3 };

// Ported from entity.Status - POISONED/BLINDED are inflicted by an attack hit
// (see attachAttackStatus below); INSPIRED/SLOWED come from a nearby aura-bearer
// going standby (see turn.js's applyAuraEffects). A unit holds at most ONE
// status at a time - see attachStatus's single-slot rule below - matching the
// original's Unit#status being a single field, not a list/set.
export const STATUS = {
  POISONED: 0,
  SLOWED: 1,
  INSPIRED: 2,
  BLINDED: 3,
};

function isDebuffStatusType(type) {
  return type === STATUS.POISONED || type === STATUS.SLOWED || type === STATUS.BLINDED;
}

/** Whether `unit.status` (if any) is a debuff - used by temple-cure (turn.js)
 * and REFRESH_AURA's cleanse (turn.js's applyAuraEffects). INSPIRED is the
 * only non-debuff status, so this is really "status but not inspired". */
export function isDebuffStatus(status) {
  return !!status && isDebuffStatusType(status.type);
}

export function hasStatus(unit, type) {
  return !!unit.status && unit.status.type === type;
}

// Ported from Unit#attachStatus's guard clause - HEAVY_MACHINE units, crystals,
// and the "saeth" scenario unit (see getTileDefenceBonus above) never receive
// any status at all, buff or debuff.
function isStatusImmune(unit) {
  return hasAbility(unit, ABILITY.HEAVY_MACHINE) || !!unit.isCrystal || unit.unitCode === "saeth";
}

/**
 * Sets unit.status to `status` ({ type, remainingTurn }) - but only if the
 * unit currently has no status, or already has this exact status type
 * (refreshing its duration). A different status already active is NOT
 * overwritten - ported from Unit#attachStatus's single-slot rule: you can't
 * e.g. poison an already-blinded unit until the blind wears off.
 */
export function attachStatus(unit, status) {
  if (isStatusImmune(unit)) return;
  if (!unit.status || unit.status.type === status.type) {
    unit.status = status;
  }
}

export function clearStatus(unit) {
  unit.status = null;
}

/**
 * Ported from UnitToolkit.attachAttackStatus - called after ANY successful
 * hit (attack or counter, see combat-resolution.js's resolveAttack), not
 * conditioned on damage actually landing. A POISONER poisons its target for
 * 2 turns; a BLINDER blinds its target for 1 - unless the target has the
 * same ability itself (a POISONER can't be poisoned by another POISONER).
 */
export function attachAttackStatus(attacker, defender) {
  if (hasAbility(attacker, ABILITY.POISONER) && !hasAbility(defender, ABILITY.POISONER)) {
    attachStatus(defender, { type: STATUS.POISONED, remainingTurn: 2 });
  }
  if (hasAbility(attacker, ABILITY.BLINDER) && !hasAbility(defender, ABILITY.BLINDER)) {
    attachStatus(defender, { type: STATUS.BLINDED, remainingTurn: 1 });
  }
}

function hasAbility(unit, abilityId) {
  return unit.abilities?.some((a) => (typeof a === "object" ? a.id === abilityId : a === abilityId));
}

/**
 * Ported from UnitToolkit#canMoveAgain: a CHARGER unit that survives its own
 * action and still has movement points left over (e.g. it moved less than
 * its full range before attacking) gets one more move immediately after -
 * see ui/actionBar.js's finishUnitActionOrCharge. Never checked for an
 * explicit Standby click - GameManager#doStandbySelectedUnit bypasses this
 * entirely in the original (submits STANDBY directly, no ACTION_FINISH) -
 * only after attack/heal/summon/occupy actually resolve.
 */
export function canMoveAgain(unit) {
  return unit.currentHp > 0 && unit.currentMovementPoint > 0 && hasAbility(unit, ABILITY.CHARGER);
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
  if (hasStatus(attacker, STATUS.INSPIRED)) bonus += attacker.maxAttackRange > 1 ? 5 : 10; // halved for ranged attacks
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
