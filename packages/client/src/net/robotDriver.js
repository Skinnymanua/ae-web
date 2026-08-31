import { PLAYER_TYPE } from "@ae/shared/src/turn.js";
import { chooseRobotStep } from "@ae/shared/src/robot.js";
import { createBoard } from "@ae/shared/src/movement.js";
import { runGameAction, ACTION_PARAM_KEYS } from "./runGameAction.js";
import { refreshUnits, animateUnitMove } from "../render/units.js";
import { refreshStatsPanel } from "../ui/statsPanel.js";
import { refreshTombs, refreshTileTexture } from "../render/tiles.js";
import { animateHpChanges } from "../render/hpChange.js";
import { playAttackHitSequence } from "../render/attackEffect.js";
import { updateBottomBarEconomy } from "../ui/bottomBar.js";

// A short beat between each of the robot's own actions so its turn reads as
// a sequence of moves happening one after another, not everything resolving
// on the same frame - purely cosmetic pacing, no game-logic reason for it.
const STEP_DELAY_MS = 350;

function delay(scene, ms) {
  return new Promise((resolve) => scene.time.delayedCall(ms, resolve));
}

/** Same castlePositions/villagePositions shape robot.js's planUnitTurn/
 * planRecruit expect (see robot.js's own header comment) - scanned fresh
 * each call since a capture can change tile ownership mid-turn. */
function buildMapInfo(game) {
  const castlePositions = [];
  const villagePositions = [];
  for (let x = 0; x < game.width; x++) {
    for (let y = 0; y < game.height; y++) {
      const tile = game.getTileAt(x, y);
      if (tile.castle) castlePositions.push({ x, y, team: tile.team });
      if (tile.village) villagePositions.push({ x, y, team: tile.team });
    }
  }
  return { castlePositions, villagePositions };
}

/** True only for local (non-networked) skirmish - there's no server-side
 * robot support yet, so a networked session never has an AI-controlled
 * team regardless of what game.players[].type says. */
export function isRobotControlledTurn(scene) {
  if (scene.networked_ || scene.game_.gameOver) return false;
  return scene.game_.players[scene.game_.currentTeam]?.type === PLAYER_TYPE.AI;
}

/**
 * Per-action-type animation, matching input/boardInput.js's/ui/actionBar.js's
 * own confirm* handlers for a human's click on that same action - a walk
 * along the path for a move, the spark+shake+damage-number sequence for an
 * attack (not the floating-number style heal/end-of-turn changes use - see
 * render/attackEffect.js), a tile-texture swap for occupy/repair, and so
 * on. Without this, every action just looked like the board silently
 * updating between beats - the actual "did something happen" motion a
 * human's own actions always get was missing entirely.
 */
const ANIMATORS = {
  async moveUnit(scene, params) {
    await runGameAction(scene, "moveUnit", params.unitId, params.path);
    const unit = scene.game_.getUnit(params.unitId);
    if (!unit) return;
    await new Promise((resolve) => animateUnitMove(scene, unit, params.path, resolve));
  },

  async attack(scene, params) {
    // Captured BEFORE the call, not after - a kill removes the defender
    // from scene.game_.units, so its pre-death position has to be known
    // ahead of time (same reasoning as boardInput.js's confirmPendingAttack).
    const attacker = scene.game_.getUnit(params.attackerId);
    const defender = scene.game_.getUnit(params.defenderId);
    if (!attacker || !defender) return;
    const positionsById = {
      [attacker.id]: { id: attacker.id, x: attacker.x, y: attacker.y },
      [defender.id]: { id: defender.id, x: defender.x, y: defender.y },
    };
    const result = await runGameAction(scene, "attack", params.attackerId, params.defenderId);
    const hits = (result.events ?? [])
      .filter((e) => e.type === "ATTACK")
      .map((e) => {
        const pos = positionsById[e.defenderId];
        return pos ? { targetUnitId: pos.id, x: pos.x, y: pos.y, damage: e.damage } : null;
      })
      .filter(Boolean);
    await new Promise((resolve) => playAttackHitSequence(scene, hits, resolve));
  },

  async heal(scene, params) {
    const healer = scene.game_.getUnit(params.healerId);
    const target = scene.game_.getUnit(params.targetId);
    if (!healer || !target) return;
    const positionsById = {
      [healer.id]: { id: healer.id, x: healer.x, y: healer.y },
      [target.id]: { id: target.id, x: target.x, y: target.y },
    };
    const result = await runGameAction(scene, "heal", params.healerId, params.targetId);
    const hpChanges = (result.events ?? [])
      .filter((e) => e.type === "HEAL")
      .map((e) => {
        const pos = positionsById[e.targetId];
        return pos ? { unitId: pos.id, x: pos.x, y: pos.y, change: e.change } : null;
      })
      .filter(Boolean);
    await new Promise((resolve) => animateHpChanges(scene, hpChanges, resolve));
  },

  async occupy(scene, params) {
    await runGameAction(scene, "occupy", params.unitId, params.x, params.y);
    refreshTileTexture(scene, params.x, params.y);
  },

  async repair(scene, params) {
    await runGameAction(scene, "repair", params.unitId, params.x, params.y);
    refreshTileTexture(scene, params.x, params.y);
  },
};

