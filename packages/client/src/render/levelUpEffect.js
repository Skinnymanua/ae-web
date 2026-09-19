/**
 * Ported from animation/UnitLevelUpAnimator.java - the visual for a unit
 * crossing a level threshold: the unit's own sprite flashes to a solid
 * white silhouette, fades back to normal, then flashes white again right
 * before the effect ends.
 *
 * The original does this with a "white mask" shader blended over the
 * unit's normal draw, ramped by a single float each frame: frames 0-10 ramp
 * it DOWN from 1.0 to 0.0 ((10 - frame) * 0.1 - starts fully white, clears
 * to normal by the midpoint), frames 11-20 ramp it back UP from ~0.1 to 1.0
 * ((frame - 10) * 0.1 - fades toward white again by the very end, right
 * before the animator is torn down and normal rendering resumes). 20 frames
 * at a fixed 15fps clock (isAnimationFinished: stateTime >= 20/15), so
 * ~1.33s total.
 *
 * Phaser has no built-in per-sprite shader-mask equivalent as simple to
 * reach for as libGDX's here, so this reproduces the same visual with a
 * separate overlay sprite: same texture/frame as the unit's own body (and
 * head, for a commander), tinted solid white via setTintFill (fills the
 * sprite's own alpha shape with one color, ignoring its actual texture
 * colors - the direct Phaser equivalent of "draw this white"), with only
 * ITS alpha animated on the same 0-10-20 timeline. At alpha 1 the white
 * overlay fully hides the normal sprite beneath it (reads as solid white);
 * at alpha 0 it's invisible (reads as the normal sprite) - same visual
 * result as the original's shader blend, without needing a custom Phaser
 * pipeline.
 */
import { DEPTH } from "../constants.js";

const FRAME_MS = 1000 / 15;
const TOTAL_FRAMES = 20;

function maskAlphaForFrame(frame) {
  return frame <= 10 ? (10 - frame) * 0.1 : (frame - 10) * 0.1;
}

/**
 * Plays the flash over `unit`'s existing body/head sprites (scene.unitSprites/
 * headSprites - must already exist, i.e. call after refreshUnits has run for
 * this unit). Calls onComplete when done; sets scene.animating, same
 * convention as animateHpChanges/animateAttackHit/animateUnitMove.
 */
export function animateLevelUp(scene, unitId, onComplete) {
  scene.animating = true;

  const bodySprite = scene.unitSprites[unitId];
  const headSprite = scene.headSprites[unitId];
  if (!bodySprite) {
    // Unit already gone (e.g. destroyed in the same action that leveled it
    // up - shouldn't normally happen, since gaining a level implies landing
    // a hit and surviving, but this is the same defensive shape every
    // other animate* helper in this codebase uses for a vanished target.
    scene.animating = false;
    onComplete?.();
    return;
  }

  const overlays = [bodySprite, headSprite].filter(Boolean).map((sprite) => {
    const overlay = scene.add[sprite.texture.key.startsWith("unit_sheet") ? "sprite" : "image"](
      sprite.x,
      sprite.y,
      sprite.texture.key,
      sprite.frame.name
    );
    overlay.setOrigin(sprite.originX, sprite.originY);
    overlay.setDisplaySize(sprite.displayWidth, sprite.displayHeight);
    overlay.setDepth(DEPTH.UNITS + 1); // just above the unit it's masking
    overlay.setTintFill(0xffffff);
    overlay.setAlpha(maskAlphaForFrame(0));
    return overlay;
  });

  let frame = 0;
  scene.time.addEvent({
    delay: FRAME_MS,
    repeat: TOTAL_FRAMES,
    callback: () => {
      frame++;
      if (frame >= TOTAL_FRAMES) {
        for (const overlay of overlays) overlay.destroy();
        scene.animating = false;
        onComplete?.();
        return;
      }
      const alpha = maskAlphaForFrame(frame);
      for (const overlay of overlays) overlay.setAlpha(alpha);
    },
  });
}

/**
 * Plays animateLevelUp for each id in `unitIds` one after another (matches
 * render/attackEffect.js's playAttackHitSequence's own shape for chaining
 * multiple animations from one action - an attack immediately followed by
 * a counter can level up both the attacker AND the countering defender in
 * the same action). Calls onComplete once all have played, or immediately
 * if `unitIds` is empty.
 */
export function playLevelUpSequence(scene, unitIds, onComplete) {
  if (!unitIds || unitIds.length === 0) {
    onComplete?.();
    return;
  }
  const [unitId, ...rest] = unitIds;
  animateLevelUp(scene, unitId, () => {
    playLevelUpSequence(scene, rest, onComplete);
  });
}
