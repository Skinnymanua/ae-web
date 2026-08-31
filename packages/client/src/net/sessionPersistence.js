/**
 * Persists just enough about the CURRENT networked session to resume it
 * after a page refresh: which session, which team, and its password (if
 * any - needed again since join_session re-checks it every time, the
 * server never trusts "you already knew this password once").
 *
 * sessionStorage, not localStorage: it should survive a refresh of this
 * tab, but not quietly resurrect a finished session in a brand new tab
 * days later. Cleared explicitly on the normal ways a session ends -
 * leaving the lobby (NetworkLobbyScene#leave), leaving the board
 * (BoardScene#showGameOverScreen's Back to Menu), or a failed resume
 * attempt (ReconnectScene) - so stale entries don't linger past the
 * situations they're meant to cover.
 */
const STORAGE_KEY = "ae_network_session";

export function saveActiveSession({ sessionId, team, password }) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId, team, password: password || undefined }));
}

export function loadActiveSession() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Malformed/corrupted entry (e.g. hand-edited in devtools) - treat the
    // same as "nothing saved" rather than letting a bad JSON.parse throw
    // and block the whole boot sequence.
    return null;
  }
}

export function clearActiveSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}
