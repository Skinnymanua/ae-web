import { createBottomBar, updateBottomBarEconomy } from "./bottomBar.js";

// End Turn now lives on the bottom bar itself (see ui/bottomBar.js) instead of
// a separate floating button, so createHud just wires up the bar. The old
// floating turn/team/gold readout (scene.infoText, parked off to the right of
// the board) is gone too — it duplicated what the bottom bar already shows.
export function createHud(scene) {
  createBottomBar(scene);
}

// Kept as the shared "something changed" hook — actionBar.js and boardInput.js
// call this after moves/buys/attacks. Now it just refreshes the bottom bar's
// gold/turn readout.
export function updateInfoText(scene) {
  updateBottomBarEconomy(scene);
}