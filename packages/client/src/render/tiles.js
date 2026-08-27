import { TILE_SIZE, BOARD_OFFSET_Y, DEPTH } from "../constants.js";

/** Draws the tile grid and wires each tile's click handler. Populates scene.tileSprites. */
/** Draws the tile grid and wires each tile's click handler. Populates scene.tileSprites. */
export function drawTileGrid(scene, onTileClick) {
  scene.tileSprites = [];
  for (let x = 0; x < scene.game_.width; x++) {
    scene.tileSprites.push([]);
    for (let y = 0; y < scene.game_.height; y++) {
      const tile = scene.game_.getTileAt(x, y);
      const sprite = scene.add.image(
        x * TILE_SIZE + TILE_SIZE / 2,
        y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y,
        `tile_${tile.index}`
      );
      sprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
      sprite.setInteractive();
      // Fires on release, not press, and is skipped if the press turned into a
      // camera drag (see input/cameraDrag.js) — otherwise a drag starting on a
      // tile would also select/move a unit underneath the pan.
      sprite.on("pointerup", () => {
        if (scene.isCameraDragging && scene.isCameraDragging()) return;
        onTileClick(x, y);
      });
      scene.tileSprites[x].push(sprite);
    }
  }

  // Second pass — top-tile overlays (castle towers, etc). Added after every base
  // tile, so they render on top of the row above them; not interactive, so they
  // never intercept that row's own click. Guard y > 0: nothing to draw into above
  // row 0's edge.
  for (let x = 0; x < scene.game_.width; x++) {
    for (let y = 1; y < scene.game_.height; y++) {
      const tile = scene.game_.getTileAt(x, y);
      if (tile.topTileIndex === -1 || tile.topTileIndex == null) continue;
      scene.add.image(
        x * TILE_SIZE + TILE_SIZE / 2,
        (y - 1) * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y,
        `top_tile_${tile.topTileIndex}`
      ).setDisplaySize(TILE_SIZE, TILE_SIZE);
    }
  }
}

/** Re-textures one tile in place — used after a capture changes its tile index. */
export function refreshTileTexture(scene, x, y) {
  scene.tileSprites[x][y].setTexture(`tile_${scene.game_.getTileAt(x, y).index}`);
}

export function clearHighlights(scene) {
  for (const rect of scene.highlightRects) rect.destroy();
  scene.highlightRects = [];
  // The red move-path preview (input/boardInput.js) is tracked separately from
  // the yellow movable-range highlights so it can be redrawn on its own without
  // disturbing the range — but every existing clearHighlights() call site expects
  // a full "wipe the board's highlight state" reset, so it's cleared here too.
  for (const rect of scene.pathPreviewRects ?? []) rect.destroy();
  scene.pathPreviewRects = [];
}

/** Adds one semi-transparent highlight square at board position (x, y) and tracks it for later clearing. */
export function addHighlight(scene, x, y, color = 0xffffff, alpha = 0.3) {
  const rect = scene.add.rectangle(
    x * TILE_SIZE + TILE_SIZE / 2,
    y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y,
    TILE_SIZE - 2,
    TILE_SIZE - 2,
    color,
    alpha
  );
  scene.highlightRects.push(rect);
  return rect;
}

/** Highlights every position in a Set of "x,y" keys (as returned by GameState.getMovablePositions). */
export function highlightPositionSet(scene, positions, color = 0xffffff, alpha = 0.3) {
  for (const key of positions) {
    const [x, y] = key.split(",").map(Number);
    addHighlight(scene, x, y, color, alpha);
  }
}

 /** Marks whichever unit's stats are currently shown — the existing square-bracket
 * selection cursor (cursor_normal.png, ported from the original's CursorAnimator),
 * used here for a plain tile click/selection. Pulses between its two frames every
 * 300ms via updateSelectedTileHighlight(). Tracked/cleared independently of the
 * movement-range highlight. */
export function highlightSelectedTile(scene, x, y) {
  showCursor(scene, x, y, "cursor_normal");
}

/** Shared cursor-sprite machinery for highlightSelectedTile (square, plain tile
 * click), previewMovePath's target cursor (square+cross, see input/boardInput.js),
 * and the attack-target cursor (ring, see input/boardInput.js's
 * handleAttackTargetClick) — same pulse-by-frame convention throughout (frame
 * count varies per sheet — cursor_attack.png has 3 — so updateSelectedTileHighlight
 * mods by the sprite's own frame total rather than a fixed 2), just a different
 * texture per mode. */
export function showCursor(scene, x, y, textureKey) {
  clearSelectedTileHighlight(scene);

  // Original: size = ts * 26/24, centered — the cursor is slightly larger than
  // the tile so it overflows the edges a bit, matching the reference screenshot.
  const size = (TILE_SIZE * 26) / 24;
  const cx = x * TILE_SIZE + TILE_SIZE / 2;
  const cy = y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y;

  const sprite = scene.add.sprite(cx, cy, textureKey, 0);
  sprite.setDisplaySize(size, size);
  // See constants.js DEPTH - must render above units (render/units.js recreates
  // unit sprites on nearly every action, which would otherwise re-climb above a
  // depthless cursor, same underlying issue as the earlier stats-bar layering fix).
  sprite.setDepth(DEPTH.CURSOR);
  scene.selectedTileHighlight = sprite;
}

/** Advances the selection cursor's pulse frame — same 300ms/frame convention as
 * animateUnits(), matching the original's 0.3f CursorAnimator. Call from the scene's
 * update() loop. Mods by the sprite's own texture frame count rather than a fixed
 * 2, since cursor_attack.png (the attack-target cursor) has 3 frames, not 2. */
export function updateSelectedTileHighlight(scene, elapsedMs) {
  if (!scene.selectedTileHighlight) return;
  const frameCount = scene.selectedTileHighlight.texture.frameTotal - 1; // frameTotal includes Phaser's implicit __BASE frame
  const frame = Math.floor(elapsedMs / 300) % frameCount;
  scene.selectedTileHighlight.setFrame(frame);
}

export function clearSelectedTileHighlight(scene) {
  if (scene.selectedTileHighlight) {
    scene.selectedTileHighlight.destroy();
    scene.selectedTileHighlight = null;
  }
}