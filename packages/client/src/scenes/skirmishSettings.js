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

export const DEFAULT_MAX_LEVEL = 3; // Rule.getDefaultRule()'s implicit cap - see combat-resolution.js's levelExperienceTable
export const DEFAULT_STARTING_GOLD = 300; // matches every hardcoded player.gold this port has used so far
export const DEFAULT_UNIT_CAPACITY = 15; // Rule.getDefaultRule()'s UNIT_CAPACITY - POPULATION_PRESET[0]
