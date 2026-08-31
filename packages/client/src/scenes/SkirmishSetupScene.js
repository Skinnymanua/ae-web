import Phaser from "phaser";
import { MAPS } from "../maps/index.js";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";
import { createScrollList } from "../ui/scrollList.js";
import {
  MAX_LEVEL_OPTIONS,
  STARTING_GOLD_OPTIONS,
  UNIT_CAPACITY_OPTIONS,
  PLAYER_COUNT_OPTIONS,
  DEFAULT_MAX_LEVEL,
  DEFAULT_STARTING_GOLD,
  DEFAULT_UNIT_CAPACITY,
  DEFAULT_PLAYER_COUNT,
} from "./skirmishSettings.js";

const COLUMN_WIDTH = 360;
const COLUMN_HEIGHT = 340;
const COLUMN_Y = 64;
const LEFT_COLUMN_X = 24;
const RIGHT_COLUMN_X = 404;
const COLUMN_PADDING = 16;

/**
 * Skirmish (local PvP) game creation: pick a map (auto-discovered from
 * maps/index.js - every .json file dropped in that folder shows up here,
 * no registration needed), then hands off to BoardScene via
 * scene.start("BoardScene", {...}) - see BoardScene#init for the receiving
 * end. The three game settings (max level/gold/units) live in their own
 * submenu now (SkirmishSettingsScene) rather than crowding this screen -
 * see #openSettings/init below for how the current values travel there and
 * back without resetting.
 *
 * Styled with the same navy-panel treatment as MenuScene.js/NetworkMenuScene.js
 * (see ui/menuPanel.js) for the static chrome (title, Settings/Start/Back
 * buttons) - the direct submenu reached from the main menu's own "Skirmish"
 * button, so it should read as part of the same visual flow. The map list
 * itself stays a plain selectable row list rather than becoming beveled
 * buttons too: it's a SELECTION control (one of several rows highlighted
 * at a time), a different interaction than a menu button's simple
 * enabled/disabled navigate-or-don't - just wrapped in a matching bordered
 * panel for visual consistency, and now scrollable (ui/scrollList.js) so it
 * doesn't overflow the panel's fixed height once more maps get added than
 * fit on screen at once.
 */
export class SkirmishSetupScene extends Phaser.Scene {
  constructor() {
    super("SkirmishSetupScene");
  }

