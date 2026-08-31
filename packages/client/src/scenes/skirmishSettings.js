// Bounded option sets, not freeform typed input - Phaser has no native text
// field, and every one of these settings has a natural small set of sensible
// values. UNIT_CAPACITY_OPTIONS in particular MUST stay the original's own
// Rule.POPULATION_PRESET entries (see entity/Rule.java) - a stepper through
// those exact presets matches the source's own design, not just a UI
// shortcut. MAX_LEVEL_OPTIONS/STARTING_GOLD_OPTIONS have no source
// equivalent (the original hardcodes level cap at 3 and starting gold
// per-map) - these ranges are this port's own reasonable bounds.
export const MAX_LEVEL_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const STARTING_GOLD_OPTIONS = [0, 100, 200, 300, 500, 750, 1000, 1500, 2000];
export const UNIT_CAPACITY_OPTIONS = [15, 20, 25, 30, 35, 40]; // Rule.POPULATION_PRESET
// Clamped the same way server/src/sessions.js clamps maxPlayers - matches
// the shared package's own team-slot bound (turn.js's isTeamAlive caps at
// team < 4) and the original's own PLAYER_TYPE/team model, which never
// supported more than 4 sides.
export const PLAYER_COUNT_OPTIONS = [2, 3, 4];

// Per-team config for the Game Setting screen (GameSettingScene) - label
// shown on the stepper + the shared PLAYER_TYPE value it maps to. "None"
// leaves that team slot empty (turn.js's isTeamAlive already treats
// PLAYER_TYPE.NONE as not alive, so the engine needs no special-casing
// beyond just setting this).
export const PLAYER_TYPE_OPTIONS = [
  { label: "Player", value: 1 }, // PLAYER_TYPE.LOCAL
  { label: "Robot", value: 2 }, // PLAYER_TYPE.AI
  { label: "None", value: 0 }, // PLAYER_TYPE.NONE
];

// Displayed 1-based (matches how alliance numbers read in the reference
// menu); stored/sent to GameState 0-based (game.players[].alliance) - see
// GameSettingScene's stepper for the conversion.
export const ALLIANCE_OPTIONS = [1, 2, 3, 4];

/** One Player followed by Robots, each its own alliance - a sensible "you
 * vs however many bots" default whenever the team rows haven't been set
 * up before (fresh entry, or player count just increased). */
export function defaultPlayerTypeIndex(team) {
  return team === 0 ? 0 : 1; // Player for team 0, Robot for everyone else
}

export function defaultAllianceIndex(team) {
  return team; // team 0 -> alliance 1, team 1 -> alliance 2, etc. - all separate
}

export const DEFAULT_MAX_LEVEL = 3; // Rule.getDefaultRule()'s implicit cap - see combat-resolution.js's levelExperienceTable
export const DEFAULT_STARTING_GOLD = 300; // matches every hardcoded player.gold this port has used so far
export const DEFAULT_UNIT_CAPACITY = 15; // Rule.getDefaultRule()'s UNIT_CAPACITY - POPULATION_PRESET[0]
export const DEFAULT_PLAYER_COUNT = 2;
