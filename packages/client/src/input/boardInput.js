import { animateUnitMove, refreshUnits } from "../render/units.js";
import { showActionBar, finishUnitAction, clearActionBar } from "../ui/actionBar.js";
import { showBuyMenu } from "../ui/dialogs.js";
import { updateInfoText } from "../ui/hud.js";
import { updateStatsPanel, refreshStatsPanel } from "../ui/statsPanel.js";
import { updateBottomBarTile } from "../ui/bottomBar.js";
import { TILE_SIZE, BOARD_OFFSET_Y } from "../constants.js";
import {
  clearHighlights,
  highlightPositionSet,
  highlightSelectedTile,
  clearSelectedTileHighlight,
  addHighlight,
  showCursor,
} from "../render/tiles.js";

/** Shows a unit's stats and rings its tile — the one place both stay in sync. */
function selectUnitForStats(scene, unit) {
  highlightSelectedTile(scene, unit.x, unit.y);
  updateStatsPanel(scene, unit);
}

/** Puts `unit` into ordinary movement-mode selection — move/attack range
 * highlighted, stats shown — the same state clicking any of your own fresh
 * units produces (see handleUnitSelectionClick below). Exported so a unit
 * that just spawned from a purchase (see purchaseUnit) can drop straight
 * into it without waiting for a second click. */
export function selectUnitForMovement(scene, unit) {
  scene.selectedUnitId = unit.id;
  scene.pendingMoveTarget = null;
  const { movable, extendedAttack } = scene.game_.getMoveAndAttackPositions(unit.id);
  clearHighlights(scene);
  highlightPositionSet(scene, movable, 0xffcc33, 0.45);
  highlightPositionSet(scene, extendedAttack, 0xdd4444, 0.4);
  selectUnitForStats(scene, unit);
}

/**
 * Executes a purchase chosen from the shop (ui/dialogs.js's Buy button).
 *
 * If the origin castle (castleX, castleY) is still empty, the unit is placed
 * there directly and dropped straight into ordinary movement-mode selection
 * (selectUnitForMovement) - same as clicking any other fresh unit - so the
 * player can walk it off the castle or confirm it in place, same as "It's
 * possible to keep the unit on the castle if king doesn't sit underneath".
 *
 * If the castle is occupied - only ever the king, since the buy button
 * itself is gated to that case, see ui/actionBar.js's canBuyHere - there's
 * nowhere to instantiate the unit yet: the tiles it could actually reach
 * from the castle (excluding the castle tile itself) are highlighted in
 * yellow, with its extended attack range in red - the same move+attack
 * highlighting any normal unit selection gets - and scene.buyMode waits for
 * the player to pick a movable tile via handleBuyPlacementClick below. dialogs.js's canPlacePurchase check already guarantees this set is
 * non-empty before the Buy button is even clickable - a king with nowhere to
 * retreat makes every unit un-buyable at that castle, not just this click.
 */
export function purchaseUnit(scene, unitDef, castleX, castleY, team) {
  const { movable, extendedAttack } = scene.game_.getSpawnMovablePositions(unitDef.index, castleX, castleY, team);
  const castleKey = `${castleX},${castleY}`;

  if (movable.has(castleKey)) {
    const unit = scene.game_.buyUnitAt(unitDef.index, team, castleX, castleY, castleX, castleY);
    if (!unit) return;
    refreshUnits(scene);
    updateInfoText(scene);
    refreshStatsPanel(scene);
    selectUnitForMovement(scene, unit);
    return;
  }

  scene.buyMode = true;
  scene.pendingBuyUnitIndex = unitDef.index;
  scene.pendingBuyCastle = { x: castleX, y: castleY };
  clearHighlights(scene);
  highlightPositionSet(scene, movable, 0xffcc33, 0.45);
  highlightPositionSet(scene, extendedAttack, 0xdd4444, 0.4);
}

