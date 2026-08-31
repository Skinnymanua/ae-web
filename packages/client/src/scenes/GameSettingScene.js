import Phaser from "phaser";
import { TEAM_COLOR } from "../constants.js";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";
import {
  PLAYER_TYPE_OPTIONS,
  ALLIANCE_OPTIONS,
  STARTING_GOLD_OPTIONS,
  UNIT_CAPACITY_OPTIONS,
  defaultPlayerTypeIndex,
  defaultAllianceIndex,
} from "./skirmishSettings.js";

const PANEL_WIDTH = 480;
const ROW_HEIGHT = 56;
const ROW_START_Y = 96;
const PANEL_X = 80;
const SWATCH_SIZE = 32;

/**
 * Per-team player-type/alliance setup for local Skirmish, matching the
 * reference "Game Setting" screen: one row per team slot (color swatch in
 * place of a portrait - see this file's own note below on why), a
 * Player/Robot/None stepper, and an alliance number stepper; Starting
 * Gold and Max Units live here too rather than staying split across
 * SkirmishSettingsScene, since the reference groups them on this same
 * screen. Max Level stays on SkirmishSettingsScene (SkirmishSetupScene's
 * separate "Settings" button) - it has no equivalent in the reference
 * layout, so there's nowhere on THIS screen it belongs.
 *
 * Row count is fixed to SkirmishSetupScene's own PLAYER_COUNT_OPTIONS
 * value (how many team slots the chosen map/settings support) - this
 * screen doesn't change that number itself, only what each of those slots
 * IS (Player/Robot/None) and which alliance it's on. "None" simply means
 * that team never gets added to the game - turn.js's isTeamAlive already
 * treats PLAYER_TYPE.NONE as not alive, so nothing downstream needs to
 * know a slot was ever configured at all.
 *
 * Reuses a plain team-color swatch (see constants.js's TEAM_COLOR) instead
 * of the reference's character portraits - this port has no per-team
 * portrait art to draw from (units.json's portraits are per-UNIT, not
 * per-team), and a color swatch reads just as clearly for "which team is
 * this row" without inventing art that doesn't exist elsewhere in the
 * project.
 */
export class GameSettingScene extends Phaser.Scene {
  constructor() {
    super("GameSettingScene");
  }

  /** playerTypeIndices/allianceIndices carry over from a previous visit to
   * this screen (Back-and-forth without losing changes, same convention as
   * SkirmishSettingsScene's round trip); resized/defaulted to match the
   * current playerCount if it changed since (e.g. bumped from 2 to 3 on
   * SkirmishSettingsScene - the new row needs SOME default). */
  init(data) {
    this.playerCount = data?.playerCount ?? 2;
    this.selectedMapId = data?.selectedMapId ?? null;
    this.maxLevelIndex = data?.maxLevelIndex;
    this.startingGoldIndex = data?.startingGoldIndex ?? STARTING_GOLD_OPTIONS.indexOf(300);
    this.unitCapacityIndex = data?.unitCapacityIndex ?? UNIT_CAPACITY_OPTIONS.indexOf(15);
    this.playerCountIndex = data?.playerCountIndex;

    const previousTypes = data?.playerTypeIndices ?? [];
    const previousAlliances = data?.allianceIndices ?? [];
    this.playerTypeIndices = Array.from(
      { length: this.playerCount },
      (_, team) => previousTypes[team] ?? defaultPlayerTypeIndex(team)
    );
    this.allianceIndices = Array.from(
      { length: this.playerCount },
      (_, team) => previousAlliances[team] ?? defaultAllianceIndex(team)
    );
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add.text(width / 2, 24, "Game Setting", { fontSize: "26px", color: "#e8e8e8", fontStyle: "bold" }).setOrigin(0.5, 0);

    const panelHeight = ROW_START_Y - 70 + this.playerCount * ROW_HEIGHT + 90;
    drawMenuPanel(this, PANEL_X, 64, PANEL_WIDTH, panelHeight);

    this.add.text(PANEL_X + 20, 78, "Team", { fontSize: "14px", color: "#999999" });
    this.add.text(PANEL_X + 100, 78, "Player Type", { fontSize: "14px", color: "#999999" });
    this.add.text(PANEL_X + 300, 78, "Alliance", { fontSize: "14px", color: "#999999" });

    for (let team = 0; team < this.playerCount; team++) {
      this.buildTeamRow(team, PANEL_X + 20, ROW_START_Y + team * ROW_HEIGHT);
    }

    const footerY = ROW_START_Y + this.playerCount * ROW_HEIGHT + 20;
    this.buildStepperRow(PANEL_X + 20, footerY, "Starting Gold", STARTING_GOLD_OPTIONS, this.startingGoldIndex, (i) => {
      this.startingGoldIndex = i;
    });
    this.buildStepperRow(PANEL_X + 250, footerY, "Max Units", UNIT_CAPACITY_OPTIONS, this.unitCapacityIndex, (i) => {
      this.unitCapacityIndex = i;
    });

    this.buildFooterButtons();
  }

  buildTeamRow(team, x, y) {
    this.add.rectangle(x, y + SWATCH_SIZE / 2, SWATCH_SIZE, SWATCH_SIZE, TEAM_COLOR[team]).setStrokeStyle(2, 0xffffff, 0.4);

    this.buildTypeStepper(x + 60, y, team);
    this.buildAllianceStepper(x + 260, y, team);
  }

