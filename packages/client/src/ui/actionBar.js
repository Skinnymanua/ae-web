import Phaser from "phaser";
import { ACTION_ICON, STAT_ICON, TILE_SIZE, BOARD_OFFSET_Y, DEPTH } from "../constants.js";
import { clearHighlights, highlightPositionSet, refreshTileTexture } from "../render/tiles.js";
import { refreshUnits } from "../render/units.js";
import { showBuyMenu } from "./dialogs.js";
import { updateInfoText } from "./hud.js";
import { refreshStatsPanel } from "./statsPanel.js";
import { handleActionBarCancelClick } from "../input/boardInput.js";
import { BOTTOM_BAR_HEIGHT } from "./bottomBar.js";
import { panCameraToUnit, getCameraTargetForUnit } from "../render/camera.js";

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

export function enterAttackTargetMode(scene, unit) {
  clearActionBar(scene);
  scene.attackTargetMode = true;
  scene._pendingAttacker = unit;
  clearHighlights(scene);
  highlightPositionSet(scene, scene.game_.getAttackablePositions(unit.id), 0xdd4444, 0.4);
}

// Compass slots around the unit — confirmed against a real screenshot of the
// commercial game (not in the open-source project_aeii repo at all — that one's a
// plain centered horizontal row). Move is always "left" and standby always "top"
// when both are shown; whatever other actions apply (attack, occupy, repair, buy,
// summon) fill "right" first, then the corners, in priority order — e.g. a
// commander on his own castle with no enemy in range gets buy on the RIGHT (not a
// fixed slot), because attack isn't available to compete for it that turn.
const RADIUS = TILE_SIZE * 0.95;
const BUTTON_RADIUS = 20;
const ICON_CLEARANCE = BUTTON_RADIUS + 2; // button radius + a small gap, for clamping to stay on-board
const SLOT_OFFSET = {
  top: { x: 0, y: -RADIUS },
  topRight: { x: RADIUS * 0.7, y: -RADIUS * 0.7 },
  right: { x: RADIUS, y: 0 },
  bottomRight: { x: RADIUS * 0.7, y: RADIUS * 0.7 },
  // bottom: reserved for heal/resurrect once that logic exists
  bottomLeft: { x: -RADIUS * 0.7, y: RADIUS * 0.7 },
  left: { x: -RADIUS, y: 0 },
  topLeft: { x: -RADIUS * 0.7, y: -RADIUS * 0.7 },
};
const OTHER_ACTION_SLOT_ORDER = ["right", "topRight", "topLeft", "bottomRight", "bottomLeft"];

/**
 * The contextual icon bar shown once a unit has confirmed its position
 * (moved, or chose to stay put) — positions icons in compass slots around
 * the unit itself instead of the original's centered bottom row.
 */
