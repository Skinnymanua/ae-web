import Phaser from "phaser";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";
import { getMenuSize } from "../constants.js";

const PANEL_WIDTH = 300;
const ROW_HEIGHT = 42;
const ROW_GAP = 8;
const ROW_PADDING = 16;
const ICON_SIZE = 25; // icons_main_menu.png's native per-frame size - see preload() below
const TITLE_BLOCK_HEIGHT = 70; // title + subtitle, see #layout below
const TITLE_TO_PANEL_GAP = 30;
const BG_NATIVE_WIDTH = 320; // main_menu_background.png's own pixel dimensions
const BG_NATIVE_HEIGHT = 224;
const BG_MAX_SCALE = 1; // cap how far a big desktop window upscales it - stays crisp pixel art, not a blurry stretch

/**
 * Entry point scene - styled after the mobile reskin's own main menu (see
 * ui/menuPanel.js for the shared navy-panel + beveled-button styling this
 * was originally built from). main_menu_background.png is a single
 * illustrated scene (a castle doorway) supplied directly for this screen -
 * rendered as ONE image, scaled UNIFORMLY to fit within the canvas (never
 * cropped, never stretched non-uniformly to fill it edge-to-edge - see
 * #create's scale calculation) and centered, with the plain dark fill
 * showing around it wherever it doesn't reach. This replaced an earlier,
 * much smaller placeholder strip that had to be tiled to cover the screen
 * at all; a full scene like this one is meant to be seen as one picture,
 * not repeated.
 *
 * Also still pulls in icons_main_menu.png (a 10-frame, 25x25-per-icon strip
 * - MainMenu's per-category icon set, plus the settings gear
 * MainMenuScreen's own CircleButton uses at frame 4). Button order matches
 * the original's actual sequence (Skirmish first, not Campaign) - see
 * MainMenu#initComponents.
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
 * Sized to whatever getMenuSize() returns (see constants.js) - that now
 * matches the DEVICE's own aspect ratio instead of forcing a fixed 800x600
 * shape onto every screen, so the title+panel block below is positioned by
 * #layout as a group CENTERED in the available height rather than at fixed
 * height-ratio offsets - those looked fine on a roughly-4:3 canvas but left
 * a large empty band at the bottom on a portrait phone's much taller one.
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
    // time (not fixed constants) so a phone-sized viewport keeps getting
    // its own actual shape on every re-entry, not just at boot - see
    // constants.js's getMenuSize().
    const { width: menuWidth, height: menuHeight } = getMenuSize();
    this.scale.resize(menuWidth, menuHeight);
    this.cameras.main.setSize(menuWidth, menuHeight);

    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x1a1a1a).setOrigin(0, 0);

    // Uniform scale (same factor both axes, so nothing distorts) that fits
    // the image within the canvas - never upscaled past BG_MAX_SCALE (a big
    // desktop window shouldn't blow this up into a blurry mess), never
    // cropped or stretched to fill edge-to-edge on a differently-shaped
    // canvas either. Centered in whatever space that leaves.
    const bgScale = Math.min(BG_MAX_SCALE, width / BG_NATIVE_WIDTH, height / BG_NATIVE_HEIGHT);
    this.add.image(width / 2, height / 2, "main_menu_background").setScale(bgScale);

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

    const panelWidth = Math.min(PANEL_WIDTH, width - 40);
    const panelHeight = entries.length * ROW_HEIGHT + (entries.length - 1) * ROW_GAP + ROW_PADDING * 2;

    // Title + panel treated as one block and centered as a group in the
    // available height (with a floor so it never gets pushed above the top
    // edge on a very short canvas), instead of each piece sitting at its
    // own fixed height-ratio offset - that's what left extra vertical
    // space unused rather than distributed around the content on a tall
    // portrait canvas.
    const blockHeight = TITLE_BLOCK_HEIGHT + TITLE_TO_PANEL_GAP + panelHeight;
    const blockTop = Math.max(30, (height - blockHeight) / 2);
    const titleY = blockTop;
    const panelY = blockTop + TITLE_BLOCK_HEIGHT + TITLE_TO_PANEL_GAP;
    const panelX = width / 2 - panelWidth / 2;

    this.add
      .text(width / 2, titleY, "Ancient Empires Reloaded", {
        fontSize: "34px",
        color: "#e8e8e8",
        fontStyle: "bold",
      })
      .setOrigin(0.5, 0);
    this.add
      .text(width / 2, titleY + 42, "- Online -", {
        fontSize: "18px",
        color: "#aaaaaa",
      })
      .setOrigin(0.5, 0);

    drawMenuPanel(this, panelX, panelY, panelWidth, panelHeight);

    entries.forEach((entry, i) => {
      const rowX = panelX + ROW_PADDING;
      const rowY = panelY + ROW_PADDING + i * (ROW_HEIGHT + ROW_GAP);
      const rowWidth = panelWidth - ROW_PADDING * 2;
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
