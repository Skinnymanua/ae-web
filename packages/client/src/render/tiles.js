import { TILE_SIZE, BOARD_OFFSET_Y } from "../constants.js";

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

 /** Marks whichever unit's stats are currently shown — the same pink diamond selection
 * cursor as the original (CursorAnimator / cursor_normal.png), pulsing between its two
 * frames every 300ms via updateSelectedTileHighlight(). Tracked/cleared independently
 * of the movement-range highlight. */
export function highlightSelectedTile(scene, x, y) {
  clearSelectedTileHighlight(scene);

  // Original: size = ts * 26/24, centered — the cursor is slightly larger than
  // the tile so it overflows the edges a bit, matching the reference screenshot.
  const size = (TILE_SIZE * 26) / 24;
  const cx = x * TILE_SIZE + TILE_SIZE / 2;
  const cy = y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y;

  const sprite = scene.add.sprite(cx, cy, "cursor_normal", 0);
  sprite.setDisplaySize(size, size);
  scene.selectedTileHighlight = sprite;
}

/** Advances the selection cursor's pulse frame — same 300ms/frame convention as
 * animateUnits(), matching the original's 0.3f CursorAnimator. Call from the scene's
 * update() loop. */
export function updateSelectedTileHighlight(scene, elapsedMs) {
  if (!scene.selectedTileHighlight) return;
  const frame = Math.floor(elapsedMs / 300) % 2;
  scene.selectedTileHighlight.setFrame(frame);
}

export function clearSelectedTileHighlight(scene) {
  if (scene.selectedTileHighlight) {
    scene.selectedTileHighlight.destroy();
    scene.selectedTileHighlight = null;
  }
}