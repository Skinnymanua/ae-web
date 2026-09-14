import { TILE_SIZE, BOARD_OFFSET_Y, DEPTH } from "../constants.js";
import { getMaxHp } from "@ae/shared/src/combat-resolution.js";
import { STATUS } from "@ae/shared/src/combat.js";
import { getUnitSpriteKey, isStandaloneUnitTexture } from "./unitTexture.js";

const FRAMES_PER_ROW = 19; // unit count — matches ResourceManager's texture_size derivation

// status.png's frame order (blood drop, asterisk, down arrow, red eye) doesn't
// match combat.js's STATUS enum order (POISONED=0, SLOWED=1, INSPIRED=2,
// BLINDED=3), hence this explicit map rather than using status.type directly.
const STATUS_ICON_FRAME = {
  [STATUS.POISONED]: 0,
  [STATUS.INSPIRED]: 1,
  [STATUS.SLOWED]: 2,
  [STATUS.BLINDED]: 3,
};
const STATUS_ICON_SIZE = TILE_SIZE / 3;

// FontRenderer: schar_width/height = ts * 6/24, ts * 7/24 — scaled from a 24px-tile design.
const SCHAR_WIDTH = (TILE_SIZE * 6) / 24;
const SCHAR_HEIGHT = (TILE_SIZE * 7) / 24;

/**
 * Syncs unit sprites (+ head overlay + HP number + status badge) to current
 * game_ state - called from 23 different places across the client (every
 * move, attack, heal, occupy, repair, standby, buy, summon, support, end
 * turn, and every robot action), so what this function actually costs
 * matters a lot, especially on mobile.
 *
 * Body and head sprites are now updated IN PLACE (position + tint on an
 * existing Phaser sprite) rather than destroyed and recreated every call -
 * this used to tear down and rebuild every unit sprite on the WHOLE board
 * on every single action, even ones that only touched one unit, which is
 * real, avoidable GC/allocation pressure that mobile CPUs feel far more
 * than desktop does. A unit's texture (body frame, head frame) is fixed
 * for its whole lifetime once created - unitIndex/team/head never change
 * on an existing unit - so there's nothing to update there after creation,
 * only position (moves) and tint (standby toggling).
 *
 * HP-digit and status-icon sprites stay destroy-and-recreate, but now only
 * for the ONE unit being processed, not the whole board - correctness here
 * is genuinely simpler that way (digit COUNT changes as HP changes between
 * 1 and 2+ digits, status icons appear/disappear entirely), and these only
 * exist at all for damaged/status-afflicted units, not every unit on the
 * board, so the per-call cost was never the dominant one the way the
 * unconditional body+head sprites were.
 */
/** New sprite fading/scaling in from nothing - the summon action's own
 * effect (no equivalent existed before; every other action already had one:
 * attack's spark sequence, heal's floating numbers, occupy/repair's tile
 * swap + banner). Targets whatever's already in scene.unitSprites for
 * unitId - call this AFTER refreshUnits() has created that sprite, not
 * before. Purely cosmetic pacing, same as every other animate* helper in
 * this file - resolves once the tween finishes. */
export function animateResurrection(scene, unitId) {
  const sprite = scene.unitSprites[unitId];
  const head = scene.headSprites[unitId];
  const targets = head ? [sprite, head] : [sprite];
  if (!sprite) return Promise.resolve();

  targets.forEach((t) => {
    t.setAlpha(0);
    t.setScale(t.scaleX * 0.3, t.scaleY * 0.3);
  });

  return new Promise((resolve) => {
    scene.tweens.add({
      targets,
      alpha: 1,
      scaleX: (target) => target.scaleX / 0.3,
      scaleY: (target) => target.scaleY / 0.3,
      duration: 400,
      ease: "Back.Out",
      onComplete: resolve,
    });
  });
}

