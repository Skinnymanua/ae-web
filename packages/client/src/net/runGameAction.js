/**
 * Single chokepoint every mutating scene.game_.<action>(...) call in
 * input/boardInput.js, ui/actionBar.js, and ui/bottomBar.js routes through -
 * see each of those files for the individual call sites, all converted to
 * `await runGameAction(scene, "actionType", ...sameArgsAsBefore)`.
 *
 * Local (skirmish) mode: scene.net_ is unset, so this just calls the method
 * on scene.game_ directly and wraps the result in a resolved Promise - zero
 * behavior change from before, every existing call site's logic after the
 * call (animations, refreshUnits, etc.) runs exactly as it did when the
 * call was synchronous.
 *
 * Networked mode: sends the action to the server and returns a Promise that
 * resolves once the CONFIRMING game_update broadcast arrives (see
 * setupNetworkedGameSync below, which is the single place that actually
 * applies a broadcast to scene.game_ and resolves this promise) - resolving
 * with the exact same `result` shape the local method would have returned,
 * since the server calls the identical GameState method under the hood
 * (see server/src/actions.js). Deliberately NEVER recomputes the action
 * locally - combat has RNG (see combat-resolution.js's getDamage), so only
 * the server's confirmed outcome is trustworthy.
 */
import { deserializeGameState } from "./deserializeGameState.js";

export const ACTION_PARAM_KEYS = {
  moveUnit: ["unitId", "path"],
  attack: ["attackerId", "defenderId"],
  heal: ["healerId", "targetId"],
  support: ["supporterId", "targetId"],
  summon: ["summonerId", "x", "y"],
  occupy: ["unitId", "x", "y"],
  repair: ["unitId", "x", "y"],
  destroyTile: ["attackerId", "x", "y"],
  standby: ["unitId"],
  buyUnitAt: ["unitIndex", "team", "castleX", "castleY", "destX", "destY"],
  endTurn: [],
};

function argsToParams(actionType, args) {
  const keys = ACTION_PARAM_KEYS[actionType];
  const params = {};
  keys.forEach((key, i) => {
    params[key] = args[i];
  });
  return params;
}

export function runGameAction(scene, actionType, ...args) {
  if (!scene.net_) {
    const result = scene.game_[actionType](...args);
    // Checked here, centrally, same reasoning as the networked branch below
    // (see setupNetworkedGameSync's own comment on scene.onGameOver) - every
    // mutating action funnels through this one function, so this is the
    // single place that needs to notice a LOCAL game just ended, rather
    // than every individual confirm* function in input/boardInput.js
    // remembering to check scene.game_.gameOver itself.
    if (scene.game_.gameOver) {
      scene.onGameOver?.();
    }
    return Promise.resolve(result);
  }
  const promise = new Promise((resolve, reject) => {
    scene.net_.pendingResolve = resolve;
    scene.net_.pendingReject = reject;
    scene.net_.socket.send("game_action", { actionType, params: argsToParams(actionType, args) });
  });
  // A rejection (server authority denied the action, or the connection
  // dropped mid-request - see setupNetworkedGameSync's action_error handler
  // and GameSocket#_handleClose) would otherwise leave scene.animating
  // stuck true forever, since none of this function's callers (see
  // input/boardInput.js/ui/actionBar.js/ui/bottomBar.js) catch the
  // rejection themselves - onTileClick's `if (scene.animating) return;`
  // guard would then permanently block all further board interaction.
  // Caught here once, centrally, rather than needing every call site to
  // remember its own try/catch.
  return promise.catch((err) => {
    scene.animating = false;
    throw err;
  });
}

/**
 * Registers the ONE persistent listener for the whole networked session -
 * every game_update broadcast (whether confirming an action THIS client
 * just sent, or reporting the opponent's action) flows through here.
 * Deserializes the fresh snapshot into scene.game_ (see
 * deserializeGameState.js) so every existing read (getUnit,
 * getMovablePositions, canAttack, etc.) sees the authoritative post-action
 * state, whichever client caused it.
 *
 * If a runGameAction call from THIS client is pending, resolves it with the
 * broadcast's result (the ordinary case: I acted, this confirms it). If
 * nothing is pending, this was the opponent's turn - onOpponentAction is
 * called with (msg, previousGameState): the PRE-action GameState instance,
 * still holding the pre-update positions of anyone the action just moved or
 * killed - see net/replayOpponentAction.js, which needs exactly that to
 * place a fatal hit's spark/shake at the right tile once the victim's
 * already gone from the fresh snapshot.
 *
 * scene.onGameOver, if set, is called (with no arguments - by the time it
 * fires, scene.game_ already reflects the ended game, same as the local
 * branch in runGameAction above) whenever a broadcast reports the game
 * ending - regardless of which client's action caused it, since
 * runGameAction's promise only resolves with msg.result (not the whole
 * message), so a game-ending action taken by THIS client wouldn't otherwise
 * see msg.gameOver at all.
 */
export function setupNetworkedGameSync(scene, unitDefs, tileDefs, onOpponentAction) {
  scene.net_.unsubscribeGameUpdate = scene.net_.socket.on("game_update", (msg) => {
    const previousGameState = scene.game_;
    // A game-ending action's broadcast can carry gameState: null - see
    // sessions.js's applySessionAction, which deletes the session (the
    // "removed on victory/defeat" rule) BEFORE index.js builds this
    // broadcast, so getSerializedGameState(sessionId) correctly finds
    // nothing left to serialize. Nothing to sync in that case; msg.gameOver
    // (checked unconditionally below) is what actually matters then.
    if (msg.gameState) {
      scene.game_ = deserializeGameState(msg.gameState, unitDefs, tileDefs);
    }
    if (scene.net_.pendingResolve) {
      const resolve = scene.net_.pendingResolve;
      scene.net_.pendingResolve = null;
      scene.net_.pendingReject = null;
      resolve(msg.result);
    } else {
      onOpponentAction?.(msg, previousGameState);
    }
    // Checked unconditionally, not just in the onOpponentAction branch -
    // the player whose OWN action ended the game needs the game-over notice
    // too, and runGameAction's own promise only resolves with msg.result
    // (not the whole message), so this is the one place both cases meet.
    if (msg.gameOver) {
      // Stashed on scene.net_ rather than re-derived from scene.game_ when
      // onGameOver runs - a game-ending action's msg.gameState is null (see
      // applySnapshot above), so scene.game_ never receives the update
      // that would show the losing team actually destroyed; the server
      // computes this BEFORE tearing the session down specifically so
      // clients don't have to guess from a stale local state.
      scene.net_.lastWinnerAlliance = msg.winnerAlliance;
      scene.onGameOver?.();
    }
  });

  scene.net_.unsubscribeActionError = scene.net_.socket.on("action_error", (msg) => {
    if (scene.net_.pendingReject) {
      const reject = scene.net_.pendingReject;
      scene.net_.pendingResolve = null;
      scene.net_.pendingReject = null;
      reject(new Error(`action rejected: ${msg.reason}`));
    }
  });
}
