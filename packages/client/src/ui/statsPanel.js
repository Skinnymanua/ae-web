/**
 * Ported from renderer.RightPanelRenderer#drawInformation — a side panel that
 * shows whatever unit is currently hovered (or last selected, on touch),
 * retaining the last-shown unit rather than clearing on mouse-out, matching
 * the original's target_unit persistence behavior.
 */
import { HUD_ICON } from "../constants.js";
import {
  getEffectiveAttack,
  getEffectivePhysicalDefence,
  getEffectiveMagicDefence,
  getMaxHp,
  LEVEL_EXPERIENCE,
  MAX_LEVEL,
} from "@ae/shared/src/combat-resolution.js";

const PANEL_X = 500;
const PANEL_TOP = 190;
const ROW_HEIGHT = 22;

// Exact colors from ResourceManager: color_physical_attack / color_magic_attack.
const PHYSICAL_ATTACK_COLOR = "#e30075";
const MAGIC_ATTACK_COLOR = "#0000ff";

export function createStatsPanel(scene) {
  const container = scene.add.container(PANEL_X, PANEL_TOP);
  const bg = scene.add.rectangle(90, 160, 220, 320, 0x1a1a1a, 0.9).setStrokeStyle(2, 0xffffff);
  container.add(bg);

  const rows = [
    { key: "level", label: "Level", icon: HUD_ICON.LEVEL },
    { key: "attack", label: "Attack", icon: HUD_ICON.ATTACK },
    { key: "pdef", label: "P.Def", icon: HUD_ICON.PDEF },
    { key: "mdef", label: "M.Def", icon: HUD_ICON.MDEF },
    { key: "hp", label: "HP", icon: null },
    { key: "xp", label: "XP", icon: null },
  ];

  const texts = {};
  let y = 70;
  for (const row of rows) {
    if (row.icon !== null) {
      const iconImg = scene.add.image(16, y + 7, "icons_hud_battle", row.icon);
      iconImg.setDisplaySize(13, 16);
      container.add(iconImg);
    }
    const labelText = scene.add.text(30, y, row.label, { fontSize: "13px", color: "#cccccc" });
    const valueText = scene.add.text(130, y, "-", { fontSize: "13px", color: "#ffffff" });
    container.add([labelText, valueText]);
    texts[row.key] = valueText;
    y += ROW_HEIGHT;
  }

  container.setVisible(false);
  scene.statsPanel = { container, texts, portrait: null, head: null };
  scene.statsPanelUnitId = null;
}

export function updateStatsPanel(scene, unit) {
  if (!unit) return; // keep showing the last hovered/selected unit — matches the original
  const panel = scene.statsPanel;
  scene.statsPanelUnitId = unit.id;
  panel.container.setVisible(true);

  if (panel.portrait) panel.portrait.destroy();
  if (panel.head) panel.head.destroy();

  panel.portrait = scene.add.sprite(45, 30, `unit_sheet_${unit.team}`, unit.unitIndex);
  panel.portrait.setDisplaySize(48, 48);
  panel.container.add(panel.portrait);

  if (unit.isCommander) {
    panel.head = scene.add.image(45 - 24 + (48 * 7) / 24, 30 - 24, "heads", unit.head ?? 0);
    panel.head.setOrigin(0, 0);
    panel.head.setDisplaySize((48 * 13) / 24, (48 * 12) / 24);
    panel.container.add(panel.head);
  }

  panel.texts.level.setText(String(unit.level));

  const attackColor = unit.attackType === 0 ? PHYSICAL_ATTACK_COLOR : MAGIC_ATTACK_COLOR;
  panel.texts.attack.setText(String(getEffectiveAttack(unit)));
  panel.texts.attack.setColor(attackColor);

  panel.texts.pdef.setText(String(getEffectivePhysicalDefence(unit)));
  panel.texts.mdef.setText(String(getEffectiveMagicDefence(unit)));

  panel.texts.hp.setText(`${unit.currentHp}/${getMaxHp(unit)}`);
  panel.texts.hp.setColor("#44dd44");

  const nextThreshold = unit.level < MAX_LEVEL ? LEVEL_EXPERIENCE[unit.level + 1] : 0;
  panel.texts.xp.setText(nextThreshold > 0 ? `${unit.experience}/${nextThreshold}` : "-/-");
  panel.texts.xp.setColor("#44ffff");
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
