import Phaser from "phaser";
import { BoardScene } from "./scenes/BoardScene.js";
import { TILE_SIZE, BOARD_OFFSET_Y } from "./constants.js";
import { BOTTOM_BAR_HEIGHT } from "./ui/bottomBar.js";
import mapData from "./sample-map.json";

// Canvas is sized to the board itself (map width/height * TILE_SIZE) plus the
// top stats bar and bottom bar, instead of a fixed 800x600 — that fixed size
// used to leave a wide dead zone to the right of the board, which is where the
// bars used to stop short instead of reaching the edge of the game view.
new Phaser.Game({
  type: Phaser.AUTO,
  width: mapData.width * TILE_SIZE,
  height: BOARD_OFFSET_Y + mapData.height * TILE_SIZE + BOTTOM_BAR_HEIGHT,
  parent: "game",
  backgroundColor: "#222222",
  scene: BoardScene,
});
