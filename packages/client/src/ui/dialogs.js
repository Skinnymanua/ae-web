	import unitsData from "@ae/shared/data/units.json";
import unitNames from "@ae/shared/data/unit-names.json";
import unitDescriptions from "@ae/shared/data/unit-descriptions.json";
import { highlightPositionSet, clearHighlights } from "../render/tiles.js";
import { DEPTH } from "../constants.js";

/** Simple modal Yes/No confirm box. Sets scene.modalOpen while shown, blocking board input. */
export function showConfirm(scene, message, onYes, onNo) {
  scene.modalOpen = true;
  const cam = scene.cameras.main;
  const container = scene.add.container(cam.width / 2, cam.height / 2);
  container.setScrollFactor(0);
  // Above the stats bars too (see constants.js DEPTH) — a modal must always
  // read as topmost, same reasoning as the stats-bar fix: units/bars get
  // recreated during play and would otherwise climb back over a static-depth dialog.
  container.setDepth(DEPTH.DIALOG);
  const bg = scene.add.rectangle(0, 0, 260, 110, 0x000000, 0.9).setStrokeStyle(2, 0xffffff);
  const text = scene.add
    .text(0, -30, message, { fontSize: "14px", color: "#ffffff", wordWrap: { width: 230 }, align: "center" })
    .setOrigin(0.5, 0.5);
  const yesText = scene.add.text(-60, 25, "[ Yes ]", { fontSize: "16px", color: "#44dd88" }).setScrollFactor(0).setInteractive();
  const noText = scene.add.text(20, 25, "[ No ]", { fontSize: "16px", color: "#dd4444" }).setScrollFactor(0).setInteractive();
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
 * Unit-detail purchase panel - one unit shown in full (name, price, population
 * cost, attack range, attack/pdef/movement stats, description) with a portrait
 * strip along the bottom to switch between every unit the current team can
 * currently afford. Picking "Buy" enters placement mode (scene.buyMode +
 * scene.pendingBuyUnitIndex), highlighting owned/empty castle tiles - the actual
 * placement click is handled by input/boardInput.js's onTileClick.
 *
 * Ported to roughly match RightPanelRenderer/StatusBarRenderer's in-game unit-info
 * panel styling (icons_hud_battle for atk/pdef/mdef, icons_action for magic-attack/
 * move, icons_hud_status for population/attack-range) rather than the earlier
 * plain text list - see the reference screenshot from the original Android app.
 */
export function showBuyMenu(scene) {
  scene.modalOpen = true;
  const team = scene.game_.currentTeam;

  const affordable = unitsData.units.filter((def) => scene.game_.canBuyUnit(def.index, team));

  const cam = scene.cameras.main;
  const panelWidth = Math.min(340, cam.width - 20);

  // Single scrollable row (drag or wheel) instead of a wrapping grid - matches
  // the original Android app's horizontally-swipeable unit picker (see the
  // reference screenshot) and sidesteps a wrapping grid's layout/hit-testing
  // fragility entirely, since row height - and everything below it - is now a
  // fixed constant regardless of how many units are affordable.
  const portraitSize = 40;
  const portraitGap = 6;
  const stripHeight = portraitSize + 8;

  // Reserve a fixed height for the description block sized to the longest
  // description among the units actually shown in this menu, so the Buy/Cancel
  // row below it never shifts or overlaps regardless of which unit is selected
  // (a per-selection reflow would also need to resize the panel background each
  // time - not worth it for text that only varies by a line or two). Measured
  // with a throwaway text object, destroyed right after.
  const descFontSize = 12;
  const descLineSpacing = 3;
  const measure = scene.add.text(0, 0, "", {
    fontSize: `${descFontSize}px`,
    wordWrap: { width: panelWidth - 32 },
    lineSpacing: descLineSpacing,
  });
  let maxDescLines = 1;
  for (const def of affordable) {
    measure.setText(unitDescriptions[def.index] ?? "");
    maxDescLines = Math.max(maxDescLines, measure.getWrappedText().length);
  }
  measure.destroy();
  const descBlockHeight = maxDescLines * (descFontSize + descLineSpacing);

  const statY = 72;
  const descY = statY + 32;
  const buyY = descY + descBlockHeight + 12;
  const stripY = buyY + 30;
  const panelHeight = Math.min(stripY + stripHeight + 16, cam.height - 20);

  const container = scene.add.container(cam.width / 2 - panelWidth / 2, cam.height / 2 - panelHeight / 2);
  container.setScrollFactor(0);
  container.setDepth(DEPTH.DIALOG);

  const bg = scene.add
    .rectangle(0, 0, panelWidth, panelHeight, 0x1a2038, 0.96)
    .setOrigin(0, 0)
    .setStrokeStyle(2, 0xffffff, 0.4);
  container.add(bg);

  if (affordable.length === 0) {
    const noneText = scene.add.text(16, 16, "No units you can afford right now.", {
      fontSize: "13px",
      color: "#dd8888",
      wordWrap: { width: panelWidth - 32 },
    });
    container.add(noneText);
    const closeText = scene.add.text(16, panelHeight - 28, "[ Close ]", { fontSize: "13px", color: "#dd4444" }).setInteractive();
    closeText.on("pointerdown", () => {
      scene.modalOpen = false;
      container.destroy();
    });
    container.add(closeText);
    return;
  }

  // --- static chrome (name/stats/description texts + buy/cancel), rebuilt in
  // place by selectUnit() each time the portrait strip picks a different unit ---
  const nameText = scene.add.text(16, 14, "", { fontSize: "18px", color: "#ffffff", fontStyle: "bold" });
  container.add(nameText);

  const goldIcon = scene.add.image(panelWidth - 108, 22, "icons_hud_status", 1).setDisplaySize(16, 16);
  const priceText = scene.add.text(panelWidth - 96, 14, "", { fontSize: "14px", color: "#ffdd44" });
  container.add([goldIcon, priceText]);

  const popIcon = scene.add.image(panelWidth - 52, 22, "icons_hud_status", 0).setDisplaySize(14, 14);
  const popText = scene.add.text(panelWidth - 42, 14, "", { fontSize: "14px", color: "#ffffff" });
  container.add([popIcon, popText]);

  const rangeIcon = scene.add.image(16, 46, "icons_hud_status", 2).setDisplaySize(16, 16);
  const rangeText = scene.add.text(30, 38, "", { fontSize: "13px", color: "#ffffff" });
  container.add([rangeIcon, rangeText]);

  // Stats row: physical attack, magic attack, physical defence, movement.
  const statW = (panelWidth - 32) / 4;
  const atkIcon = scene.add.image(16 + statW * 0 + 8, statY + 8, "icons_hud_battle", 0).setDisplaySize(16, 20);
  const atkText = scene.add.text(16 + statW * 0 + 22, statY + 2, "", { fontSize: "14px", color: "#88ee88" });
  const matkIcon = scene.add.image(16 + statW * 1 + 8, statY + 8, "icons_action", 6).setDisplaySize(18, 18);
  const matkText = scene.add.text(16 + statW * 1 + 22, statY + 2, "", { fontSize: "14px", color: "#88ee88" });
  const pdefIcon = scene.add.image(16 + statW * 2 + 8, statY + 8, "icons_hud_battle", 1).setDisplaySize(16, 20);
  const pdefText = scene.add.text(16 + statW * 2 + 22, statY + 2, "", { fontSize: "14px", color: "#ffffff" });
  const moveIcon = scene.add.image(16 + statW * 3 + 8, statY + 8, "icons_action", 4).setDisplaySize(18, 18);
  const moveText = scene.add.text(16 + statW * 3 + 22, statY + 2, "", { fontSize: "14px", color: "#ffffff" });
  container.add([atkIcon, atkText, matkIcon, matkText, pdefIcon, pdefText, moveIcon, moveText]);

  const descText = scene.add.text(16, descY, "", {
    fontSize: `${descFontSize}px`,
    color: "#ccccdd",
    wordWrap: { width: panelWidth - 32 },
    lineSpacing: descLineSpacing,
  });
  container.add(descText);

  const buyText = scene.add.text(16, buyY, "[ Buy ]", { fontSize: "14px", color: "#44dd88" }).setInteractive();
  container.add(buyText);
  const cancelText = scene.add
    .text(panelWidth - 78, buyY, "[ Cancel ]", { fontSize: "14px", color: "#dd4444" })
    .setInteractive();
  container.add(cancelText);

  // --- scrollable portrait strip ---
  // container is at scene-space (containerX, containerY); the strip's clip
  // rectangle and drag/wheel hit-zone need to be in that same scene space, not
  // container-local coordinates, since Phaser hit-testing and masks both work
  // in world/scene space.
  const containerX = cam.width / 2 - panelWidth / 2;
  const containerY = cam.height / 2 - panelHeight / 2;
  const stripVisibleWidth = panelWidth - 32;

  // Mask source must be a Graphics object, not a Rectangle Shape: Phaser's
  // canvas renderer path for GeometryMask calls the mask source's renderCanvas
  // with a trailing "allowClip" flag telling it to build a clip path instead of
  // actually painting pixels - Graphics implements that branch, but Rectangle
  // (and shapes generally) ignore the flag and just fillRect() as normal,
  // painting an opaque block over the strip instead of clipping it. That was
  // the actual cause of "no units show" - not a coordinate or z-order bug.
  const stripMaskGraphics = scene.add.graphics();
  stripMaskGraphics.setScrollFactor(0);
  stripMaskGraphics.setVisible(false);
  stripMaskGraphics.fillStyle(0xffffff);
  stripMaskGraphics.fillRect(containerX + 16, containerY + stripY, stripVisibleWidth, stripHeight);
  const stripMask = stripMaskGraphics.createGeometryMask();

  const stripContainer = scene.add.container(16, stripY);
  stripContainer.setMask(stripMask);
  container.add(stripContainer);

  const totalStripWidth = affordable.length * (portraitSize + portraitGap) - portraitGap;
  const maxScroll = Math.max(0, totalStripWidth - stripVisibleWidth);
  let scrollX = 0;

  function applyScroll() {
    stripContainer.x = 16 - scrollX;
  }

  // A dedicated invisible hit-zone (not the portraits themselves) drives both
  // drag-to-scroll and wheel-to-scroll, so drags and wheel events work anywhere
  // over the strip - not just when the pointer happens to start on a portrait.
  const stripHitZone = scene.add
    .rectangle(containerX + 16, containerY + stripY, stripVisibleWidth, stripHeight, 0x000000, 0)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setInteractive();
  container.add(stripHitZone);

  // Same click-vs-drag threshold pattern as input/cameraDrag.js: a press only
  // becomes a scroll-drag once the pointer moves past DRAG_THRESHOLD, so a plain
  // tap still reaches the portrait's own "pointerup" handler underneath.
  const DRAG_THRESHOLD = 6;
  let dragging = false;
  let dragStartX = 0;
  let scrollStartX = 0;

  stripHitZone.on("pointerdown", (pointer) => {
    dragging = false;
    dragStartX = pointer.x;
    scrollStartX = scrollX;
  });
  const endDrag = () => {
    dragging = false;
  };
  scene.input.on("pointerup", endDrag);
  scene.input.on("pointerupoutside", endDrag);

  const onPointerMove = (pointer) => {
    if (!pointer.isDown) return;
    const dx = pointer.x - dragStartX;
    if (!dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      dragging = true;
    }
    scrollX = Math.max(0, Math.min(maxScroll, scrollStartX - dx));
    applyScroll();
  };
  scene.input.on("pointermove", onPointerMove);

  // The scene-level listeners above outlive this function call, so they must be
  // removed explicitly on every close path (Buy or Cancel) - otherwise each time
  // the buy menu is reopened it adds another set, leaking listeners that keep
  // firing (harmlessly, but needlessly) after the menu that owns them is gone.
  function cleanupStripListeners() {
    scene.input.off("pointermove", onPointerMove);
    scene.input.off("pointerup", endDrag);
    scene.input.off("pointerupoutside", endDrag);
  }

  stripHitZone.on("wheel", (pointer, dx, dy) => {
    scrollX = Math.max(0, Math.min(maxScroll, scrollX + dy));
    applyScroll();
  });

  cancelText.on("pointerdown", () => {
    cleanupStripListeners();
    scene.modalOpen = false;
    container.destroy();
    stripMaskGraphics.destroy();
  });

  const portraits = [];

  function selectUnit(def) {
    const name = unitNames[def.index] ?? `Unit #${def.index}`;
    nameText.setText(name);
    priceText.setText(String(def.price));
    popText.setText(String(def.occupancy));
    rangeText.setText(`${def.minAttackRange}-${def.maxAttackRange}`);
    // units.json stores one attack value + an attackType flag (0 physical, 1
    // magic) rather than two separate stat pools - split it back into the two
    // display slots the original's panel shows side by side (see the reference
    // screenshot), with whichever type the unit doesn't have shown as 0.
    atkText.setText(String(def.attackType === 0 ? def.attack : 0));
    matkText.setText(String(def.attackType === 1 ? def.attack : 0));
    pdefText.setText(String(def.physicalDefence));
    moveText.setText(String(def.movementPoint));
    descText.setText(unitDescriptions[def.index] ?? "");

    for (const p of portraits) {
      p.bg.setStrokeStyle(2, p.def.index === def.index ? 0xffdd44 : 0xffffff, p.def.index === def.index ? 1 : 0.3);
    }

    buyText.off("pointerdown");
    buyText.on("pointerdown", () => {
      cleanupStripListeners();
      scene.modalOpen = false;
      container.destroy();
      stripMaskGraphics.destroy();
      scene.pendingBuyUnitIndex = def.index;
      scene.buyMode = true;
      clearHighlights(scene);
      highlightPositionSet(
        scene,
        scene.game_.getBuyPositions(team).map((p2) => `${p2.x},${p2.y}`),
        0x44ddaa,
        0.4
      );
    });
  }

  affordable.forEach((def, i) => {
    const px = i * (portraitSize + portraitGap);
    const py = 4;
    const pBg = scene.add
      .rectangle(px, py, portraitSize, portraitSize, 0x000000, 0.4)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xffffff, 0.3)
      .setInteractive();
    const sprite = scene.add.sprite(px + portraitSize / 2, py + portraitSize / 2, `unit_sheet_${team}`, def.index);
    sprite.setDisplaySize(portraitSize - 6, portraitSize - 6);
    stripContainer.add([pBg, sprite]);
    // pointerup (not pointerdown), and skip if this press turned into a strip
    // drag - same rationale as render/tiles.js's tile clicks vs camera drag.
    pBg.on("pointerup", () => {
      if (dragging) return;
      selectUnit(def);
    });
    portraits.push({ def, bg: pBg });
  });

  selectUnit(affordable[0]);
}
