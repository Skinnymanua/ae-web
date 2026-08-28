// Mermaid (19) and Druid (20) were added later from a different source than
// the rest of the roster (see units.json) - no per-team-color unit_sheet_N.png
// variant exists for either, just one standalone sprite each (see BoardScene.js's
// preload). Every other unit still resolves to unit_sheet_${team} at
// frame=unitIndex as before.
const STANDALONE_UNIT_TEXTURES = { 19: "mermaid", 20: "druid" };

/** Whether unitIndex uses a standalone texture (see getUnitSpriteKey) instead
 * of the usual per-team unit_sheet_${team} sheet. */
export function isStandaloneUnitTexture(unitIndex) {
  return unitIndex in STANDALONE_UNIT_TEXTURES;
}

/**
 * Resolves the Phaser texture key + frame for a unit's body sprite, given its
 * def.index (or unit.unitIndex) and team. Centralized here so every place that
 * draws a unit body (on-board sprites, purchase-menu portraits, ...) picks the
 * standalone texture the same way instead of duplicating this special case.
 */
export function getUnitSpriteKey(unitIndex, team) {
  const standalone = STANDALONE_UNIT_TEXTURES[unitIndex];
  if (standalone) return { key: standalone, frame: 0 };
  return { key: `unit_sheet_${team}`, frame: unitIndex };
}
