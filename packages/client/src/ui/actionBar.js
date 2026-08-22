import { ACTION_ICON } from "../constants.js";
import { clearHighlights, addHighlight, refreshTileTexture } from "../render/tiles.js";
import { refreshUnits } from "../render/units.js";
import { showBuyMenu } from "./dialogs.js";
import { updateInfoText } from "./hud.js";
import { refreshStatsPanel } from "./statsPanel.js";

/** Returns [{x,y}] of enemy-occupied tiles within `unit`'s attack range. */
function getAttackableEnemyPositions(scene, unit) {
  const positions = scene.game_.getAttackablePositions(unit.id);
  const result = [];
  for (const key of positions) {
    const [tx, ty] = key.split(",").map(Number);
    const target = scene.game_.getUnitAt(tx, ty);
    if (target && target.team !== unit.team) result.push({ x: tx, y: ty });
  }
  return result;
}

export function clearActionBar(scene) {
  if (scene.actionBarContainer) {
    scene.actionBarContainer.destroy();
    scene.actionBarContainer = null;
  }
  scene.actionBarOpen = false;
  scene.actionBarUnitId = null;
}

/** Marks the unit's turn as done, closes the bar, and re-renders. */
export function finishUnitAction(scene, unit) {
  unit.standby = true;
  clearActionBar(scene);
  scene.selectedUnitId = null;
  scene.actionOrigin = null;
  clearHighlights(scene);
  refreshUnits(scene);
  updateInfoText(scene);
  refreshStatsPanel(scene);
}

export function enterAttackTargetMode(scene, unit, attackablePositions) {
  clearActionBar(scene);
  scene.attackTargetMode = true;
  scene._pendingAttacker = unit;
  clearHighlights(scene);
  for (const { x, y } of attackablePositions) {
    addHighlight(scene, x, y, 0xdd4444, 0.4);
  }
}

/**
 * The contextual icon bar shown once a unit has confirmed its position
 * (moved, or chose to stay put) — mirrors ActionButtonBar.java's
 * updateButtons() visibility logic for the STATE_ACTION case.
 */
export function showActionBar(scene, unit, x, y) {
  clearActionBar(scene);
  scene.actionBarOpen = true;
  scene.actionBarUnitId = unit.id;
  
  const tile = scene.game_.getTileAt(x, y);
  const attackable = getAttackableEnemyPositions(scene, unit);
  const canOccupy = scene.game_.canOccupyTile(unit.id, x, y);
  const canBuyHere = unit.isCommander && tile.castle && tile.team === unit.team;

  const icons = [];
  if (attackable.length > 0) {
    icons.push({ frame: ACTION_ICON.ATTACK, onClick: () => enterAttackTargetMode(scene, unit, attackable) });
  }
  if (canOccupy) {
    icons.push({
      frame: ACTION_ICON.OCCUPY,
      onClick: () => {
        scene.game_.occupy(unit.id, x, y);
        refreshTileTexture(scene, x, y);
        finishUnitAction(scene, unit);
      },
    });
  }
  if (canBuyHere) {
    icons.push({
      frame: ACTION_ICON.BUY,
      onClick: () => {
        clearActionBar(scene);
        showBuyMenu(scene);
        finishUnitAction(scene, unit);
      },
    });
  }
  icons.push({ frame: ACTION_ICON.STANDBY, onClick: () => finishUnitAction(scene, unit) });

  scene.actionBarContainer = scene.add.container(0, 0);
  const barY = scene.cameras.main.height - 40;
  const spacing = 50;
  const startX = scene.cameras.main.width / 2 - (icons.length * spacing) / 2 + spacing / 2;

  icons.forEach((icon, i) => {
    const cx = startX + i * spacing;
    const bg = scene.add.circle(cx, barY, 20, 0x222222, 0.9).setStrokeStyle(2, 0xffffff);
    bg.setInteractive();
    const iconImg = scene.add.image(cx, barY, "icons_action", icon.frame);
    iconImg.setDisplaySize(24, 24);
    bg.on("pointerdown", icon.onClick);
    scene.actionBarContainer.add([bg, iconImg]);
  });
}
