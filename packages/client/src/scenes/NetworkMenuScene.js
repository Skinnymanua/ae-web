import Phaser from "phaser";
import { drawCornerBracketPanel, addTitleBar, addMenuButton, addCircleButton } from "../ui/menuPanel.js";

const PANEL_WIDTH = 300;
const PANEL_Y = 96;
const TITLE_BAR_HEIGHT = 44;
const ROW_HEIGHT = 42;
const ROW_GAP = 10;
const ROW_PADDING = 16;

/**
 * Entry point into networked play - just routes to CreateGameScene or
 * JoinGameScene, neither of which connects a socket until the player
 * actually commits to one (no reason to hold a connection open just for
 * browsing this menu).
 *
 * Restyled with the circular-button kit (ui/menuPanel.js's addTitleBar/
 * drawCornerBracketPanel/addCircleButton) to match the Skirmish flow's own
 * redesign (SkirmishSetupScene/SkirmishSettingsScene) - this is the direct
 * multiplayer counterpart of that flow's entry screen, so it should look
 * like the same design language, not the older flat navy-panel style. The
 * two nav rows stay plain addMenuButton rows (not circular) - same
 * reasoning as GameSettingScene's "Game Setting" button: a labeled
 * navigation action reads better as a full-width row than a small icon.
 */
export class NetworkMenuScene extends Phaser.Scene {
  constructor() {
    super("NetworkMenuScene");
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x1a1a1a).setOrigin(0, 0);

    const panelX = width / 2 - PANEL_WIDTH / 2;

    addTitleBar(this, panelX, 24, PANEL_WIDTH, TITLE_BAR_HEIGHT, {
      title: "Multiplayer",
      onBack: () => this.scene.start("MenuScene"),
    });

    const entries = [
      { label: "Create Game", target: "CreateGameScene" },
      { label: "Join Game", target: "JoinGameScene" },
    ];
    const panelHeight = entries.length * ROW_HEIGHT + (entries.length - 1) * ROW_GAP + ROW_PADDING * 2;

    drawCornerBracketPanel(this, panelX, PANEL_Y, PANEL_WIDTH, panelHeight);

    entries.forEach((entry, i) => {
      const rowX = panelX + ROW_PADDING;
      const rowY = PANEL_Y + ROW_PADDING + i * (ROW_HEIGHT + ROW_GAP);
      addMenuButton(this, rowX, rowY, PANEL_WIDTH - ROW_PADDING * 2, ROW_HEIGHT, {
        label: entry.label,
        onClick: () => this.scene.start(entry.target),
      });
    });

    const radius = 32;
    addCircleButton(this, radius + 20, height - radius - 20, radius, {
      icon: "back",
      onClick: () => this.scene.start("MenuScene"),
    });
  }
}
