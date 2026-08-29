/**
 * Ported from animation/UnitAttackAnimator.java - the visual for landing a
 * hit: a looping 6-frame spark burst over the target's tile, the target's
 * own sprite jittering randomly (re-rolled roughly every 66ms), and a
 * static "-N" damage number for the whole ~400ms duration.
 *
 * Deliberately distinct from render/hpChange.js's rising HpChangeAnimator -
 * the original reserves that one for Heal and end-of-turn hp changes
 * (terrain heal/poison/siege) only. Combat damage always uses this simpler,
 * static-number effect instead - see GameEventExecutor#onAttack calling
 * submitUnitAttackAnimation, never submitHpChangeAnimation. Also covers
 * DESTROYER's tile-targeting (submitUnitAttackAnimation(attacker, x, y), no
 * target unit, no damage number) via the optional targetUnitId/damage params.
 *
 * spark_attack.png: 6 frames of 20x20 each, played at 30fps looping.
 * Duration: 1/30 * 12 = 400ms (matches isAnimationFinished()), during which
 * the spark loops exactly twice.
 */
import { TILE_SIZE, BOARD_OFFSET_Y, DEPTH } from "../constants.js";

const SPARK_FRAME_MS = 1000 / 30;
const SPARK_FRAME_COUNT = 6;
const SHAKE_STEP_MS = 1000 / 15;
const TOTAL_DURATION_MS = (1000 / 30) * 12; // 400ms
const SHAKE_RANGE_PX = TILE_SIZE / 12; // ts()/12 in the original, jitter re-rolled each step within ±half this

// Same large-digit convention as render/hpChange.js's rising number - reused
// here for the static one, always minus-prefixed (combat damage only, never
// a heal - see combat-resolution.js's resolveAttack always producing >= 0).
const LCHAR_WIDTH = (TILE_SIZE * 8) / 24;
const LCHAR_HEIGHT = (TILE_SIZE * 11) / 24;
const LCHAR_MINUS = 11;

/**
 * Plays the hit effect at tile (x, y). `targetUnitId` (jittered for the
 * duration) and `damage` (shown as a static "-N") are both optional - omit
 * both for DESTROYER's tile-only targeting, which has no unit to shake and
 * no damage number in the original either. Calls onComplete when done; sets
 * scene.animating, same convention as animateHpChanges/animateUnitMove.
 */
export function animateAttackHit(scene, targetUnitId, x, y, damage, onComplete) {
  scene.animating = true;

  const bodySprite = targetUnitId ? scene.unitSprites[targetUnitId] : null;
  const headSprite = targetUnitId ? scene.headSprites[targetUnitId] : null;
  const bodyHome = bodySprite ? { x: bodySprite.x, y: bodySprite.y } : null;
  const headHome = headSprite ? { x: headSprite.x, y: headSprite.y } : null;

  const sparkSize = (TILE_SIZE * 20) / 24;
  const sparkOffset = (TILE_SIZE - sparkSize) / 2;
  const sparkSprite = scene.add.sprite(
    x * TILE_SIZE + sparkOffset + sparkSize / 2,
    y * TILE_SIZE + BOARD_OFFSET_Y + sparkOffset + sparkSize / 2,
    "spark_attack",
    0
  );
  sparkSprite.setDisplaySize(sparkSize, sparkSize);
  sparkSprite.setDepth(DEPTH.CURSOR);

  const digitSprites = [];
  if (damage != null) {
    const digits = String(damage).split("").map(Number);
    const frames = [LCHAR_MINUS, ...digits];
    const totalWidth = frames.length * LCHAR_WIDTH;
    const baseX = x * TILE_SIZE + (TILE_SIZE - totalWidth) / 2;
    const baseY = y * TILE_SIZE + BOARD_OFFSET_Y + (TILE_SIZE - LCHAR_HEIGHT) / 2;
    frames.forEach((frame, i) => {
      const sprite = scene.add.sprite(baseX + i * LCHAR_WIDTH, baseY, "chars_large", frame);
      sprite.setOrigin(0, 0);
      sprite.setDisplaySize(LCHAR_WIDTH, LCHAR_HEIGHT);
      sprite.setDepth(DEPTH.CURSOR);
      digitSprites.push(sprite);
    });
  }

  let sparkFrame = 0;
  const sparkTimer = scene.time.addEvent({
    delay: SPARK_FRAME_MS,
    loop: true,
    callback: () => {
      sparkFrame = (sparkFrame + 1) % SPARK_FRAME_COUNT;
      sparkSprite.setFrame(sparkFrame);
    },
  });

  const shakeTimer = scene.time.addEvent({
    delay: SHAKE_STEP_MS,
    loop: true,
    callback: () => {
      const dx = Math.random() * SHAKE_RANGE_PX - SHAKE_RANGE_PX / 2;
      const dy = Math.random() * SHAKE_RANGE_PX - SHAKE_RANGE_PX / 2;
      if (bodySprite) {
        bodySprite.x = bodyHome.x + dx;
        bodySprite.y = bodyHome.y + dy;
      }
      if (headSprite) {
        headSprite.x = headHome.x + dx;
        headSprite.y = headHome.y + dy;
      }
    },
  });

  scene.time.delayedCall(TOTAL_DURATION_MS, () => {
    sparkTimer.remove();
    shakeTimer.remove();
    sparkSprite.destroy();
    for (const sprite of digitSprites) sprite.destroy();
    if (bodySprite) {
      bodySprite.x = bodyHome.x;
      bodySprite.y = bodyHome.y;
    }
    if (headSprite) {
      headSprite.x = headHome.x;
      headSprite.y = headHome.y;
    }
    scene.animating = false;
    onComplete?.();
  });
}

/**
 * Plays each entry in `hits` (shape: [{targetUnitId?, x, y, damage?}, ...])
 * one after another, not simultaneously - matching how an attack followed
 * by a counter submits two separate UnitAttackAnimator instances in
 * sequence in the original, not at once. Calls onComplete once all have
 * played (or immediately if `hits` is empty).
 */
export function playAttackHitSequence(scene, hits, onComplete) {
  if (!hits || hits.length === 0) {
    onComplete?.();
    return;
  }
  const [hit, ...rest] = hits;
  animateAttackHit(scene, hit.targetUnitId, hit.x, hit.y, hit.damage, () => {
    playAttackHitSequence(scene, rest, onComplete);
  });
}
