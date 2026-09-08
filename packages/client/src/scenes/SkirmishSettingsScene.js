import Phaser from "phaser";
import { MAPS } from "../maps/index.js";
import { TEAM_COLOR } from "../constants.js";
import { drawCornerBracketPanel, addTitleBar, addCircleButton, addCircleStepper } from "../ui/menuPanel.js";
import {
  MAX_LEVEL_OPTIONS,
  STARTING_GOLD_OPTIONS,
  UNIT_CAPACITY_OPTIONS,
  PLAYER_COUNT_OPTIONS,
  PLAYER_TYPE_OPTIONS,
  ALLIANCE_OPTIONS,
  DEFAULT_MAX_LEVEL,
  DEFAULT_STARTING_GOLD,
  DEFAULT_UNIT_CAPACITY,
  DEFAULT_PLAYER_COUNT,
  defaultPlayerTypeIndex,
  defaultAllianceIndex,
} from "./skirmishSettings.js";

const PANEL_WIDTH = 460;
const PANEL_Y = 96;
const OPTION_ROW_HEIGHT = 40;
const TEAM_ROW_HEIGHT = 50;
const TEAM_SECTION_GAP = 16; // between the last option row and the first team row
const TITLE_BAR_HEIGHT = 44;
const SWATCH_SIZE = 28;

