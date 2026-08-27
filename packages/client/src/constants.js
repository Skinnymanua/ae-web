export const TILE_SIZE = 48;

// Height of the top stats bar (see ui/statsPanel.js) — the board is drawn shifted
// down by this much so the bar sits in its own space above the map, not overlapping it.
export const BOARD_OFFSET_Y = 76;

// Frame indices within icons_action.png (128x16 = 8 frames of 16x16),
// matching ResourceManager#getActionIcon usage in the original's ActionButtonBar.java.
// Frame indices within icons_action.png (128x16 = 8 frames of 16x16),
// matching ResourceManager#getActionIcon usage in the original's ActionButtonBar.java.
export const ACTION_ICON = { BUY: 0, OCCUPY: 1, ATTACK: 2, STANDBY: 5 };

// Two more frames from that same sheet (heart, 4-way move arrows) aren't used by the
// action bar itself but are the right icons for the top stats bar's HP/Move rows.
export const STAT_ICON = { HP: 7, MOVE: 4 };

// Frame indices within icons_hud_battle.png (52x16 = 4 frames of 13x16).
// Verified directly against RightPanelRenderer.java's drawInformation(): icon(3)
// is drawn at the smallest y-offset (paired with the level row, closest to the
// portrait), icon(0) pairs with attack, icon(1) with physical defence, icon(2)
// with magic defence. HP and XP rows have no icon in the original at all —
// just "HP "/"XP " text prefixes.
export const HUD_ICON = { LEVEL: 3, ATTACK: 0, PDEF: 1, MDEF: 2 };

// Explicit render-layer ordering. Without setDepth(), Phaser falls back to
// creation order — that broke down because refreshUnits() (render/units.js)
// destroys and recreates every unit sprite on nearly every action (move, buy,
// attack, standby...), which re-adds them to the *top* of the display list each
// time — putting units above the top/bottom stats bars (created once, at scene
// start) whenever a unit sat near the board's top or bottom edge. Explicit
// depths make layering independent of creation/refresh order.
export const DEPTH = {
  TILES: 0,
  UNITS: 10,
  CURSOR: 15, // selection/preview/attack-target cursor (render/tiles.js showCursor) - must sit above the unit it's marking
  ACTION_BAR: 20,
  STATS_BARS: 30, // top stats bar (ui/statsPanel.js) + bottom bar (ui/bottomBar.js)
  DIALOG: 40,
};
