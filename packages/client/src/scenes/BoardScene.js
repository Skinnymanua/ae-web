import Phaser from "phaser";
import { GameState } from "@ae/shared/src/game-state.js";
import { getWinnerAlliance, PLAYER_TYPE } from "@ae/shared/src/turn.js";
import unitsData from "@ae/shared/data/units.json";
import tilesData from "@ae/shared/data/tiles.json";
import { MAPS } from "../maps/index.js";
import { PLAYER_TYPE_OPTIONS, ALLIANCE_OPTIONS } from "./skirmishSettings.js";
import { TILE_SIZE, BOARD_OFFSET_Y } from "../constants.js";
import { BOTTOM_BAR_HEIGHT } from "../ui/bottomBar.js";
import { deserializeGameState } from "../net/deserializeGameState.js";
import { setupNetworkedGameSync } from "../net/runGameAction.js";
import { runPendingRobotTurns } from "../net/robotDriver.js";
import { replayOpponentAction } from "../net/replayOpponentAction.js";
import { clearActiveSession } from "../net/sessionPersistence.js";

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
   * Receives whatever scene.start("BoardScene", data) was called with.
   * Two shapes:
   *   - local skirmish (see SkirmishSetupScene#startGame): mapData + the
   *     three configurable settings, builds a fresh local GameState.
   *   - networked (see NetworkLobbyScene#startGame): { networked: true,
   *     socket, session, team, gameState } - gameState is a server snapshot
   *     to deserialize rather than a mapData to build fresh from, and every
   *     mutating action routes over `socket` instead of calling scene.game_
   *     directly (see net/runGameAction.js).
   * Falls back to the first auto-discovered map and the original's own
   * defaults if launched directly with no data (e.g. during dev iteration
   * on this scene alone), so local mode never hard-crashes for missing input.
   */
  init(data) {
    this.networked_ = !!data?.networked;
    if (this.networked_) {
      this.net_ = { socket: data.socket, team: data.team, session: data.session, pendingResolve: null, pendingReject: null };
      this.initialSnapshot_ = data.gameState;
    } else {
      this.mapData_ = data?.mapData ?? MAPS[0]?.data;
      this.maxLevel_ = data?.maxLevel ?? 3; // Rule.getDefaultRule()'s implicit cap
      this.startingGold_ = data?.startingGold ?? 300;
      this.unitCapacity_ = data?.unitCapacity ?? 15; // POPULATION_PRESET[0]
      this.playerCount_ = data?.playerCount ?? 2;
      // From GameSettingScene, if the player ever visited it - see the
      // players array built in create() below. Undefined (never visited)
      // falls back to the original hardcoded behavior: every slot is a
      // human (PLAYER_TYPE.LOCAL) on its own separate alliance.
      this.playerTypeIndices_ = data?.playerTypeIndices;
      this.allianceIndices_ = data?.allianceIndices;
    }
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
    // Board dimensions for canvas sizing (see below) come from either the
    // local mapData or the networked snapshot - both carry width/height in
    // the same shape (a GameState instance's own width/height fields for
    // the snapshot, since that's literally what it's a serialization of).
    const boardWidth = this.networked_ ? this.initialSnapshot_.width : this.mapData_.width;
    const boardHeight = this.networked_ ? this.initialSnapshot_.height : this.mapData_.height;

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
    const targetWidth = Math.min(boardWidth * TILE_SIZE, MAX_VIEWPORT_WIDTH);
    const targetHeight = Math.min(BOARD_OFFSET_Y + boardHeight * TILE_SIZE + BOTTOM_BAR_HEIGHT, MAX_VIEWPORT_HEIGHT);
    this.scale.resize(targetWidth, targetHeight);
    this.cameras.main.setSize(targetWidth, targetHeight);

    if (this.networked_) {
      // Deserialized from the server's snapshot, not built fresh - see
      // net/deserializeGameState.js. Every subsequent mutating action goes
      // through net/runGameAction.js instead of calling scene.game_
      // directly; see input/boardInput.js/ui/actionBar.js/ui/bottomBar.js
      // for those call sites, all `await runGameAction(scene, ...)` now.
      this.game_ = deserializeGameState(this.initialSnapshot_, unitsData.units, tilesData.tiles);
      setupNetworkedGameSync(this, unitsData.units, tilesData.tiles, (msg, previousGameState) =>
        this.onOpponentAction(msg, previousGameState)
      );
      this.onGameOver = () => this.showGameOverScreen();
    } else {
      this.game_ = new GameState({
        mapData: this.mapData_,
        unitDefs: unitsData.units,
        tileDefs: tilesData.tiles,
        // One player per team, own alliance each unless GameSettingScene
        // set something else - see this.playerTypeIndices_/allianceIndices_
        // above and skirmishSettings.js's PLAYER_TYPE_OPTIONS/ALLIANCE_OPTIONS
        // for what those indices map to. A "None" team still gets a players[]
        // entry (turn.js's isTeamAlive already treats PLAYER_TYPE.NONE as not
        // alive, same as it always has for any team slot beyond playerCount_).
        players: Array.from({ length: this.playerCount_ }, (_, team) => ({
          team,
          type: this.playerTypeIndices_ ? PLAYER_TYPE_OPTIONS[this.playerTypeIndices_[team]].value : PLAYER_TYPE.LOCAL,
          alliance: this.allianceIndices_ ? ALLIANCE_OPTIONS[this.allianceIndices_[team]] - 1 : team,
          gold: this.startingGold_,
        })),
        rule: { maxLevel: this.maxLevel_, unitCapacity: this.unitCapacity_ },
      });
      this.onGameOver = () => this.showGameOverScreen();
    }

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

    // Covers only the (unusual, but GameSettingScene does allow it) case
    // where team 0 itself is a Robot - runPendingRobotTurns is a no-op for
    // everyone else (see isRobotControlledTurn: false whenever
    // this.networked_ or the current team isn't PLAYER_TYPE.AI). Fired and
    // forgotten rather than awaited - nothing here needs to block on it,
    // same as the End Turn handler's own call in ui/bottomBar.js.
    if (!this.networked_) runPendingRobotTurns(this);
  }

  /**
   * Networked-mode only: fired by net/runGameAction.js's persistent
   * game_update listener when a broadcast reports the OPPONENT's action
   * (not something this client itself sent - see setupNetworkedGameSync's
   * own docstring on that distinction). scene.game_ has already been
   * replaced with the fresh authoritative snapshot by the time this runs;
   * `previousGameState` is what it was immediately before that, still
   * holding pre-action positions for anyone this action just killed - see
   * net/replayOpponentAction.js, which does the actual animation work.
   */
  onOpponentAction(msg, previousGameState) {
    replayOpponentAction(this, msg, previousGameState);
  }

  /**
   * End-of-game screen for BOTH local skirmish and networked play - shown
   * once scene.game_.gameOver is true (see net/runGameAction.js's two
   * onGameOver call sites, one per mode, both wired to this same method).
   * Reads the winner straight off the current game state rather than
   * needing anything passed in - by the time this fires, scene.game_
   * already reflects the game that just ended, in both modes.
   *
   * Networked sessions are already gone server-side by this point (see
   * server/src/sessions.js's applySessionAction - "removed on
   * victory/defeat"), so "Back to Menu" is the only meaningful action here;
   * there's no game left to return to or leave gracefully, just the local
   * socket to close.
   */
  showGameOverScreen() {
    const { width, height } = this.cameras.main;
    this.modalOpen = true; // blocks further board/bottom-bar clicks - same flag ui/dialogs.js's own modals use

    this.add.rectangle(0, 0, width, height, 0x000000, 0.65).setScrollFactor(0).setDepth(1000);

    // getWinnerAlliance returns an ALLIANCE number, not a team number - for
    // local skirmish and today's 2-player networked games these are the
    // same thing (both SkirmishSetupScene and CreateGameScene assign each
    // player alliance === team), so this is displayed as the winning team
    // directly. Revisit this equivalence if/when true multi-team alliances
    // (e.g. 2v2 in a 4-player game) exist - it would no longer hold then.
    //
    // Networked mode reads this from net/runGameAction.js's stashed
    // net_.lastWinnerAlliance instead of recomputing it here - by the time
    // this method runs, this.game_ never received the final game-ending
    // update (its broadcast's gameState is null - the session's already
    // gone server-side), so getWinnerAlliance(this.game_) would incorrectly
    // still show both teams alive.
    const winnerAlliance = this.networked_ ? this.net_.lastWinnerAlliance : getWinnerAlliance(this.game_);
    const titleText = winnerAlliance >= 0 ? `Team ${winnerAlliance} Wins!` : "Game Over";
    this.add
      .text(width / 2, height / 2 - 30, titleText, { fontSize: "32px", color: "#ffdd44", fontStyle: "bold" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1001);

    if (this.networked_ && winnerAlliance >= 0) {
      const won = winnerAlliance === this.net_.team;
      this.add
        .text(width / 2, height / 2 + 10, won ? "Victory!" : "Defeat", {
          fontSize: "20px",
          color: won ? "#44dd88" : "#dd4444",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1001);
    }

    const backButton = this.add
      .text(width / 2, height / 2 + 60, "[ Back to Menu ]", { fontSize: "18px", color: "#44aaff" })
      .setOrigin(0.5)
      .setInteractive()
      .setScrollFactor(0)
      .setDepth(1001);
    backButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      if (this.networked_ && this.net_?.socket) {
        // The session is already gone server-side at this point (see this
        // method's own docstring above), but clear the client's persisted
        // copy too (see net/sessionPersistence.js) so ReconnectScene doesn't
        // try to resume a match that's already over on the next boot.
        clearActiveSession();
        this.net_.socket.send("leave_session");
        this.net_.socket.close();
      }
      this.scene.start("MenuScene");
    });
  }

    update(time, delta) {
    this.elapsedMs += delta;
    animateUnits(this, this.elapsedMs);
    updateSelectedTileHighlight(this, this.elapsedMs);
  }
}
