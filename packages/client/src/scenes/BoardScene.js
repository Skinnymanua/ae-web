import Phaser from "phaser";
import { GameState, instantiateUnit } from "@ae/shared/src/game-state.js";
import unitsData from "@ae/shared/data/units.json";
import tilesData from "@ae/shared/data/tiles.json";
import mapData from "../sample-map.json";

import { drawTileGrid, updateSelectedTileHighlight } from "../render/tiles.js";
import { refreshUnits, animateUnits } from "../render/units.js";
import { createHud } from "../ui/hud.js";
import { createStatsPanel } from "../ui/statsPanel.js";
import { onTileClick } from "../input/boardInput.js";

export class BoardScene extends Phaser.Scene {
  preload() {
    for (let i = 0; i < 89; i++) {
      this.load.image(`tile_${i}`, `/images/tiles/tile_${i}.png`);
    }
    for (let team = 0; team < 4; team++) {
      this.load.spritesheet(`unit_sheet_${team}`, `/images/units/unit_sheet_${team}.png`, {
        frameWidth: 24,
        frameHeight: 24,
      });
    }
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
  }

  create() {
    this.game_ = new GameState({
      mapData,
      unitDefs: unitsData.units,
      tileDefs: tilesData.tiles,
      players: [
        { team: 0, type: 1, alliance: 0, gold: 300 },
        { team: 1, type: 1, alliance: 1, gold: 300 },
      ],
    });

    // TEMP: manually spawn a team-1 enemy for testing attack — remove once
    // real multi-team map/spawn logic exists.
    const enemyDef = unitsData.units[0];
    const enemyUnit = instantiateUnit(enemyDef, { team: 1, x: 2, y: 2 });
    enemyUnit._tile = this.game_.getTileAt(2, 2);
    this.game_.units.push(enemyUnit);
    this.game_.players[1].population += enemyDef.occupancy;

    // --- interaction state (read/written by input/boardInput.js and ui/actionBar.js) ---
    this.selectedUnitId = null;
    this.buyMode = false;
    this.pendingBuyUnitIndex = null;
    this.animating = false;
    this.modalOpen = false;
    this.actionBarOpen = false;
    this.actionBarUnitId = null;
    this.actionOrigin = null;
    this.attackTargetMode = false;
    this._pendingAttacker = null;
    this.highlightRects = [];
    this.unitSprites = {};
    this.headSprites = {};
    this.actionBarContainer = null;
    this.elapsedMs = 0;

    drawTileGrid(this, (x, y) => onTileClick(this, x, y));
    refreshUnits(this);
    createHud(this);
    createStatsPanel(this);
  }

    update(time, delta) {
    this.elapsedMs += delta;
    animateUnits(this, this.elapsedMs);
    updateSelectedTileHighlight(this, this.elapsedMs);
  }
}
