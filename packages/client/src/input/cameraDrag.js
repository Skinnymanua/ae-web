import { getScrollBounds } from "../render/camera.js";

// Pointer must move at least this many pixels (from its down position) before a
// press counts as a drag rather than a tap — keeps ordinary tile clicks (handled
// by each tile sprite's own "pointerdown" in render/tiles.js) working normally.
const DRAG_THRESHOLD = 6;

/**
 * Wires click-and-drag camera panning onto the board. Not from the original
 * (project_aeii's GameScreen has no camera scrolling at all — see render/camera.js);
 * this is a bespoke addition so players can freely look around a board larger than
 * the viewport, on top of the existing unit-follow auto-pan.
 *
 * Implemented as a scene-level pointer listener (not a per-tile handler like
 * boardInput.js's clicks) since a drag can start on one tile and move over many.
 * Only scrolls scene.cameras.main — every HUD element is setScrollFactor(0) so it's
 * unaffected (see render/camera.js's header comment).
 */
export function setupCameraDrag(scene) {
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let camStartX = 0;
  let camStartY = 0;

  scene.input.on("pointerdown", (pointer) => {
    dragging = false; // becomes true only once DRAG_THRESHOLD is crossed
    dragStartX = pointer.x;
    dragStartY = pointer.y;
    camStartX = scene.cameras.main.scrollX;
    camStartY = scene.cameras.main.scrollY;
  });

  scene.input.on("pointermove", (pointer) => {
    if (!pointer.isDown) return;

    const dx = pointer.x - dragStartX;
    const dy = pointer.y - dragStartY;

    if (!dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragging = true;
      // A real drag is starting — stop any in-flight unit-follow pan so it
      // doesn't fight the player's own scrolling.
      scene.tweens.killTweensOf(scene.cameras.main);
    }

    const bounds = getScrollBounds(scene);
    const cam = scene.cameras.main;
    cam.scrollX = Math.max(bounds.minX, Math.min(bounds.maxX, camStartX - dx));
    cam.scrollY = Math.max(bounds.minY, Math.min(bounds.maxY, camStartY - dy));
  });

  const endDrag = () => {
    dragging = false;
  };
  scene.input.on("pointerup", endDrag);
  scene.input.on("pointerupoutside", endDrag);

  // Exposed so tile click handlers can tell a drag-release apart from a tap —
  // Phaser still fires the tile's own "pointerdown"/click on press, so without
  // this a drag would also trigger tile selection/movement underneath it.
  scene.isCameraDragging = () => dragging;
}
