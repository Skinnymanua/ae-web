import Phaser from "phaser";
import { MAPS } from "../maps/index.js";
import { drawCornerBracketPanel, addTitleBar, addCircleButton } from "../ui/menuPanel.js";
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

const PANEL_WIDTH = 560;
const PANEL_X_RATIO = 0.5; // centered
const PANEL_Y = 96;
const PANEL_HEIGHT = 340;
const TITLE_BAR_HEIGHT = 44;

/**
 * Skirmish (local PvP) game creation, step 1 of 2: map selection only. Used
 * to also show a live settings summary + Settings/Game Setting buttons
 * side by side with the map list on this same screen - split apart so
 * picking a map and configuring the match are two separate steps instead
 * of one crowded one, matching the reference's own "pick a map, then
 * configure it" flow. Settings now live entirely in SkirmishSettingsScene
 * (step 2 - see #goNext below), reached once a map is actually chosen.
 *
 * Styled with the circular-button kit (ui/menuPanel.js's addTitleBar/
 * drawCornerBracketPanel/addCircleButton) rather than the flat rectangular
 * buttons this used before - see SkirmishSettingsScene.js for where that
 * kit was first built out. The map list itself stays a plain selectable row
 * list rather than becoming beveled/circular buttons too: it's a
 * SELECTION control (one of several rows highlighted at a time), a
 * different interaction than a menu button's simple enabled/disabled
 * navigate-or-don't - just wrapped in the same corner-bracket panel for
 * visual consistency, and scrollable (ui/scrollList.js) so it doesn't
 * overflow the panel's fixed height once more maps exist than fit at once.
 */
export class SkirmishSetupScene extends Phaser.Scene {
  constructor() {
    super("SkirmishSetupScene");
  }

  /** Restores whatever was passed back from SkirmishSettingsScene's "Back"
   * button, or starts fresh with defaults on a normal first entry from
   * MenuScene (data undefined then). Doesn't DO anything with the settings
   * fields itself anymore (see class doc above) - just holds and forwards
   * them so going Setup -> Settings -> Game Setting -> back -> Setup ->
   * change map -> forward again doesn't silently reset anything. */
  init(data) {
    this.selectedMapId = data?.selectedMapId ?? MAPS[0]?.id ?? null;
    this.maxLevelIndex = data?.maxLevelIndex ?? MAX_LEVEL_OPTIONS.indexOf(DEFAULT_MAX_LEVEL);
    this.startingGoldIndex = data?.startingGoldIndex ?? STARTING_GOLD_OPTIONS.indexOf(DEFAULT_STARTING_GOLD);
    this.unitCapacityIndex = data?.unitCapacityIndex ?? UNIT_CAPACITY_OPTIONS.indexOf(DEFAULT_UNIT_CAPACITY);
    this.playerCountIndex = data?.playerCountIndex ?? PLAYER_COUNT_OPTIONS.indexOf(DEFAULT_PLAYER_COUNT);
    this.playerTypeIndices = data?.playerTypeIndices;
    this.allianceIndices = data?.allianceIndices;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x1a1a1a).setOrigin(0, 0);

    const panelX = width * PANEL_X_RATIO - PANEL_WIDTH / 2;

    addTitleBar(this, panelX, 24, PANEL_WIDTH, TITLE_BAR_HEIGHT, {
      title: "Select Map",
      onBack: () => this.scene.start("MenuScene"),
    });

    this.buildFooter();
    this.buildMapList(panelX);
  }

  buildMapList(panelX) {
    drawCornerBracketPanel(this, panelX, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT);

    const padding = 20;
    const startX = panelX + padding;
    const labelY = PANEL_Y + padding;

    if (MAPS.length === 0) {
      this.add.text(startX, labelY, "(no maps found in src/maps/)", { fontSize: "13px", color: "#888888" });
      return;
    }

    const listY = labelY;
    const listWidth = PANEL_WIDTH - padding * 2;
    const listHeight = PANEL_Y + PANEL_HEIGHT - padding - listY;
    const rowHeight = 30;

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
        this.nextButton.setEnabled(!!this.selectedMapId);
      },
    });

    if (this.selectedMapId) this.mapList.select(this.selectedMapId);
  }

  buildFooter() {
    const { width, height } = this.cameras.main;
    const radius = 32;

    addCircleButton(this, radius + 20, height - radius - 20, radius, {
      icon: "chevronLeft",
      borderColor: 0xe8a33d,
      onClick: () => this.scene.start("MenuScene"),
    });

    this.nextButton = addCircleButton(this, width - radius - 20, height - radius - 20, radius, {
      icon: "check",
      borderColor: 0x5ecc6a,
      enabled: !!this.selectedMapId,
      onClick: () => this.goNext(),
    });
  }

  goNext() {
    if (!this.selectedMapId) return;
    this.scene.start("SkirmishSettingsScene", {
      selectedMapId: this.selectedMapId,
      maxLevelIndex: this.maxLevelIndex,
      startingGoldIndex: this.startingGoldIndex,
      unitCapacityIndex: this.unitCapacityIndex,
      playerCountIndex: this.playerCountIndex,
      playerTypeIndices: this.playerTypeIndices,
      allianceIndices: this.allianceIndices,
      // Left at its default ("SkirmishSetupScene") by not passing
      // returnScene at all - see SkirmishSettingsScene#init. That default
      // is also what it checks to know whether it's in this local-skirmish
      // flow (show Game Setting + Start) or reused by CreateGameScene's
      // networked one (show only Back) - see that scene's own comment.
    });
  }
}
