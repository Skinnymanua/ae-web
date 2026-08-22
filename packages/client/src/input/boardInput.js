import { animateUnitMove, refreshUnits } from "../render/units.js";
import { showActionBar, finishUnitAction, clearActionBar } from "../ui/actionBar.js";
import { updateInfoText } from "../ui/hud.js";
import { updateStatsPanel, refreshStatsPanel } from "../ui/statsPanel.js";
import {
  clearHighlights,
  highlightPositionSet,
  highlightSelectedTile,
  clearSelectedTileHighlight,
} from "../render/tiles.js";

/** Shows a unit's stats and rings its tile — the one place both stay in sync. */
function selectUnitForStats(scene, unit) {
  highlightSelectedTile(scene, unit.x, unit.y);
  updateStatsPanel(scene, unit);
}

export function onTileClick(scene, x, y) {
  if (scene.animating || scene.modalOpen) return;

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
function handleActionBarCancelClick(scene) {
  const unit = scene.game_.getUnit(scene.actionBarUnitId);
  const origin = scene.actionOrigin;
  clearActionBar(scene);
  if (!unit || !origin) return;

  const reselectForMove = () => {
    unit.currentMovementPoint = origin.movementPoint;
    scene.selectedUnitId = unit.id;
    const { positions } = scene.game_.getMovablePositions(unit.id);
    clearHighlights(scene);
    highlightPositionSet(scene, positions, 0xffcc33, 0.45);
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
    scene.game_.attack(attacker.id, target.id);
    scene.attackTargetMode = false;
    clearHighlights(scene);
    finishUnitAction(scene, attacker);
  } else {
    // invalid target — back out to the action bar rather than force a finish
    scene.attackTargetMode = false;
    clearHighlights(scene);
    showActionBar(scene, attacker, attacker.x, attacker.y);
  }
}

function handleBuyPlacementClick(scene, x, y) {
  const team = scene.game_.currentTeam;
  if (
    scene.pendingBuyUnitIndex !== null &&
    scene.game_.canBuyUnit(scene.pendingBuyUnitIndex, team) &&
    scene.game_.isCastleAccessible(x, y, team)
  ) {
    scene.game_.buyUnit(scene.pendingBuyUnitIndex, team, x, y);
    refreshUnits(scene);
    updateInfoText(scene);
    refreshStatsPanel(scene);
  }
  scene.buyMode = false;
  scene.pendingBuyUnitIndex = null;
  clearHighlights(scene);
}

function handleUnitSelectionClick(scene, x, y) {
  const clickedUnit = scene.game_.getUnitAt(x, y);
  if (!clickedUnit) return;

  const canAct = clickedUnit.team === scene.game_.currentTeam && !clickedUnit.standby;

  if (!canAct) {
    // Enemy unit, or one of ours that's already acted this turn — show its
    // stats and ring it, but don't enter movement mode: leave selectedUnitId
    // unset so the next click still goes through this same selection path.
    clearHighlights(scene);
    selectUnitForStats(scene, clickedUnit);
    return;
  }

  scene.selectedUnitId = clickedUnit.id;
  const { positions } = scene.game_.getMovablePositions(clickedUnit.id);
  clearHighlights(scene);
  highlightPositionSet(scene, positions, 0xffcc33, 0.45);
  selectUnitForStats(scene, clickedUnit);
}

function handleActingUnitClick(scene, x, y) {
  const selectedUnit = scene.game_.getUnit(scene.selectedUnitId);
  const clickedUnit = scene.game_.getUnitAt(x, y);

   if (clickedUnit && clickedUnit.id === selectedUnit.id) {
    // confirm current position without moving — opens the action bar directly
    clearHighlights(scene);
    scene.selectedUnitId = null;
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
      const path = scene.game_.getMovePath(selectedUnit.id, x, y);
      const origin = {
        x: selectedUnit.x,
        y: selectedUnit.y,
        movementPoint: selectedUnit.currentMovementPoint,
        path,
      };
      clearHighlights(scene);
      scene.selectedUnitId = null;
      animateUnitMove(scene, selectedUnit, path, () => {
        scene.game_.moveUnit(selectedUnit.id, path);
        refreshUnits(scene);
        updateInfoText(scene);
        selectUnitForStats(scene, selectedUnit); // selectedUnit.x/y are updated by moveUnit()
        scene.actionOrigin = origin;
        showActionBar(scene, selectedUnit, x, y);
      });
      return;
    }
  }
  
  // clicked an enemy, or an unreachable tile — just deselect
  scene.selectedUnitId = null;
  clearHighlights(scene);
  clearSelectedTileHighlight(scene);
  updateStatsPanel(scene, null);
}
