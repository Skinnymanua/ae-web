/**
 * Top-of-map stats bar, styled after the reference screenshot: three cells side by
 * side (left stat pair-column, center unit portrait, right stat pair-column), each
 * stat row a colored circular icon badge next to a pill-shaped value background.
 * Layout is bespoke (the original used a text-only side panel — see
 * RightPanelRenderer), but the SIX stats shown are exactly the reference
 * screenshot's own six: HP/Attack/Defence (left), XP/Magic defence/Move (right).
 *
 * Left column top-to-bottom: HP / Attack / Defence.
 * Right column top-to-bottom: XP (current/needed for next level, or "-/-" at max
 * level - see combat-resolution.js's getCurrentExperience/getLevelUpExperience)
 * / Magic defence / Move (max tiles per move).
 *
 * XP's icon reuses HUD_ICON.LEVEL (icons_hud_battle.png frame 3, an upward
 * chevron) flipped vertically - confirmed against the reference screenshot,
 * which shows the same chevron shape and color pointing DOWN for this exact
 * row; there's no separate XP icon asset in the source repo to draw from.
 */
import { HUD_ICON, STAT_ICON, BOARD_OFFSET_Y, DEPTH, PHYSICAL_ATTACK_COLOR, MAGIC_ATTACK_COLOR } from "../constants.js";
import { getUnitSpriteKey } from "../render/unitTexture.js";
import {
  getEffectiveAttack,
  getEffectivePhysicalDefence,
  getEffectiveMagicDefence,
  getMaxHp,
  getCurrentExperience,
  getLevelUpExperience,
} from "@ae/shared/src/combat-resolution.js";

const BAR_HEIGHT = BOARD_OFFSET_Y;
const ROW_HEIGHT = 24;
const PORTRAIT_SIZE = 64;
// Modestly bigger than before (was 10/14/20) to read closer to the reference
// screenshot's much larger badges - bounded by ROW_HEIGHT/BAR_HEIGHT though,
// which this port keeps compact (76px total for all 3 rows) rather than the
// screenshot's much taller phone-scaled bar; a full match would need
// restructuring BAR_HEIGHT itself; not done here.
const BADGE_RADIUS = 11;
const ICON_SIZE = 17;
const PILL_WIDTH = 74;
const PILL_HEIGHT = 22;

const CELL_BG = 0x232838;
const PILL_BG = 0x3a4258;
// Sampled from the reference screenshot: every badge is the SAME black
// circle with a steel-teal ring border, whatever stat it is - the icon art
// itself (not the badge) carries the per-stat color (yellow heart, magenta
// shield, etc.). Replaces an earlier per-stat BADGE_COLORS fill, which was
// a guess made before an actual screenshot was available to check against.
const BADGE_FILL = 0x0a0a0a;
const BADGE_RING = 0x5b93ab;


function addStatRow(scene, container, graphics, x, y, iconSheet, iconFrame, align, flipY = false) {
  const badgeX = align === "left" ? x + BADGE_RADIUS : x - BADGE_RADIUS;
  const badgeY = y + PILL_HEIGHT / 2;
  graphics.fillStyle(BADGE_FILL, 1);
  graphics.fillCircle(badgeX, badgeY, BADGE_RADIUS);
  graphics.lineStyle(2, BADGE_RING, 1);
  graphics.strokeCircle(badgeX, badgeY, BADGE_RADIUS);

  const pillX = align === "left" ? x + BADGE_RADIUS : x - BADGE_RADIUS - PILL_WIDTH;
  graphics.fillStyle(PILL_BG, 1);
  graphics.fillRoundedRect(pillX, y, PILL_WIDTH, PILL_HEIGHT, 6);

  const icon = scene.add.image(badgeX, badgeY, iconSheet, iconFrame);
  icon.setDisplaySize(ICON_SIZE, ICON_SIZE);
  icon.setFlipY(flipY);
  container.add(icon);

  const text = scene.add.text(pillX + PILL_WIDTH - 8, y + PILL_HEIGHT / 2, "-", {
    fontSize: "13px",
    color: "#ffffff",
  });
  text.setOrigin(1, 0.5);
  container.add(text);
  return text;
}

