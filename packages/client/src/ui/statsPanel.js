/**
 * Top-of-map stats bar, styled after the reference screenshot: three cells side by
 * side (left stat pair-column, center unit portrait, right stat pair-column), each
 * stat row a colored circular icon badge next to a pill-shaped value background.
 * Not from the original (which used a text-only side panel — see RightPanelRenderer)
 * — this is a bespoke layout built from the original's icon assets.
 *
 * Left column top-to-bottom: HP / Attack / Defence.
 * Right column top-to-bottom: Level / Magic strength (magic defence) / Move (max
 * tiles per move).
 */
import { HUD_ICON, STAT_ICON, TILE_SIZE, BOARD_OFFSET_Y, DEPTH } from "../constants.js";
import {
  getEffectiveAttack,
  getEffectivePhysicalDefence,
  getEffectiveMagicDefence,
  getMaxHp,
} from "@ae/shared/src/combat-resolution.js";

const BAR_HEIGHT = BOARD_OFFSET_Y;
const ROW_HEIGHT = 24;
const PORTRAIT_SIZE = 64;
const BADGE_RADIUS = 10;
const ICON_SIZE = 14;
const PILL_WIDTH = 74;
const PILL_HEIGHT = 20;

// Exact colors from ResourceManager: color_physical_attack / color_magic_attack.
const PHYSICAL_ATTACK_COLOR = "#e30075";
const MAGIC_ATTACK_COLOR = "#0000ff";

const CELL_BG = 0x232838;
const PILL_BG = 0x3a4258;
const BADGE_COLORS = { hp: 0xe0a83a, attack: 0x2b2b2b, pdef: 0xc0348a, level: 0xe8e4d8, mdef: 0xe0842a, move: 0xe8b13a };

function addStatRow(scene, container, graphics, x, y, key, iconSheet, iconFrame, align) {
  const badgeX = align === "left" ? x + BADGE_RADIUS : x - BADGE_RADIUS;
  const badgeY = y + PILL_HEIGHT / 2;
  graphics.fillStyle(BADGE_COLORS[key], 1);
  graphics.fillCircle(badgeX, badgeY, BADGE_RADIUS);

  const pillX = align === "left" ? x + BADGE_RADIUS : x - BADGE_RADIUS - PILL_WIDTH;
  graphics.fillStyle(PILL_BG, 1);
  graphics.fillRoundedRect(pillX, y, PILL_WIDTH, PILL_HEIGHT, 6);

  const icon = scene.add.image(badgeX, badgeY, iconSheet, iconFrame);
  icon.setDisplaySize(ICON_SIZE, ICON_SIZE);
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
  const barWidth = scene.game_.width * TILE_SIZE;
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
  texts.hp = addStatRow(scene, container, g, leftX, rowY, "hp", "icons_action", STAT_ICON.HP, "left");
  texts.level = addStatRow(scene, container, g, rightX, rowY, "level", "icons_hud_battle", HUD_ICON.LEVEL, "right");
  rowY += ROW_HEIGHT;
  texts.attack = addStatRow(scene, container, g, leftX, rowY, "attack", "icons_hud_battle", HUD_ICON.ATTACK, "left");
  texts.mdef = addStatRow(scene, container, g, rightX, rowY, "mdef", "icons_hud_battle", HUD_ICON.MDEF, "right");
  rowY += ROW_HEIGHT;
  texts.pdef = addStatRow(scene, container, g, leftX, rowY, "pdef", "icons_hud_battle", HUD_ICON.PDEF, "left");
  texts.move = addStatRow(scene, container, g, rightX, rowY, "move", "icons_action", STAT_ICON.MOVE, "right");

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
  panel.portrait = scene.add.sprite(cx, cy, `unit_sheet_${unit.team}`, unit.unitIndex);
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
  panel.texts.level.setText(String(unit.level));
  panel.texts.mdef.setText(String(getEffectiveMagicDefence(unit)));
  panel.texts.move.setText(String(unit.maxMovementPoint));
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