/**
 * Camera-follow for the acting unit. Not from the original (no camera scrolling
 * exists in project_aeii's GameScreen — it renders the whole map statically); this
 * is a bespoke addition so the action-bar icons always have room around the unit,
 * confirmed against a real screenshot of the commercial game where the visible
 * board region shifts to keep the acting unit centered.
 *
 * Only the board layer (tiles/units/highlights/cursor/action-bar icons) scrolls —
 * every HUD element (stats bar, bottom bar, dialogs, end-turn button) is
 * setScrollFactor(0) so it stays fixed on screen regardless of camera position.
 */
import { TILE_SIZE, BOARD_OFFSET_Y } from "../constants.js";
import { BOTTOM_BAR_HEIGHT } from "../ui/bottomBar.js";

// How far the camera is allowed to scroll past the board's own edges — enough to
// give action-bar icons room in the surrounding black space for an edge-adjacent
// unit, without pushing the board itself mostly out of view.
const OVERSCROLL = TILE_SIZE * 1.5;

function clampScroll(target, edgeA, edgeB) {
  const min = Math.min(edgeA, edgeB);
  const max = Math.max(edgeA, edgeB);
  return Math.max(min, Math.min(max, target));
}

/** The min/max scrollX/scrollY the camera is allowed to reach — same overscroll
 * allowance used by getCameraTargetForUnit, shared here so drag-panning clamps
 * to the same edges as the unit-follow camera. */
export function getScrollBounds(scene) {
  const cam = scene.cameras.main;
  const boardWidth = scene.game_.width * TILE_SIZE;
  const boardHeight = scene.game_.height * TILE_SIZE;
  const playableBottom = cam.height - BOTTOM_BAR_HEIGHT;

  return {
    minX: -OVERSCROLL,
    maxX: boardWidth - cam.width + OVERSCROLL,
    minY: -OVERSCROLL,
    maxY: BOARD_OFFSET_Y + boardHeight - playableBottom + OVERSCROLL,
  };
}

/** The scroll position that centers `unit` in the playable area (between the top
 * stats bar and bottom info bar), clamped. Shared by panCameraToUnit (to animate
 * it) and showActionBar (to know the final visible range for icon placement). */
export function getCameraTargetForUnit(scene, unit) {
  const cam = scene.cameras.main;
  const boardWidth = scene.game_.width * TILE_SIZE;
  const boardHeight = scene.game_.height * TILE_SIZE;
  const playableBottom = cam.height - BOTTOM_BAR_HEIGHT;
  const playableCenterY = (BOARD_OFFSET_Y + playableBottom) / 2;

  const unitWorldX = unit.x * TILE_SIZE + TILE_SIZE / 2;
  const unitWorldY = unit.y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y;

  const scrollX = clampScroll(unitWorldX - cam.width / 2, -OVERSCROLL, boardWidth - cam.width + OVERSCROLL);
  const scrollY = clampScroll(
    unitWorldY - playableCenterY,
    -OVERSCROLL,
    BOARD_OFFSET_Y + boardHeight - playableBottom + OVERSCROLL
  );
  return { scrollX, scrollY };
}

/** Smoothly scrolls the camera so `unit` sits centered in the playable area. */
export function panCameraToUnit(scene, unit) {
  const { scrollX, scrollY } = getCameraTargetForUnit(scene, unit);
  scene.tweens.add({
    targets: scene.cameras.main,
    scrollX,
    scrollY,
    duration: 250,
    ease: "Sine.InOut",
  });
}

/** Scrolls the camera back to its default resting position. */
export function resetCamera(scene) {
  scene.tweens.add({
    targets: scene.cameras.main,
    scrollX: 0,
    scrollY: 0,
    duration: 250,
    ease: "Sine.InOut",
  });
}