export function onTileClick(scene, x, y) {
  if (scene.animating || scene.modalOpen) return;

  updateBottomBarTile(scene, x, y);

  if (scene.attackTargetMode) {
    handleAttackTargetClick(scene, x, y);
    return;
  }

  if (scene.actionBarOpen) {
    handleActionBarCancelClick(scene);
    return;
  }
  
  if (scene.buyMode) {
    handleBuyPlacementClick(scene, x, y);
    return;
  }

  if (!scene.selectedUnitId) {
    handleUnitSelectionClick(scene, x, y);
    return;
  }

  handleActingUnitClick(scene, x, y);
}

/**
 * Any board click while the action bar is open (other than on the bar's own icons)
 * undoes the pending move and re-selects the unit for movement — ported from the
 * original's doReverseMove()/STATE_ACTION handling, which treats a tap anywhere on
 * the board as "actually, let me reconsider" rather than requiring a dedicated
 * cancel button.
 */
export function handleActionBarCancelClick(scene) {
  const unit = scene.game_.getUnit(scene.actionBarUnitId);
  const origin = scene.actionOrigin;
  clearActionBar(scene);
  if (!unit || !origin) return;
  
  const reselectForMove = () => {
    unit.currentMovementPoint = origin.movementPoint;
    scene.selectedUnitId = unit.id;
    scene.pendingMoveTarget = null;
    const { movable, extendedAttack } = scene.game_.getMoveAndAttackPositions(unit.id);
    clearHighlights(scene);
    highlightPositionSet(scene, movable, 0xffcc33, 0.45);
    highlightPositionSet(scene, extendedAttack, 0xdd4444, 0.4);
    selectUnitForStats(scene, unit);
  };

  if (unit.x === origin.x && unit.y === origin.y) {
    // never actually moved (just confirmed in place) — no walk-back needed
    reselectForMove();
    return;
  }

  const reversePath = [...origin.path].reverse();
  animateUnitMove(scene, unit, reversePath, () => {
    unit.x = origin.x;
    unit.y = origin.y;
    unit._tile = scene.game_.getTileAt(origin.x, origin.y);
    refreshUnits(scene);
    updateInfoText(scene);
    reselectForMove();
  });
}

function handleAttackTargetClick(scene, x, y) {
  const attacker = scene._pendingAttacker;
  const target = scene.game_.getUnitAt(x, y);

  if (target && scene.game_.canAttack(attacker.id, target.id)) {
    // First click on a valid target previews it (circle cursor + its stats) and
    // waits for a second click on that same target to confirm — mirrors the
    // move-path two-click confirm above. A click on a *different* valid target
    // re-previews there instead of confirming.
    if (scene.pendingAttackTarget === target.id) {
      confirmPendingAttack(scene, attacker, target);
      return;
    }
    previewAttackTarget(scene, target);
    return;
  }

  // invalid target — back out to the action bar rather than force a finish
  scene.attackTargetMode = false;
  scene.pendingAttackTarget = null;
  clearHighlights(scene);
  selectUnitForStats(scene, attacker);
  showActionBar(scene, attacker, attacker.x, attacker.y);
}

/** Marks a valid attack target with the circle cursor and shows its stats,
 * without resolving the attack yet — remembers it as the pending target for
 * the confirming click. */
function previewAttackTarget(scene, target) {
  scene.pendingAttackTarget = target.id;
  showCursor(scene, target.x, target.y, "cursor_attack");
  updateStatsPanel(scene, target);
}

function confirmPendingAttack(scene, attacker, target) {
  scene.game_.attack(attacker.id, target.id);
  scene.attackTargetMode = false;
  scene.pendingAttackTarget = null;
  clearHighlights(scene);
  clearSelectedTileHighlight(scene);
  finishUnitAction(scene, attacker);
}

