import Phaser from "phaser";
import { MENU_WIDTH, MENU_HEIGHT } from "../constants.js";

// Colors sampled directly from a real screenshot of the mobile reskin's own
// main menu (navy panel, mid-grey beveled buttons) - see the button-row
// helper below for how the bevel itself is approximated (plain Graphics
// rects, since there's no matching 9-slice asset in this repo for this
// specific panel style - ui/dialogs.js's "border" texture is a different,
// thinner corner-bracket look, sampled and rejected as a mismatch for this).
const PANEL_BG = 0x242b47;
const PANEL_BORDER = 0x4a5a8f;
const BUTTON_BG = 0x5e5e5e;
const BUTTON_BG_DISABLED = 0x3a3a3a;
const BUTTON_HIGHLIGHT = 0x8a8a8a;

const PANEL_WIDTH = 300;
const ROW_HEIGHT = 42;
const ROW_GAP = 8;
const ROW_PADDING = 16;

/**
 * Entry point scene - styled after the mobile reskin's own main menu (see
 * the screenshot this was built from). Shows the full button list from that
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

    const g = this.add.graphics();
    g.fillStyle(PANEL_BG, 1);
    g.fillRoundedRect(panelX, panelY, PANEL_WIDTH, panelHeight, 6);
    g.lineStyle(2, PANEL_BORDER, 1);
    g.strokeRoundedRect(panelX, panelY, PANEL_WIDTH, panelHeight, 6);

    entries.forEach((entry, i) => {
      const rowX = panelX + ROW_PADDING;
      const rowY = panelY + ROW_PADDING + i * (ROW_HEIGHT + ROW_GAP);
      const rowWidth = PANEL_WIDTH - ROW_PADDING * 2;
      this.addMenuButton(rowX, rowY, rowWidth, entry);
    });
  }

  /** One beveled button row - a plain filled rect with a lighter top/left
   * edge to fake a raised look (no bevel/gradient asset available for this
   * specific style), white bold text when enabled, dimmed and
   * non-interactive when not. */
  addMenuButton(x, y, w, { label, enabled, target }) {
    const g = this.add.graphics();
    g.fillStyle(enabled ? BUTTON_BG : BUTTON_BG_DISABLED, 1);
    g.fillRoundedRect(x, y, w, ROW_HEIGHT, 4);
    if (enabled) {
      g.lineStyle(1, BUTTON_HIGHLIGHT, 0.6);
      g.strokeRoundedRect(x, y, w, ROW_HEIGHT, 4);
    }

    const text = this.add
      .text(x + w / 2, y + ROW_HEIGHT / 2, label, {
        fontSize: "17px",
        color: enabled ? "#ffffff" : "#777777",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    if (!enabled) return;

    // A generous invisible hit zone over the whole row (not just the text
    // glyphs) - matches how every other button in this project's menus
    // works, since a Phaser Text object's own hit area is exactly its
    // rendered text bounds otherwise, which reads as a much smaller and
    // less forgiving click target than the visible button row.
    const hitZone = this.add.zone(x, y, w, ROW_HEIGHT).setOrigin(0, 0).setInteractive();
    hitZone.on("pointerup", () => this.scene.start(target));
  }
}
