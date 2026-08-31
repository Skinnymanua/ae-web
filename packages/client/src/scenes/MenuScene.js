import Phaser from "phaser";
import { MENU_WIDTH, MENU_HEIGHT } from "../constants.js";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";

const PANEL_WIDTH = 300;
const ROW_HEIGHT = 42;
const ROW_GAP = 8;
const ROW_PADDING = 16;

/**
 * Entry point scene - styled after the mobile reskin's own main menu (see
 * ui/menuPanel.js for the shared navy-panel + beveled-button styling this
 * was originally built from). Shows the full button list from that
 * reference for recognizability, but only Skirmish and Multiplayer actually
 * go anywhere - Campaign, Load Game, Tools, and Account aren't built (see
 * the project-wide gap summary: no AI/campaign mode, no save/load, no
 * account system), and Help doesn't have any content to show yet either.
 * Those five render visibly disabled (dimmed, non-interactive) rather than
 * as dead buttons that look like they should do something - matching this
 * project's general stance on not shipping controls that don't work (see
 * the turn-gating fix a few turns back for the same principle applied to
 * board interaction).
 *
 * Sized independently of any map (see constants.js's MENU_WIDTH/HEIGHT),
 * unlike the old bootstrap that sized the whole game canvas around whichever
 * map BoardScene happened to hardcode - now that map choice happens at
 * runtime (SkirmishSetupScene) and BoardScene resizes the canvas dynamically
 * to fit it, nothing here can size itself around "the" map anymore.
 */
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
      .text(width / 2, height * 0.1, "Ancient Empires", {
        fontSize: "34px",
        color: "#e8e8e8",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height * 0.1 + 42, "- Reloaded -", {
        fontSize: "18px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5);

    const entries = [
      { label: "Campaign", enabled: false },
      { label: "Skirmish", enabled: true, target: "SkirmishSetupScene" },
      { label: "Multiplayer", enabled: true, target: "NetworkMenuScene" },
      { label: "Load Game", enabled: false },
      { label: "Tools", enabled: false },
      { label: "Account", enabled: false },
      { label: "Help", enabled: false },
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
        enabled: entry.enabled,
        onClick: entry.target ? () => this.scene.start(entry.target) : undefined,
      });
    });
  }
}