/**
 * Skirmish (local PvP) game creation, step 2 of 2: match settings AND, for
 * the local flow specifically, per-team Player/Robot/Alliance config all on
 * one screen - the per-team config used to live on its own separate screen
 * (GameSettingScene) reached via a button here, which also duplicated the
 * Starting Gold/Max Units steppers that already exist on THIS screen.
 * Removed that screen entirely and folded its per-team rows in below the
 * four option rows instead, so there's exactly one Gold/Units control, not
 * two, and one screen instead of two for the whole local-skirmish setup
 * step. See #rebuildTeamRows for how the team-row count stays in sync with
 * the Players stepper right above it, live, without needing a screen
 * transition to see the new rows appear.
 *
 * Also still reused directly by CreateGameScene for the networked-game-
 * creation flow (see its own #openSettings-equivalent call site), which
 * needs the four option steppers but NOTHING team-related - no map was
 * picked (network sessions pick a map differently), no per-team Robot
 * config exists over network yet. Distinguished by `returnScene`: left at
 * its default ("SkirmishSetupScene") for the local flow, explicitly
 * overridden to "CreateGameScene" for the networked one - isLocalSkirmish
 * below is computed from that one check rather than as a separate flag
 * either caller needs to remember to pass.
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
    this.playerTypeIndices = data?.playerTypeIndices;
    this.allianceIndices = data?.allianceIndices;
    this.returnScene = data?.returnScene ?? "SkirmishSetupScene";
    this.returnExtra = data?.returnExtra ?? {};
    this.isLocalSkirmish = this.returnScene === "SkirmishSetupScene";
    // Reset here, not just left to buildFooterButtons() to (re)create -
    // Phaser reuses this same scene INSTANCE on every visit rather than
    // constructing a fresh one, so without this, a second+ visit's
    // redrawPanel() (via rebuildTeamRows -> updateStartButton, both of
    // which run before buildFooterButtons() this create() pass) would
    // still see the PREVIOUS visit's startButton - whose underlying zone
    // Phaser already destroyed on scene shutdown - and crash calling
    // .setEnabled() on it.
    this.startButton = undefined;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x1a1a1a).setOrigin(0, 0);

    this.panelX = width / 2 - PANEL_WIDTH / 2;

    addTitleBar(this, this.panelX, 24, PANEL_WIDTH, TITLE_BAR_HEIGHT, {
      title: "Game Settings",
      onBack: () => this.goBack(),
    });

    this.optionRows = [
      { label: "Max Level", options: MAX_LEVEL_OPTIONS, get: () => this.maxLevelIndex, set: (i) => (this.maxLevelIndex = i) },
      {
        label: "Starting Gold",
        options: STARTING_GOLD_OPTIONS,
        get: () => this.startingGoldIndex,
        set: (i) => (this.startingGoldIndex = i),
      },
      {
        label: "Max Units",
        options: UNIT_CAPACITY_OPTIONS,
        get: () => this.unitCapacityIndex,
        set: (i) => (this.unitCapacityIndex = i),
      },
      {
        label: "Players",
        options: PLAYER_COUNT_OPTIONS,
        get: () => this.playerCountIndex,
        set: (i) => {
          this.playerCountIndex = i;
          this.redrawPanel(); // team-row count depends on this - see rebuildTeamRows
        },
      },
    ];

    this.panelGraphics = null;
    this.teamHeaderObjects = [];
    this.teamRowObjects = [];
    this.redrawPanel();

    this.buildFooterButtons();
  }

  /** Draws (or redraws, after the Players stepper changes) the panel at
   * whatever height the current option-row count + team-row count needs,
   * then the four option rows, then the team rows (if isLocalSkirmish).
   * Option-row steppers are recreated too, not just the panel - simplest
   * way to guarantee nothing references a destroyed Graphics object,
   * given the panel behind everything gets torn down and redrawn. */
  redrawPanel() {
    this.panelGraphics?.destroy();
    this.optionRowObjects?.forEach((obj) => obj.destroy());
    this.optionRowObjects = [];

    const playerCount = PLAYER_COUNT_OPTIONS[this.playerCountIndex];
    const teamSectionHeight = this.isLocalSkirmish ? TEAM_SECTION_GAP + 24 + playerCount * TEAM_ROW_HEIGHT : 0;
    const panelHeight = 30 + this.optionRows.length * OPTION_ROW_HEIGHT + teamSectionHeight + 20;
    this.panelGraphics = drawCornerBracketPanel(this, this.panelX, PANEL_Y, PANEL_WIDTH, panelHeight);

    this.optionRows.forEach((row, i) => {
      const y = PANEL_Y + 30 + i * OPTION_ROW_HEIGHT;
      const rowLabel = this.add.text(this.panelX + 24, y - 9, row.label, { fontSize: "15px", color: "#cccccc" });
      const stepper = addCircleStepper(this, this.panelX + PANEL_WIDTH - 90, y, {
        text: String(row.options[row.get()]),
        radius: 15,
        gap: 90,
        onPrev: (label) => {
          row.set(Math.max(0, row.get() - 1));
          label.setText(String(row.options[row.get()]));
        },
        onNext: (label) => {
          row.set(Math.min(row.options.length - 1, row.get() + 1));
          label.setText(String(row.options[row.get()]));
        },
      });
      this.optionRowObjects.push(rowLabel, stepper.label, stepper.minusButton, stepper.plusButton);
    });

    if (this.isLocalSkirmish) {
      const teamSectionY = PANEL_Y + 30 + this.optionRows.length * OPTION_ROW_HEIGHT + TEAM_SECTION_GAP;
      this.rebuildTeamRows(teamSectionY, playerCount);
    }
  }

  /** The per-team Player Type/Alliance rows moved in from the old
   * GameSettingScene - torn down and rebuilt every time the Players
   * stepper changes (see redrawPanel), so growing from 2 to 4 players
   * immediately shows two more rows rather than needing a screen
   * transition to see them. playerTypeIndices/allianceIndices are resized
   * to match here too - a value already set for a team stays put; a newly
   * added team slot gets the same default GameSettingScene used to. */
  rebuildTeamRows(startY, playerCount) {
    this.teamHeaderObjects.forEach((obj) => obj.destroy());
    this.teamRowObjects.forEach((obj) => obj.destroy());
    this.teamHeaderObjects = [];
    this.teamRowObjects = [];

    const previousTypes = this.playerTypeIndices ?? [];
    const previousAlliances = this.allianceIndices ?? [];
    this.playerTypeIndices = Array.from({ length: playerCount }, (_, team) => previousTypes[team] ?? defaultPlayerTypeIndex(team));
    this.allianceIndices = Array.from({ length: playerCount }, (_, team) => previousAlliances[team] ?? defaultAllianceIndex(team));

    const colX = this.panelX + 24;
    this.teamHeaderObjects.push(
      this.add.text(colX, startY, "Team", { fontSize: "13px", color: "#999999" }),
      this.add.text(colX + 90, startY, "Player Type", { fontSize: "13px", color: "#999999" }),
      this.add.text(colX + 280, startY, "Alliance", { fontSize: "13px", color: "#999999" })
    );

    for (let team = 0; team < playerCount; team++) {
      const y = startY + 24 + team * TEAM_ROW_HEIGHT;
      const swatch = this.add
        .rectangle(colX + SWATCH_SIZE / 2, y + SWATCH_SIZE / 2, SWATCH_SIZE, SWATCH_SIZE, TEAM_COLOR[team])
        .setStrokeStyle(2, 0xffffff, 0.4);
      this.teamRowObjects.push(swatch);

      const typeStepper = addCircleStepper(this, colX + 140, y + SWATCH_SIZE / 2, {
        text: PLAYER_TYPE_OPTIONS[this.playerTypeIndices[team]].label,
        radius: 14,
        gap: 120,
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
      this.teamRowObjects.push(typeStepper.label, typeStepper.minusButton, typeStepper.plusButton);

      const allianceStepper = addCircleStepper(this, colX + 320, y + SWATCH_SIZE / 2, {
        text: String(ALLIANCE_OPTIONS[this.allianceIndices[team]]),
        radius: 14,
        gap: 80,
        onPrev: (label) => {
          this.allianceIndices[team] = Math.max(0, this.allianceIndices[team] - 1);
          label.setText(String(ALLIANCE_OPTIONS[this.allianceIndices[team]]));
        },
        onNext: (label) => {
          this.allianceIndices[team] = Math.min(ALLIANCE_OPTIONS.length - 1, this.allianceIndices[team] + 1);
          label.setText(String(ALLIANCE_OPTIONS[this.allianceIndices[team]]));
        },
      });
      this.teamRowObjects.push(allianceStepper.label, allianceStepper.minusButton, allianceStepper.plusButton);
    }

    this.updateStartButton();
  }

  /** At least one Player and at least two active (non-None) teams total -
   * a game with zero humans or only one live side isn't a game anyone
   * asked for. Only meaningful (and only called) in the local-skirmish
   * flow - the networked reuse has no playerTypeIndices at all. */
  hasValidSetup() {
    if (!this.isLocalSkirmish) return true;
    const activeCount = this.playerTypeIndices.filter((i) => PLAYER_TYPE_OPTIONS[i].label !== "None").length;
    const hasPlayer = this.playerTypeIndices.some((i) => PLAYER_TYPE_OPTIONS[i].label === "Player");
    return activeCount >= 2 && hasPlayer;
  }

  updateStartButton() {
    this.startButton?.setEnabled(this.hasValidSetup());
  }

  /** Local-skirmish flow: Back (orange chevron) returns to map selection,
   * Start (green check) goes straight to BoardScene - this screen is the
   * last step before the match starts. Networked reuse (CreateGameScene):
   * just the one Back button, centered, returning to returnScene/
   * returnExtra exactly as before - no Start here, since CreateGameScene's
   * own screen is what actually creates the session. */
  buildFooterButtons() {
    const { width, height } = this.cameras.main;
    const radius = 32;

    if (this.isLocalSkirmish) {
      addCircleButton(this, radius + 20, height - radius - 20, radius, {
        icon: "chevronLeft",
        borderColor: 0xe8a33d,
        onClick: () => this.goBack(),
      });
      this.startButton = addCircleButton(this, width - radius - 20, height - radius - 20, radius, {
        icon: "check",
        borderColor: 0x5ecc6a,
        enabled: this.hasValidSetup(),
        onClick: () => this.startGame(),
      });
    } else {
      addCircleButton(this, width / 2, height - radius - 20, radius, {
        icon: "chevronLeft",
        borderColor: 0xe8a33d,
        onClick: () => this.goBack(),
      });
    }
  }

  goBack() {
    this.scene.start(this.returnScene, {
      ...this.returnExtra,
      selectedMapId: this.selectedMapId,
      maxLevelIndex: this.maxLevelIndex,
      startingGoldIndex: this.startingGoldIndex,
      unitCapacityIndex: this.unitCapacityIndex,
      playerCountIndex: this.playerCountIndex,
      playerTypeIndices: this.playerTypeIndices,
      allianceIndices: this.allianceIndices,
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
      // Per-team Player/Robot/Alliance config from the rows above - see
      // BoardScene#init for the "everyone human, own alliance" fallback,
      // which no longer applies in practice for the local flow (this
      // screen always sets these now) but stays as a defensive default.
      playerTypeIndices: this.playerTypeIndices,
      allianceIndices: this.allianceIndices,
    });
  }
}
