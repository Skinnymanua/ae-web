import Phaser from "phaser";
import { ACTION_ICON, STAT_ICON, TILE_SIZE, BOARD_OFFSET_Y, DEPTH } from "../constants.js";
import { clearHighlights, highlightPositionSet, refreshTileTexture, refreshTombs } from "../render/tiles.js";
import { refreshUnits } from "../render/units.js";
import { showBuyMenu } from "./dialogs.js";
import { updateInfoText } from "./hud.js";
import { refreshStatsPanel } from "./statsPanel.js";
import { handleActionBarCancelClick } from "../input/boardInput.js";
import { BOTTOM_BAR_HEIGHT } from "./bottomBar.js";
import { panCameraToUnit, getCameraTargetForUnit } from "../render/camera.js";
import { canMoveAgain } from "@ae/shared/src/combat.js";
import { runGameAction } from "../net/runGameAction.js";

/** Returns [{x,y}] of enemy-occupied tiles within `unit`'s attack range. */
function getAttackableEnemyPositions(scene, unit) {
  const positions = scene.game_.getAttackablePositions(unit.id);
  const result = [];
  for (const key of positions) {
    const [tx, ty] = key.split(",").map(Number);
    const target = scene.game_.getUnitAt(tx, ty);
    if (target && target.team !== unit.team) result.push({ x: tx, y: ty });
  }
  return result;
}

/** Returns [{x,y}] of empty, destroyable tiles within `unit`'s attack range -
 * the DESTROYER's alternative attack target, alongside enemy units above.
 * Ported from GameCore#canAttack's defender==null branch, which folds both
 * cases into the SAME attack action rather than a separate one - see
 * enterAttackTargetMode below highlighting both sets together. */
function getDestroyableTilePositions(scene, unit) {
  const positions = scene.game_.getAttackablePositions(unit.id);
  const result = [];
  for (const key of positions) {
    const [tx, ty] = key.split(",").map(Number);
    if (scene.game_.getUnitAt(tx, ty)) continue; // occupied - a unit attack, not a tile-destroy target
    if (scene.game_.canDestroyTile(unit.id, tx, ty)) result.push({ x: tx, y: ty });
  }
  return result;
}

export function clearActionBar(scene) {
  if (scene.actionBarContainer) {
    scene.actionBarContainer.destroy();
    scene.actionBarContainer = null;
  }
  scene.actionBarOpen = false;
  scene.actionBarUnitId = null;
}

/** Marks the unit's turn as done, closes the bar, and re-renders. Async now
 * (see runGameAction below) - every caller fire-and-forgets this the same
 * way they already fire-and-forget the OTHER async confirm functions in
 * input/boardInput.js (nothing downstream needs to await its completion),
 * so none of those call sites needed to change. */
export async function finishUnitAction(scene, unit) {
  // Re-fetched by id rather than trusting the passed-in reference directly -
  // in networked mode, scene.game_ gets wholesale REPLACED with a freshly
  // deserialized instance once the action's broadcast arrives (see
  // net/runGameAction.js), so any `unit` object a caller captured BEFORE
  // that await is now a detached, possibly-stale snapshot - e.g. an
  // attacker that took counter damage would still show its PRE-attack HP.
  // Harmless in local mode, where it's already the live object.
  unit = scene.game_.getUnit(unit.id) ?? unit;
  if (!unit) return;
  // Routed through GameState#standby (not a direct unit.standby=true mutation)
  // so the aura scan runs - see turn.js's applyAuraEffects: a nearby
  // ATTACK_AURA/SLOWING_AURA/REFRESH_AURA holder needs every standby to
  // trigger it, not just its own. Goes through runGameAction (not a direct
  // call) even here - standby has real authoritative effects (aura
  // triggers, tomb hazard poison), so networked mode needs the server to
  // confirm it just like any other action, not just apply it locally.
  await runGameAction(scene, "standby", unit.id);
  clearActionBar(scene);
  scene.selectedUnitId = null;
  scene.actionOrigin = null;
  clearHighlights(scene);
  refreshUnits(scene);
  refreshTombs(scene); // standby may have just consumed a tomb (applyTombHazard) or an attack just before it may have created one
  updateInfoText(scene);
  refreshStatsPanel(scene);
}

/**
 * Called after attack/heal/summon/occupy resolve (never after an explicit
 * Standby click - see combat.js's canMoveAgain docstring for why). A
 * CHARGER unit that survived its own action and still has movement points
 * left over gets to reposition before its turn actually ends - ported from
 * OperationExecutor#onActionFinish's canMoveAgain branch (STATE_REMOVE).
 * Otherwise this is just finishUnitAction.
 */
