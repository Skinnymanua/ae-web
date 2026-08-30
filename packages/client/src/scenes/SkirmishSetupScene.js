import Phaser from "phaser";
import { MAPS } from "../maps/index.js";
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

/**
 * Skirmish (local PvP) game creation: pick a map (auto-discovered from
 * maps/index.js - every .json file dropped in that folder shows up here,
 * no registration needed), then hands off to BoardScene via
 * scene.start("BoardScene", {...}) - see BoardScene#init for the receiving
 * end. The three game settings (max level/gold/units) live in their own
 * submenu now (SkirmishSettingsScene) rather than crowding this screen -
 * see #openSettings/init below for how the current values travel there and
 * back without resetting.
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
      .text(width / 2, 24, "Skirmish Setup", { fontSize: "24px", color: "#ffdd44", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    this.mapRowTexts = [];
    this.buildMapList();
    this.buildSettingsSummary();
    this.buildFooter();
  }

  buildMapList() {
    const startX = 40;
    const startY = 90;
    this.add.text(startX, startY - 26, "Select Map", { fontSize: "16px", color: "#cccccc" });

    if (MAPS.length === 0) {
      this.add.text(startX, startY, "(no maps found in src/maps/)", { fontSize: "13px", color: "#888888" });
      return;
    }

    MAPS.forEach((map, i) => {
      const y = startY + i * 26;
      const label = `${map.name}  (${map.width}x${map.height}, ${map.unitCount} units)`;
      const text = this.add.text(startX, y, label, { fontSize: "14px", color: "#ffffff" }).setInteractive();
      // pointerup + stopPropagation - see ui/dialogs.js's yesText/buyText for
      // why this matters: without it, the SAME click that lands here can
      // leak through to whatever's underneath once this text is destroyed
      // (not applicable to a plain non-destroying row click like this one,
      // but kept consistent with the rest of the codebase's convention).
      text.on("pointerup", (pointer, localX, localY, event) => {
        event.stopPropagation();
        this.selectMap(map.id);
      });
      this.mapRowTexts.push({ id: map.id, text });
    });

    this.updateMapSelectionHighlight();
  }

  selectMap(id) {
    this.selectedMapId = id;
    this.updateMapSelectionHighlight();
    this.updateStartButtonState();
  }

  updateMapSelectionHighlight() {
    for (const { id, text } of this.mapRowTexts) {
      text.setColor(id === this.selectedMapId ? "#44dd88" : "#ffffff");
    }
  }

  /** Read-only glance at the current settings (so you don't have to open the
   * submenu just to check them) plus the button into it. */
  buildSettingsSummary() {
    const startX = 420;
    const startY = 90;
    this.add.text(startX, startY - 26, "Game Settings", { fontSize: "16px", color: "#cccccc" });

    this.settingsSummaryText = this.add.text(startX, startY, "", {
      fontSize: "14px",
      color: "#ffffff",
      lineSpacing: 10,
    });
    this.updateSettingsSummary();

    const settingsButton = this.add
      .text(startX, startY + 115, "[ Settings ]", { fontSize: "16px", color: "#44aaff" })
      .setInteractive();
    settingsButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.openSettings();
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

    this.startButton = this.add
      .text(width / 2 - 80, height - 50, "[ Start Game ]", { fontSize: "18px", color: "#44dd88" })
      .setInteractive();
    this.startButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.startGame();
    });

    const backButton = this.add
      .text(width / 2 + 80, height - 50, "[ Back ]", { fontSize: "18px", color: "#dd4444" })
      .setInteractive();
    backButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.scene.start("MenuScene");
    });

    this.updateStartButtonState();
  }

  /** Disabled (greyed out, non-interactive) until a map is picked - mirrors
   * ui/dialogs.js's buyText disabled-state pattern (setColor + set/disable
   * Interactive together). */
  updateStartButtonState() {
    if (this.selectedMapId) {
      this.startButton.setColor("#44dd88");
      this.startButton.setInteractive();
    } else {
      this.startButton.setColor("#666677");
      this.startButton.disableInteractive();
    }
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
