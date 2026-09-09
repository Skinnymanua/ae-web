import Phaser from "phaser";
import { MAPS } from "../maps/index.js";
import { drawCornerBracketPanel, addTitleBar, addCircleButton, addCircleStepper, CIRCLE_BG, CIRCLE_BORDER } from "../ui/menuPanel.js";
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

const MAX_PANEL_WIDTH = 460;
const PANEL_MARGIN_X = 20; // min gap either side of the panel on a narrow canvas
const OPTION_ROW_HEIGHT = 40;
const TEAM_ROW_HEIGHT = 50;
const TEAM_SECTION_GAP = 16; // between the last option row and the first team row
const TITLE_BAR_HEIGHT = 44;
const SWATCH_SIZE = 36; // bumped up from 28 - now showing a full body+head composite, not just a small head icon, needs more room to read clearly
const HEAD_FRAME_WIDTH = 13; // heads.png's native per-frame size (52x12 = 4 frames) - same sprite render/units.js draws above every unit on the board
const HEAD_FRAME_HEIGHT = 12;
const BODY_FRAME_SIZE = 24; // unit_sheet_${team}.png's native per-frame size - see render/units.js
const COMMANDER_UNIT_INDEX = 9; // units.json's isCommander:true entry - the actual body frame every commander uses
// Frame index == team index directly - heads.png's own frame order already
// matches: 0 (blue) and 2 (green) are plain human faces, 1 (magenta/"red")
// and 3 (navy/"black") are the grey helmed/skull-like ones. This is the
// actual in-game head sprite (render/units.js's `head` overlay drawn above
// every unit), not a decorative stand-in - see this file's git history for
// the two earlier attempts (a 6-face bust strip, then a curated subset of
// it) that used portraits.png instead and didn't match what's really on
// the board.

