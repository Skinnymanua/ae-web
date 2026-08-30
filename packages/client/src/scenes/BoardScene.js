import Phaser from "phaser";
import { GameState } from "@ae/shared/src/game-state.js";
import unitsData from "@ae/shared/data/units.json";
import tilesData from "@ae/shared/data/tiles.json";
import { MAPS } from "../maps/index.js";
import { TILE_SIZE, BOARD_OFFSET_Y } from "../constants.js";
import { BOTTOM_BAR_HEIGHT } from "../ui/bottomBar.js";

import { drawTileGrid, updateSelectedTileHighlight, refreshTombs } from "../render/tiles.js";
import { refreshUnits, animateUnits } from "../render/units.js";
import { createHud } from "../ui/hud.js";
import { createStatsPanel } from "../ui/statsPanel.js";
import { onTileClick } from "../input/boardInput.js";
import { setupCameraDrag } from "../input/cameraDrag.js";

export class BoardScene extends Phaser.Scene {
  constructor() {
    super("BoardScene");
  }

  /**
   * Receives whatever scene.start("BoardScene", data) was called with (see
   * SkirmishSetupScene#startGame) - map + the three configurable settings.
   * Falls back to the first auto-discovered map and the original's own
   * defaults if launched directly with no data (e.g. during dev iteration
   * on this scene alone), so this never hard-crashes for missing input.
   */
  init(data) {
    this.mapData_ = data?.mapData ?? MAPS[0]?.data;
    this.maxLevel_ = data?.maxLevel ?? 3; // Rule.getDefaultRule()'s implicit cap
    this.startingGold_ = data?.startingGold ?? 300;
    this.unitCapacity_ = data?.unitCapacity ?? 15; // POPULATION_PRESET[0]
  }

