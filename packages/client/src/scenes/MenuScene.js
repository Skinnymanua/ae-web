import Phaser from "phaser";
import { MENU_WIDTH, MENU_HEIGHT } from "../constants.js";

/** Entry point scene - just a title and a way into Skirmish setup for now.
 * Sized independently of any map (see constants.js's MENU_WIDTH/HEIGHT),
 * unlike the old bootstrap that sized the whole game canvas around whichever
 * map BoardScene happened to hardcode - now that map choice happens at
 * runtime (SkirmishSetupScene) and BoardScene resizes the canvas dynamically
 * to fit it, nothing here can size itself around "the" map anymore. */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super("MenuScene");
  }

  create() {
    // Explicit resize back to the fixed menu size - guards against landing
    // here after BoardScene resized the canvas to fit a map (no "back to
    // menu" button exists yet, but this makes that safe to add later).
    this.scale.resize(MENU_WIDTH, MENU_HEIGHT);
    this.cameras.main.setSize(MENU_WIDTH, MENU_HEIGHT);

    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, height * 0.3, "Ancient Empires", {
        fontSize: "32px",
        color: "#ffdd44",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    const skirmishButton = this.add
      .text(width / 2, height * 0.5, "[ Skirmish ]", {
        fontSize: "20px",
        color: "#44dd88",
      })
      .setOrigin(0.5)
      .setInteractive();

    // pointerup (not pointerdown) - matches the same click-leak fix applied
    // throughout ui/dialogs.js: a pointerdown here would destroy nothing (no
    // container to tear down on this simple a screen), but staying
    // consistent with the established convention costs nothing and avoids
    // relearning the lesson if this scene ever grows a container to destroy.
    skirmishButton.on("pointerup", () => {
      this.scene.start("SkirmishSetupScene");
    });
  }
}
