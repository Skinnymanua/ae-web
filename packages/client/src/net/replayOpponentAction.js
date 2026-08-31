/**
 * Plays the same visual feedback for the OPPONENT's confirmed action that
 * the acting player's own client already gets via input/boardInput.js's
 * confirm* functions (playAttackHitSequence, animateHpChanges,
 * animateUnitMove, etc.) - called from BoardScene#onOpponentAction, itself
 * invoked by net/runGameAction.js's setupNetworkedGameSync whenever a
 * game_update broadcast isn't the confirmation of something THIS client
 * sent.
 *
 * `previousGameState` (see setupNetworkedGameSync's own docstring) is the
 * GameState as it stood immediately BEFORE this action was applied - needed
 * for attack/heal specifically, since a unit that died in the exchange is
 * already gone from the fresh post-action snapshot by the time this runs,
 * and the spark/shake effect still needs to know where it used to be.
 *
 * Not every action type has special handling here - support, summon,
 * occupy, and repair fall through to a plain refresh, because none of
 * THOSE have an elaborate animation for the acting player either (see
 * their own confirm-functions and onClick handlers in input/boardInput.js
 * and ui/actionBar.js) - a plain refresh already matches what the acting
 * player themselves would have seen. standby is usually the same (also no
 * elaborate animation locally) - EXCEPT when the standing-by unit itself
 * carries REFRESH_AURA and actually healed or hit something nearby, which
 * does get an hp-change animation, matching ui/actionBar.js's own
 * finishUnitAction.
 */
import { TILE_SIZE, BOARD_OFFSET_Y } from "../constants.js";
import { refreshUnits, animateUnitMove } from "../render/units.js";
import { refreshTombs } from "../render/tiles.js";
import { refreshStatsPanel } from "../ui/statsPanel.js";
import { updateInfoText } from "../ui/hud.js";
import { animateHpChanges } from "../render/hpChange.js";
import { animateAttackHit, playAttackHitSequence } from "../render/attackEffect.js";

function finishReplay(scene) {
  refreshUnits(scene);
  refreshTombs(scene);
  refreshStatsPanel(scene);
  updateInfoText(scene);
  scene.animating = false;
}

/** Same as finishReplay, but for the one case (buyUnitAt) that needs
 * refreshUnits() to run BEFORE the animation starts (a brand-new unit has
 * no sprite yet to reposition/animate until refreshUnits creates one), not
 * after - see the buyUnitAt branch below. */
function finishReplayAlreadyRefreshedUnits(scene) {
  refreshTombs(scene);
  refreshStatsPanel(scene);
  updateInfoText(scene);
  scene.animating = false;
}

/** Builds a positionsById map the same way confirmPendingAttack/
 * confirmPendingHeal do locally, but reading from `previousGameState`
 * (pre-action) instead of already-in-scope unit variables, since this
 * client never selected/clicked those units itself. */
function positionsFromEvents(events, idKeys, previousGameState) {
  const positionsById = {};
  for (const event of events) {
    for (const key of idKeys) {
      const id = event[key];
      if (id && !positionsById[id]) {
        const unit = previousGameState.getUnit(id);
        if (unit) positionsById[id] = { id, x: unit.x, y: unit.y };
      }
    }
  }
  return positionsById;
}

export function replayOpponentAction(scene, msg, previousGameState) {
  const { actionType, params, result } = msg;
  scene.animating = true;

  if (actionType === "attack" && result?.events) {
    const positionsById = positionsFromEvents(result.events, ["attackerId", "defenderId"], previousGameState);
    const hits = result.events
      .filter((e) => e.type === "ATTACK")
      .map((e) => {
        const pos = positionsById[e.defenderId];
        if (!pos) return null;
        return { targetUnitId: pos.id, x: pos.x, y: pos.y, damage: e.damage };
      })
      .filter(Boolean);
    playAttackHitSequence(scene, hits, () => finishReplay(scene));
    return;
  }

  if (actionType === "heal" && result?.events) {
    const positionsById = positionsFromEvents(result.events, ["healerId", "targetId"], previousGameState);
    const hpChanges = result.events
      .filter((e) => e.type === "HEAL")
      .map((e) => {
        const pos = positionsById[e.targetId];
        if (!pos) return null;
        return { unitId: pos.id, x: pos.x, y: pos.y, change: e.change };
      })
      .filter(Boolean);
    animateHpChanges(scene, hpChanges, () => finishReplay(scene));
    return;
  }

  if (actionType === "destroyTile" && params) {
    animateAttackHit(scene, null, params.x, params.y, null, () => finishReplay(scene));
    return;
  }

  if (actionType === "moveUnit" && params?.path?.length > 0) {
    const unit = scene.game_.getUnit(params.unitId);
    if (unit) {
      animateUnitMove(scene, unit, params.path, () => finishReplay(scene));
      return;
    }
  }

  if (actionType === "endTurn" && Array.isArray(result?.hpChanges) && result.hpChanges.length > 0) {
    // Self-sufficient already - turn.js's own hpChanges entries carry
    // {unitId, x, y, change} directly, no previousGameState lookup needed.
    animateHpChanges(scene, result.hpChanges, () => finishReplay(scene));
    return;
  }

  if (actionType === "standby" && Array.isArray(result?.hpChanges) && result.hpChanges.length > 0) {
    // Empty unless the standing-by unit itself carries REFRESH_AURA and
    // actually healed (or hit) something nearby - see GameState#standby's
    // own comment. Same shape as endTurn's own hpChanges, self-sufficient
    // for the same reason.
    animateHpChanges(scene, result.hpChanges, () => finishReplay(scene));
    return;
  }

  if (actionType === "buyUnitAt" && result && params) {
    // Mirrors input/boardInput.js's handleBuyPlacementClick exactly: the
    // bought unit has no sprite yet, so refreshUnits() has to run FIRST to
    // create one (at its final resting tile) - then that fresh sprite gets
    // snapped back to the castle tile and walked forward, the same
    // "spawn at the castle, cosmetically walk to the destination" trick
    // the acting player's own client plays.
    refreshUnits(scene);
    const unit = scene.game_.getUnit(result.id);
    const path = unit
      ? scene.game_.getSpawnMovePath(params.unitIndex, params.castleX, params.castleY, params.team, params.destX, params.destY)
      : [];
    const sprite = unit ? scene.unitSprites[unit.id] : null;
    if (unit && sprite && path.length > 0) {
      sprite.x = params.castleX * TILE_SIZE + TILE_SIZE / 2;
      sprite.y = params.castleY * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y;
      const head = scene.headSprites[unit.id];
      if (head) {
        head.x = params.castleX * TILE_SIZE + (TILE_SIZE * 7) / 24;
        head.y = params.castleY * TILE_SIZE + BOARD_OFFSET_Y;
      }
      animateUnitMove(scene, unit, path, () => finishReplayAlreadyRefreshedUnits(scene));
      return;
    }
    finishReplayAlreadyRefreshedUnits(scene);
    return;
  }

  finishReplay(scene);
}
