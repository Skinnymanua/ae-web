import Phaser from "phaser";
import { TEAM_COLOR } from "../constants.js";
import { drawCornerBracketPanel, addTitleBar, addCircleButton, addCircleStepper } from "../ui/menuPanel.js";
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
const ROW_START_Y = 150;
const PANEL_X = 80;
const PANEL_Y = 96;
const TITLE_BAR_HEIGHT = 44;
const SWATCH_SIZE = 32;

/**
 * Per-team player-type/alliance setup for local Skirmish, now actually
 * matching the reference "Game Setting" screenshot's own look (title bar
 * with a circular back button, corner-bracket panel, circular chevron
 * steppers) via the shared kit in ui/menuPanel.js - the first version of
 * this scene approximated the LAYOUT (rows, panel, footer steppers) but
 * used the plain rectangular button styling from MenuScene, not this
 * screen's own circular one.
 *
 * One row per team slot (color swatch in place of a portrait - no per-team
 * portrait art exists in this port to draw from), a Player/Robot/None
 * stepper, and an alliance number stepper; Starting Gold and Max Units
 * live here too rather than staying split across SkirmishSettingsScene,
 * since the reference groups them on this same screen. Max Level stays on
 * SkirmishSettingsScene (SkirmishSetupScene's separate "Settings" button) -
 * it has no equivalent in the reference layout, so there's nowhere on THIS
 * screen it belongs.
 *
 * Row count is fixed to SkirmishSetupScene's own PLAYER_COUNT_OPTIONS
 * value (how many team slots the chosen map/settings support) - this
 * screen doesn't change that number itself, only what each of those slots
 * IS (Player/Robot/None) and which alliance it's on. "None" simply means
 * that team never gets added to the game - turn.js's isTeamAlive already
 * treats PLAYER_TYPE.NONE as not alive, so nothing downstream needs to
 * know a slot was ever configured at all.
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

  preload() {
    // StatusBarRenderer's population/gold icons (see ui/bottomBar.js's own
    // identical load call) - reused here for the footer's Gold/Units
    // steppers rather than plain text labels, matching the reference's own
    // coin/person icons next to those two rows. Loaded here too (not just
    // relying on BoardScene having already loaded it) since this scene can
    // run before any BoardScene ever has.
    this.load.spritesheet("icons_hud_status", "/images/icons_hud_status.png", { frameWidth: 11, frameHeight: 11 });
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x1a1a1a).setOrigin(0, 0);

    addTitleBar(this, PANEL_X, 24, PANEL_WIDTH, TITLE_BAR_HEIGHT, {
      title: "Game Setting",
      onBack: () => this.goBack(),
    });

    const panelHeight = ROW_START_Y - PANEL_Y + this.playerCount * ROW_HEIGHT + 90;
    drawCornerBracketPanel(this, PANEL_X, PANEL_Y, PANEL_WIDTH, panelHeight);

    this.add.text(PANEL_X + 20, PANEL_Y + 14, "Team", { fontSize: "14px", color: "#999999" });
    this.add.text(PANEL_X + 100, PANEL_Y + 14, "Player Type", { fontSize: "14px", color: "#999999" });
    this.add.text(PANEL_X + 300, PANEL_Y + 14, "Alliance", { fontSize: "14px", color: "#999999" });

    for (let team = 0; team < this.playerCount; team++) {
      this.buildTeamRow(team, PANEL_X + 20, ROW_START_Y + team * ROW_HEIGHT);
    }

    const footerY = ROW_START_Y + this.playerCount * ROW_HEIGHT + 30;
    this.buildIconStepperRow(PANEL_X + 60, footerY, 0, STARTING_GOLD_OPTIONS, this.startingGoldIndex, (i) => {
      this.startingGoldIndex = i;
    });
    this.buildIconStepperRow(PANEL_X + 290, footerY, 2, UNIT_CAPACITY_OPTIONS, this.unitCapacityIndex, (i) => {
      this.unitCapacityIndex = i;
    });

    this.buildFooterButtons();
  }

  buildTeamRow(team, x, y) {
    this.add.rectangle(x, y + SWATCH_SIZE / 2, SWATCH_SIZE, SWATCH_SIZE, TEAM_COLOR[team]).setStrokeStyle(2, 0xffffff, 0.4);

    addCircleStepper(this, x + 150, y + SWATCH_SIZE / 2, {
      text: PLAYER_TYPE_OPTIONS[this.playerTypeIndices[team]].label,
      radius: 15,
      gap: 130,
      onPrev: (label) => {
        this.playerTypeIndices[team] = (this.playerTypeIndices[team] - 1 + PLAYER_TYPE_OPTIONS.length) % PLAYER_TYPE_OPTIONS.length;
        label.setText(PLAYER_TYPE_OPTIONS[this.playerTypeIndices[team]].label);
        this.updateStartButton();
      },
      onNext: (label) => {
        this.playerTypeIndices[team] = (this.playerTypeIndices[team] + 1) % PLAYER_TYPE_OPTIONS.length;
        label.setText(PLAYER_TYPE_OPTIONS[this.playerTypeIndices[team]].label);
        this.updateStartButton();
      },
    });

    addCircleStepper(this, x + 340, y + SWATCH_SIZE / 2, {
      text: String(ALLIANCE_OPTIONS[this.allianceIndices[team]]),
      radius: 15,
      gap: 90,
      onPrev: (label) => {
        this.allianceIndices[team] = Math.max(0, this.allianceIndices[team] - 1);
        label.setText(String(ALLIANCE_OPTIONS[this.allianceIndices[team]]));
      },
      onNext: (label) => {
        this.allianceIndices[team] = Math.min(ALLIANCE_OPTIONS.length - 1, this.allianceIndices[team] + 1);
        label.setText(String(ALLIANCE_OPTIONS[this.allianceIndices[team]]));
      },
    });
  }

  /** Gold/Units footer row - same addCircleStepper as the team rows above,
   * with a small StatusBarRenderer icon (see preload()) in place of a text
   * label, matching the reference's coin/person icons on those two rows
   * specifically (the team rows above have no equivalent icon in the
   * reference, hence why only these two get one). */
  buildIconStepperRow(x, y, iconFrame, options, initialIndex, onChange) {
    this.add.image(x - 22, y, "icons_hud_status", iconFrame).setDisplaySize(18, 18);

    let index = initialIndex;
    addCircleStepper(this, x + 60, y, {
      text: String(options[index]),
      radius: 15,
      gap: 100,
      onPrev: (label) => {
        index = Math.max(0, index - 1);
        label.setText(String(options[index]));
        onChange(index);
      },
      onNext: (label) => {
        index = Math.min(options.length - 1, index + 1);
        label.setText(String(options[index]));
        onChange(index);
      },
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

  /** The reference's two big circular buttons at the bottom corners - an
   * orange back-arrow, bottom-left, and a green checkmark, bottom-right.
   * Both go to the same place (see goBack()'s own comment on why one
   * "Back" serves as both). */
  buildFooterButtons() {
    const { width, height } = this.cameras.main;
    const radius = 32;

    addCircleButton(this, radius + 20, height - radius - 20, radius, {
      icon: "chevronLeft",
      borderColor: 0xe8a33d,
      onClick: () => this.goBack(),
    });

    this.confirmButton = addCircleButton(this, width - radius - 20, height - radius - 20, radius, {
      icon: "check",
      borderColor: 0x5ecc6a,
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
