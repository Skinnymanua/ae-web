export const TILE_SIZE = 48;

// Frame indices within icons_action.png (128x16 = 8 frames of 16x16),
// matching ResourceManager#getActionIcon usage in the original's ActionButtonBar.java.
export const ACTION_ICON = { BUY: 0, OCCUPY: 1, ATTACK: 2, STANDBY: 5 };

// Frame indices within icons_hud_battle.png (52x16 = 4 frames of 13x16).
// Verified directly against RightPanelRenderer.java's drawInformation(): icon(3)
// is drawn at the smallest y-offset (paired with the level row, closest to the
// portrait), icon(0) pairs with attack, icon(1) with physical defence, icon(2)
// with magic defence. HP and XP rows have no icon in the original at all —
// just "HP "/"XP " text prefixes.
export const HUD_ICON = { LEVEL: 3, ATTACK: 0, PDEF: 1, MDEF: 2 };