export function finishUnitActionOrCharge(scene, unit) {
  // Same re-fetch-by-id reasoning as finishUnitAction above - canMoveAgain
  // below reads currentHp/currentMovementPoint/abilities directly off
  // `unit`, so a stale networked-mode reference could give a wrong answer
  // (e.g. an attacker that took lethal counter damage still showing alive).
  // If the unit is gone entirely (died from that same counter), fall
  // through to finishUnitAction directly rather than falling back to the
  // stale object - canMoveAgain on a stale "still alive" reference would
  // incorrectly say yes for a unit that's actually dead now.
  const freshUnit = scene.game_.getUnit(unit.id);
  if (!freshUnit) {
    finishUnitAction(scene, unit);
    return;
  }
  if (!canMoveAgain(freshUnit)) {
    finishUnitAction(scene, freshUnit);
    return;
  }
  enterChargerMoveMode(scene, freshUnit);
}

/**
 * Highlights wherever `unit` can still reach with its LEFTOVER movement
 * points (not reset to max - that's the whole point of canMoveAgain) in the
 * same yellow as normal movement selection, but deliberately WITHOUT the red
 * extended-attack overlay normal selection also shows: a charger's bonus
 * move can only end the turn once resolved (see input/boardInput.js's
 * confirmChargerMove going straight to finishUnitAction, no action bar
 * shown again - ported from OperationExecutor#onMoveFinish's STATE_REMOVE
 * branch), so it can never be followed by another attack.
 */
function enterChargerMoveMode(scene, unit) {
  scene.chargerMoveMode = true;
  scene._pendingCharger = unit;
  clearHighlights(scene);
  const { positions } = scene.game_.getMovablePositions(unit.id);
  highlightPositionSet(scene, positions, 0xffcc33, 0.45);
}

/** Highlights every tile within unit's attack range in red - enemy units AND,
 * for a DESTROYER, empty destroyable tiles are both valid targets within this
 * same range (see getDestroyableTilePositions above), so the full range set
 * is highlighted indiscriminately rather than filtering to just enemies. */
export function enterAttackTargetMode(scene, unit) {
  clearActionBar(scene);
  scene.attackTargetMode = true;
  scene._pendingAttacker = unit;
  clearHighlights(scene);
  highlightPositionSet(scene, scene.game_.getAttackablePositions(unit.id), 0xdd4444, 0.4);
}

/** Same shape as enterAttackTargetMode above, for the Summon action -
 * highlights unoccupied-tomb tiles within the necromancer's own attack
 * range (see GameState#getSummonablePositions) in a distinct color so it
 * doesn't read as an attack. */
export function enterSummonTargetMode(scene, unit) {
  clearActionBar(scene);
  scene.summonTargetMode = true;
  scene._pendingSummoner = unit;
  clearHighlights(scene);
  highlightPositionSet(scene, scene.game_.getSummonablePositions(unit.id), 0x9933cc, 0.4);
}

/** Same shape as enterAttackTargetMode above, for the Heal action -
 * highlights valid heal targets within the healer's own attack range PLUS
 * its own tile (self-heal - see GameState#getHealablePositions) in green.
 * Can include an enemy tile too (heal-as-damage against an UNDEAD enemy),
 * so this doesn't filter by team the way attack's highlight implicitly
 * does through getAttackableEnemyPositions - getHealablePositions already
 * only returns tiles canHeal actually approves. */
export function enterHealTargetMode(scene, unit) {
  clearActionBar(scene);
  scene.healTargetMode = true;
  scene._pendingHealer = unit;
  clearHighlights(scene);
  highlightPositionSet(scene, scene.game_.getHealablePositions(unit.id), 0x33cc66, 0.4);
}

/** Same shape as enterHealTargetMode above, for the Druid's Support ability
 * (a custom addition - see combat.js's ABILITY.SUPPORT comment). Highlights
 * valid support targets - an ally that's ALREADY gone standby this turn,
 * within the Druid's own attack range, that isn't a CHARGER, isn't the
 * commander, and isn't a higher level than the Druid (see
 * GameState#getSupportablePositions) - in a distinct blue so it doesn't
 * read as either heal or attack. */
export function enterSupportTargetMode(scene, unit) {
  clearActionBar(scene);
  scene.supportTargetMode = true;
  scene._pendingSupporter = unit;
  clearHighlights(scene);
  highlightPositionSet(scene, scene.game_.getSupportablePositions(unit.id), 0x3399ff, 0.4);
}