  buildTypeStepper(x, y, team) {
    const valueText = this.add.text(x + 80, y + 4, PLAYER_TYPE_OPTIONS[this.playerTypeIndices[team]].label, {
      fontSize: "15px",
      color: "#ffdd44",
    });

    const minus = this.add.text(x, y + 4, "<", { fontSize: "15px", color: "#dd4444" }).setInteractive();
    const plus = this.add.text(x + 170, y + 4, ">", { fontSize: "15px", color: "#44dd88" }).setInteractive();

    minus.on("pointerup", (pointer, lx, ly, event) => {
      event.stopPropagation();
      this.playerTypeIndices[team] = (this.playerTypeIndices[team] - 1 + PLAYER_TYPE_OPTIONS.length) % PLAYER_TYPE_OPTIONS.length;
      valueText.setText(PLAYER_TYPE_OPTIONS[this.playerTypeIndices[team]].label);
      this.updateStartButton();
    });
    plus.on("pointerup", (pointer, lx, ly, event) => {
      event.stopPropagation();
      this.playerTypeIndices[team] = (this.playerTypeIndices[team] + 1) % PLAYER_TYPE_OPTIONS.length;
      valueText.setText(PLAYER_TYPE_OPTIONS[this.playerTypeIndices[team]].label);
      this.updateStartButton();
    });
  }

  buildAllianceStepper(x, y, team) {
    const valueText = this.add.text(x + 40, y + 4, String(ALLIANCE_OPTIONS[this.allianceIndices[team]]), {
      fontSize: "15px",
      color: "#ffdd44",
    });

    const minus = this.add.text(x, y + 4, "<", { fontSize: "15px", color: "#dd4444" }).setInteractive();
    const plus = this.add.text(x + 70, y + 4, ">", { fontSize: "15px", color: "#44dd88" }).setInteractive();

    minus.on("pointerup", (pointer, lx, ly, event) => {
      event.stopPropagation();
      this.allianceIndices[team] = Math.max(0, this.allianceIndices[team] - 1);
      valueText.setText(String(ALLIANCE_OPTIONS[this.allianceIndices[team]]));
    });
    plus.on("pointerup", (pointer, lx, ly, event) => {
      event.stopPropagation();
      this.allianceIndices[team] = Math.min(ALLIANCE_OPTIONS.length - 1, this.allianceIndices[team] + 1);
      valueText.setText(String(ALLIANCE_OPTIONS[this.allianceIndices[team]]));
    });
  }

  /** Same "- value +" stepper as SkirmishSettingsScene's own - kept as a
   * local copy rather than shared, since that one is laid out for a single
   * full-width column and this one needs two side by side. */
  buildStepperRow(x, y, label, options, initialIndex, onChange) {
    this.add.text(x, y, label, { fontSize: "14px", color: "#cccccc" });
    const valueText = this.add.text(x, y + 20, String(options[initialIndex]), { fontSize: "15px", color: "#ffdd44" });

    let index = initialIndex;
    const minus = this.add.text(x + 70, y + 20, "-", { fontSize: "15px", color: "#dd4444" }).setInteractive();
    const plus = this.add.text(x + 95, y + 20, "+", { fontSize: "15px", color: "#44dd88" }).setInteractive();

    minus.on("pointerup", (pointer, lx, ly, event) => {
      event.stopPropagation();
      index = Math.max(0, index - 1);
      valueText.setText(String(options[index]));
      onChange(index);
    });
    plus.on("pointerup", (pointer, lx, ly, event) => {
      event.stopPropagation();
      index = Math.min(options.length - 1, index + 1);
      valueText.setText(String(options[index]));
      onChange(index);
    });
  }

  /** At least one Player and at least two active (non-None) teams total -
   * a game with zero humans or only one live side isn't a game anyone
   * asked for. */
  hasValidSetup() {
    const activeCount = this.playerTypeIndices.filter((i) => PLAYER_TYPE_OPTIONS[i].label !== "None").length;
    const hasPlayer = this.playerTypeIndices.some((i) => PLAYER_TYPE_OPTIONS[i].label === "Player");
    return activeCount >= 2 && hasPlayer;
  }

  updateStartButton() {
    this.confirmButton?.setEnabled(this.hasValidSetup());
  }

  buildFooterButtons() {
    const { width, height } = this.cameras.main;

    addMenuButton(this, width / 2 - 170, height - 60, 160, 42, {
      label: "Back",
      onClick: () => this.goBack(),
    });

    this.confirmButton = addMenuButton(this, width / 2 + 10, height - 60, 160, 42, {
      label: "Confirm",
      enabled: this.hasValidSetup(),
      onClick: () => this.goBack(),
    });
  }

  /** One "Back" for both buttons on purpose - there's nothing to
   * separately "confirm" into; this screen's whole job is producing the
   * playerTypeIndices/allianceIndices SkirmishSetupScene passes to
   * BoardScene on Start, same round-trip convention as
   * SkirmishSettingsScene's own single Back button. Confirm just makes
   * that intent explicit for a screen this shaped, and stays disabled
   * until the setup is actually valid so leaving it invalid isn't a
   * silent success. */
  goBack() {
    this.scene.start("SkirmishSetupScene", {
      selectedMapId: this.selectedMapId,
      maxLevelIndex: this.maxLevelIndex,
      startingGoldIndex: this.startingGoldIndex,
      unitCapacityIndex: this.unitCapacityIndex,
      playerCountIndex: this.playerCountIndex,
      playerTypeIndices: this.playerTypeIndices,
      allianceIndices: this.allianceIndices,
    });
  }
}
