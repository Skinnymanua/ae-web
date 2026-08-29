/**
 * Ported from animation/HpChangeAnimator.java — a floating "+N" / "-N" number
 * (drawn with the "large" digit font, chars_large.png) that rises then falls
 * back down over a unit's tile. Uses the original's exact 22-entry y-offset
 * curve, stepped at 30fps (~0.73s total) rather than continuously tweened,
 * since the original steps through fixed frames.
 *
 * The original's render loop draws these numbers on TOP of the unit's own
 * sprite every frame instead of a separate submit-and-forget effect, and the
 * y-offset table is authored for libGDX's Y-up screen space (subtracting the
 * offset moves the number UP). Phaser is Y-down, so the sign flips here:
 * ADDING the offset gives the same rise-then-settle-below motion.
 *
 * Callers are expected to invoke this BEFORE refreshUnits() removes any
 * sprites for units that died from the change (e.g. castle siege damage
 * dropping a unit to 0 hp) — the original plays this HP_CHANGE animation
 * while the unit is still on screen, then runs a separate UNIT_DESTROY
 * animation after. We don't port unit-destroy animation yet (out of scope
 * for this pass), so refreshUnits()'s subsequent redraw is what actually
 * removes it, right after the number finishes floating.
 */
import { TILE_SIZE, BOARD_OFFSET_Y, DEPTH } from "../constants.js";

const Y_OFFSET = [2, 0, -1, -1, -2, -2, -2, -2, -1, -1, 0, 1, 2, 4, 6, 4, 3, 4, 6, 6, 6, 6];
const FRAME_DURATION_MS = 1000 / 30; // original's `1f/30` per-frame step

// FontRenderer: lchar_width/height = ts * 8/24, ts * 11/24 — scaled from the
// same 24px-tile design as the small HP digits in render/units.js.
const LCHAR_WIDTH = (TILE_SIZE * 8) / 24;
const LCHAR_HEIGHT = (TILE_SIZE * 11) / 24;

// chars_large.png frame layout (13 frames): 0-9 digits, 12 '+', 11 '-', 10 '/' (unused here).
const LCHAR_PLUS = 12;
const LCHAR_MINUS = 11;

/**
 * Plays every entry in `changes` (shape: [{unitId, x, y, change}], as
 * returned by GameState#endTurn / turn.js's nextTurn) simultaneously on one
 * shared clock, then calls onComplete. Sets scene.animating for the duration,
 * same convention as render/units.js's animateUnitMove.
 */
export function animateHpChanges(scene, changes, onComplete) {
  const active = (changes ?? []).filter((c) => c.change !== 0);
  if (active.length === 0) {
    onComplete?.();
    return;
  }

  scene.animating = true;

  const sprites = [];
  for (const { x, y, change } of active) {
    const digits = String(Math.abs(change)).split("").map(Number);
    const frames = [change > 0 ? LCHAR_PLUS : LCHAR_MINUS, ...digits];
    const totalWidth = frames.length * LCHAR_WIDTH;
    const baseX = x * TILE_SIZE + (TILE_SIZE - totalWidth) / 2;
    const baseY = y * TILE_SIZE + BOARD_OFFSET_Y + (TILE_SIZE - LCHAR_HEIGHT) / 2;

    frames.forEach((frame, i) => {
      const sprite = scene.add.sprite(baseX + i * LCHAR_WIDTH, baseY, "chars_large", frame);
      sprite.setOrigin(0, 0);
      sprite.setDisplaySize(LCHAR_WIDTH, LCHAR_HEIGHT);
      // Explicit depth, matching every other per-unit overlay (see
      // constants.js's DEPTH comment on why this project doesn't rely on
      // creation order) - without it this falls back to Phaser's default (0),
      // rendering BENEATH the unit sprites (DEPTH.UNITS) it's meant to float
      // above. CURSOR tier is a reasonable fit: same "temporary overlay on
      // top of a unit" role the selection/attack-target cursor already has.
      sprite.setDepth(DEPTH.CURSOR);
      sprite.setData("baseY", baseY);
      sprites.push(sprite);
    });
  }

  let frameIndex = 0;
  const applyFrame = () => {
    const offsetPx = (Y_OFFSET[frameIndex] * TILE_SIZE) / 24;
    for (const sprite of sprites) sprite.y = sprite.getData("baseY") + offsetPx;
  };
  applyFrame();

  scene.time.addEvent({
    delay: FRAME_DURATION_MS,
    repeat: Y_OFFSET.length - 2, // frame 0 already drawn above; this fires once per remaining frame (1..21)
    callback: () => {
      if (frameIndex >= Y_OFFSET.length - 1) return; // guard against any extra firing
      frameIndex = Math.min(frameIndex + 1, Y_OFFSET.length - 1);
      applyFrame();
      if (frameIndex >= Y_OFFSET.length - 1) {
        for (const sprite of sprites) sprite.destroy();
        scene.animating = false;
        onComplete?.();
      }
    },
  });
}
