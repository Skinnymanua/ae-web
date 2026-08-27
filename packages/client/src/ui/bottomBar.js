/**
 * Bottom bar — loosely ported from StatusBarRenderer.java, which drew the
 * currently-hovered tile (with its defence bonus) plus population and gold along
 * the bottom edge. We don't show population here (not asked for), and there's no
 * turn-limit concept in the shared package yet, so "turn" is just the current turn
 * number, not a countdown. There's also no hourglass/turn icon asset in the source
 * repo, so that one's a small Graphics-drawn clock rather than a ported sprite.
 *
 * Unlike the original (which tracks the pointer continuously), tile info here
 * updates on click — see updateBottomBarTile()'s call site in input/boardInput.js.
 *
 * The whole bar now doubles as the End Turn button (replacing the old floating
 * "[ End Turn ]" text that used to sit awkwardly over the board) — it still shows
 * tile/gold/turn info, but a right-aligned "End Turn ▶" label plus a click
 * anywhere on the bar triggers the end-turn confirm flow.
 */
import { TILE_SIZE } from "../constants.js";
import { showConfirm } from "./dialogs.js";
import { clearHighlights } from "../render/tiles.js";
import { refreshUnits } from "../render/units.js";
import { refreshStatsPanel } from "./statsPanel.js";
import { animateHpChanges } from "../render/hpChange.js";

export const BOTTOM_BAR_HEIGHT = 44;
const BAR_HEIGHT = BOTTOM_BAR_HEIGHT;
const PREVIEW_SIZE = 36;
const END_TURN_ZONE_WIDTH = 100;

export function createBottomBar(scene) {
  const barWidth = scene.game_.width * TILE_SIZE;
  const barY = scene.cameras.main.height - BAR_HEIGHT;
  const container = scene.add.container(0, barY);
  container.setScrollFactor(0);

  const bg = scene.add
    .rectangle(0, 0, barWidth, BAR_HEIGHT, 0x1a1a1a, 0.85)
    .setOrigin(0, 0)
    .setScrollFactor(0)  
    .setInteractive();
  container.add(bg);
  bg.on("pointerdown", () => {
    if (scene.modalOpen || scene.animating || scene.actionBarOpen) return;
    showConfirm(scene, "End your turn?", () => {
      const result = scene.game_.endTurn();
      scene.selectedUnitId = null;
      clearHighlights(scene);
      updateBottomBarEconomy(scene);
      animateHpChanges(scene, result.hpChanges, () => {
        refreshUnits(scene);
        refreshStatsPanel(scene);
      });
    });
  });
  // Right-hand zone visually reads as the End Turn button, set off from the
  // info section by a thin divider.
  const zoneX = barWidth - END_TURN_ZONE_WIDTH;
  const zoneBg = scene.add.rectangle(zoneX, 0, END_TURN_ZONE_WIDTH, BAR_HEIGHT, 0x3a3210, 0.6).setOrigin(0, 0);
  container.add(zoneBg);
  const divider = scene.add.rectangle(zoneX, 0, 2, BAR_HEIGHT, 0xffffff, 0.15).setOrigin(0, 0);
  container.add(divider);
  const endTurnText = scene.add
    .text(zoneX + END_TURN_ZONE_WIDTH / 2, BAR_HEIGHT / 2, "End Turn \u25b6", { fontSize: "15px", color: "#ffdd44" })
    .setOrigin(0.5, 0.5);
  container.add(endTurnText);

  // --- selected (clicked) tile preview + terrain specs ---
  const previewX = 4;
  const previewY = (BAR_HEIGHT - PREVIEW_SIZE) / 2;
  const previewBg = scene.add
    .rectangle(previewX, previewY, PREVIEW_SIZE, PREVIEW_SIZE, 0x000000, 0.4)
    .setOrigin(0, 0)
    .setStrokeStyle(1, 0xffffff, 0.5);
  container.add(previewBg);

  const previewSprite = scene.add.image(previewX + PREVIEW_SIZE / 2, previewY + PREVIEW_SIZE / 2, "tile_0");
  previewSprite.setDisplaySize(PREVIEW_SIZE, PREVIEW_SIZE);
  container.add(previewSprite);

  const terrainText = scene.add.text(previewX + PREVIEW_SIZE + 8, 6, "-", { fontSize: "13px", color: "#ffffff" });
  container.add(terrainText);
  const terrainSubText = scene.add.text(previewX + PREVIEW_SIZE + 8, 23, "-", { fontSize: "11px", color: "#aaaaaa" });
  container.add(terrainSubText);

  // --- gold (icons_hud_status frame 1 — the ported StatusBarRenderer gold coin) ---
  const goldX = 240;
  const goldIcon = scene.add.image(goldX, BAR_HEIGHT / 2, "icons_hud_status", 1);
  goldIcon.setDisplaySize(20, 20);
  container.add(goldIcon);
  const goldText = scene.add
    .text(goldX + 16, BAR_HEIGHT / 2, "-", { fontSize: "15px", color: "#ffdd44" })
    .setOrigin(0, 0.5);
  container.add(goldText);

  // --- turn count (no original asset found — drawn as a simple clock) ---
  // Kept clear of the End Turn zone on the right (zoneX = barWidth - 100).
  const turnX = 300;
  const clockG = scene.add.graphics();
  clockG.lineStyle(2, 0xffffff, 1);
  clockG.strokeCircle(turnX, BAR_HEIGHT / 2, 9);
  clockG.beginPath();
  clockG.moveTo(turnX, BAR_HEIGHT / 2);
  clockG.lineTo(turnX, BAR_HEIGHT / 2 - 6);
  clockG.moveTo(turnX, BAR_HEIGHT / 2);
  clockG.lineTo(turnX + 4, BAR_HEIGHT / 2);
  clockG.strokePath();
  container.add(clockG);
  const turnText = scene.add
    .text(turnX + 16, BAR_HEIGHT / 2, "-", { fontSize: "15px", color: "#ffffff" })
    .setOrigin(0, 0.5);
  container.add(turnText);

  scene.bottomBar = { container, previewSprite, terrainText, terrainSubText, goldText, turnText };

  updateBottomBarEconomy(scene);
}

/** Updates the tile-preview section — call whenever a tile gets clicked (see
 * boardInput.js's onTileClick) or after anything that could change a tile's
 * texture in place (e.g. a capture). */
export function updateBottomBarTile(scene, x, y) {
  const bar = scene.bottomBar;
  const tile = scene.game_.getTileAt(x, y);
  bar.previewSprite.setTexture(`tile_${tile.index}`);
  bar.terrainText.setText(tile.typeName ?? "-");
  bar.terrainSubText.setText(`Def +${tile.defenceBonus}  Move ${tile.stepCost}`);
}

/** Updates gold + turn — call after anything that changes either (buy, end turn, etc). */
export function updateBottomBarEconomy(scene) {
  const bar = scene.bottomBar;
  const player = scene.game_.players[scene.game_.currentTeam];
  bar.goldText.setText(String(player?.gold ?? 0));
  bar.turnText.setText(`Turn ${scene.game_.turn}`);
}