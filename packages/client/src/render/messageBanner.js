import { DEPTH } from "../constants.js";
import { drawMenuPanel } from "../ui/menuPanel.js";

/**
 * Short-lived on-screen notifications for events a player should notice but
 * that don't need a modal or a click to dismiss - "Occupied"/"Repaired",
 * and the two-line "Turn N" / "Income +G" banner at the start of each
 * round. Framed in the same navy beveled panel as the main menu (see
 * ui/menuPanel.js's drawMenuPanel) and centered on screen, rather than
 * bare floating text off to one side - reads more like a deliberate
 * announcement than an incidental label.
 *
 * Queued (see the module-level `queue` below) so two triggers landing close
 * together - e.g. a robot repairing a bridge right after occupying a
 * village next to it - show one after another instead of two banners
 * fighting for the same screen position at once.
 */

const FADE_MS = 250;
const HOLD_MS = 900;
const LINE_HEIGHT = 26;
const PANEL_PADDING_X = 32;
const PANEL_PADDING_Y = 18;

let queue = Promise.resolve();

function playOnce(scene, lines) {
  return new Promise((resolve) => {
    const { width: screenWidth, height: screenHeight } = scene.cameras.main;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    const panelHeight = lines.length * LINE_HEIGHT + PANEL_PADDING_Y * 2;
    const texts = lines.map((line, i) =>
      scene.add
        .text(centerX, centerY - panelHeight / 2 + PANEL_PADDING_Y + i * LINE_HEIGHT + LINE_HEIGHT / 2, line.text, {
          fontSize: line.fontSize ?? "18px",
          color: line.color ?? "#ffffff",
          fontStyle: "bold",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.DIALOG + 1)
    );

    // Widest line decides the panel width, with a floor so a short single
    // word like "Occupied" doesn't draw a comically narrow box.
    const panelWidth = Math.max(220, ...texts.map((t) => t.width)) + PANEL_PADDING_X * 2;
    const panelX = centerX - panelWidth / 2;
    const panelY = centerY - panelHeight / 2;
    const panel = drawMenuPanel(scene, panelX, panelY, panelWidth, panelHeight).setScrollFactor(0).setDepth(DEPTH.DIALOG);
    texts.forEach((t) => t.setX(centerX)); // re-center now that panelWidth is known, in case it grew past the floor

    const targets = [panel, ...texts];
    targets.forEach((t) => t.setAlpha(0));

    scene.tweens.add({
      targets,
      alpha: 1,
      duration: FADE_MS,
      onComplete: () => {
        scene.time.delayedCall(HOLD_MS, () => {
          scene.tweens.add({
            targets,
            alpha: 0,
            duration: FADE_MS,
            onComplete: () => {
              targets.forEach((t) => t.destroy());
              resolve();
            },
          });
        });
      },
    });
  });
}

/** One-line notification - "Occupied", "Repaired", etc. Fire-and-forget:
 * callers don't need to await this for the game to keep going, it's purely
 * cosmetic. */
export function showMessage(scene, text) {
  queue = queue.then(() => playOnce(scene, [{ text }]));
  return queue;
}

/** Two-line notification - specifically the "Turn N" / "Income +G" banner a
 * new round starts with (see ui/bottomBar.js's and net/robotDriver.js's
 * endTurn handling). Upper line reads slightly larger/brighter than the
 * lower one to establish which is the headline. */
export function showTwoLineMessage(scene, upperText, lowerText) {
  queue = queue.then(() =>
    playOnce(scene, [
      { text: upperText, fontSize: "20px", color: "#ffdd44" },
      { text: lowerText, fontSize: "16px", color: "#cccccc" },
    ])
  );
  return queue;
}
