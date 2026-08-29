import Phaser from "phaser";
import { MenuScene } from "./scenes/MenuScene.js";
import { SkirmishSetupScene } from "./scenes/SkirmishSetupScene.js";
import { BoardScene } from "./scenes/BoardScene.js";

// Fixed viewport now, independent of any particular map - map choice used to
// be hardcoded at boot (this file importing one specific map JSON just to
// size the canvas around it), but now happens at runtime in
// SkirmishSetupScene instead. BoardScene's own UI already sizes itself off
// the camera rather than the map (see ui/statsPanel.js/bottomBar.js's own
// "stretched bars" fix), and a map larger than this viewport scrolls via
// camera drag (input/cameraDrag.js), so there's nothing left here to size
// around a specific map's dimensions for.
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: "game",
  backgroundColor: "#222222",
  scene: [MenuScene, SkirmishSetupScene, BoardScene],
});