export function showActionBar(scene, unit, x, y) {
  clearActionBar(scene);
  scene.actionBarOpen = true;
  scene.actionBarUnitId = unit.id;

  const tile = scene.game_.getTileAt(x, y);
  const attackable = getAttackableEnemyPositions(scene, unit);
  const canOccupy = scene.game_.canOccupyTile(unit.id, x, y);
  // Buying via the action bar is gated to the commander/king specifically -
  // shared/game-state.js's canBuyUnit only checks tile ownership (any friendly
  // unit could technically trigger it), but the action-bar button itself should
  // only appear when the king is the one standing on the castle. Any other
  // friendly unit occupying the castle gets no purchase option here; buying
  // with the castle empty instead goes through the direct tile-click shortcut
  // in input/boardInput.js (handleUnitSelectionClick).
  const canBuyHere = tile.castle && tile.team === unit.team && unit.isCommander;

  const otherActions = [];
  if (attackable.length > 0) {
    otherActions.push({ frame: ACTION_ICON.ATTACK, onClick: () => enterAttackTargetMode(scene, unit) });
  }
  if (canOccupy) {
    otherActions.push({
      frame: ACTION_ICON.OCCUPY,
      onClick: () => {
        scene.game_.occupy(unit.id, x, y);
        refreshTileTexture(scene, x, y);
        finishUnitAction(scene, unit);
      },
    });
  }
  if (canBuyHere) {
    otherActions.push({
      frame: ACTION_ICON.BUY,
      onClick: () => {
        clearActionBar(scene);
        showBuyMenu(scene);
        finishUnitAction(scene, unit);
      },
    });
  }

  const slots = [];
  if (otherActions.length === 0) {
    // Nothing to actually choose between — standby is the only real action, so
    // there's no point offering "move" as a reconsideration alongside it.
    slots.push({ slot: "top", frame: ACTION_ICON.STANDBY, onClick: () => finishUnitAction(scene, unit) });
  } else {
    slots.push({ slot: "left", frame: STAT_ICON.MOVE, onClick: () => handleActionBarCancelClick(scene) });
    otherActions.forEach((action, i) => {
      slots.push({ ...action, slot: OTHER_ACTION_SLOT_ORDER[i] ?? "right" });
    });
    slots.push({ slot: "top", frame: ACTION_ICON.STANDBY, onClick: () => finishUnitAction(scene, unit) });
  }

  const cx = unit.x * TILE_SIZE + TILE_SIZE / 2;
  const cy = unit.y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y;

  panCameraToUnit(scene, unit);
  // The camera pan (above) is what actually solves icon overflow now — icons are
  // free to land in the black area beyond the board, since the camera brings that
  // space into view around the unit. This clamp is just a final safety net against
  // the post-pan viewport itself, not the board's edges.
  const { scrollX, scrollY } = getCameraTargetForUnit(scene, unit);
  const viewLeft = scrollX + ICON_CLEARANCE;
  const viewRight = scrollX + scene.cameras.main.width - ICON_CLEARANCE;
  const viewTop = scrollY + BOARD_OFFSET_Y + ICON_CLEARANCE; // never render over the top stats bar
  const viewBottom = scrollY + (scene.cameras.main.height - BOTTOM_BAR_HEIGHT) - ICON_CLEARANCE;

  scene.actionBarContainer = scene.add.container(0, 0);
  scene.actionBarContainer.setDepth(DEPTH.ACTION_BAR);

  slots.forEach(({ slot, frame, onClick }, i) => {
    const offset = SLOT_OFFSET[slot];
    const targetX = Math.max(viewLeft, Math.min(viewRight, cx + offset.x));
    const targetY = Math.max(viewTop, Math.min(viewBottom, cy + offset.y));

    const bg = scene.add.circle(cx, cy, BUTTON_RADIUS, 0x222222, 0.9).setStrokeStyle(2, 0xffffff);
    // Arc/Circle shapes' default setInteractive() (no explicit shape/callback)
    // builds its hit area as a plain Rectangle sized to the object's bounding
    // box, but that rectangle - like every Phaser hitArea - is anchored to the
    // TOP-LEFT of the bounding box, ignoring the shape's own origin. An earlier
    // pass at this fix used Circle(0, 0, BUTTON_RADIUS), assuming (0,0) meant
    // "the shape's own center" - it doesn't; (0,0) is the top-left corner, so
    // that put the hit-circle's center a full radius up-and-left of the actual
    // button, which is worse than the original bug, not a fix of it. The
    // correct center in that top-left-anchored space is (radius, radius) -
    // matching Phaser's own docs example for a circular hit area.
    bg.setInteractive(new Phaser.Geom.Circle(BUTTON_RADIUS, BUTTON_RADIUS, BUTTON_RADIUS), Phaser.Geom.Circle.Contains);
    const iconImg = scene.add.image(cx, cy, "icons_action", frame);
    iconImg.setDisplaySize(32, 32); // was 24 — too much padding inside the 40px circle
    // pointerup (not pointerdown) to match the tile sprites underneath (see
    // render/tiles.js), and stopPropagation so that same tile's own pointerup
    // handler doesn't also fire and cancel the action bar out from under this click.
    bg.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      onClick();
    });
    scene.actionBarContainer.add([bg, iconImg]);

    // Pop out from the unit's center to its compass slot, staggered per button —
    // with exactly 3 buttons active the resting positions form a visible triangle.
    bg.setScale(0.3);
    iconImg.setScale(0.3);
    scene.tweens.add({
      targets: [bg, iconImg],
      x: targetX,
      y: targetY,
      scale: 1,
      duration: 180,
      delay: i * 40,
      ease: "Back.Out",
    });
  });
}