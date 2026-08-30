/**
 * Rebuilds a real GameState instance from a plain snapshot the server sent
 * (session_created/session_joined/game_update's `gameState` field - see
 * server/src/index.js's protocol doc). Mirrors server/src/sessions.js's own
 * deserializeGameState exactly: reattach unitDefs/tileDefs (static data,
 * never part of the snapshot itself - same reasoning as the server not
 * persisting them either) and re-derive each unit's `_tile` reference via
 * _syncTileRefs() rather than trusting a serialized copy of it.
 */
import { GameState } from "@ae/shared/src/game-state.js";

export function deserializeGameState(plain, unitDefs, tileDefs) {
  const gameState = Object.create(GameState.prototype);
  Object.assign(gameState, plain);
  gameState.unitDefs = unitDefs;
  gameState.tileDefs = tileDefs;
  gameState._syncTileRefs();
  return gameState;
}
