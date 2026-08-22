import { TILE_SIZE } from "../constants.js";

/** Draws the tile grid and wires each tile's click handler. Populates scene.tileSprites. */
export function drawTileGrid(scene, onTileClick) {
  scene.tileSprites = [];
  for (let x = 0; x < scene.game_.width; x++) {
    scene.tileSprites.push([]);
    for (let y = 0; y < scene.game_.height; y++) {
      const tile = scene.game_.getTileAt(x, y);
      const sprite = scene.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, `tile_${tile.index}`);
      sprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
      sprite.setInteractive();
      sprite.on("pointerdown", () => onTileClick(x, y));
      scene.tileSprites[x].push(sprite);
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
    y * TILE_SIZE + TILE_SIZE / 2,
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