// Compass slots around the unit — confirmed against a real screenshot of the
// commercial game (not in the open-source project_aeii repo at all — that one's a
// plain centered horizontal row). Move is always "left" and standby always "top"
// when both are shown; whatever other actions apply (attack, occupy, repair, buy,
// summon) fill "right" first, then the corners, in priority order — e.g. a
// commander on his own castle with no enemy in range gets buy on the RIGHT (not a
// fixed slot), because attack isn't available to compete for it that turn.
const RADIUS = TILE_SIZE * 0.95;
const BUTTON_RADIUS = 20;
const ICON_CLEARANCE = BUTTON_RADIUS + 2; // button radius + a small gap, for clamping to stay on-board
const SLOT_OFFSET = {
  top: { x: 0, y: -RADIUS },
  topRight: { x: RADIUS * 0.7, y: -RADIUS * 0.7 },
  right: { x: RADIUS, y: 0 },
  bottomRight: { x: RADIUS * 0.7, y: RADIUS * 0.7 },
  // bottom: reserved for heal/resurrect once that logic exists
  bottomLeft: { x: -RADIUS * 0.7, y: RADIUS * 0.7 },
  left: { x: -RADIUS, y: 0 },
  topLeft: { x: -RADIUS * 0.7, y: -RADIUS * 0.7 },
};
const OTHER_ACTION_SLOT_ORDER = ["right", "topRight", "topLeft", "bottomRight", "bottomLeft"];

/**
 * The contextual icon bar shown once a unit has confirmed its position
 * (moved, or chose to stay put) — positions icons in compass slots around
 * the unit itself instead of the original's centered bottom row.
 */
