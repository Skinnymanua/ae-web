import Phaser from "phaser";
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
 * Settings submenu, split out of SkirmishSetupScene so map selection isn't
 * crowded together with these three steppers on one screen. Receives the
 * caller's current indices via init(data) and hands the (possibly changed)
 * indices back the same way on "Back" - see SkirmishSetupScene#init for the
 * receiving end of that round trip, and #openSettings for how it gets here.
 *
 * `returnScene`/`returnExtra` let a different caller reuse this same
 * submenu (see CreateGameScene, which shares this rather than duplicating
 * the three steppers again) - defaults to SkirmishSetupScene for backward
 * compatibility with the original local-skirmish flow.
 */
export class SkirmishSettingsScene extends Phaser.Scene {
  constructor() {
    super("SkirmishSettingsScene");
  }

  init(data) {
    this.selectedMapId = data?.selectedMapId ?? null;
    this.maxLevelIndex = data?.maxLevelIndex ?? MAX_LEVEL_OPTIONS.indexOf(DEFAULT_MAX_LEVEL);
    this.startingGoldIndex = data?.startingGoldIndex ?? STARTING_GOLD_OPTIONS.indexOf(DEFAULT_STARTING_GOLD);
    this.unitCapacityIndex = data?.unitCapacityIndex ?? UNIT_CAPACITY_OPTIONS.indexOf(DEFAULT_UNIT_CAPACITY);
    this.playerCountIndex = data?.playerCountIndex ?? PLAYER_COUNT_OPTIONS.indexOf(DEFAULT_PLAYER_COUNT);
    this.returnScene = data?.returnScene ?? "SkirmishSetupScene";
    this.returnExtra = data?.returnExtra ?? {};
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, 24, "Game Settings", { fontSize: "24px", color: "#ffdd44", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    const startX = width / 2 - 120;
    const startY = 110;
    this.createStepperRow(startX, startY, "Max Level", MAX_LEVEL_OPTIONS, this.maxLevelIndex, (i) => {
      this.maxLevelIndex = i;
    });
    this.createStepperRow(startX, startY + 44, "Starting Gold", STARTING_GOLD_OPTIONS, this.startingGoldIndex, (i) => {
      this.startingGoldIndex = i;
    });
    this.createStepperRow(startX, startY + 88, "Max Units", UNIT_CAPACITY_OPTIONS, this.unitCapacityIndex, (i) => {
      this.unitCapacityIndex = i;
    });
    this.createStepperRow(startX, startY + 132, "Players", PLAYER_COUNT_OPTIONS, this.playerCountIndex, (i) => {
      this.playerCountIndex = i;
    });

    const backButton = this.add
      .text(width / 2, height - 50, "[ Back ]", { fontSize: "18px", color: "#dd4444" })
      .setOrigin(0.5)
      .setInteractive();
    backButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.scene.start(this.returnScene, {
        ...this.returnExtra,
        selectedMapId: this.selectedMapId,
        maxLevelIndex: this.maxLevelIndex,
        startingGoldIndex: this.startingGoldIndex,
        unitCapacityIndex: this.unitCapacityIndex,
        playerCountIndex: this.playerCountIndex,
      });
    });
  }

  /** Same "- value +" stepper as before - see skirmishSettings.js's own
   * comment on why these are bounded option sets rather than free text. */
  createStepperRow(x, y, label, options, initialIndex, onChange) {
    this.add.text(x, y, label, { fontSize: "16px", color: "#ffffff" });

    const valueX = x + 180;
    const valueText = this.add
      .text(valueX, y, String(options[initialIndex]), { fontSize: "16px", color: "#ffdd44" })
      .setOrigin(0.5, 0);

    let index = initialIndex;
    const minus = this.add.text(valueX - 35, y, "-", { fontSize: "16px", color: "#dd4444" }).setInteractive();
    const plus = this.add.text(valueX + 35, y, "+", { fontSize: "16px", color: "#44dd88" }).setInteractive();

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
}
