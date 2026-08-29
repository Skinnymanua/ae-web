import Phaser from "phaser";
import { MAPS } from "../maps/index.js";

// Bounded option sets, not freeform typed input - Phaser has no native text
// field, and every one of these settings has a natural small set of sensible
// values. UNIT_CAPACITY_OPTIONS in particular MUST stay the original's own
// Rule.POPULATION_PRESET entries (see entity/Rule.java) - a stepper through
// those exact presets matches the source's own design, not just a UI
// shortcut. MAX_LEVEL_OPTIONS/STARTING_GOLD_OPTIONS have no source
// equivalent (the original hardcodes level cap at 3 and starting gold
// per-map) - these ranges are this port's own reasonable bounds.
const MAX_LEVEL_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const STARTING_GOLD_OPTIONS = [0, 100, 200, 300, 500, 750, 1000, 1500, 2000];
const UNIT_CAPACITY_OPTIONS = [15, 20, 25, 30, 35, 40]; // Rule.POPULATION_PRESET

const DEFAULT_MAX_LEVEL = 3; // Rule.getDefaultRule()'s implicit cap - see combat-resolution.js's levelExperienceTable
const DEFAULT_STARTING_GOLD = 300; // matches every hardcoded player.gold this port has used so far
const DEFAULT_UNIT_CAPACITY = 15; // Rule.getDefaultRule()'s UNIT_CAPACITY - POPULATION_PRESET[0]

/**
 * Skirmish (local PvP) game creation: pick a map (auto-discovered from
 * maps/index.js - every .json file dropped in that folder shows up here,
 * no registration needed) and three game settings, then hands off to
 * BoardScene via scene.start("BoardScene", {...}) - see BoardScene#init for
 * the receiving end.
 */
export class SkirmishSetupScene extends Phaser.Scene {
  constructor() {
    super("SkirmishSetupScene");
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, 24, "Skirmish Setup", { fontSize: "24px", color: "#ffdd44", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    this.selectedMapId = MAPS[0]?.id ?? null;
    this.maxLevelIndex = MAX_LEVEL_OPTIONS.indexOf(DEFAULT_MAX_LEVEL);
    this.startingGoldIndex = STARTING_GOLD_OPTIONS.indexOf(DEFAULT_STARTING_GOLD);
    this.unitCapacityIndex = UNIT_CAPACITY_OPTIONS.indexOf(DEFAULT_UNIT_CAPACITY);

    this.mapRowTexts = [];
    this.buildMapList();
    this.buildSettings();
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

  buildSettings() {
    const startX = 420;
    const startY = 90;
    this.add.text(startX, startY - 26, "Game Settings", { fontSize: "16px", color: "#cccccc" });

    this.createStepperRow(startX, startY, "Max Level", MAX_LEVEL_OPTIONS, this.maxLevelIndex, (i) => {
      this.maxLevelIndex = i;
    });
    this.createStepperRow(startX, startY + 36, "Starting Gold", STARTING_GOLD_OPTIONS, this.startingGoldIndex, (i) => {
      this.startingGoldIndex = i;
    });
    this.createStepperRow(startX, startY + 72, "Max Units", UNIT_CAPACITY_OPTIONS, this.unitCapacityIndex, (i) => {
      this.unitCapacityIndex = i;
    });
  }

  /** A labeled "- value +" row stepping through `options` by index - see the
   * module-level comment on why these are bounded option sets rather than
   * free text entry. */
  createStepperRow(x, y, label, options, initialIndex, onChange) {
    this.add.text(x, y, label, { fontSize: "14px", color: "#ffffff" });

    const valueX = x + 150;
    const valueText = this.add
      .text(valueX, y, String(options[initialIndex]), { fontSize: "14px", color: "#ffdd44" })
      .setOrigin(0.5, 0);

    let index = initialIndex;
    const minus = this.add.text(valueX - 30, y, "-", { fontSize: "14px", color: "#dd4444" }).setInteractive();
    const plus = this.add.text(valueX + 30, y, "+", { fontSize: "14px", color: "#44dd88" }).setInteractive();

    const update = () => {
      valueText.setText(String(options[index]));
      onChange(index);
    };

    minus.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      index = Math.max(0, index - 1);
      update();
    });
    plus.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      index = Math.min(options.length - 1, index + 1);
      update();
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
    });
  }
}
