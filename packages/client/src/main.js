import Phaser from "phaser";
import { MenuScene } from "./scenes/MenuScene.js";
import { SkirmishSetupScene } from "./scenes/SkirmishSetupScene.js";
import { SkirmishSettingsScene } from "./scenes/SkirmishSettingsScene.js";
import { BoardScene } from "./scenes/BoardScene.js";
import { MENU_WIDTH, MENU_HEIGHT } from "./constants.js";

// Fixed viewport for the menu flow (see constants.js's MENU_WIDTH/HEIGHT) -
// map choice happens at runtime in SkirmishSetupScene, and BoardScene itself
// resizes the canvas dynamically to fit whichever map gets chosen (see its
// own create()), so this is only ever the STARTING size, not a permanent one.
new Phaser.Game({
  type: Phaser.AUTO,
  width: MENU_WIDTH,
  height: MENU_HEIGHT,
  parent: "game",
  backgroundColor: "#222222",
  scene: [MenuScene, SkirmishSetupScene, SkirmishSettingsScene, BoardScene],
});
