import Phaser from "phaser";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";

const PANEL_WIDTH = 300;
const ROW_HEIGHT = 42;
const ROW_GAP = 8;
const ROW_PADDING = 16;

/**
 * Entry point into networked play - just routes to CreateGameScene or
 * JoinGameScene, neither of which connects a socket until the player
 * actually commits to one (no reason to hold a connection open just for
 * browsing this menu). Styled with the same navy-panel + beveled-button
 * treatment as MenuScene.js (see ui/menuPanel.js) - the direct submenu
 * reached from that menu's own "Multiplayer" button, so it should read as
 * part of the same visual flow, not a different-looking screen.
 */
export class NetworkMenuScene extends Phaser.Scene {
  constructor() {
    super("NetworkMenuScene");
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, height * 0.15, "Network Play", { fontSize: "28px", color: "#e8e8e8", fontStyle: "bold" })
      .setOrigin(0.5);

    const entries = [
      { label: "Create Game", target: "CreateGameScene" },
      { label: "Join Game", target: "JoinGameScene" },
      { label: "Back", target: "MenuScene" },
    ];

    const panelHeight = entries.length * ROW_HEIGHT + (entries.length - 1) * ROW_GAP + ROW_PADDING * 2;
    const panelX = width / 2 - PANEL_WIDTH / 2;
    const panelY = height * 0.32;

    drawMenuPanel(this, panelX, panelY, PANEL_WIDTH, panelHeight);

    entries.forEach((entry, i) => {
      const rowX = panelX + ROW_PADDING;
      const rowY = panelY + ROW_PADDING + i * (ROW_HEIGHT + ROW_GAP);
      const rowWidth = PANEL_WIDTH - ROW_PADDING * 2;
      addMenuButton(this, rowX, rowY, rowWidth, ROW_HEIGHT, {
        label: entry.label,
        onClick: () => this.scene.start(entry.target),
      });
    });
  }
}
