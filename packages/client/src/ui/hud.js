import { showConfirm } from "./dialogs.js";
import { clearHighlights } from "../render/tiles.js";
import { refreshUnits } from "../render/units.js";
import { refreshStatsPanel } from "./statsPanel.js";
import { createBottomBar, updateBottomBarEconomy } from "./bottomBar.js";

export function createHud(scene) {
  scene.infoText = scene.add.text(500, 20, "", { fontSize: "16px", color: "#ffffff" });
  scene.infoText.setScrollFactor(0);
  createBottomBar(scene);
  updateInfoText(scene);

  const endTurnButton = scene.add
    .text(500, 120, "[ End Turn ]", { fontSize: "18px", color: "#ffdd44" })
    .setInteractive();
    endTurnButton.setScrollFactor(0);
    endTurnButton.on("pointerdown", () => {
    if (scene.modalOpen || scene.animating || scene.actionBarOpen) return;
    showConfirm(scene, "End your turn?", () => {
      scene.game_.endTurn();
      scene.selectedUnitId = null;
      clearHighlights(scene);
      refreshUnits(scene);
      updateInfoText(scene);
      refreshStatsPanel(scene);
    });
  });
}

export function updateInfoText(scene) {
  const lines = [
    `Turn: ${scene.game_.turn}`,
    `Current team: ${scene.game_.currentTeam}`,
    ...scene.game_.players.map((p) => `Team ${p.team} gold: ${p.gold}`),
  ];
  scene.infoText.setText(lines.join("\n"));
  updateBottomBarEconomy(scene);
}