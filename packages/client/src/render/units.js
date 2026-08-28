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

/** Destroys and redraws every unit sprite (+ head overlay + HP number + status
 * badge) from current game_ state. */
export function refreshUnits(scene) {
  for (const sprite of Object.values(scene.unitSprites)) sprite.destroy();
  for (const sprite of Object.values(scene.headSprites)) sprite.destroy();
  for (const digits of Object.values(scene.hpDigitSprites ?? {})) {
    for (const d of digits) d.destroy();
  }
  for (const sprite of Object.values(scene.statusIconSprites ?? {})) sprite.destroy();
  scene.unitSprites = {};
  scene.headSprites = {};
  scene.hpDigitSprites = {};
  scene.statusIconSprites = {};

  for (const unit of scene.game_.units) {
    const topLeftX = unit.x * TILE_SIZE;
    const topLeftY = unit.y * TILE_SIZE + BOARD_OFFSET_Y;

    const { key: spriteKey, frame: spriteFrame } = getUnitSpriteKey(unit.unitIndex, unit.team);
    const sprite = scene.add.sprite(topLeftX + TILE_SIZE / 2, topLeftY + TILE_SIZE / 2, spriteKey, spriteFrame);
    sprite.setDisplaySize(TILE_SIZE, TILE_SIZE);
    sprite.setTint(unit.standby ? 0x888888 : 0xffffff);
    sprite.setData("unitIndex", unit.unitIndex);
    sprite.setData("standby", unit.standby);
    sprite.setDepth(DEPTH.UNITS);
    // Not interactive: unit sprites sit on top of their tile, and the tile's
    // own pointerdown (drawTileGrid) handles selection/movement. Keeping units
    // non-interactive avoids blocking that click — see boardInput.js for how
    // the stats panel gets updated on selection instead of hover.
    scene.unitSprites[unit.id] = sprite;

    if (unit.isCommander) {
      // Original draws heads in libGDX's Y-up coordinate space; Phaser/canvas is Y-down,
      // so the original's "+ ts/2" offset becomes "no offset" here (top half of the tile,
      // over the shoulders, not the bottom half).
      const head = scene.add.image(topLeftX + (TILE_SIZE * 7) / 24, topLeftY, "heads", unit.head ?? 0);
      head.setOrigin(0, 0);
      head.setDisplaySize((TILE_SIZE * 13) / 24, (TILE_SIZE * 12) / 24);
      head.setTint(unit.standby ? 0x888888 : 0xffffff);
      head.setDepth(DEPTH.UNITS);
      scene.headSprites[unit.id] = head;
    }

    // Ported from CanvasRenderer#drawUnitWithInformation: only shown while damaged,
    // digits drawn bottom-left of the tile via FontRenderer#drawSNumber.
    const maxHp = getMaxHp(unit);
    scene.hpDigitSprites[unit.id] = [];
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

    // Ported from android/assets/images/status.png - shown top-right of the
    // tile (HP digits already own bottom-left, head overlay owns top-center)
    // whenever the unit carries an active status. See STATUS_ICON_FRAME above
    // for which badge maps to which of the four STATUS types.
    if (unit.status) {
      const iconFrame = STATUS_ICON_FRAME[unit.status.type];
      const iconSprite = scene.add.sprite(
        topLeftX + TILE_SIZE - STATUS_ICON_SIZE / 2 - 2,
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