export function refreshUnits(scene) {
  const seenIds = new Set(scene.game_.units.map((u) => u.id));

  // Sweep sprites for units that no longer exist (died, etc.) - anything
  // left behind here would otherwise just sit at its last position forever.
  // unit.id is always a string (game-state.js's generateUnitId: "unit-N"),
  // matching Object.entries' own string keys directly - no numeric
  // conversion needed.
  for (const [id, sprite] of Object.entries(scene.unitSprites)) {
    if (!seenIds.has(id)) {
      sprite.destroy();
      delete scene.unitSprites[id];
    }
  }
  for (const [id, sprite] of Object.entries(scene.headSprites)) {
    if (!seenIds.has(id)) {
      sprite.destroy();
      delete scene.headSprites[id];
    }
  }
  // Same sweep for HP-digit/status sprites - these are rebuilt per-unit
  // inside the loop below for units that still exist, but a unit that just
  // died needs its old ones cleaned up here too, or they'd sit at its last
  // position forever the same way an unswept body/head sprite would.
  for (const [id, digits] of Object.entries(scene.hpDigitSprites)) {
    if (!seenIds.has(id)) {
      for (const d of digits) d.destroy();
      delete scene.hpDigitSprites[id];
    }
  }
  for (const [id, sprite] of Object.entries(scene.statusIconSprites)) {
    if (!seenIds.has(id)) {
      sprite.destroy();
      delete scene.statusIconSprites[id];
    }
  }

  for (const unit of scene.game_.units) {
    const topLeftX = unit.x * TILE_SIZE;
    const topLeftY = unit.y * TILE_SIZE + BOARD_OFFSET_Y;
    const tint = unit.standby ? 0x888888 : 0xffffff;

    let sprite = scene.unitSprites[unit.id];
    if (sprite) {
      sprite.setPosition(topLeftX + TILE_SIZE / 2, topLeftY + TILE_SIZE / 2);
      sprite.setTint(tint);
      sprite.setData("standby", unit.standby);
    } else {
      const { key: spriteKey, frame: spriteFrame } = getUnitSpriteKey(unit.unitIndex, unit.team);
      sprite = scene.add.sprite(topLeftX + TILE_SIZE / 2, topLeftY + TILE_SIZE / 2, spriteKey, spriteFrame);
      sprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
      sprite.setTint(tint);
      sprite.setData("unitIndex", unit.unitIndex);
      sprite.setData("standby", unit.standby);
      sprite.setDepth(DEPTH.UNITS);
      // Not interactive: unit sprites sit on top of their tile, and the tile's
      // own pointerdown (drawTileGrid) handles selection/movement. Keeping units
      // non-interactive avoids blocking that click — see boardInput.js for how
      // the stats panel gets updated on selection instead of hover.
      scene.unitSprites[unit.id] = sprite;
    }

    if (unit.isCommander) {
      // Original draws heads in libGDX's Y-up coordinate space; Phaser/canvas is Y-down,
      // so the original's "+ ts/2" offset becomes "no offset" here (top half of the tile,
      // over the shoulders, not the bottom half).
      const headX = topLeftX + (TILE_SIZE * 7) / 24;
      let head = scene.headSprites[unit.id];
      if (head) {
        head.setPosition(headX, topLeftY);
        head.setTint(tint);
      } else {
        head = scene.add.image(headX, topLeftY, "heads", unit.head ?? 0);
        head.setOrigin(0, 0);
        head.setDisplaySize((TILE_SIZE * 13) / 24, (TILE_SIZE * 12) / 24);
        head.setTint(tint);
        head.setDepth(DEPTH.UNITS);
        scene.headSprites[unit.id] = head;
      }
    }

    // HP digits and the status badge stay destroy-and-recreate, but scoped
    // to just this unit now (see this function's own docstring for why).
    for (const d of scene.hpDigitSprites[unit.id] ?? []) d.destroy();
    scene.hpDigitSprites[unit.id] = [];

    // Ported from CanvasRenderer#drawUnitWithInformation: only shown while damaged,
    // digits drawn bottom-left of the tile via FontRenderer#drawSNumber.
    const maxHp = getMaxHp(unit);
    if (unit.currentHp !== maxHp) {
      const digits = String(unit.currentHp).split("").map(Number);
      const digitY = topLeftY + TILE_SIZE - SCHAR_HEIGHT;
      digits.forEach((n, i) => {
        const digitSprite = scene.add.sprite(topLeftX + i * SCHAR_WIDTH, digitY, "chars_small", n);
        digitSprite.setOrigin(0, 0);
        digitSprite.setDisplaySize(SCHAR_WIDTH, SCHAR_HEIGHT);
        digitSprite.setDepth(DEPTH.UNITS);
        scene.hpDigitSprites[unit.id].push(digitSprite);
      });
    }

    scene.statusIconSprites[unit.id]?.destroy();
    delete scene.statusIconSprites[unit.id];

    // Ported from android/assets/images/status.png via
    // CanvasRenderer#drawUnitWithInformation - the original draws this at
    // (screen_x, screen_y + ts - sh), i.e. the SAME left edge as the HP
    // digits above (screen_x, screen_y, no adjustment - confirmed against
    // that already-correct port) with just a vertical offset toward the
    // top, not the tile's right edge. This used to render top-RIGHT here -
    // a genuine mismatch from the source, not a deliberate placement
    // choice; there's also a separate level-up badge in the original,
    // undrawn in this port so far, that DOES belong on the right (same Y as
    // this, mirrored X - screen_x + ts - sw) - worth keeping in mind if
    // that ever gets built, so the two don't collide.
    if (unit.status) {
      const iconFrame = STATUS_ICON_FRAME[unit.status.type];
      const iconSprite = scene.add.sprite(
        topLeftX + STATUS_ICON_SIZE / 2 + 2,
        topLeftY + STATUS_ICON_SIZE / 2 + 2,
        "status",
        iconFrame
      );
      iconSprite.setDisplaySize(STATUS_ICON_SIZE, STATUS_ICON_SIZE);
      iconSprite.setDepth(DEPTH.UNITS);
      scene.statusIconSprites[unit.id] = iconSprite;
    }
  }
}

/** Alternates every non-standby unit between its two idle frames every 0.3s
 * (matches the original's CanvasRenderer#getCurrentFrame timing exactly). */
export function animateUnits(scene, elapsedMs) {
  const frame = Math.floor(elapsedMs / 300) % 2;
  for (const sprite of Object.values(scene.unitSprites)) {
    if (sprite.getData("standby")) continue;
    const unitIndex = sprite.getData("unitIndex");
    sprite.setFrame(isStandaloneUnitTexture(unitIndex) ? frame : frame * FRAMES_PER_ROW + unitIndex);
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
      y: y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y,
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
        y: y * TILE_SIZE + BOARD_OFFSET_Y,
        duration: stepDuration,
      });
    }
  };
  doStep();
}