/**
 * The placement click for a purchase that couldn't spawn directly on its
 * castle (see purchaseUnit) - (x, y) must be one of the tiles that were
 * highlighted, i.e. reachable from scene.pendingBuyCastle. The unit is
 * created already standing at (x, y) - buyUnitAt places it there directly,
 * gold spent up front, mirroring how the original engine's own two-layer
 * unit stack lets it always target the castle tile and only reveals the
 * commander again once the purchase walks off - but since this port has no
 * such stacking, the walk itself is faked visually: the freshly rendered
 * sprite is snapped back to the castle's pixel position and tweened along
 * the same path getSpawnMovePath/purchaseUnit's highlight were based on,
 * purely cosmetic since the unit's real state is already final. Ends on the
 * action bar, same as a unit whose real move just resolved - spawning here
 * *was* its move for the turn, so there's no leftover movement-mode
 * selection to offer.
 */
function handleBuyPlacementClick(scene, x, y) {
  const team = scene.game_.currentTeam;
  const castle = scene.pendingBuyCastle;
  const unitDefIndex = scene.pendingBuyUnitIndex;

  scene.buyMode = false;
  scene.pendingBuyUnitIndex = null;
  scene.pendingBuyCastle = null;
  clearHighlights(scene);

  if (unitDefIndex === null || !castle) return;

  // Computed against the board as it stands right now - before the unit
  // exists - since afterward it would just block its own starting tile.
  const path = scene.game_.getSpawnMovePath(unitDefIndex, castle.x, castle.y, team, x, y);
  const unit = scene.game_.buyUnitAt(unitDefIndex, team, castle.x, castle.y, x, y);
  if (!unit) return;

  refreshUnits(scene);
  updateInfoText(scene);

  const finish = () => {
    refreshStatsPanel(scene);
    // No actionOrigin: unlike a real move, there's no walk-back path to
    // reverse if the player hits the action bar's cancel icon - it just
    // closes the bar (see handleActionBarCancelClick's `if (!unit || !origin)
    // return;` guard) and leaves the unit standing where it was placed.
    scene.actionOrigin = null;
    selectUnitForStats(scene, unit);
    showActionBar(scene, unit, x, y);
  };

  const sprite = scene.unitSprites[unit.id];
  if (sprite && path.length > 0) {
    sprite.x = castle.x * TILE_SIZE + TILE_SIZE / 2;
    sprite.y = castle.y * TILE_SIZE + TILE_SIZE / 2 + BOARD_OFFSET_Y;
    const head = scene.headSprites[unit.id];
    if (head) {
      head.x = castle.x * TILE_SIZE + (TILE_SIZE * 7) / 24;
      head.y = castle.y * TILE_SIZE + BOARD_OFFSET_Y;
    }
    animateUnitMove(scene, unit, path, finish);
  } else {
    finish();
  }
}

function handleUnitSelectionClick(scene, x, y) {
  const clickedUnit = scene.game_.getUnitAt(x, y);
  if (!clickedUnit) {
    // Clicked empty ground with nothing in movement-selection mode — this is how
    // an enemy/standby unit's threat-range preview (below) gets dismissed, since
    // that path never sets scene.selectedUnitId for handleActingUnitClick to catch.
    clearHighlights(scene);
    clearSelectedTileHighlight(scene);

    // An unoccupied castle the current team owns is a shortcut straight into
    // the shop — no need to march a unit onto it first and dig through the
    // action bar. Once any unit (friendly or not) sits on the tile, this
    // shortcut steps aside: a king there still gets buy via the action bar
    // (see ui/actionBar.js's canBuyHere), any other unit gets no purchase
    // option at all.
    const tile = scene.game_.getTileAt(x, y);
    if (tile?.castle && tile.team === scene.game_.currentTeam) {
      showBuyMenu(scene, x, y);
    }
    return;
  }

  const canAct = clickedUnit.team === scene.game_.currentTeam && !clickedUnit.standby;

  if (!canAct) {
    // Enemy unit, or one of ours that's already acted this turn — show its
    // stats and ring it, but don't enter movement mode: leave selectedUnitId
    // unset so the next click still goes through this same selection path.
    // Also preview its full threat range (yellow move / red attack-beyond-move)
    // so the player can plan around it.
    const { movable, extendedAttack } = scene.game_.getThreatPositions(clickedUnit.id);
    clearHighlights(scene);
    highlightPositionSet(scene, movable, 0xffcc33, 0.45);
    highlightPositionSet(scene, extendedAttack, 0xdd4444, 0.4);
    selectUnitForStats(scene, clickedUnit);
    return;
  }
  
  selectUnitForMovement(scene, clickedUnit);
}

