/**
 * Session lifecycle for networked play: create/join/list a session, persist
 * its authoritative GameState to a JSON file on disk keyed by a unique id,
 * and clean that file up according to two rules stated by the person who
 * asked for this:
 *   - the session file is removed the moment the game ends (victory/defeat)
 *   - if a player disconnects, the file stays until EVERY player has left -
 *     i.e. it survives a disconnect (for reconnecting later) but not the
 *     last player leaving.
 *
 * Each session wraps one @ae/shared GameState instance - the SAME class the
 * client uses for local skirmish play (see client/src/scenes/BoardScene.js).
 * The server is authoritative: it holds the real GameState and applies
 * actions to it directly (see applySessionAction below), rather than each
 * client computing independently and trusting the other - that only works
 * because GameState is plain, dependency-free JS that runs identically in
 * Node and the browser.
 *
 * Two representations of "what's in the file" exist on purpose:
 *   - `session.gameState` on disk is a PLAIN serialized snapshot (see
 *     serializeGameState/deserializeGameState) - safe to JSON.stringify.
 *   - the live in-memory registry (see the `live` Map below) holds an
 *     actual GameState *instance* plus which teams currently have a
 *     connected socket - that connection bookkeeping is never written to
 *     disk (a socket isn't serializable, and doesn't need to survive a
 *     server restart the way the game itself does).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { GameState } from "@ae/shared/src/game-state.js";
import { loadUnits, loadTiles } from "@ae/shared";

const SESSIONS_DIR = process.env.SESSIONS_DIR ?? path.join(process.cwd(), "sessions");

function ensureSessionsDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionFilePath(id) {
  return path.join(SESSIONS_DIR, `${id}.json`);
}

function generateSessionId() {
  return crypto.randomBytes(4).toString("hex"); // 8 hex chars - plenty for a casual session count, and file-name safe
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

/** Strips the per-unit `_tile` reference (see GameState#_syncTileRefs) before
 * writing - it's derived, redundant with tileIndices, and just bloats the
 * file; reattached via _syncTileRefs() on load instead (see
 * deserializeGameState). Everything else on a GameState instance is already
 * plain arrays/objects/primitives - safe to serialize directly. */
function serializeGameState(gameState) {
  const plain = JSON.parse(JSON.stringify(gameState));
  for (const unit of plain.units) delete unit._tile;
  return plain;
}

function deserializeGameState(plain) {
  const gameState = Object.create(GameState.prototype);
  Object.assign(gameState, plain);
  gameState.unitDefs = loadUnits();
  gameState.tileDefs = loadTiles();
  gameState._syncTileRefs();
  return gameState;
}

const units = loadUnits();
const tiles = loadTiles();

// id -> { meta: {id, name, mapId, passwordHash, createdAt}, gameState: GameState, connectedTeams: Set<number> }
const live = new Map();

function writeSessionFile(entry) {
  ensureSessionsDir();
  const record = {
    ...entry.meta,
    gameState: serializeGameState(entry.gameState),
  };
  fs.writeFileSync(sessionFilePath(entry.meta.id), JSON.stringify(record), "utf8");
}

