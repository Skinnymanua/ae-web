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
/**
 * Circular-button UI kit matching a second reference screenshot (the
 * mobile reskin's "Game Setting" screen specifically) - dark-navy circles
 * with a silver ring and a drawn icon, a title bar with a circular back
 * button, and a corner-bracket-accented panel instead of the plain uniform
 * border above.
 *
 * Circle styling and the "confirm"/"back" icons themselves are NOT a new
 * approximation - they're the exact navy-fill/silver-ring/yellow-glyph
 * look ui/dialogs.js's addIconButton already built for the buy menu's own
 * Buy/Cancel and Yes/No buttons (see that file for the reference
 * screenshot it was built from), reused here rather than invented a second
 * time. The stepper chevrons (chevronLeft/chevronRight, used by
 * addCircleStepper's </> pair - a different control than a confirm/back
 * action) keep their own plain white arrow rather than adopting the
 * yellow confirm/back glyph color, so a stepper doesn't visually read as
 * "the same kind of button" as a screen's Back/Confirm.
 */
export const CIRCLE_BG = 0x242b47; // matches ui/dialogs.js's addIconButton circle fill exactly (== PANEL_BG above)
export const CIRCLE_BORDER = 0xb8bec9; // silver ring, matching addIconButton
export const CIRCLE_BORDER_DISABLED = 0x555a66; // matching addIconButton's disabled ring

const ICON_COLOR = 0xffdd44; // yellow, matching addIconButton's glyph color
const ICON_COLOR_DISABLED = 0x77775f;
const CHEVRON_COLOR = 0xffffff; // stepper chevrons stay plain white - see class doc above
const CHEVRON_COLOR_DISABLED = 0x777788;

function drawChevron(g, cx, cy, radius, direction, color) {
  g.lineStyle(2.5, color, 1);
  g.beginPath();
  g.moveTo(cx + direction * radius * 0.22, cy - radius * 0.32);
  g.lineTo(cx - direction * radius * 0.22, cy);
  g.lineTo(cx + direction * radius * 0.22, cy + radius * 0.32);
  g.strokePath();
}

/** Checkmark - identical geometry to ui/dialogs.js's addIconButton
 * "confirm" icon, just parameterized on radius the same way this file's
 * other draw helpers are. */
function drawConfirmIcon(g, cx, cy, radius, color) {
  g.lineStyle(Math.max(2, radius * 0.22), color, 1);
  g.beginPath();
  g.moveTo(cx - radius * 0.45, cy + radius * 0.05);
  g.lineTo(cx - radius * 0.1, cy + radius * 0.35);
  g.lineTo(cx + radius * 0.45, cy - radius * 0.35);
  g.strokePath();
}

/** Solid left-pointing arrow (triangle head + rectangle shaft) - identical
 * geometry to ui/dialogs.js's addIconButton "cancel" icon. That function's
 * own doc calls this a stand-in for the reference's curved back-arrow
 * (Phaser Graphics has no easy primitive for that exact curve); reused
 * here as-is rather than drawn differently a second time; screens using
 * this for "go back" get the same glyph the buy menu's own Cancel does. */
function drawBackIcon(g, cx, cy, radius, color) {
  g.fillStyle(color, 1);
  const headSize = radius * 0.35;
  g.fillTriangle(cx - radius * 0.45, cy, cx - radius * 0.05, cy - headSize, cx - radius * 0.05, cy + headSize);
  g.fillRect(cx - radius * 0.05, cy - radius * 0.14, radius * 0.55, radius * 0.28);
}

/**
 * One circular icon button - `icon` is "chevronLeft" | "chevronRight"
 * (plain white, for addCircleStepper's </> pair) | "confirm" | "back"
 * (both yellow, matching ui/dialogs.js's addIconButton exactly - see this
 * file's class doc above) | "none" (a plain empty circle, for the
 * reference's unlabeled top-right title-bar button - see addTitleBar's own
 * comment on why that one has no onClick at all). Same enabled/disabled +
 * destroy() shape as addMenuButton above, for the same reasons.
 */
