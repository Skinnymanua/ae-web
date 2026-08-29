import Phaser from "phaser";

/** Entry point scene - just a title and a way into Skirmish setup for now.
 * Sized independently of any map (see main.js), unlike the old bootstrap
 * that sized the whole game canvas around whichever map BoardScene happened
 * to hardcode - now that map choice happens at runtime (SkirmishSetupScene),
 * nothing here can size itself around "the" map anymore. */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super("MenuScene");
  }

  create() {
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
