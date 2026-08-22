import { TILE_SIZE } from "../constants.js";
import { getMaxHp } from "@ae/shared/src/combat-resolution.js";
import { updateStatsPanel } from "../ui/statsPanel.js";

const FRAMES_PER_ROW = 19; // unit count — matches ResourceManager's texture_size derivation

function hpBarColor(fraction) {
  if (fraction > 0.5) return 0x44dd44;
  if (fraction > 0.25) return 0xdddd44;
  return 0xdd4444;
}

/** Destroys and redraws every unit sprite (+ head overlay + HP bar) from current game_ state. */
export function refreshUnits(scene) {
  for (const sprite of Object.values(scene.unitSprites)) sprite.destroy();
  for (const sprite of Object.values(scene.headSprites)) sprite.destroy();
  for (const bar of Object.values(scene.hpBars ?? {})) {
    bar.bg.destroy();
    bar.fg.destroy();
  }
  scene.unitSprites = {};
  scene.headSprites = {};
  scene.hpBars = {};

  for (const unit of scene.game_.units) {
    const topLeftX = unit.x * TILE_SIZE;
    const topLeftY = unit.y * TILE_SIZE;

    const sprite = scene.add.sprite(
      topLeftX + TILE_SIZE / 2,
      topLeftY + TILE_SIZE / 2,
      `unit_sheet_${unit.team}`,
      unit.unitIndex
    );
    sprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
    sprite.setTint(unit.standby ? 0x888888 : 0xffffff);
    sprite.setData("unitIndex", unit.unitIndex);
    sprite.setData("standby", unit.standby);
    sprite.setInteractive();
    sprite.on("pointerover", () => updateStatsPanel(scene, unit));
    sprite.on("pointerout", () => {
      const stillSelected = scene.selectedUnitId ? scene.game_.getUnit(scene.selectedUnitId) : null;
      updateStatsPanel(scene, stillSelected);
    });
    scene.unitSprites[unit.id] = sprite;

    if (unit.isCommander) {
      // Original draws heads in libGDX's Y-up coordinate space; Phaser/canvas is Y-down,
      // so the original's "+ ts/2" offset becomes "no offset" here (top half of the tile,
      // over the shoulders, not the bottom half).
      const head = scene.add.image(topLeftX + (TILE_SIZE * 7) / 24, topLeftY, "heads", unit.head ?? 0);
      head.setOrigin(0, 0);
      head.setDisplaySize((TILE_SIZE * 13) / 24, (TILE_SIZE * 12) / 24);
      head.setTint(unit.standby ? 0x888888 : 0xffffff);
      scene.headSprites[unit.id] = head;
    }

    // HP bar — not in the original (which only shows HP in the side panel), but
    // a small at-a-glance indicator is worth the extra draw calls for playability.
    const maxHp = getMaxHp(unit);
    const fraction = Math.max(unit.currentHp / maxHp, 0);
    const barWidth = TILE_SIZE - 8;
    const barY = topLeftY + TILE_SIZE - 6;
    const barBg = scene.add.rectangle(topLeftX + TILE_SIZE / 2, barY, barWidth, 5, 0x000000, 0.6);
    const barFg = scene.add.rectangle(topLeftX + 4, barY, barWidth * fraction, 5, hpBarColor(fraction));
    barFg.setOrigin(0, 0.5);
    scene.hpBars[unit.id] = { bg: barBg, fg: barFg };
  }
}

/** Alternates every non-standby unit between its two idle frames every 0.3s
 * (matches the original's CanvasRenderer#getCurrentFrame timing exactly). */
export function animateUnits(scene, elapsedMs) {
  const frame = Math.floor(elapsedMs / 300) % 2;
  for (const sprite of Object.values(scene.unitSprites)) {
    if (sprite.getData("standby")) continue;
    const unitIndex = sprite.getData("unitIndex");
    sprite.setFrame(frame * FRAMES_PER_ROW + unitIndex);
  }
}

/**
 * Tweens a unit's sprite (+ head, if any) step-by-step along `path` before the
 * engine state actually changes. 150ms/tile is a reasonable approximation —
 * the original doesn't expose an isolated walk-speed constant to port exactly.
 * Calls `onComplete` once the visual walk finishes; real state mutation should
 * happen there, not before.
 */
export function animateUnitMove(scene, unit, path, onComplete) {
  scene.animating = true;
  const sprite = scene.unitSprites[unit.id];
  const head = scene.headSprites[unit.id];
  const steps = path.slice(1); // skip the starting tile, already there
  const stepDuration = 150;
  let i = 0;

  const doStep = () => {
    if (i >= steps.length) {
      scene.animating = false;
      onComplete();
      return;
    }
    const { x, y } = steps[i];
    scene.tweens.add({
      targets: sprite,
      x: x * TILE_SIZE + TILE_SIZE / 2,
      y: y * TILE_SIZE + TILE_SIZE / 2,
      duration: stepDuration,
      onComplete: () => {
        i++;
        doStep();
      },
    });
    if (head) {
      scene.tweens.add({
        targets: head,
        x: x * TILE_SIZE + (TILE_SIZE * 7) / 24,
        y: y * TILE_SIZE,
        duration: stepDuration,
      });
    }
  };
  doStep();
}
