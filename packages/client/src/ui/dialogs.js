import unitsData from "@ae/shared/data/units.json";
import { highlightPositionSet, clearHighlights } from "../render/tiles.js";

/** Simple modal Yes/No confirm box. Sets scene.modalOpen while shown, blocking board input. */
export function showConfirm(scene, message, onYes, onNo) {
  scene.modalOpen = true;
  const container = scene.add.container(150, 250);
  container.setScrollFactor(0);
  const bg = scene.add.rectangle(0, 0, 260, 110, 0x000000, 0.9).setStrokeStyle(2, 0xffffff);
  const text = scene.add
    .text(0, -30, message, { fontSize: "14px", color: "#ffffff", wordWrap: { width: 230 }, align: "center" })
    .setOrigin(0.5, 0.5);
  const yesText = scene.add.text(-60, 25, "[ Yes ]", { fontSize: "16px", color: "#44dd88" }).setInteractive();
  const noText = scene.add.text(20, 25, "[ No ]", { fontSize: "16px", color: "#dd4444" }).setInteractive();
  container.add([bg, text, yesText, noText]);

  yesText.on("pointerdown", () => {
    scene.modalOpen = false;
    container.destroy();
    onYes?.();
  });
  noText.on("pointerdown", () => {
    scene.modalOpen = false;
    container.destroy();
    onNo?.();
  });
}

/**
 * Lists every unit the current team can currently afford. Picking one enters
 * placement mode (scene.buyMode + scene.pendingBuyUnitIndex), highlighting
 * owned/empty castle tiles — the actual placement click is handled by
 * input/boardInput.js's onTileClick.
 */
export function showBuyMenu(scene) {
  scene.modalOpen = true;
  const team = scene.game_.currentTeam;
  const container = scene.add.container(500, 200);
  container.setScrollFactor(0);
  
  const affordable = unitsData.units.filter((def) => scene.game_.canBuyUnit(def.index, team));
  const rowHeight = 20;
  const panelHeight = (affordable.length + 1) * rowHeight + 20;
  const bg = scene.add.rectangle(90, panelHeight / 2 - 10, 220, panelHeight, 0x111111, 0.92).setStrokeStyle(2, 0xffffff);
  container.add(bg);

  if (affordable.length === 0) {
    const noneText = scene.add.text(0, 0, "No units you can afford right now.", {
      fontSize: "13px",
      color: "#dd8888",
      wordWrap: { width: 200 },
    });
    container.add(noneText);
  }

  affordable.forEach((def, i) => {
    const label = scene.add
      .text(0, i * rowHeight, `Unit #${def.index} — ${def.price}g`, { fontSize: "13px", color: "#ffffff" })
      .setInteractive();
    label.on("pointerdown", () => {
      scene.modalOpen = false;
      container.destroy();
      scene.pendingBuyUnitIndex = def.index;
      scene.buyMode = true;
      clearHighlights(scene);
      highlightPositionSet(
        scene,
        scene.game_.getBuyPositions(team).map((p) => `${p.x},${p.y}`),
        0x44ddaa,
        0.4
      );
    });
    container.add(label);
  });

  const cancelText = scene.add
    .text(0, affordable.length * rowHeight + 10, "[ Cancel ]", { fontSize: "13px", color: "#dd4444" })
    .setInteractive();
  cancelText.on("pointerdown", () => {
    scene.modalOpen = false;
    container.destroy();
  });
  container.add(cancelText);
}
