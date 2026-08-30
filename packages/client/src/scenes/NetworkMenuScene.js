import Phaser from "phaser";

/** Entry point into networked play - just routes to CreateGameScene or
 * JoinGameScene, neither of which connects a socket until the player
 * actually commits to one (no reason to hold a connection open just for
 * browsing this menu). */
export class NetworkMenuScene extends Phaser.Scene {
  constructor() {
    super("NetworkMenuScene");
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, height * 0.25, "Network Play", { fontSize: "28px", color: "#ffdd44", fontStyle: "bold" })
      .setOrigin(0.5);

    const createButton = this.add
      .text(width / 2, height * 0.45, "[ Create Game ]", { fontSize: "20px", color: "#44dd88" })
      .setOrigin(0.5)
      .setInteractive();
    createButton.on("pointerup", () => this.scene.start("CreateGameScene"));

    const joinButton = this.add
      .text(width / 2, height * 0.55, "[ Join Game ]", { fontSize: "20px", color: "#44aaff" })
      .setOrigin(0.5)
      .setInteractive();
    joinButton.on("pointerup", () => this.scene.start("JoinGameScene"));

    const backButton = this.add
      .text(width / 2, height * 0.7, "[ Back ]", { fontSize: "18px", color: "#dd4444" })
      .setOrigin(0.5)
      .setInteractive();
    backButton.on("pointerup", () => this.scene.start("MenuScene"));
  }
}
