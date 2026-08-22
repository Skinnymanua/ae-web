import Phaser from "phaser";
import { BoardScene } from "./scenes/BoardScene.js";

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: "game",
  backgroundColor: "#222222",
  scene: BoardScene,
});