  /** Restores whatever was passed back from SkirmishSettingsScene's "Back"
   * button, or starts fresh with defaults on a normal first entry from
   * MenuScene (data undefined then). */
  init(data) {
    this.selectedMapId = data?.selectedMapId ?? MAPS[0]?.id ?? null;
    this.maxLevelIndex = data?.maxLevelIndex ?? MAX_LEVEL_OPTIONS.indexOf(DEFAULT_MAX_LEVEL);
    this.startingGoldIndex = data?.startingGoldIndex ?? STARTING_GOLD_OPTIONS.indexOf(DEFAULT_STARTING_GOLD);
    this.unitCapacityIndex = data?.unitCapacityIndex ?? UNIT_CAPACITY_OPTIONS.indexOf(DEFAULT_UNIT_CAPACITY);
    this.playerCountIndex = data?.playerCountIndex ?? PLAYER_COUNT_OPTIONS.indexOf(DEFAULT_PLAYER_COUNT);
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, 24, "Skirmish Setup", { fontSize: "26px", color: "#e8e8e8", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    // Footer first - buildMapList's scroll list restores the previously
    // selected map (if any) by calling select(), which fires onSelect and
    // needs this.startButton to already exist to update its enabled state.
    this.buildFooter();
    this.buildSettingsSummary();
    this.buildMapList();
  }

  buildMapList() {
    drawMenuPanel(this, LEFT_COLUMN_X, COLUMN_Y, COLUMN_WIDTH, COLUMN_HEIGHT);

    const startX = LEFT_COLUMN_X + COLUMN_PADDING;
    const labelY = COLUMN_Y + COLUMN_PADDING;
    this.add.text(startX, labelY, "Select Map", { fontSize: "16px", color: "#cccccc" });

    if (MAPS.length === 0) {
      this.add.text(startX, labelY + 22, "(no maps found in src/maps/)", { fontSize: "13px", color: "#888888" });
      return;
    }

    const listY = labelY + 26;
    const listWidth = COLUMN_WIDTH - COLUMN_PADDING * 2;
    const listHeight = COLUMN_Y + COLUMN_HEIGHT - COLUMN_PADDING - listY;
    const rowHeight = 28;

    // createScrollList needs an actual Phaser container as its "parent" for
    // mask/hit-zone coordinate math (see its own doc comment) - this scene
    // doesn't otherwise use one (everything else is added straight to the
    // scene), so a bare wrapper at the scene's own origin (no offset)
    // satisfies that without restructuring the rest of the layout around it.
    const wrapper = this.add.container(0, 0);

    this.mapList = createScrollList(this, {
      parentContainer: wrapper,
      parentX: 0,
      parentY: 0,
      x: startX,
      y: listY,
      width: listWidth,
      height: listHeight,
      rowHeight,
      items: MAPS.map((map) => ({
        id: map.id,
        label: `${map.name}  (${map.width}x${map.height}, ${map.unitCount} units)`,
      })),
      onSelect: (item) => {
        this.selectedMapId = item?.id ?? null;
        this.startButton.setEnabled(!!this.selectedMapId);
      },
    });

    if (this.selectedMapId) this.mapList.select(this.selectedMapId);
    // No explicit this.mapList.destroy() needed here, unlike
    // ui/dialogs.js's showBuyMenu using the equivalent purchaseStrip: that
    // one closes WITHIN a long-lived BoardScene, so its global
    // scene.input listeners need manual removal. This list lives for the
    // whole duration of THIS scene - Phaser tears down a scene's own
    // InputPlugin (and everything registered on it) automatically when the
    // scene itself shuts down, e.g. navigating to Settings or starting the
    // game.
  }

  /** Read-only glance at the current settings (so you don't have to open the
   * submenu just to check them) plus the button into it. */
  buildSettingsSummary() {
    drawMenuPanel(this, RIGHT_COLUMN_X, COLUMN_Y, COLUMN_WIDTH, COLUMN_HEIGHT);

    const startX = RIGHT_COLUMN_X + COLUMN_PADDING;
    const startY = COLUMN_Y + COLUMN_PADDING + 22;
    this.add.text(startX, COLUMN_Y + COLUMN_PADDING, "Game Settings", { fontSize: "16px", color: "#cccccc" });

    this.settingsSummaryText = this.add.text(startX, startY, "", {
      fontSize: "14px",
      color: "#ffffff",
      lineSpacing: 10,
    });
    this.updateSettingsSummary();

    addMenuButton(this, startX, startY + 120, COLUMN_WIDTH - COLUMN_PADDING * 2, 40, {
      label: "Settings",
      fontSize: "15px",
      onClick: () => this.openSettings(),
    });
  }

  updateSettingsSummary() {
    const lines = [
      `Max Level: ${MAX_LEVEL_OPTIONS[this.maxLevelIndex]}`,
      `Starting Gold: ${STARTING_GOLD_OPTIONS[this.startingGoldIndex]}`,
      `Max Units: ${UNIT_CAPACITY_OPTIONS[this.unitCapacityIndex]}`,
      `Players: ${PLAYER_COUNT_OPTIONS[this.playerCountIndex]}`,
    ];
    this.settingsSummaryText.setText(lines.join("\n"));
  }

  openSettings() {
    this.scene.start("SkirmishSettingsScene", {
      selectedMapId: this.selectedMapId,
      maxLevelIndex: this.maxLevelIndex,
      startingGoldIndex: this.startingGoldIndex,
      unitCapacityIndex: this.unitCapacityIndex,
      playerCountIndex: this.playerCountIndex,
    });
  }

  buildFooter() {
    const { width, height } = this.cameras.main;
    const buttonWidth = 160;
    const buttonHeight = 42;
    const gap = 16;

    this.startButton = addMenuButton(this, width / 2 - buttonWidth - gap / 2, height - 60, buttonWidth, buttonHeight, {
      label: "Start Game",
      enabled: !!this.selectedMapId,
      onClick: () => this.startGame(),
    });

    addMenuButton(this, width / 2 + gap / 2, height - 60, buttonWidth, buttonHeight, {
      label: "Back",
      onClick: () => this.scene.start("MenuScene"),
    });
  }

  startGame() {
    if (!this.selectedMapId) return;
    const map = MAPS.find((m) => m.id === this.selectedMapId);
    if (!map) return;
    this.scene.start("BoardScene", {
      mapData: map.data,
      maxLevel: MAX_LEVEL_OPTIONS[this.maxLevelIndex],
      startingGold: STARTING_GOLD_OPTIONS[this.startingGoldIndex],
      unitCapacity: UNIT_CAPACITY_OPTIONS[this.unitCapacityIndex],
      playerCount: PLAYER_COUNT_OPTIONS[this.playerCountIndex],
    });
  }
}
