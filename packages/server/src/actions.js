/**
 * Maps a `game_action` message's `type` to the actual GameState method it
 * calls, plus which team is allowed to issue it - the server-authority
 * checks that make this safe to expose over a socket at all. Two gates,
 * both required:
 *   1. it must be the caller's own turn (gameState.currentTeam === callerTeam)
 *   2. for anything acting through a specific unit, that unit must actually
 *      belong to the caller's team (actingTeam(...) === callerTeam) - a
 *      second check on top of (1), since without it a player could in
 *      theory reference an opponent's unit id during their own turn.
 *
 * `apply` is called with (gameState, params) and should return whatever the
 * corresponding GameState method returns - that return value flows straight
 * back to both connected clients as the action's `result` (see
 * server/src/index.js's game_action handler).
 */

const ACTIONS = {
  moveUnit: {
    actingTeam: (gs, p) => gs.getUnit(p.unitId)?.team,
    apply: (gs, p) => gs.moveUnit(p.unitId, p.path),
  },
  attack: {
    actingTeam: (gs, p) => gs.getUnit(p.attackerId)?.team,
    apply: (gs, p) => gs.attack(p.attackerId, p.defenderId),
  },
  heal: {
    actingTeam: (gs, p) => gs.getUnit(p.healerId)?.team,
    apply: (gs, p) => gs.heal(p.healerId, p.targetId),
  },
  support: {
    actingTeam: (gs, p) => gs.getUnit(p.supporterId)?.team,
    apply: (gs, p) => gs.support(p.supporterId, p.targetId),
  },
  summon: {
    actingTeam: (gs, p) => gs.getUnit(p.summonerId)?.team,
    apply: (gs, p) => gs.summon(p.summonerId, p.x, p.y),
  },
  occupy: {
    actingTeam: (gs, p) => gs.getUnit(p.unitId)?.team,
    apply: (gs, p) => gs.occupy(p.unitId, p.x, p.y),
  },
  repair: {
    actingTeam: (gs, p) => gs.getUnit(p.unitId)?.team,
    apply: (gs, p) => gs.repair(p.unitId, p.x, p.y),
  },
  destroyTile: {
    actingTeam: (gs, p) => gs.getUnit(p.attackerId)?.team,
    apply: (gs, p) => gs.destroyTile(p.attackerId, p.x, p.y),
  },
  standby: {
    actingTeam: (gs, p) => gs.getUnit(p.unitId)?.team,
    apply: (gs, p) => gs.standby(p.unitId),
  },
  buyUnitAt: {
    actingTeam: (gs, p) => p.team,
    apply: (gs, p) => gs.buyUnitAt(p.unitIndex, p.team, p.castleX, p.castleY, p.destX, p.destY),
  },
  endTurn: {
    actingTeam: (gs) => gs.currentTeam,
    apply: (gs) => gs.endTurn(),
  },
};

/**
 * Validates and applies a network action against the live GameState.
 * Returns { ok: true, result } or { ok: false, reason } - reasons:
 * "unknown_action" (bad type string), "not_your_turn", "not_your_unit".
 * Never throws for a bad request - only a genuine bug in a GameState method
 * itself would escape this, same as any other server code.
 */
export function applyNetworkAction(gameState, type, params, callerTeam) {
  const action = ACTIONS[type];
  if (!action) return { ok: false, reason: "unknown_action" };

  if (gameState.currentTeam !== callerTeam) {
    return { ok: false, reason: "not_your_turn" };
  }
  const actingTeam = action.actingTeam(gameState, params);
  if (actingTeam !== callerTeam) {
    return { ok: false, reason: "not_your_unit" };
  }

  const result = action.apply(gameState, params);
  return { ok: true, result };
}
