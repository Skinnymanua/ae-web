import { clearHighlights, highlightPositionSet } from "../render/tiles.js";
import { animateUnitMove, refreshUnits } from "../render/units.js";
import { showActionBar, finishUnitAction } from "../ui/actionBar.js";
import { updateInfoText } from "../ui/hud.js";
import { updateStatsPanel, refreshStatsPanel } from "../ui/statsPanel.js";

export function onTileClick(scene, x, y) {
  if (scene.animating || scene.modalOpen) return;

  if (scene.attackTargetMode) {
    handleAttackTargetClick(scene, x, y);
    return;
  }

  if (scene.actionBarOpen) return; // only the bar's own icons should respond right now

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
  if (!clickedUnit || clickedUnit.team !== scene.game_.currentTeam || clickedUnit.standby) return;

  scene.selectedUnitId = clickedUnit.id;
  const { positions } = scene.game_.getMovablePositions(clickedUnit.id);
  clearHighlights(scene);
  highlightPositionSet(scene, positions, 0xffffff, 0.3);
  updateStatsPanel(scene, clickedUnit);
}

function handleActingUnitClick(scene, x, y) {
  const selectedUnit = scene.game_.getUnit(scene.selectedUnitId);
  const clickedUnit = scene.game_.getUnitAt(x, y);

  if (clickedUnit && clickedUnit.id === selectedUnit.id) {
    // confirm current position without moving — opens the action bar directly
    clearHighlights(scene);
    scene.selectedUnitId = null;
    updateStatsPanel(scene, selectedUnit);
    showActionBar(scene, selectedUnit, selectedUnit.x, selectedUnit.y);
    return;
  }

  if (!clickedUnit) {
    const { positions } = scene.game_.getMovablePositions(selectedUnit.id);
    if (positions.has(`${x},${y}`)) {
      const path = scene.game_.getMovePath(selectedUnit.id, x, y);
      clearHighlights(scene);
      scene.selectedUnitId = null;
      animateUnitMove(scene, selectedUnit, path, () => {
        scene.game_.moveUnit(selectedUnit.id, path);
        refreshUnits(scene);
        updateInfoText(scene);
        updateStatsPanel(scene, selectedUnit);
        showActionBar(scene, selectedUnit, x, y);
      });
      return;
    }
  }

  // clicked an enemy, or an unreachable tile — just deselect
  scene.selectedUnitId = null;
  clearHighlights(scene);
  updateStatsPanel(scene, null);
}