const FOOTER_BUTTON_RADIUS = 32;
const FOOTER_RESERVED_HEIGHT = FOOTER_BUTTON_RADIUS * 2 + 40;
const PANEL_TOP_MIN = 24 + TITLE_BAR_HEIGHT + 16; // just below the title bar

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
 * Panel is vertically CENTERED in the space between the title bar and the
 * footer buttons (see #redrawPanel), not pinned at a fixed Y - on a
 * portrait phone (constants.js's getMenuSize() now matches the device's
 * own aspect ratio instead of a fixed 800x600), that gap is much taller
 * than this content needs, and centering it there reads better than
 * leaving a large empty band below a panel stuck near the top. Width is
 * clamped to the canvas width too. Recomputed every redrawPanel() call
 * (not just once in create()), since panel height itself changes when the
 * Players stepper adds/removes team rows.
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

  preload() {
    // Same asset render/units.js loads for the on-board head overlay - see
    // HEAD_FRAME_WIDTH/HEIGHT above for why team index doubles as frame
    // index here.
    this.load.spritesheet("heads", "/images/units/heads.png", {
      frameWidth: HEAD_FRAME_WIDTH,
      frameHeight: HEAD_FRAME_HEIGHT,
    });
    // Same per-team body sheets render/unitTexture.js's unit_sheet_${team}
    // resolves to on the board - loaded for all 4 possible team slots here
    // (PLAYER_COUNT_OPTIONS tops out at 4), not just however many the
    // current game happens to use, since the Players stepper can raise
    // that count after this preload already ran.
    for (let team = 0; team < 4; team++) {
      this.load.spritesheet(`unit_sheet_${team}`, `/images/units/unit_sheet_${team}.png`, {
        frameWidth: BODY_FRAME_SIZE,
        frameHeight: BODY_FRAME_SIZE,
      });
    }
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

    this.panelWidth = Math.min(MAX_PANEL_WIDTH, width - PANEL_MARGIN_X * 2);
    this.panelX = width / 2 - this.panelWidth / 2;

    addTitleBar(this, this.panelX, 24, this.panelWidth, TITLE_BAR_HEIGHT, {
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
    ];
    // Local skirmish always shows all 4 team-row slots now (see
    // redrawPanel's fixed playerCount below) - which team/robot/none each
    // slot IS is controlled per-row instead, so there's nothing left for a
    // separate "Players" count stepper to do here. Only the networked
    // reuse (CreateGameScene) still needs it - that flow has no per-team
    // rows at all, so a real slot-count control is the only way it has to
    // say how many can join.
    if (!this.isLocalSkirmish) {
      this.optionRows.push({
        label: "Players",
        options: PLAYER_COUNT_OPTIONS,
        get: () => this.playerCountIndex,
        set: (i) => {
          this.playerCountIndex = i;
        },
      });
    }

    this.panelGraphics = null;
    this.teamHeaderObjects = [];
    this.teamRowObjects = [];
    this.redrawPanel();

    this.buildFooterButtons();
  }

  /** Draws (or redraws, after the Players stepper changes) the panel at
   * whatever height the current option-row count + team-row count needs,
   * vertically centered in the space below the title bar and above the
   * footer buttons (see class doc above), then the four option rows, then
   * the team rows (if isLocalSkirmish). Option-row steppers are recreated
   * too, not just the panel - simplest way to guarantee nothing references
   * a destroyed Graphics object, given the panel behind everything gets
   * torn down and redrawn. */
  redrawPanel() {
    this.panelGraphics?.destroy();
    this.optionRowObjects?.forEach((obj) => obj.destroy());
    this.optionRowObjects = [];

    const { height } = this.cameras.main;
    // Always 4 for local skirmish now (see class doc + the optionRows
    // comment above) - every slot renders, defaulting to None until its
    // own Player Type stepper turns it into something. The networked reuse
    // still goes through the Players option row above instead.
    const playerCount = this.isLocalSkirmish ? 4 : PLAYER_COUNT_OPTIONS[this.playerCountIndex];
    const teamSectionHeight = this.isLocalSkirmish ? TEAM_SECTION_GAP + 24 + playerCount * TEAM_ROW_HEIGHT : 0;
    const panelHeight = 30 + this.optionRows.length * OPTION_ROW_HEIGHT + teamSectionHeight + 20;

    const availableBottom = height - FOOTER_RESERVED_HEIGHT;
    const panelY = Math.max(PANEL_TOP_MIN, PANEL_TOP_MIN + (availableBottom - PANEL_TOP_MIN - panelHeight) / 2);

    this.panelGraphics = drawCornerBracketPanel(this, this.panelX, panelY, this.panelWidth, panelHeight);

    this.optionRows.forEach((row, i) => {
      const y = panelY + 30 + i * OPTION_ROW_HEIGHT;
      const rowLabel = this.add.text(this.panelX + 24, y - 9, row.label, { fontSize: "15px", color: "#cccccc" });
      const stepper = addCircleStepper(this, this.panelX + this.panelWidth - 90, y, {
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
      const teamSectionY = panelY + 30 + this.optionRows.length * OPTION_ROW_HEIGHT + TEAM_SECTION_GAP;
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
    // Player Type/Alliance column positions are relative to panelWidth
    // (not fixed pixel offsets like colX + 140 / colX + 320 used to be) -
    // those were sized for the full 460px desktop panel, and on a phone
    // where panelWidth shrinks (see create()'s PANEL_MARGIN_X clamp), the
    // Alliance stepper's buttons would extend past the panel's actual
    // right edge instead of shrinking to match it.
    const typeStepperX = this.panelX + this.panelWidth * 0.40;
    const allianceStepperX = this.panelX + this.panelWidth - 70;

    this.teamHeaderObjects.push(
      this.add.text(colX, startY, "Team", { fontSize: "13px", color: "#999999" }),
      this.add.text(typeStepperX - 40, startY, "Player Type", { fontSize: "13px", color: "#999999" }),
      this.add.text(allianceStepperX - 33, startY, "Alliance", { fontSize: "13px", color: "#999999" })
    );

    for (let team = 0; team < playerCount; team++) {
      const y = startY + 24 + team * TEAM_ROW_HEIGHT;
      const iconCx = colX + SWATCH_SIZE / 2;
      const iconCy = y + SWATCH_SIZE / 2;
      const iconRadius = SWATCH_SIZE / 2;

      // Same circular-button styling as everywhere else (addCircleButton's
      // own navy fill + silver ring), so this reads as one more button in
      // the set rather than a differently-styled swatch.
      const circleBg = this.add.graphics();
      circleBg.fillStyle(CIRCLE_BG, 1);
      circleBg.fillCircle(iconCx, iconCy, iconRadius);
      circleBg.lineStyle(2, CIRCLE_BORDER, 1);
      circleBg.strokeCircle(iconCx, iconCy, iconRadius);
      this.teamRowObjects.push(circleBg);

      // Body + head composited the SAME way render/units.js draws a
      // commander on the actual board (down to reusing its exact
      // fractional offsets, just scaled from a 24px tile to this icon's
      // own size) - not a separate illustration, the real in-game model.
      // Sized to slightly less than the full circle (0.85x) so the
      // character reads clearly inside the ring instead of touching its
      // edge.
      const bodySize = SWATCH_SIZE * 0.85;
      const bodyTopLeftX = iconCx - bodySize / 2;
      const bodyTopLeftY = iconCy - bodySize / 2;

      const body = this.add.sprite(iconCx, iconCy, `unit_sheet_${team}`, COMMANDER_UNIT_INDEX);
      body.setDisplaySize(bodySize, bodySize);
      this.teamRowObjects.push(body);

      const head = this.add.image(bodyTopLeftX + (bodySize * 7) / 24, bodyTopLeftY, "heads", team);
      head.setOrigin(0, 0);
      head.setDisplaySize((bodySize * 13) / 24, (bodySize * 12) / 24);
      this.teamRowObjects.push(head);

      const typeStepper = addCircleStepper(this, typeStepperX, y + SWATCH_SIZE / 2, {
        text: PLAYER_TYPE_OPTIONS[this.playerTypeIndices[team]].label,
        radius: 14,
        gap: 100,
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

      const allianceStepper = addCircleStepper(this, allianceStepperX, y + SWATCH_SIZE / 2, {
        text: String(ALLIANCE_OPTIONS[this.allianceIndices[team]]),
        radius: 14,
        gap: 60,
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
    const radius = FOOTER_BUTTON_RADIUS;

    if (this.isLocalSkirmish) {
      addCircleButton(this, radius + 20, height - radius - 20, radius, {
        icon: "back",
        onClick: () => this.goBack(),
      });
      this.startButton = addCircleButton(this, width - radius - 20, height - radius - 20, radius, {
        icon: "confirm",
        enabled: this.hasValidSetup(),
        onClick: () => this.startGame(),
      });
    } else {
      addCircleButton(this, width / 2, height - radius - 20, radius, {
        icon: "back",
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
      // Always 4 for local skirmish (see redrawPanel's own comment) -
      // BoardScene builds one players[] entry per slot regardless, and
      // turn.js's isTeamAlive already treats a None slot as not alive, so
      // an unused 4th slot costs nothing at runtime.
      playerCount: 4,
      // Per-team Player/Robot/Alliance config from the rows above - see
      // BoardScene#init for the "everyone human, own alliance" fallback,
      // which no longer applies in practice for the local flow (this
      // screen always sets these now) but stays as a defensive default.
      playerTypeIndices: this.playerTypeIndices,
      allianceIndices: this.allianceIndices,
    });
  }
}