  preload() {
    for (let i = 0; i < 89; i++) {
      this.load.image(`tile_${i}`, `/images/tiles/tile_${i}.png`);
    }
    // Ported from android/assets/images/tiles/top_tiles/top_tile_0.png — the castle's
    // tower/roof overlay, drawn on top of the tile *above* a castle base tile (see
    // Tile#getTopTileIndex / GameScreen#drawMap in the original). Only index 0 exists
    // in the source repo — every castle variant (team-owned or neutral) uses it.
    this.load.image("top_tile_0", "/images/tiles/top_tiles/top_tile_0.png");
    for (let team = 0; team < 4; team++) {
      this.load.spritesheet(`unit_sheet_${team}`, `/images/units/unit_sheet_${team}.png`, {
        frameWidth: 24,
        frameHeight: 24,
      });
    }
    // Existing but previously unwired assets - AvailableUnitList draws every
    // portrait in the original's unit-store list on top of getBigCircleTexture(0);
    // used by ui/dialogs.js's buy-menu portrait strip. Each sheet is 2 frames side
    // by side (createFrames(sheet, 2, 1) in the original's ResourceManager) - frame
    // 0 is the normal ring, frame 1 is the pressed/selected ring (see CircleButton's
    // isPressed()||isHeld() ? 1 : 0). Native frame sizes (32x33 / 20x21) come
    // straight from the PNG dimensions (64x33 / 40x21) divided by 2 columns.
    this.load.spritesheet("circle_big", "/images/circle_big.png", { frameWidth: 32, frameHeight: 33 });
    this.load.spritesheet("circle_small", "/images/circle_small.png", { frameWidth: 20, frameHeight: 21 });
    // Ported from BorderRenderer.java's drawBorder() - the dialog-window frame
    // used throughout the original (UnitStoreDialog extends BasicDialog, which
    // draws this). 8 frames of 16x16: top-left/top-edge/top-right corner+edge,
    // left-edge/right-edge, bottom-left/bottom-edge/bottom-right - the two edge
    // frames (1, 6 horizontal; 3, 4 vertical) get stretched to fill the gap
    // between corners, the four corner frames are drawn at native size.
    this.load.spritesheet("border", "/images/border.png", { frameWidth: 16, frameHeight: 16 });
    // Mermaid/Druid (units.json indices 19/20) came from a different source
    // than the rest of the roster - no per-team-color unit_sheet_N.png variant
    // exists for either, just one standalone sprite each. See
    // render/unitTexture.js for how these get resolved instead of the usual
    // unit_sheet_${team} lookup.
    this.load.spritesheet("mermaid", "/images/units/mermaid.png", { frameWidth: 24, frameHeight: 25 });
    this.load.spritesheet("druid", "/images/units/druid.png", { frameWidth: 24, frameHeight: 25 });
    this.load.spritesheet("heads", "/images/units/heads.png", {
      frameWidth: 13,
      frameHeight: 12,
    });
    this.load.spritesheet("icons_action", "/images/icons_action.png", {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("icons_hud_battle", "/images/icons_hud_battle.png", {
      frameWidth: 13,
      frameHeight: 16,
    });
        this.load.spritesheet("icons_hud_battle", "/images/icons_hud_battle.png", {
      frameWidth: 13,
      frameHeight: 16,
    });
    // Ported from android/assets/images/cursor_normal.png in project_aeii — the
    // pink diamond selection cursor, 2 frames for CursorAnimator's 0.3s pulse.
    this.load.spritesheet("cursor_normal", "/images/cursor_normal.png", {
      frameWidth: 26,
      frameHeight: 26,
    });
        // Ported from android/assets/images/cursor_normal.png in project_aeii — the
    // pink diamond selection cursor, 2 frames for CursorAnimator's 0.3s pulse.
    this.load.spritesheet("cursor_normal", "/images/cursor_normal.png", {
      frameWidth: 26,
      frameHeight: 26,
    });
    // Bespoke (not from the original) — square-with-cross cursor for the
    // move-path preview target (see input/boardInput.js's previewMovePath's
    // two-click confirm flow). Not new art: this sheet is cursor_normal.png's
    // square-bracket frames with cursor_move_target.png's cross composited on
    // top of each — both existing, previously-unused assets already in the repo.
    this.load.spritesheet("cursor_move_preview", "/images/cursor_move_preview.png", {
      frameWidth: 26,
      frameHeight: 26,
    });
    // Existing but previously unwired asset — ring cursor for attack-target
    // selection (attackTargetMode). 3 frames, not the usual 2 — see
    // updateSelectedTileHighlight's pulse, which just mods by frame count.
    this.load.spritesheet("cursor_attack", "/images/cursor_attack.png", {
      frameWidth: 40,
      frameHeight: 41,
    });
    // Ported from android/assets/images/chars_small.png — FontRenderer's small digit
    // font (12 frames of 6x7; 0-9 are the digits, used for the bottom-left HP number).
    this.load.spritesheet("chars_small", "/images/chars_small.png", {
      frameWidth: 6,
      frameHeight: 7,
    });
        // Ported from android/assets/images/chars_small.png — FontRenderer's small digit
    // font (12 frames of 6x7; 0-9 are the digits, used for the bottom-left HP number).
    this.load.spritesheet("chars_small", "/images/chars_small.png", {
      frameWidth: 6,
      frameHeight: 7,
    });
    // Ported from android/assets/images/icons_hud_status.png — StatusBarRenderer's
    // population/gold icons (3 frames of 11x11: person, gold coin, shield-cross).
    this.load.spritesheet("icons_hud_status", "/images/icons_hud_status.png", {
      frameWidth: 11,
      frameHeight: 11,
    });
    this.load.spritesheet("chars_large", "/images/chars_large.png", {
      frameWidth: 8,
      frameHeight: 11,
    });
    // Ported from android/assets/images/status.png — the four status-effect
    // badges (4 frames of 7x9): blood drop (poison), asterisk (inspire), down
    // arrow (slow), red eye (blind) — see render/units.js's STATUS_ICON_FRAME
    // for the STATUS-constant-to-frame mapping (spritesheet order doesn't
    // match combat.js's STATUS enum order, so this can't just be unit.status.type).
    this.load.spritesheet("status", "/images/status.png", {
      frameWidth: 7,
      frameHeight: 9,
    });
    // Ported from android/assets/images/tombstone.png - a single 24x24 image
    // (not a spritesheet), drawn at full tile size the same way tile_N.png's
    // source resolution doesn't matter - see render/tiles.js's refreshTombs.
    this.load.image("tombstone", "/images/tombstone.png");
    // Ported from android/assets/images/spark_attack.png - the attack-hit
    // spark burst (6 frames of 20x20) - see render/attackEffect.js.
    this.load.spritesheet("spark_attack", "/images/spark_attack.png", {
      frameWidth: 20,
      frameHeight: 20,
    });
  }

  create() {
    // Ported from this project's old "canvas sized to the board" approach
    // (see main.js's history) — but applied dynamically per-map now that
    // map choice happens at runtime, not at boot. Without this, every map
    // just renders inside whatever fixed size main.js's Phaser.Game started
    // with, leaving a large dead zone for any map smaller than that (e.g.
    // sample-map.json at 480x480 inside an 800x600 canvas) or forcing scroll
    // for any map bigger. Capped so an unusually large map still scrolls via
    // input/cameraDrag.js instead of producing an oversized browser window.
    const MAX_VIEWPORT_WIDTH = 1000;
    const MAX_VIEWPORT_HEIGHT = 700;
    const targetWidth = Math.min(this.mapData_.width * TILE_SIZE, MAX_VIEWPORT_WIDTH);
    const targetHeight = Math.min(
      BOARD_OFFSET_Y + this.mapData_.height * TILE_SIZE + BOTTOM_BAR_HEIGHT,
      MAX_VIEWPORT_HEIGHT
    );
    this.scale.resize(targetWidth, targetHeight);
    this.cameras.main.setSize(targetWidth, targetHeight);

    this.game_ = new GameState({
      mapData: this.mapData_,
      unitDefs: unitsData.units,
      tileDefs: tilesData.tiles,
      players: [
        { team: 0, type: 1, alliance: 0, gold: this.startingGold_ },
        { team: 1, type: 1, alliance: 1, gold: this.startingGold_ },
      ],
      rule: { maxLevel: this.maxLevel_, unitCapacity: this.unitCapacity_ },
    });

    // Whichever map SkirmishSetupScene passed in (see init() above) - covers
    // whatever unit/terrain layout that map defines; no longer hardcoded to
    // battle-test-map.json specifically.

    // --- interaction state (read/written by input/boardInput.js and ui/actionBar.js) ---
    this.selectedUnitId = null;
    this.pendingMoveTarget = null;
    this.buyMode = false;
    this.pendingBuyUnitIndex = null;
    this.pendingBuyCastle = null;
    this.animating = false;
    this.modalOpen = false;
    this.actionBarOpen = false;
    this.actionBarUnitId = null;
    this.actionOrigin = null;
    this.attackTargetMode = false;
    this._pendingAttacker = null;
    this.summonTargetMode = false;
    this._pendingSummoner = null;
    this.healTargetMode = false;
    this._pendingHealer = null;
    this.supportTargetMode = false;
    this._pendingSupporter = null;
    this.pendingSupportTarget = null;
    this.chargerMoveMode = false;
    this._pendingCharger = null;
    this.pendingChargerMoveTarget = null;
    this.highlightRects = [];
    this.pathPreviewRects = [];
    this.unitSprites = {};
    this.headSprites = {};
    this.actionBarContainer = null;
    this.elapsedMs = 0;

    drawTileGrid(this, (x, y) => onTileClick(this, x, y));
    refreshTombs(this);
    refreshUnits(this);
    createHud(this);
    createStatsPanel(this);
    setupCameraDrag(this);
  }

    update(time, delta) {
    this.elapsedMs += delta;
    animateUnits(this, this.elapsedMs);
    updateSelectedTileHighlight(this, this.elapsedMs);
  }
}