export function createStatsPanel(scene) {
  // Fixed to the camera's actual viewport width, not the map's - this bar is
  // pinned on-screen (setScrollFactor(0) below), so its own width has to
  // match what's actually visible, not how many tiles wide the loaded map
  // happens to be. The two only coincided by chance on the original 10-wide
  // sample map; any wider or narrower map (e.g. battle-test-map.json's 21
  // tiles) stretched or shrank every cell/stat position along with it.
  const barWidth = scene.cameras.main.width;
  const container = scene.add.container(0, 0);

  const g = scene.add.graphics();
  container.add(g);

  const centerX = barWidth / 2;
  const cellGap = 6;
  const cellPad = 4;
  const leftCellRight = centerX - PORTRAIT_SIZE / 2 - cellGap;
  const rightCellLeft = centerX + PORTRAIT_SIZE / 2 + cellGap;

  g.fillStyle(CELL_BG, 1);
  g.fillRoundedRect(cellPad, cellPad, leftCellRight - cellPad, BAR_HEIGHT - cellPad * 2, 8);
  g.fillRoundedRect(rightCellLeft, cellPad, barWidth - cellPad - rightCellLeft, BAR_HEIGHT - cellPad * 2, 8);
  g.fillStyle(0x14161f, 1);
  g.fillRoundedRect(centerX - PORTRAIT_SIZE / 2, cellPad, PORTRAIT_SIZE, BAR_HEIGHT - cellPad * 2, 8);
  g.lineStyle(2, 0xffffff, 0.6);
  g.strokeRoundedRect(centerX - PORTRAIT_SIZE / 2, cellPad, PORTRAIT_SIZE, BAR_HEIGHT - cellPad * 2, 8);

  const leftX = 10;
  const rightX = barWidth - 10;
  let rowY = 6;

  const texts = {};
  texts.hp = addStatRow(scene, container, g, leftX, rowY, "icons_action", STAT_ICON.HP, "left");
  texts.xp = addStatRow(scene, container, g, rightX, rowY, "icons_hud_battle", HUD_ICON.LEVEL, "right", true);
  rowY += ROW_HEIGHT;
  texts.attack = addStatRow(scene, container, g, leftX, rowY, "icons_hud_battle", HUD_ICON.ATTACK, "left");
  texts.mdef = addStatRow(scene, container, g, rightX, rowY, "icons_action", STAT_ICON.MDEF, "right");
  rowY += ROW_HEIGHT;
  texts.pdef = addStatRow(scene, container, g, leftX, rowY, "icons_hud_battle", HUD_ICON.PDEF, "left");
  texts.move = addStatRow(scene, container, g, rightX, rowY, "icons_action", STAT_ICON.MOVE, "right");

  container.setVisible(false);
  container.setScrollFactor(0);
  // Explicit depth: refreshUnits() (render/units.js) recreates unit sprites on
  // nearly every action, which re-adds them at the top of the display list — without
  // this, a unit near the board's top edge would render over this bar. See constants.js.
  container.setDepth(DEPTH.STATS_BARS);
  scene.statsPanel = { container, texts, portrait: null, head: null, centerX };
  scene.statsPanelUnitId = null;
}

export function updateStatsPanel(scene, unit) {
  if (!unit) return; // keep showing the last selected unit — matches the original's persistence
  const panel = scene.statsPanel;
  scene.statsPanelUnitId = unit.id;
  panel.container.setVisible(true);

  if (panel.portrait) panel.portrait.destroy();
  if (panel.head) panel.head.destroy();

  const cx = panel.centerX;
  const cy = BAR_HEIGHT / 2;
  const { key: portraitKey, frame: portraitFrame } = getUnitSpriteKey(unit.unitIndex, unit.team);
  panel.portrait = scene.add.sprite(cx, cy, portraitKey, portraitFrame);
  panel.portrait.setDisplaySize(PORTRAIT_SIZE - 12, PORTRAIT_SIZE - 12);
  panel.container.add(panel.portrait);

  if (unit.isCommander) {
    const headSize = PORTRAIT_SIZE - 12;
    panel.head = scene.add.image(
      cx - headSize / 2 + (headSize * 7) / 24,
      cy - headSize / 2,
      "heads",
      unit.head ?? 0
    );
    panel.head.setOrigin(0, 0);
    panel.head.setDisplaySize((headSize * 13) / 24, (headSize * 12) / 24);
    panel.container.add(panel.head);
  }

  panel.texts.hp.setText(`${unit.currentHp}/${getMaxHp(unit)}`);

  const attackColor = unit.attackType === 0 ? PHYSICAL_ATTACK_COLOR : MAGIC_ATTACK_COLOR;
  panel.texts.attack.setText(String(getEffectiveAttack(unit)));
  panel.texts.attack.setColor(attackColor);

  panel.texts.pdef.setText(String(getEffectivePhysicalDefence(unit)));
  panel.texts.mdef.setText(String(getEffectiveMagicDefence(unit)));
  panel.texts.move.setText(String(unit.maxMovementPoint));

  // Ported from RightPanelRenderer's XP display exactly: "current/needed" for
  // the next level, or "-/-" once maxLevel is reached (getLevelUpExperience's
  // -1 sentinel) - white, matching the reference screenshot (not the
  // original desktop source's Color.CYAN - the screenshot is this port's
  // actual visual target here).
  const maxLevel = scene.game_.rule.maxLevel;
  const neededXp = getLevelUpExperience(unit, maxLevel);
  panel.texts.xp.setText(neededXp > 0 ? `${getCurrentExperience(unit, maxLevel)}/${neededXp}` : "-/-");
}

/** Re-renders the panel for whichever unit it's currently showing — call after
 * any action that might change that unit's HP/level/etc (attack, move, buy). */
export function refreshStatsPanel(scene) {
  if (!scene.statsPanelUnitId) return;
  const unit = scene.game_.getUnit(scene.statsPanelUnitId);
  if (unit) {
    updateStatsPanel(scene, unit);
  } else {
    scene.statsPanel.container.setVisible(false);
    scene.statsPanelUnitId = null;
  }
}