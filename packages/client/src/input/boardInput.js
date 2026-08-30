import { animateUnitMove, refreshUnits } from "../render/units.js";
import { animateHpChanges } from "../render/hpChange.js";
import { animateAttackHit, playAttackHitSequence } from "../render/attackEffect.js";
import { runGameAction } from "../net/runGameAction.js";
import { showActionBar, finishUnitAction, finishUnitActionOrCharge, clearActionBar } from "../ui/actionBar.js";
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
  refreshTileTexture,
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
export async function purchaseUnit(scene, unitDef, castleX, castleY, team) {
  const { movable, extendedAttack } = scene.game_.getSpawnMovablePositions(unitDef.index, castleX, castleY, team);
  const castleKey = `${castleX},${castleY}`;

  if (movable.has(castleKey)) {
    const boughtUnit = await runGameAction(scene, "buyUnitAt", unitDef.index, team, castleX, castleY, castleX, castleY);
    if (!boughtUnit) return;
    // Re-fetched by id rather than trusting the returned reference directly -
    // in networked mode that reference is a detached clone from the
    // broadcast's serialized result, not the same object scene.game_.units
    // actually holds after deserializing the snapshot (see
    // net/runGameAction.js's docstring). Harmless extra lookup in local
    // mode, where it already is the same object.
    const unit = scene.game_.getUnit(boughtUnit.id);
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

  if (scene.summonTargetMode) {
    handleSummonTargetClick(scene, x, y);
    return;
  }

  if (scene.healTargetMode) {
    handleHealTargetClick(scene, x, y);
    return;
  }

  if (scene.supportTargetMode) {
    handleSupportTargetClick(scene, x, y);
    return;
  }

  if (scene.chargerMoveMode) {
    handleChargerMoveClick(scene, x, y);
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

  // DESTROYER: an empty, destroyable tile is also a valid attack target -
  // ported from GameCore#canAttack's defender==null branch. Tracked in its
  // own field (an {x,y} pair, not a unit id) since there's no unit here to
  // key off of - same two-click preview/confirm shape either way.
  if (!target && scene.game_.canDestroyTile(attacker.id, x, y)) {
    if (scene.pendingDestroyTarget && scene.pendingDestroyTarget.x === x && scene.pendingDestroyTarget.y === y) {
      confirmPendingDestroyTile(scene, attacker, x, y);
      return;
    }
    previewDestroyTileTarget(scene, x, y);
    return;
  }

  // invalid target — back out to the action bar rather than force a finish
  scene.attackTargetMode = false;
  scene.pendingAttackTarget = null;
  scene.pendingDestroyTarget = null;
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

/**
 * Builds the [{x,y,change}] shape render/hpChange.js's animateHpChanges
 * expects from a HEAL result's `events` - positions are captured by the
 * caller BEFORE the game_ call runs (see confirmPendingHeal below), since a
 * kill already removes the dead unit from game_.units by the time the
 * result comes back, making a live position lookup unreliable for exactly
 * the most dramatic case. Combat damage no longer goes through this - see
 * render/attackEffect.js for why attack/counter uses a different effect.
 */
function hpChangeFromEvent(event, positionsById) {
  const pos = positionsById[event.targetId];
  if (!pos) return null;
  return { unitId: pos.id, x: pos.x, y: pos.y, change: event.change };
}

async function confirmPendingAttack(scene, attacker, target) {
  const positionsById = {
    [attacker.id]: { id: attacker.id, x: attacker.x, y: attacker.y },
    [target.id]: { id: target.id, x: target.x, y: target.y },
  };
  // Cleared/set BEFORE the await, not after - during a networked round-trip
  // a re-entrant click would otherwise still see attackTargetMode as true
  // and could send a SECOND attack before the first one's even confirmed.
  scene.attackTargetMode = false;
  scene.pendingAttackTarget = null;
  scene.animating = true;
  clearHighlights(scene);
  clearSelectedTileHighlight(scene);
  const result = await runGameAction(scene, "attack", attacker.id, target.id);

  // Played BEFORE finishUnitAction's refreshUnits() - see attackEffect.js's
  // own docstring on why: a unit destroyed by this exchange needs to still
  // be on screen for the spark/shake to play over it, and refreshUnits() is
  // what actually removes its sprite once the effect finishes. Combat
  // damage uses the spark+shake+static-number effect (UnitAttackAnimator in
  // the original), NOT the rising HpChangeAnimator style animateHpChanges
  // gives Heal/end-of-turn changes - the two are deliberately different in
  // the source, not just here.
  const hits = result.events
    .filter((e) => e.type === "ATTACK")
    .map((e) => {
      const pos = positionsById[e.defenderId];
      if (!pos) return null;
      return { targetUnitId: pos.id, x: pos.x, y: pos.y, damage: e.damage };
    })
    .filter(Boolean);
  playAttackHitSequence(scene, hits, () => finishUnitActionOrCharge(scene, attacker));
}

/** Same cursor preview as previewAttackTarget above, for a DESTROYER's
 * tile target - no unit to show stats for, so just the cursor. */
function previewDestroyTileTarget(scene, x, y) {
  scene.pendingDestroyTarget = { x, y };
  showCursor(scene, x, y, "cursor_attack");
}

/** No HP change, no counter, no defending unit - just the tile swap and
 * ATTACK_EXPERIENCE for the attacker (see combat-resolution.js's
 * resolveDestroyTile). Still plays the spark effect over the target tile
 * though - matches the original's own submitUnitAttackAnimation(attacker,
 * target_x, target_y) overload for this exact case: no target unit to
 * jitter, no damage number, just the spark burst. */
async function confirmPendingDestroyTile(scene, attacker, x, y) {
  scene.attackTargetMode = false;
  scene.pendingAttackTarget = null;
  scene.pendingDestroyTarget = null;
  scene.animating = true;
  clearHighlights(scene);
  clearSelectedTileHighlight(scene);
  await runGameAction(scene, "destroyTile", attacker.id, x, y);
  refreshTileTexture(scene, x, y);
  animateAttackHit(scene, null, x, y, null, () => finishUnitActionOrCharge(scene, attacker));
}

/** Same two-click preview/confirm shape as attack above, for Heal. A click on
 * the healer's own tile works the same way as any other valid target -
 * self-heal is just canHeal(healer, healer) being true (see
 * GameState#getHealablePositions). */
function handleHealTargetClick(scene, x, y) {
  const healer = scene._pendingHealer;
  const target = scene.game_.getUnitAt(x, y);

  if (target && scene.game_.canHeal(healer.id, target.id)) {
    if (scene.pendingHealTarget === target.id) {
      confirmPendingHeal(scene, healer, target);
      return;
    }
    previewHealTarget(scene, target);
    return;
  }

  // invalid target — back out to the action bar rather than force a finish
  scene.healTargetMode = false;
  scene.pendingHealTarget = null;
  clearHighlights(scene);
  selectUnitForStats(scene, healer);
  showActionBar(scene, healer, healer.x, healer.y);
}

/** Same cursor/stats preview as attack's - the original reuses the exact
 * same attack_cursor for heal-targeting too (see GameScreen's STATE_HEAL
 * cursor branch), not a distinct heal cursor. */
function previewHealTarget(scene, target) {
  scene.pendingHealTarget = target.id;
  showCursor(scene, target.x, target.y, "cursor_attack");
  updateStatsPanel(scene, target);
}

async function confirmPendingHeal(scene, healer, target) {
  const positionsById = {
    [healer.id]: { id: healer.id, x: healer.x, y: healer.y },
    [target.id]: { id: target.id, x: target.x, y: target.y },
  };
  scene.healTargetMode = false;
  scene.pendingHealTarget = null;
  scene.animating = true;
  clearHighlights(scene);
  clearSelectedTileHighlight(scene);
  const result = await runGameAction(scene, "heal", healer.id, target.id);

  const hpChanges = result.events.filter((e) => e.type === "HEAL").map((e) => hpChangeFromEvent(e, positionsById)).filter(Boolean);
  animateHpChanges(scene, hpChanges, () => finishUnitActionOrCharge(scene, healer));
}

/** Same two-click preview/confirm shape as Heal above, for the Druid's
 * Support ability (custom addition - see combat.js's ABILITY.SUPPORT
 * comment). Never targets the Druid itself - see canSupport's standby
 * requirement in combat-resolution.js. */
function handleSupportTargetClick(scene, x, y) {
  const supporter = scene._pendingSupporter;
  const target = scene.game_.getUnitAt(x, y);

  if (target && scene.game_.canSupport(supporter.id, target.id)) {
    if (scene.pendingSupportTarget === target.id) {
      confirmPendingSupport(scene, supporter, target);
      return;
    }
    previewSupportTarget(scene, target);
    return;
  }

  // invalid target — back out to the action bar rather than force a finish
  scene.supportTargetMode = false;
  scene.pendingSupportTarget = null;
  clearHighlights(scene);
  selectUnitForStats(scene, supporter);
  showActionBar(scene, supporter, supporter.x, supporter.y);
}

/** Same cursor/stats preview pattern as attack/heal - reuses cursor_attack,
 * no dedicated support cursor exists (there wasn't one for heal either). */
function previewSupportTarget(scene, target) {
  scene.pendingSupportTarget = target.id;
  showCursor(scene, target.x, target.y, "cursor_attack");
  updateStatsPanel(scene, target);
}

/** Support doesn't change anyone's HP, so unlike attack/heal there's no
 * animateHpChanges step here - just the state change (target's movement
 * reset, standby cleared) and a full refresh so that shows up visually
 * (an un-standbyed target's greyed-out tint needs to clear too). */
async function confirmPendingSupport(scene, supporter, target) {
  scene.supportTargetMode = false;
  scene.pendingSupportTarget = null;
  scene.animating = true;
  clearHighlights(scene);
  clearSelectedTileHighlight(scene);
  await runGameAction(scene, "support", supporter.id, target.id);
  scene.animating = false;
  refreshUnits(scene);
  finishUnitActionOrCharge(scene, supporter);
}

/**
 * A single click resolves summon-target mode - no preview/confirm step like
 * attack has, since there's no defending unit's stats to show first (a tomb
 * tile is just a tomb tile). Ends the summoner's turn on success, matching
 * the original's doSummon submitting ACTION_FINISH immediately after Summon.
 */
async function handleSummonTargetClick(scene, x, y) {
  const summoner = scene._pendingSummoner;

  if (scene.game_.canSummon(summoner.id, x, y)) {
    scene.summonTargetMode = false;
    scene._pendingSummoner = null;
    scene.animating = true;
    clearHighlights(scene);
    clearSelectedTileHighlight(scene);
    await runGameAction(scene, "summon", summoner.id, x, y);
    scene.animating = false;
    refreshUnits(scene);
    updateInfoText(scene);
    finishUnitActionOrCharge(scene, summoner);
    return;
  }

  // invalid target — back out to the action bar rather than force a finish
  scene.summonTargetMode = false;
  scene._pendingSummoner = null;
  clearHighlights(scene);
  selectUnitForStats(scene, summoner);
  showActionBar(scene, summoner, summoner.x, summoner.y);
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
async function handleBuyPlacementClick(scene, x, y) {
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

  // Set before the network round-trip, same reasoning as confirmPendingMove's
  // identical comment - buyMode is already false by this point, so nothing
  // else would route a stray click back here, but nothing was blocking it
  // from falling through to a DIFFERENT click handler during the wait either.
  scene.animating = true;
  const boughtUnit = await runGameAction(scene, "buyUnitAt", unitDefIndex, team, castle.x, castle.y, x, y);
  if (!boughtUnit) {
    scene.animating = false;
    return;
  }
  // Re-fetched by id - see purchaseUnit's identical comment on why the
  // returned reference itself isn't trustworthy in networked mode.
  const unit = scene.game_.getUnit(boughtUnit.id);
  if (!unit) {
    scene.animating = false;
    return;
  }

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
    scene.animating = false;
    finish();
  }
}

function handleUnitSelectionClick(scene, x, y) {
  // Local skirmish is hot-seat - both teams share one screen/keyboard, so
  // "whose turn is it" already fully gates who CAN act (there's no separate
  // notion of "which browser is looking at this"). Networked mode adds that
  // second dimension: scene.game_.currentTeam being team 0's turn does NOT
  // mean THIS client should be able to act - only when it's also this
  // client's own team. Without this, a spectating opponent could select
  // the acting player's own units and walk through to a real action bar
  // (whose buttons the server would then correctly reject anyway, but
  // shouldn't have been reachable in the first place).
  const isMyTurn = !scene.net_ || scene.net_.team === scene.game_.currentTeam;

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
    if (isMyTurn && tile?.castle && tile.team === scene.game_.currentTeam) {
      showBuyMenu(scene, x, y);
    }
    return;
  }

  const canAct = isMyTurn && clickedUnit.team === scene.game_.currentTeam && !clickedUnit.standby;

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

async function confirmPendingMove(scene, selectedUnit, x, y) {
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

  // Set before the network round-trip (not just inside animateUnitMove,
  // which only covers the animation itself) - onTileClick's own animating
  // guard needs to block further clicks for the WHOLE window in networked
  // mode, not just once the animation starts; animateUnitMove sets this
  // same flag again below, harmlessly idempotent.
  scene.animating = true;
  await runGameAction(scene, "moveUnit", selectedUnit.id, path);
  // Re-fetched by id, not the pre-move reference - in networked mode
  // scene.game_ was just wholesale replaced (see net/runGameAction.js), so
  // selectedUnit.x/y here would still show the PRE-move position; the old
  // local-only comment "selectedUnit.x/y are updated by moveUnit()" only
  // held because moveUnit used to mutate that exact same object in place.
  const unit = scene.game_.getUnit(selectedUnit.id) ?? selectedUnit;

  animateUnitMove(scene, unit, path, () => {
    refreshUnits(scene);
    updateInfoText(scene);
    selectUnitForStats(scene, unit);
    scene.actionOrigin = origin;
    showActionBar(scene, unit, x, y);
  });
}

/**
 * Same two-click preview/confirm shape as normal movement above
 * (previewMovePath/confirmPendingMove), for a CHARGER unit's post-action
 * bonus move - see ui/actionBar.js's enterChargerMoveMode. The unit's own
 * tile is just one more entry in the movable set here (createMovablePositions
 * always includes the starting tile), so "stay put" needs no special-casing
 * the way a normal move's own-tile click does (there's no action bar to
 * open by staying - confirmChargerMove always ends the turn either way).
 */
function handleChargerMoveClick(scene, x, y) {
  const charger = scene._pendingCharger;
  const { positions } = scene.game_.getMovablePositions(charger.id);

  if (positions.has(`${x},${y}`)) {
    if (scene.pendingChargerMoveTarget && scene.pendingChargerMoveTarget.x === x && scene.pendingChargerMoveTarget.y === y) {
      confirmChargerMove(scene, charger, x, y);
      return;
    }
    previewChargerMovePath(scene, charger, x, y);
    return;
  }

  // An invalid click just stays in this mode, waiting for a valid one - the
  // original doesn't offer an early way out of STATE_REMOVE (GameScreen's
  // click handler only falls back to cancelMovePhase for STATE_MOVE, not
  // STATE_REMOVE - a charger's bonus move must be resolved, not backed out of).
}

function previewChargerMovePath(scene, unit, x, y) {
  const path = scene.game_.getMovePath(unit.id, x, y);
  scene.pendingChargerMoveTarget = { x, y };
  clearPathPreview(scene);
  scene.pathPreviewRects = path.map((step) => addHighlight(scene, step.x, step.y, 0xdd4444, 0.5));
  showCursor(scene, x, y, "cursor_move_preview");
}

async function confirmChargerMove(scene, unit, x, y) {
  const path = scene.game_.getMovePath(unit.id, x, y);
  clearHighlights(scene);
  clearPathPreview(scene);
  scene.chargerMoveMode = false;
  scene._pendingCharger = null;
  scene.pendingChargerMoveTarget = null;

  scene.animating = true; // see confirmPendingMove's identical comment on why this is set before the network round-trip too
  await runGameAction(scene, "moveUnit", unit.id, path);
  const movedUnit = scene.game_.getUnit(unit.id) ?? unit;

  animateUnitMove(scene, movedUnit, path, () => {
    refreshUnits(scene);
    updateInfoText(scene);
    // Straight to standby - no action bar, no re-check of canMoveAgain -
    // matching OperationExecutor#onMoveFinish's STATE_REMOVE branch calling
    // onStandby directly, unlike a normal confirmed move which returns to
    // STATE_ACTION. Uses finishUnitAction (not finishUnitActionOrCharge):
    // a charger's bonus move never chains into another one.
    finishUnitAction(scene, movedUnit);
  });
}