function handleActingUnitClick(scene, x, y) {
  const selectedUnit = scene.game_.getUnit(scene.selectedUnitId);
  const clickedUnit = scene.game_.getUnitAt(x, y);

   if (clickedUnit && clickedUnit.id === selectedUnit.id) {
    // confirm current position without moving — opens the action bar directly
    clearHighlights(scene);
    scene.selectedUnitId = null;
    scene.pendingMoveTarget = null;
    selectUnitForStats(scene, selectedUnit);
    scene.actionOrigin = {
      x: selectedUnit.x,
      y: selectedUnit.y,
      movementPoint: selectedUnit.currentMovementPoint,
      path: [{ x: selectedUnit.x, y: selectedUnit.y }],
    };
    showActionBar(scene, selectedUnit, selectedUnit.x, selectedUnit.y);
    return;
  }
  
  if (!clickedUnit) {
    const { positions } = scene.game_.getMovablePositions(selectedUnit.id);
    if (positions.has(`${x},${y}`)) {
      // First click on a reachable tile previews the path in red and waits for
      // a second click on that same tile to confirm — mirrors the "click twice"
      // pattern already used for the acting unit's own tile above. A click on a
      // *different* reachable tile re-previews there instead of confirming.
      if (scene.pendingMoveTarget && scene.pendingMoveTarget.x === x && scene.pendingMoveTarget.y === y) {
        confirmPendingMove(scene, selectedUnit, x, y);
        return;
      }

      previewMovePath(scene, selectedUnit, x, y);
      return;
    }
  }
  
  // clicked an enemy, or an unreachable tile — just deselect
  scene.selectedUnitId = null;
  scene.pendingMoveTarget = null;
  clearHighlights(scene);
  clearSelectedTileHighlight(scene);
  updateStatsPanel(scene, null);
}

/** Shows the path to (x, y) in red on top of the existing yellow movable-range
 * highlight, and remembers it as the pending target for the confirming click.
 * Also marks the target tile with the square+cross cursor (distinct from the
 * plain square used for an ordinary tile click/selection — see render/tiles.js). */
function previewMovePath(scene, unit, x, y) {
  const path = scene.game_.getMovePath(unit.id, x, y);
  scene.pendingMoveTarget = { x, y };
  clearPathPreview(scene);
  scene.pathPreviewRects = path.map((step) => addHighlight(scene, step.x, step.y, 0xdd4444, 0.5));
  showCursor(scene, x, y, "cursor_move_preview");
}

/** Removes just the red path-preview overlay, leaving the yellow movable-range
 * highlight (a separate tracked set — see render/tiles.js) untouched. */
function clearPathPreview(scene) {
  for (const rect of scene.pathPreviewRects ?? []) rect.destroy();
  scene.pathPreviewRects = [];
}

function confirmPendingMove(scene, selectedUnit, x, y) {
  const path = scene.game_.getMovePath(selectedUnit.id, x, y);
  const origin = {
    x: selectedUnit.x,
    y: selectedUnit.y,
    movementPoint: selectedUnit.currentMovementPoint,
    path,
  };
  clearHighlights(scene);
  clearPathPreview(scene);
  scene.selectedUnitId = null;
  scene.pendingMoveTarget = null;
  animateUnitMove(scene, selectedUnit, path, () => {
    scene.game_.moveUnit(selectedUnit.id, path);
    refreshUnits(scene);
    updateInfoText(scene);
    selectUnitForStats(scene, selectedUnit); // selectedUnit.x/y are updated by moveUnit()
    scene.actionOrigin = origin;
    showActionBar(scene, selectedUnit, x, y);
  });
}
