/**
 * WebSocket message protocol for networked play. Each connected socket
 * tracks its own `sessionId`/`team` once it's created or joined a session -
 * see the `connection` handler below. The server holds the authoritative
 * GameState for every session (see sessions.js) and broadcasts the result
 * of every action to both connected players, so neither client's local
 * copy can drift from the other's.
 *
 * Client -> server message types:
 *   { type: "list_sessions" }
 *   { type: "create_session", name, mapId, mapData, maxLevel, startingGold, unitCapacity, password? }
 *   { type: "join_session", sessionId, password? }
 *   { type: "leave_session" }
 *   { type: "start_game" }
 *   { type: "game_action", actionType, params }
 *     - actionType/params: see actions.js's ACTIONS table (attack, heal,
 *       moveUnit, endTurn, etc.) - params match that action's GameState
 *       method signature exactly.
 *
 * Server -> client message types:
 *   { type: "session_list", sessions }
 *   { type: "session_created", session, team, gameState }
 *   { type: "session_joined", session, team, gameState }
 *   { type: "join_error", reason }              // not_found | wrong_password | full
 *   { type: "player_joined", team }              // broadcast to whoever's already there
 *   { type: "player_disconnected", team }        // broadcast on a socket closing
 *   { type: "game_started" }                     // broadcast to both, in response to either one's start_game
 *   { type: "game_update", actionType, result, gameOver, gameState }  // broadcast after any action - gameState is a fresh full snapshot, always apply that, never recompute locally (RNG)
 *   { type: "action_error", reason }             // unknown_action | not_your_turn | not_your_unit
 *   { type: "error", message }                   // malformed/unhandled message
 */
import { WebSocketServer } from "ws";
import { loadUnits, loadTiles } from "@ae/shared";
import {
  createSession,
  listSessions,
  joinSession,
  markDisconnected,
  applySessionAction,
  getSerializedGameState,
} from "./sessions.js";
import { applyNetworkAction } from "./actions.js";

const PORT = process.env.PORT || 8080;

const units = loadUnits();
const tiles = loadTiles();
console.log(`Loaded ${units.length} units and ${tiles.length} tiles from @ae/shared`);

// sessionId -> Map<team, socket> - live socket references, kept separate from
// sessions.js's own bookkeeping (which only tracks CONNECTED TEAM NUMBERS,
// not socket objects, since those aren't part of what gets persisted).
const sessionSockets = new Map();

function send(socket, message) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(sessionId, message, exceptSocket) {
  const sockets = sessionSockets.get(sessionId);
  if (!sockets) return;
  for (const socket of sockets.values()) {
    if (socket !== exceptSocket) send(socket, message);
  }
}

function registerSocket(sessionId, team, socket) {
  if (!sessionSockets.has(sessionId)) sessionSockets.set(sessionId, new Map());
  sessionSockets.get(sessionId).set(team, socket);
  socket.sessionId = sessionId;
  socket.team = team;
}

function leaveCurrentSession(socket) {
  const { sessionId, team } = socket;
  if (sessionId === undefined || team === undefined) return;
  sessionSockets.get(sessionId)?.delete(team);
  if (sessionSockets.get(sessionId)?.size === 0) sessionSockets.delete(sessionId);
  markDisconnected(sessionId, team);
  broadcast(sessionId, { type: "player_disconnected", team });
  socket.sessionId = undefined;
  socket.team = undefined;
}

function handleMessage(socket, message) {
  switch (message.type) {
    case "list_sessions": {
      send(socket, { type: "session_list", sessions: listSessions() });
      return;
    }

    case "create_session": {
      const { name, mapId, mapData, maxLevel, startingGold, unitCapacity, password } = message;
      const session = createSession({ name, mapId, mapData, maxLevel, startingGold, unitCapacity, password });
      registerSocket(session.id, 0, socket);
      send(socket, { type: "session_created", session, team: 0, gameState: getSerializedGameState(session.id) });
      return;
    }

    case "join_session": {
      const result = joinSession(message.sessionId, message.password);
      if (!result.ok) {
        send(socket, { type: "join_error", reason: result.reason });
        return;
      }
      registerSocket(message.sessionId, result.team, socket);
      send(socket, { type: "session_joined", session: result.session, team: result.team, gameState: result.gameState });
      broadcast(message.sessionId, { type: "player_joined", team: result.team }, socket);
      return;
    }

    case "leave_session": {
      leaveCurrentSession(socket);
      return;
    }

    case "start_game": {
      const { sessionId } = socket;
      if (sessionId === undefined) {
        send(socket, { type: "error", message: "not in a session" });
        return;
      }
      // Broadcast to EVERYONE in the session, including the sender (no
      // exceptSocket) - both players' clients handle this through the SAME
      // "on game_started, transition to BoardScene" listener (see
      // NetworkLobbyScene), whether they clicked Start themselves or their
      // opponent did. Purely a coordination signal - doesn't touch the
      // GameState at all, so there's no applySessionAction/authority check
      // involved here the way game_action has.
      broadcast(sessionId, { type: "game_started" });
      return;
    }

    case "game_action": {
      const { sessionId, team } = socket;
      if (sessionId === undefined) {
        send(socket, { type: "error", message: "not in a session" });
        return;
      }
      const outcome = applySessionAction(sessionId, (gameState) =>
        applyNetworkAction(gameState, message.actionType, message.params, team)
      );
      if (!outcome.ok) {
        send(socket, { type: "action_error", reason: outcome.reason ?? "not_found" });
        return;
      }
      if (!outcome.result.ok) {
        send(socket, { type: "action_error", reason: outcome.result.reason });
        return;
      }
      broadcast(sessionId, {
        type: "game_update",
        actionType: message.actionType,
        result: outcome.result.result,
        gameOver: outcome.gameOver,
        // A fresh full snapshot, not just the bare result - see
        // getSerializedGameState's own docstring for why clients should
        // apply THIS rather than recomputing the action themselves (RNG).
        gameState: getSerializedGameState(sessionId),
      });
      return;
    }

    default:
      send(socket, { type: "error", message: `unknown message type: ${message.type}` });
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket) => {
  console.log("Client connected");
  send(socket, { type: "welcome", unitCount: units.length, tileCount: tiles.length });

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "malformed JSON" });
      return;
    }
    try {
      handleMessage(socket, message);
    } catch (err) {
      console.error("Error handling message:", message.type, err);
      send(socket, { type: "error", message: "internal error handling " + message.type });
    }
  });

  socket.on("close", () => {
    console.log("Client disconnected");
    leaveCurrentSession(socket);
  });
});

console.log(`WebSocket server listening on ws://localhost:${PORT}`);
