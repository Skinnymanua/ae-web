import Phaser from "phaser";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";
import { getMenuSize } from "../constants.js";

const PANEL_WIDTH = 300;
const ROW_HEIGHT = 42;
const ROW_GAP = 8;
const ROW_PADDING = 16;
const ICON_SIZE = 25; // icons_main_menu.png's native per-frame size - see preload() below

/**
 * Entry point scene - styled after the mobile reskin's own main menu (see
 * ui/menuPanel.js for the shared navy-panel + beveled-button styling this
 * was originally built from), now also pulling in the two menu-specific
 * assets that sat unused in public/images since this was first built:
 * main_menu_background.png (a tileable 20x100 strip - MainMenuScreen#draw's
 * background texture, stretched full-screen there; tiled here instead
 * since a strip this narrow would smear badly stretched to a full 800px+
 * width) and icons_main_menu.png (a 10-frame, 25x25-per-icon strip -
 * MainMenu's per-category icon set, plus the settings gear
 * MainMenuScreen's own CircleButton uses at frame 4). Button order now
 * matches the original's actual sequence (Skirmish first, not Campaign) -
 * see MainMenu#initComponents.
 *
 * Shows the full button list from that reference for recognizability, but
 * only Skirmish and Multiplayer actually go anywhere - Campaign, Load Game,
 * Tools, and Account aren't built (see the project-wide gap summary: no
 * AI/campaign mode, no save/load, no account system), and Help doesn't have
 * any content to show yet either. Those five render visibly disabled
 * (dimmed, non-interactive) rather than as dead buttons that look like they
 * should do something - matching this project's general stance on not
 * shipping controls that don't work (see the turn-gating fix a few turns
 * back for the same principle applied to board interaction).
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

  preload() {
    this.load.image("main_menu_background", "/images/main_menu_background.png");
    this.load.spritesheet("icons_main_menu", "/images/icons_main_menu.png", {
      frameWidth: ICON_SIZE,
      frameHeight: ICON_SIZE,
    });
  }

  create() {
    // Explicit resize back to the menu size - guards against landing here
    // after BoardScene resized the canvas to fit a map. Recomputed each
    // time (not the plain MENU_WIDTH/HEIGHT constants) so a phone-sized
    // viewport keeps getting the shrunk-to-fit size on every re-entry, not
    // just at boot - see constants.js's getMenuSize().
    const { width: menuWidth, height: menuHeight } = getMenuSize();
    this.scale.resize(menuWidth, menuHeight);
    this.cameras.main.setSize(menuWidth, menuHeight);

    const { width, height } = this.cameras.main;
    // Tiled, not stretched - the source strip is only 20x100, and stretching
    // that thin a texture across an 800px+ wide canvas would smear it badly.
    this.add.tileSprite(0, 0, width, height, "main_menu_background").setOrigin(0, 0);

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

    // Order and icon-frame numbers matched to MainMenu#initComponents'
    // actual button sequence and icons_main_menu.png's left-to-right icon
    // art (crossed swords, banner, globe, wrench+screwdriver, ..., floppy
    // disk, speech bubble) - iconFrame omitted where nothing in that strip
    // reads as a sensible match (Account has no equivalent in the original
    // menu at all).
    const entries = [
      { label: "Skirmish", enabled: true, target: "SkirmishSetupScene", iconFrame: 0 },
      { label: "Campaign", enabled: false, iconFrame: 1 },
      { label: "Multiplayer", enabled: true, target: "NetworkMenuScene", iconFrame: 2 },
      { label: "Load Game", enabled: false, iconFrame: 5 },
      { label: "Tools", enabled: false, iconFrame: 3 },
      { label: "Account", enabled: false },
      { label: "Help", enabled: false, iconFrame: 6 },
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

      if (entry.iconFrame !== undefined) {
        this.add
          .sprite(rowX + ROW_PADDING, rowY + ROW_HEIGHT / 2, "icons_main_menu", entry.iconFrame)
          .setAlpha(entry.enabled ? 1 : 0.4);
      }
    });
  }
}