function deleteSessionFile(id) {
  try {
    fs.unlinkSync(sessionFilePath(id));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

function loadSessionFileFromDisk(id) {
  let raw;
  try {
    raw = fs.readFileSync(sessionFilePath(id), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const record = JSON.parse(raw);
  const { gameState: plainGameState, ...meta } = record;
  const entry = { meta, gameState: deserializeGameState(plainGameState), connectedTeams: new Set() };
  live.set(id, entry);
  return entry;
}

/** Finds a live (in-memory) session, falling back to loading it off disk if
 * the server restarted since it was created - a session surviving a
 * restart isn't the requirement that was actually asked for (that's about
 * surviving a player disconnect), but falls out for free from persisting
 * to a real file rather than memory alone, and costs nothing extra. */
function getEntry(id) {
  return live.get(id) ?? loadSessionFileFromDisk(id);
}

/**
 * Creates a new session as team 0's game: builds the authoritative
 * GameState from the map/settings (same shape SkirmishSetupScene already
 * sends for local play), persists it, and returns the session's public
 * record (never the password itself - only whether one is set).
 */
export function createSession({ name, mapId, mapData, maxLevel, startingGold, unitCapacity, password }) {
  const id = generateSessionId();
  const gameState = new GameState({
    mapData,
    unitDefs: units,
    tileDefs: tiles,
    players: [
      { team: 0, type: 1, alliance: 0, gold: startingGold },
      { team: 1, type: 1, alliance: 1, gold: startingGold },
    ],
    rule: { maxLevel, unitCapacity },
  });

  const meta = {
    id,
    name: name || id,
    mapId,
    passwordHash: password ? hashPassword(password) : null,
    createdAt: Date.now(),
  };
  const entry = { meta, gameState, connectedTeams: new Set([0]) };
  live.set(id, entry);
  writeSessionFile(entry);
  return toPublicSession(entry);
}

/** Everything the Join Game browser needs to show a session in the list -
 * never the password hash, never the full game state (that's only sent to
 * someone who's actually joined). */
export function listSessions() {
  ensureSessionsDir();
  const idsOnDisk = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  const ids = new Set([...live.keys(), ...idsOnDisk]);
  const result = [];
  for (const id of ids) {
    const entry = getEntry(id);
    if (entry) result.push(toPublicSession(entry));
  }
  return result;
}

function toPublicSession(entry) {
  return {
    id: entry.meta.id,
    name: entry.meta.name,
    mapId: entry.meta.mapId,
    hasPassword: !!entry.meta.passwordHash,
    connectedPlayerCount: entry.connectedTeams.size,
    maxPlayers: 2,
    gameOver: entry.gameState.gameOver,
  };
}

/**
 * Joins an existing session as the next open team slot. Returns
 * { ok: true, session, team, gameState } on success, or
 * { ok: false, reason } for "not_found" / "wrong_password" / "full".
 * `gameState` here is the full plain snapshot (see serializeGameState) -
 * everything the joining client needs to render the in-progress game.
 */
export function joinSession(id, password) {
  const entry = getEntry(id);
  if (!entry) return { ok: false, reason: "not_found" };
  if (entry.meta.passwordHash && hashPassword(password ?? "") !== entry.meta.passwordHash) {
    return { ok: false, reason: "wrong_password" };
  }
  const openTeam = [0, 1].find((t) => !entry.connectedTeams.has(t));
  if (openTeam === undefined) return { ok: false, reason: "full" };

  entry.connectedTeams.add(openTeam);
  return { ok: true, session: toPublicSession(entry), team: openTeam, gameState: serializeGameState(entry.gameState) };
}

/**
 * Marks a team's socket as disconnected. Per the stated rule, the session
 * file is NOT deleted here unless this was the last connected player -
 * it stays around so whoever's left (or a reconnecting player) still has
 * a game to come back to.
 */
export function markDisconnected(id, team) {
  const entry = live.get(id);
  if (!entry) return;
  entry.connectedTeams.delete(team);
  if (entry.connectedTeams.size === 0) {
    deleteSessionFile(id);
    live.delete(id);
  }
}

/**
 * Applies a GameState mutation to the session (caller passes a function that
 * receives the live GameState instance and mutates/reads it - e.g.
 * `(gameState) => gameState.attack(attackerId, defenderId)`), persists the
 * result, and ends the session (deleting its file immediately, regardless
 * of who's still connected - the "removed on victory/defeat" rule)
 * if that action just ended the game.
 */
export function applySessionAction(id, mutator) {
  const entry = live.get(id);
  if (!entry) return { ok: false, reason: "not_found" };
  const result = mutator(entry.gameState);
  if (entry.gameState.gameOver) {
    deleteSessionFile(id);
    live.delete(id);
  } else {
    writeSessionFile(entry);
  }
  return { ok: true, result, gameOver: entry.gameState.gameOver };
}

export function getLiveGameState(id) {
  return live.get(id)?.gameState ?? null;
}

/** Plain, JSON-safe snapshot of a session's current state - same shape
 * joinSession returns on join, used so every game_update broadcast can
 * include a fresh full snapshot (see server/src/index.js) instead of just
 * the bare action result. Deliberately NOT "replay the action client-side"
 * - combat involves RNG (see combat-resolution.js's getDamage), so a client
 * recomputing the same action locally would NOT necessarily get the same
 * outcome the server already committed to; shipping the real post-action
 * state sidesteps that entirely rather than trying to keep two independent
 * RNG streams in lockstep. */
export function getSerializedGameState(id) {
  const gameState = getLiveGameState(id);
  return gameState ? serializeGameState(gameState) : null;
}

// Exposed for tests only - not part of the module's real API surface.
export const _internal = { SESSIONS_DIR, live, serializeGameState, deserializeGameState };
