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
const ROW_HEIGHT = 34;
const PORTRAIT_SIZE = 90;
// Scaled up roughly 1.4x across the board (badge/icon/pill/font all
// together) - see constants.js's BOARD_OFFSET_Y for the matching bump to
// BAR_HEIGHT itself, which this whole panel's height derives from.
const BADGE_RADIUS = 15;
const ICON_SIZE = 24;
const PILL_WIDTH = 150;
const PILL_HEIGHT = 30;
const STAT_FONT_SIZE = "20px";
const PILL_TEXT_PADDING = 0;

const CELL_BG = 0x232838;
const PILL_BG = 0x3a4258;
// Sampled from the reference screenshot: every badge is the SAME black
// circle with a steel-teal ring border, whatever stat it is - the icon art
// itself (not the badge) carries the per-stat color (yellow heart, magenta
// shield, etc.). Replaces an earlier per-stat BADGE_COLORS fill, which was
// a guess made before an actual screenshot was available to check against.
const BADGE_FILL = 0x0a0a0a;
const BADGE_RING = 0x5b93ab;


function addStatRow(scene, container, graphics, x, y, iconSheet, iconFrame, align, pillWidth, flipY = false) {
  const badgeX = align === "left" ? x + BADGE_RADIUS : x - BADGE_RADIUS;
  const badgeY = y + PILL_HEIGHT / 2;

  // Pill drawn so its near edge sits UNDER the badge (not flush against it) -
  // "left" align starts the pill at x itself (the badge's own left edge),
  // so the badge center (x + BADGE_RADIUS) lands inside the pill's span
  // instead of just touching its border. "right" align mirrors that off
  // the far end. Drawn BEFORE the badge circle/ring below, so the badge
  // paints on top of the pill wherever they overlap - draw order is
  // z-order within a single Graphics object, same as any canvas API.
  const pillX = align === "left" ? x : x - pillWidth;
  graphics.fillStyle(PILL_BG, 1);
  graphics.fillRoundedRect(pillX, y, pillWidth, PILL_HEIGHT, 6);

  graphics.fillStyle(BADGE_FILL, 1);
  graphics.fillCircle(badgeX, badgeY, BADGE_RADIUS);
  graphics.lineStyle(2, BADGE_RING, 1);
  graphics.strokeCircle(badgeX, badgeY, BADGE_RADIUS);

  const icon = scene.add.image(badgeX, badgeY, iconSheet, iconFrame);
  icon.setDisplaySize(ICON_SIZE, ICON_SIZE);
  icon.setFlipY(flipY);
  container.add(icon);

  // Anchored to whichever end of the pill is AWAY from the badge, not
  // "the right edge" unconditionally - now that the badge overlaps the
  // pill's near end (see above), a right-aligned row's number needs to
  // sit at the pill's LEFT end instead, or it'd render underneath the
  // badge the same way the pill itself does.
  const text =
    align === "left"
      ? scene.add
          .text(pillX + pillWidth - PILL_TEXT_PADDING, y + PILL_HEIGHT / 2, "-", { fontSize: STAT_FONT_SIZE, color: "#ffffff" })
          .setOrigin(1, 0.5)
      : scene.add
          .text(pillX + PILL_TEXT_PADDING, y + PILL_HEIGHT / 2, "-", { fontSize: STAT_FONT_SIZE, color: "#ffffff" })
          .setOrigin(0, 0.5);
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
  const cellPad = 6;

  // One continuous background spanning the whole bar, not three separate
  // boxes with visible gaps between them - the portrait still gets its own
  // distinct (darker, bordered) inset on top of this, but the left/right
  // stat areas now read as one connected panel instead of two floating
  // islands either side of it.
  g.fillStyle(CELL_BG, 1);
  g.fillRoundedRect(cellPad, cellPad, barWidth - cellPad * 2, BAR_HEIGHT - cellPad * 2, 8);
  g.fillStyle(0x14161f, 1);
  g.fillRoundedRect(centerX - PORTRAIT_SIZE / 2, cellPad, PORTRAIT_SIZE, BAR_HEIGHT - cellPad * 2, 8);
  g.lineStyle(2, 0xffffff, 0.6);
  g.strokeRoundedRect(centerX - PORTRAIT_SIZE / 2, cellPad, PORTRAIT_SIZE, BAR_HEIGHT - cellPad * 2, 8);

  const leftX = 14;
  const rightX = barWidth - 14;
  let rowY = 8;

  // Clamped down from PILL_WIDTH when there isn't enough room between the
  // panel edge and the portrait to fit it - on a narrow phone, PILL_WIDTH
  // (sized for the bigger desktop bar) could otherwise extend the pill
  // right over the portrait, both sides at once, which is exactly the
  // overlapping/garbled text a real device screenshot showed. Never
  // upscaled past PILL_WIDTH itself - a wide desktop bar keeps the
  // original size.
  const sideSpan = centerX - PORTRAIT_SIZE / 2 - leftX - BADGE_RADIUS * 2 - 4;
  const pillWidth = Math.max(30, Math.min(PILL_WIDTH, sideSpan));

  const texts = {};
  texts.hp = addStatRow(scene, container, g, leftX, rowY, "icons_action", STAT_ICON.HP, "left", pillWidth);
  texts.xp = addStatRow(scene, container, g, rightX, rowY, "icons_hud_battle", HUD_ICON.LEVEL, "right", pillWidth, true);
  rowY += ROW_HEIGHT;
  texts.attack = addStatRow(scene, container, g, leftX, rowY, "icons_hud_battle", HUD_ICON.ATTACK, "left", pillWidth);
  texts.mdef = addStatRow(scene, container, g, rightX, rowY, "icons_action", STAT_ICON.MDEF, "right", pillWidth);
  rowY += ROW_HEIGHT;
  texts.pdef = addStatRow(scene, container, g, leftX, rowY, "icons_hud_battle", HUD_ICON.PDEF, "left", pillWidth);
  texts.move = addStatRow(scene, container, g, rightX, rowY, "icons_action", STAT_ICON.MOVE, "right", pillWidth);

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