export function addCircleButton(scene, x, y, radius, { icon = "none", enabled = true, onClick } = {}) {
  const g = scene.add.graphics();
  const zone = scene.add.zone(x - radius, y - radius, radius * 2, radius * 2).setOrigin(0, 0);
  if (onClick) zone.on("pointerup", () => draw.isEnabled && onClick());

  function draw(isEnabled) {
    draw.isEnabled = isEnabled;
    g.clear();
    g.fillStyle(CIRCLE_BG, 1);
    g.fillCircle(x, y, radius);
    g.lineStyle(3, isEnabled ? CIRCLE_BORDER : CIRCLE_BORDER_DISABLED, 1);
    g.strokeCircle(x, y, radius);

    if (icon === "chevronLeft") drawChevron(g, x, y, radius, 1, isEnabled ? CHEVRON_COLOR : CHEVRON_COLOR_DISABLED);
    else if (icon === "chevronRight") drawChevron(g, x, y, radius, -1, isEnabled ? CHEVRON_COLOR : CHEVRON_COLOR_DISABLED);
    else if (icon === "confirm") drawConfirmIcon(g, x, y, radius, isEnabled ? ICON_COLOR : ICON_COLOR_DISABLED);
    else if (icon === "back") drawBackIcon(g, x, y, radius, isEnabled ? ICON_COLOR : ICON_COLOR_DISABLED);

    if (onClick && isEnabled) zone.setInteractive({ useHandCursor: true });
    else zone.disableInteractive();
  }

  draw(enabled);

  return {
    setEnabled: draw,
    destroy() {
      g.destroy();
      zone.destroy();
    },
  };
}

/**
 * A value between two circular chevron buttons - the Player Type/Alliance/
 * Gold/Units rows in the reference. Generic over what "value" means: the
 * caller owns the actual state and passes onPrev/onNext to compute the new
 * value and update `label` themselves (same division of responsibility as
 * addMenuButton's setEnabled - this draws and wires the buttons, the
 * caller decides what changing them means). `gap` is the label's own
 * clickable width, i.e. distance between the two button centers.
 */
export function addCircleStepper(scene, x, y, { text, radius = 18, gap = 110, fontSize = "16px", color = "#ffdd44", onPrev, onNext }) {
  const label = scene.add.text(x, y, text, { fontSize, color, fontStyle: "bold" }).setOrigin(0.5);
  const minusButton = addCircleButton(scene, x - gap / 2, y, radius, { icon: "chevronLeft", onClick: () => onPrev?.(label) });
  const plusButton = addCircleButton(scene, x + gap / 2, y, radius, { icon: "chevronRight", onClick: () => onNext?.(label) });
  return { label, minusButton, plusButton };
}

/**
 * The title bar in the reference: a rounded bar with the screen title
 * centered, a circular back button on the left end, and an unlabeled
 * circular button on the right end. That right-hand button has no defined
 * purpose in the reference (settings? help?) and nothing in this project
 * needs one yet, so it's rendered decorative-only (icon: "none", no
 * onClick, permanently non-interactive) rather than a control that looks
 * clickable but does nothing - same stance as MenuScene's disabled entries.
 */
export function addTitleBar(scene, x, y, width, height, { title, onBack }) {
  const g = scene.add.graphics();
  g.fillStyle(PANEL_BG, 1);
  g.fillRoundedRect(x, y, width, height, height / 2);
  g.lineStyle(2, PANEL_BORDER, 1);
  g.strokeRoundedRect(x, y, width, height, height / 2);

  scene.add.text(x + width / 2, y + height / 2, title, { fontSize: "20px", color: "#e8e8e8", fontStyle: "bold" }).setOrigin(0.5);

  const buttonRadius = height / 2 - 2;
  const backButton = addCircleButton(scene, x + height / 2, y + height / 2, buttonRadius, {
    icon: "chevronLeft",
    onClick: onBack,
  });
  addCircleButton(scene, x + width - height / 2, y + height / 2, buttonRadius, { icon: "none" });

  return { backButton };
}

/**
 * The main content panel in the reference: same navy fill as drawMenuPanel,
 * but a lighter/subtler border plus a light-blue L-shaped bracket accent
 * at each corner instead of a plain uniform stroke.
 */
export function drawCornerBracketPanel(scene, x, y, width, height, { bracketLength = 14 } = {}) {
  const g = scene.add.graphics();
  g.fillStyle(PANEL_BG, 1);
  g.fillRoundedRect(x, y, width, height, 4);
  g.lineStyle(1, PANEL_BORDER, 0.5);
  g.strokeRoundedRect(x, y, width, height, 4);

  g.lineStyle(2, CIRCLE_BORDER, 1);
  const corners = [
    [x, y, 1, 1],
    [x + width, y, -1, 1],
    [x, y + height, 1, -1],
    [x + width, y + height, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    g.beginPath();
    g.moveTo(cx + dx * bracketLength, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy + dy * bracketLength);
    g.strokePath();
  }
  return g;
}
