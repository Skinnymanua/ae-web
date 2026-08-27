export const TILE_SIZE = 48;

// Explicit render-order tiers. Phaser draws by depth first, then by add-order
// within the same depth — so without these, anything re-added later (units get
// destroyed/recreated by refreshUnits on every move/buy/end-turn) can end up
// drawn on top of UI that was created earlier, like the stats panel or buy menu.
// Keep gaps between tiers so new layers can be inserted without renumbering.
export const DEPTH = {
  BOARD: 0,
  UNITS: 100,
  HUD: 200, // top stats bar + bottom bar (always-visible overlays)
  ACTION_BAR: 300, // compass action wheel — sits above HUD when a unit is selected
  MODAL: 400, // buy menu, confirm dialogs — always on top
};

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
