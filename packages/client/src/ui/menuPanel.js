/**
 * Shared navy-panel + beveled-button styling used across the main menu and
 * its direct submenus (Skirmish, Multiplayer) - originally built once, in
 * MenuScene.js, styled after a real screenshot of the mobile reskin's own
 * main menu (navy panel, mid-grey beveled buttons; no bevel/gradient asset
 * exists in this repo for this specific look, so it's plain Graphics rects
 * with a lighter top/left edge standing in for the bevel - ui/dialogs.js's
 * "border" texture is a different, thinner corner-bracket style, sampled
 * and rejected as a mismatch for this). Extracted here once a second scene
 * needed the exact same treatment, rather than duplicating the drawing code
 * per scene.
 */
export const PANEL_BG = 0x242b47;
export const PANEL_BORDER = 0x4a5a8f;
export const BUTTON_BG = 0x5e5e5e;
export const BUTTON_BG_DISABLED = 0x3a3a3a;
export const BUTTON_HIGHLIGHT = 0x8a8a8a;

export function drawMenuPanel(scene, x, y, width, height) {
  const g = scene.add.graphics();
  g.fillStyle(PANEL_BG, 1);
  g.fillRoundedRect(x, y, width, height, 6);
  g.lineStyle(2, PANEL_BORDER, 1);
  g.strokeRoundedRect(x, y, width, height, 6);
  return g;
}

/**
 * One beveled button row - same visual as the main menu's own entries.
 * `onClick` fires on pointerup when enabled; disabled buttons render dimmed
 * and non-interactive rather than as controls that look functional but
 * don't do anything (see MenuScene.js's own doc comment on this project's
 * general stance on that).
 *
 * Returns { zone, setEnabled } so callers whose enabled state can change
 * after creation (see SkirmishSetupScene's Start Game button, which toggles
 * on map selection) can redraw it in place - mirrors ui/dialogs.js's
 * addIconButton and its own identical need.
 */
export function addMenuButton(scene, x, y, width, height, { label, enabled = true, onClick, fontSize = "17px" }) {
  const g = scene.add.graphics();
  const text = scene.add.text(x + width / 2, y + height / 2, label, { fontSize, fontStyle: "bold" }).setOrigin(0.5);
  const zone = scene.add.zone(x, y, width, height).setOrigin(0, 0).setInteractive();
  zone.on("pointerup", () => onClick?.());

  function draw(isEnabled) {
    g.clear();
    g.fillStyle(isEnabled ? BUTTON_BG : BUTTON_BG_DISABLED, 1);
    g.fillRoundedRect(x, y, width, height, 4);
    if (isEnabled) {
      g.lineStyle(1, BUTTON_HIGHLIGHT, 0.6);
      g.strokeRoundedRect(x, y, width, height, 4);
    }
    text.setColor(isEnabled ? "#ffffff" : "#777777");
    if (isEnabled) zone.setInteractive();
    else zone.disableInteractive();
  }

  draw(enabled);

  return {
    zone,
    setEnabled: draw,
    // Only needed by a caller that creates/destroys these dynamically after
    // the fact (see JoinGameScene's password-prompt Join button, rebuilt
    // each time a different session row is selected) - most callers just
    // let the whole scene's own shutdown clean these up.
    destroy() {
      g.destroy();
      text.destroy();
      zone.destroy();
    },
  };
}