/** Fallback for support/standby/summon/buyUnitAt/endTurn - none of these
 * have their own dedicated visual effect in the human flow either (see
 * e.g. confirmPendingSupport's own comment: no HP change, just the state
 * change plus a refresh), so a generic "run it, animate whatever hp
 * changes came back (endTurn's terrain heal/poison, mainly), refresh" is
 * the same thing a human's click for any of these actually gets. */
async function applyGenericAction(scene, action) {
  const keys = ACTION_PARAM_KEYS[action.type];
  const args = keys.map((key) => action.params[key]);
  const result = await runGameAction(scene, action.type, ...args);
  if (result?.hpChanges?.length > 0) {
    await new Promise((resolve) => animateHpChanges(scene, result.hpChanges, resolve));
  }
}

/** Applies one robot.js action (the `{type, params}` shape shared with
 * server/src/actions.js's ACTIONS table), playing whichever animation
 * matches what a human's own click on that action would show, then the
 * same post-action refresh every action gets regardless of type (unit
 * sprites, stats panel, tomb decay, the bottom bar's gold/turn/team-color
 * readout). Keeping this ONE path (runGameAction) under both is what makes
 * a Robot team's move indistinguishable on screen from a human's. */
async function applyRobotAction(scene, action) {
  const animator = ANIMATORS[action.type];
  if (animator) {
    await animator(scene, action.params);
  } else {
    await applyGenericAction(scene, action);
  }

  refreshTombs(scene);
  updateBottomBarEconomy(scene);
  refreshUnits(scene);
  refreshStatsPanel(scene);
}

/** Plays out every action for exactly the CURRENT team's turn (one
 * chooseRobotStep call per unit/recruit, finishing on the endTurn step
 * chooseRobotStep itself returns once there's nothing left to do) -
 * mirrors a human playing their own turn one action at a time, just
 * without the clicks. */
async function runOneRobotTurn(scene) {
  const team = scene.game_.currentTeam;
  while (scene.game_.currentTeam === team && !scene.game_.gameOver) {
    const board = createBoard({
      width: scene.game_.width,
      height: scene.game_.height,
      tileIndexAt: (x, y) => scene.game_.getTileAt(x, y).index,
      tileDefs: scene.game_.tileDefs,
      units: scene.game_.units,
    });
    const ctx = {
      game: scene.game_,
      rule: scene.game_.rule,
      units: scene.game_.units,
      board,
      mapInfo: buildMapInfo(scene.game_),
      team,
      unitDefs: scene.game_.unitDefs,
    };

    const { actions } = chooseRobotStep(ctx);
    for (const action of actions) {
      await applyRobotAction(scene, action);
      if (scene.game_.gameOver) return;
      await delay(scene, STEP_DELAY_MS);
    }
  }
}

/**
 * Call after anything that could hand the turn to a Robot team - the end
 * of BoardScene#create() (covers a game that STARTS on a Robot team) and
 * the End Turn button's handler (covers a human handing off to one, or one
 * Robot handing off to another in a 3+ team game). Loops rather than
 * playing just one team's turn, so a run of consecutive Robot teams (e.g.
 * one human + two robots) plays all the way through back to the next human
 * team, or to game over, without needing another trigger in between.
 *
 * Sets scene.animating for its whole duration - same flag boardInput.js/
 * bottomBar.js already check before accepting a click - so the board
 * can't be interacted with while a Robot team is "thinking".
 */
export async function runPendingRobotTurns(scene) {
  if (!isRobotControlledTurn(scene)) return;
  scene.animating = true;
  try {
    while (isRobotControlledTurn(scene)) {
      await runOneRobotTurn(scene);
    }
  } finally {
    scene.animating = false;
  }
  if (scene.game_.gameOver) scene.onGameOver?.();
}