export function showActionBar(scene, unit, x, y) {
  clearActionBar(scene);
  scene.actionBarOpen = true;
  scene.actionBarUnitId = unit.id;

  const tile = scene.game_.getTileAt(x, y);
  const attackable = getAttackableEnemyPositions(scene, unit);
  // Non-empty only for a DESTROYER with an empty, destroyable tile in range
  // (see GameCore#canAttack's defender==null branch) - folded into the SAME
  // Attack button/target-mode as enemy units, not a separate action.
  const destroyableTiles = getDestroyableTilePositions(scene, unit);
  const canOccupy = scene.game_.canOccupyTile(unit.id, x, y);
  const canRepairHere = scene.game_.canRepairTile(unit.id, x, y);
  // Buying via the action bar is gated to the commander/king specifically -
  // shared/game-state.js's canBuyUnit only checks tile ownership (any friendly
  // unit could technically trigger it), but the action-bar button itself should
  // only appear when the king is the one standing on the castle. Any other
  // friendly unit occupying the castle gets no purchase option here; buying
  // with the castle empty instead goes through the direct tile-click shortcut
  // in input/boardInput.js (handleUnitSelectionClick).
  const canBuyHere = tile.castle && tile.team === unit.team && unit.isCommander;
  // Non-empty only for a NECROMANCER with an unoccupied tomb within its own
  // attack range - see GameState#getSummonablePositions. Computing the full
  // set here (not just a boolean) means enterSummonTargetMode below can
  // reuse it directly rather than recomputing.
  const summonable = scene.game_.getSummonablePositions(unit.id);
  // Same idea for Heal - non-empty only for a HEALER with a valid target
  // (an ally, itself, or an UNDEAD enemy) in range. See GameState#getHealablePositions.
  const healable = scene.game_.getHealablePositions(unit.id);
  // Same idea for Support (custom addition) - non-empty only for a
  // SUPPORT-carrying unit with a valid target in range. See GameState#getSupportablePositions.
  const supportable = scene.game_.getSupportablePositions(unit.id);

  const otherActions = [];
  if (attackable.length > 0 || destroyableTiles.length > 0) {
    otherActions.push({ frame: ACTION_ICON.ATTACK, onClick: () => enterAttackTargetMode(scene, unit) });
  }
  if (summonable.size > 0) {
    otherActions.push({ frame: ACTION_ICON.SUMMON, onClick: () => enterSummonTargetMode(scene, unit) });
  }
  if (healable.size > 0) {
    otherActions.push({ frame: ACTION_ICON.HEAL, onClick: () => enterHealTargetMode(scene, unit) });
  }
  if (supportable.size > 0) {
    otherActions.push({ frame: ACTION_ICON.SUPPORT, onClick: () => enterSupportTargetMode(scene, unit) });
  }
  if (canOccupy) {
    otherActions.push({
      frame: ACTION_ICON.OCCUPY,
      onClick: async () => {
        scene.animating = true;
        await runGameAction(scene, "occupy", unit.id, x, y);
        scene.animating = false;
        refreshTileTexture(scene, x, y);
        finishUnitActionOrCharge(scene, unit);
      },
    });
  }
  if (canRepairHere) {
    otherActions.push({
      frame: ACTION_ICON.REPAIR,
      onClick: async () => {
        scene.animating = true;
        await runGameAction(scene, "repair", unit.id, x, y);
        scene.animating = false;
        refreshTileTexture(scene, x, y);
        finishUnitActionOrCharge(scene, unit);
      },
    });
  }
  if (canBuyHere) {
    otherActions.push({
      frame: ACTION_ICON.BUY,
      onClick: () => {
        // Deliberately no finishUnitAction here - opening the shop isn't
        // itself a turn-ending action, and neither is buying: the original
        // engine's own Buy button just does setState(STATE_SELECT) +
        // showDialog("store"), nothing else - the king is never marked
        // standby by this. clearActionBar leaves both scene.selectedUnitId
        // and scene.actionBarUnitId null (selectedUnitId was already null
        // going into this action bar - see confirmPendingMove/
        // handleActingUnitClick), so whether the player cancels out of the
        // shop or completes a purchase, the king is simply left as an
        // ordinary not-yet-acted unit: fully movable/attackable if clicked
        // again, exactly like before Buy was ever clicked.
        clearActionBar(scene);
        showBuyMenu(scene, x, y);
      },
    });
  }

  const slots = [];
  if (otherActions.length === 0) {
    // Nothing to actually choose between — standby is the only real action, so
    // there's no point offering "move" as a reconsideration alongside it.
    slots.push({ slot: "top", frame: ACTION_ICON.STANDBY, onClick: () => finishUnitAction(scene, unit) });
  } else {
    slots.push({ slot: "left", frame: STAT_ICON.MOVE, onClick: () => handleActionBarCancelClick(scene) });
    otherActions.forEach((action, i) => {
      slots.push({ ...action, slot: OTHER_ACTION_SLOT_ORDER[i] ?? "right" });
    });
    slots.push({ slot: "top", frame: ACTION_ICON.STANDBY, onClick: () => finishUnitAction(scene, unit) });
  }

  const cx = unit.x * TILE_SIZE + TILE_SIZE / 2;
  const cy = unit.y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y;

  panCameraToUnit(scene, unit);
  // The camera pan (above) is what actually solves icon overflow now — icons are
  // free to land in the black area beyond the board, since the camera brings that
  // space into view around the unit. This clamp is just a final safety net against
  // the post-pan viewport itself, not the board's edges.
  const { scrollX, scrollY } = getCameraTargetForUnit(scene, unit);
  const viewLeft = scrollX + ICON_CLEARANCE;
  const viewRight = scrollX + scene.cameras.main.width - ICON_CLEARANCE;
  const viewTop = scrollY + BOARD_OFFSET_Y + ICON_CLEARANCE; // never render over the top stats bar
  const viewBottom = scrollY + (scene.cameras.main.height - BOTTOM_BAR_HEIGHT) - ICON_CLEARANCE;

  scene.actionBarContainer = scene.add.container(0, 0);
  scene.actionBarContainer.setDepth(DEPTH.ACTION_BAR);

  slots.forEach(({ slot, frame, onClick }, i) => {
    const offset = SLOT_OFFSET[slot];
    const targetX = Math.max(viewLeft, Math.min(viewRight, cx + offset.x));
    const targetY = Math.max(viewTop, Math.min(viewBottom, cy + offset.y));

    const bg = scene.add.circle(cx, cy, BUTTON_RADIUS, 0x222222, 0.9).setStrokeStyle(2, 0xffffff);
    // Arc/Circle shapes' default setInteractive() (no explicit shape/callback)
    // builds its hit area as a plain Rectangle sized to the object's bounding
    // box, but that rectangle - like every Phaser hitArea - is anchored to the
    // TOP-LEFT of the bounding box, ignoring the shape's own origin. An earlier
    // pass at this fix used Circle(0, 0, BUTTON_RADIUS), assuming (0,0) meant
    // "the shape's own center" - it doesn't; (0,0) is the top-left corner, so
    // that put the hit-circle's center a full radius up-and-left of the actual
    // button, which is worse than the original bug, not a fix of it. The
    // correct center in that top-left-anchored space is (radius, radius) -
    // matching Phaser's own docs example for a circular hit area.
    bg.setInteractive(new Phaser.Geom.Circle(BUTTON_RADIUS, BUTTON_RADIUS, BUTTON_RADIUS), Phaser.Geom.Circle.Contains);
    const iconImg = scene.add.image(cx, cy, "icons_action", frame);
    iconImg.setDisplaySize(32, 32); // was 24 — too much padding inside the 40px circle
    // pointerup (not pointerdown) to match the tile sprites underneath (see
    // render/tiles.js), and stopPropagation so that same tile's own pointerup
    // handler doesn't also fire and cancel the action bar out from under this click.
    bg.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      onClick();
    });
    scene.actionBarContainer.add([bg, iconImg]);

    // Pop out from the unit's center to its compass slot, staggered per button —
    // with exactly 3 buttons active the resting positions form a visible triangle.
    bg.setScale(0.3);
    iconImg.setScale(0.3);
    scene.tweens.add({
      targets: [bg, iconImg],
      x: targetX,
      y: targetY,
      scale: 1,
      duration: 180,
      delay: i * 40,
      ease: "Back.Out",
    });
  });
}