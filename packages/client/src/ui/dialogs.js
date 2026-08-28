import unitsData from "@ae/shared/data/units.json";
import unitNames from "@ae/shared/data/unit-names.json";
import unitDescriptions from "@ae/shared/data/unit-descriptions.json";
import { highlightPositionSet, clearHighlights } from "../render/tiles.js";
import { createPurchaseStrip } from "./purchaseStrip.js";
import { getUnitSpriteKey } from "../render/unitTexture.js";
import { DEPTH, HUD_ICON, STAT_ICON, PHYSICAL_ATTACK_COLOR, MAGIC_ATTACK_COLOR } from "../constants.js";

// Shared sizing for every icon+value pair in this panel. A single fixed icon
// size (rather than the old per-icon 16x20 / 18x18 / 14x14 mix) is what makes
// the left-aligned stat row and the right-aligned gold/pop pair line up
// consistently regardless of which icon sheet a given stat's frame comes from.
const STAT_ICON_SIZE = 16;
const STAT_ICON_GAP = 4;
const STAT_GROUP_GAP = 14;

/**
 * Icon + value text, growing rightward from `x`. Text is vertically centered
 * on the icon's own center line (origin 0.5 on the icon, 0/0.5 on the text),
 * so the pairing stays visually centered no matter what iconSize is passed -
 * unlike the old code, which placed icon and text at independently-guessed
 * fixed offsets and would drift if the icon's display size ever changed.
 */
function addIconValueLeft(scene, container, x, y, iconSheet, iconFrame, fontSize, color, iconSize = STAT_ICON_SIZE) {
  const icon = scene.add.image(x + iconSize / 2, y, iconSheet, iconFrame).setDisplaySize(iconSize, iconSize);
  const text = scene.add.text(x + iconSize + STAT_ICON_GAP, y, "", { fontSize: `${fontSize}px`, color }).setOrigin(0, 0.5);
  container.add([icon, text]);
  return text;
}

/**
 * Icon + value text, right-aligned so the group's right edge lands at a caller-
 * chosen x. Unlike the old fixed `panelWidth - 108` / `panelWidth - 96` style
 * offsets (which assumed a specific digit count and would overlap once a value
 * got wider, e.g. a 4-digit price), this repositions the icon relative to the
 * *actual measured width* of the text every time updateGroup() runs, so it's
 * correct for any value length. Returns a {text, updateGroup} pair - call
 * updateGroup(value, rightEdge) from selectUnit() after picking a unit.
 */
function addIconValueRight(scene, container, y, iconSheet, iconFrame, fontSize, color, iconSize = STAT_ICON_SIZE) {
  const icon = scene.add.image(0, y, iconSheet, iconFrame).setDisplaySize(iconSize, iconSize);
  const text = scene.add.text(0, y, "", { fontSize: `${fontSize}px`, color }).setOrigin(1, 0.5);
  container.add([icon, text]);
  function updateGroup(value, rightEdge) {
    text.setText(String(value));
    text.x = rightEdge;
    icon.x = text.x - text.width - STAT_ICON_GAP - iconSize / 2;
    return icon.x - iconSize / 2; // this group's own left edge, for chaining another group further left
  }
  return { text, updateGroup };
}

/**
 * Draws the original's dialog-window frame - ported from BorderRenderer.
 * drawBorder(), which BasicDialog (UnitStoreDialog's base class) uses for
 * every dialog. Four fixed-size corner pieces (frames 0/2/5/7) plus four edge
 * pieces (1/3/4/6) stretched to fill the gap between them - see border.png's
 * load call in BoardScene.js for the frame layout. Assumes `container`
 * already has a filled background rectangle sized (width, height) at (0,0);
 * this only adds the frame on top of it.
 */
function drawDialogBorder(scene, container, width, height, borderSize = 16) {
  const piece = (frameIndex, x, y, w, h) => {
    const img = scene.add.image(x, y, "border", frameIndex).setOrigin(0, 0);
    img.setDisplaySize(w, h);
    container.add(img);
  };
  piece(0, 0, 0, borderSize, borderSize); // top-left corner
  piece(1, borderSize, 0, width - borderSize * 2, borderSize); // top edge
  piece(2, width - borderSize, 0, borderSize, borderSize); // top-right corner
  piece(3, 0, borderSize, borderSize, height - borderSize * 2); // left edge
  piece(4, width - borderSize, borderSize, borderSize, height - borderSize * 2); // right edge
  piece(5, 0, height - borderSize, borderSize, borderSize); // bottom-left corner
  piece(6, borderSize, height - borderSize, width - borderSize * 2, borderSize); // bottom edge
  piece(7, width - borderSize, height - borderSize, borderSize, borderSize); // bottom-right corner
}

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
 * panel styling (icons_hud_battle for attack/pdef, icons_action for move/mdef,
 * icons_hud_status for population/price/attack-range) rather than the earlier
 * plain text list. Portrait-strip picker (vs. the original's vertical list) is
 * an intentional deviation for the web port's portrait-mode layout.
 */
export function showBuyMenu(scene) {
  scene.modalOpen = true;
  const team = scene.game_.currentTeam;

  // Every roster unit gets listed regardless of whether the player can currently
  // afford it - only skeleton/crystal (scenario/summoned types, never meant to
  // be purchasable at all) are excluded here. Affordability is checked
  // per-unit in selectUnit() below instead, to grey out the price/Buy button
  // rather than hide the unit entirely - so the player can still see what's
  // coming up, not just what they can afford right now.
  // Commander is the one exception: while a living commander already exists,
  // buying another isn't "not affordable yet" (something gold can fix), it's
  // just not available at all until the current one dies - showing it dimmed
  // every single turn regardless would be noise, not useful foresight, so it's
  // excluded from the listing entirely in that case (see hasLivingCommander).
  const listed = unitsData.units.filter(
    (def) => !def.isSkeleton && !def.isCrystal && (!def.isCommander || !scene.game_.hasLivingCommander(team))
  );

  const cam = scene.cameras.main;
  const panelWidth = Math.min(340, cam.width - 20);

  // Single scrollable row (drag or wheel) instead of a wrapping grid - matches
  // the original Android app's horizontally-swipeable unit picker (see the
  // reference screenshot) and sidesteps a wrapping grid's layout/hit-testing
  // fragility entirely, since row height - and everything below it - is now a
  // fixed constant regardless of how many units are listed.
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
  for (const def of listed) {
    measure.setText(unitDescriptions[def.index] ?? "");
    maxDescLines = Math.max(maxDescLines, measure.getWrappedText().length);
  }
  measure.destroy();
  const descBlockHeight = maxDescLines * (descFontSize + descLineSpacing);

  const statY = 46;
  const descY = statY + 32;
  const buyY = descY + descBlockHeight + 12;
  const stripY = buyY + 30;
  const panelHeight = Math.min(stripY + stripHeight + 16, cam.height - 20);

  const container = scene.add.container(cam.width / 2 - panelWidth / 2, cam.height / 2 - panelHeight / 2);
  container.setScrollFactor(0);
  // ^ Container.setScrollFactor() only propagates to children already in the
  // list at call time (there are none yet, right after creation) - it does
  // NOT retroactively cover anything added to `container` later. Rendering
  // still comes out correct either way (nested transforms compose fine), but
  // Phaser's input hit-testing separately factors camera.scroll * the child's
  // OWN scrollFactor, so any interactive element left at the default
  // scrollFactor(1) silently drifts from where it's drawn by however far the
  // camera has panned. Every interactive child added below (buyText,
  // cancelText, the purchase strip's badges, ...) needs its own explicit
  // .setScrollFactor(0) - don't rely on this call alone.
  container.setDepth(DEPTH.DIALOG);

  const bg = scene.add.rectangle(0, 0, panelWidth, panelHeight, 0x1a2038, 0.96).setOrigin(0, 0);
  container.add(bg);
  drawDialogBorder(scene, container, panelWidth, panelHeight);

  if (listed.length === 0) {
    const noneText = scene.add.text(16, 16, "No units available.", {
      fontSize: "13px",
      color: "#dd8888",
      wordWrap: { width: panelWidth - 32 },
    });
    container.add(noneText);
    const closeText = scene.add.text(16, panelHeight - 28, "[ Close ]", { fontSize: "13px", color: "#dd4444" }).setScrollFactor(0).setInteractive();
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

  // Price, range, and population all on one row (matches UnitStoreDialog.java's
  // hud_pane, which puts image_price/label_price, image_attack_range/
  // label_attack_range, image_occupancy/label_occupancy side by side in a
  // single Table row) - an earlier version of this port split range onto its
  // own row below, which doesn't match either the original or the reference
  // screenshot. Right-to-left chain, same reasoning as before: population's
  // right edge is fixed to the panel edge, range's right edge is fixed to
  // population's measured left edge, and price's right edge is fixed to
  // range's - so the whole group shifts together and never overlaps
  // regardless of how wide any individual value's text measures out to.
  const priceRowY = 22;
  const popGroup = addIconValueRight(scene, container, priceRowY, "icons_hud_status", 0, 14, "#ffffff", 14);
  const rangeGroup = addIconValueRight(scene, container, priceRowY, "icons_hud_status", 2, 13, "#ffffff");
  const goldGroup = addIconValueRight(scene, container, priceRowY, "icons_hud_status", 1, 14, "#ffdd44");

  // Stats row: attack (single value, color-coded physical/magic - the
  // original has no separate magic-attack slot, see UnitStoreDialog.label_attack),
  // magic defence, physical defence, move. This order (not the naive atk/move/
  // pdef/mdef row-major reading of the original's 2x2 Table grid - attack+move
  // on row 1, pdef+mdef on row 2) matches the reference screenshot's actual
  // single-row layout, which is from the commercial reskin, not the plain
  // open-source UnitStoreDialog. All four share STAT_ICON_SIZE so the
  // icon-to-text gap is identical in every column.
  const statW = (panelWidth - 32) / 4;
  const statRowY = statY + 8;
  const atkText = addIconValueLeft(scene, container, 16 + statW * 0, statRowY, "icons_hud_battle", HUD_ICON.ATTACK, 14, "#88ee88");
  const mdefText = addIconValueLeft(scene, container, 16 + statW * 1, statRowY, "icons_action", STAT_ICON.MDEF, 14, "#88ee88");
  const pdefText = addIconValueLeft(scene, container, 16 + statW * 2, statRowY, "icons_hud_battle", HUD_ICON.PDEF, 14, "#ffffff");
  const moveText = addIconValueLeft(scene, container, 16 + statW * 3, statRowY, "icons_action", STAT_ICON.MOVE, 14, "#ffffff");

  const descText = scene.add.text(16, descY, "", {
    fontSize: `${descFontSize}px`,
    color: "#ccccdd",
    wordWrap: { width: panelWidth - 32 },
    lineSpacing: descLineSpacing,
  });
  container.add(descText);

  const buyText = scene.add.text(16, buyY, "[ Buy ]", { fontSize: "14px", color: "#44dd88" }).setScrollFactor(0).setInteractive();
  container.add(buyText);
  const cancelText = scene.add
    .text(panelWidth - 78, buyY, "[ Cancel ]", { fontSize: "14px", color: "#dd4444" })
    .setScrollFactor(0)
    .setInteractive();
  container.add(cancelText);

  // container is at scene-space (containerX, containerY); the strip needs that
  // same scene space for its mask/hit-zone - see purchaseStrip.js's doc comment.
  const containerX = cam.width / 2 - panelWidth / 2;
  const containerY = cam.height / 2 - panelHeight / 2;
  const stripVisibleWidth = panelWidth - 32;

  function selectUnit(def) {
    const name = unitNames[def.index] ?? `Unit #${def.index}`;
    nameText.setText(name);
    // Right-to-left chain: population's right edge is fixed to the panel;
    // range's right edge is fixed to population's measured left edge; price's
    // right edge is fixed to range's - so reading left-to-right the group
    // always comes out price, range, population (matching the reference
    // screenshot), and never overlaps regardless of how wide any one value's
    // text measures out to.
    const popLeftEdge = popGroup.updateGroup(def.occupancy, panelWidth - 16);
    const rangeLeftEdge = rangeGroup.updateGroup(`${def.minAttackRange}-${def.maxAttackRange}`, popLeftEdge - STAT_GROUP_GAP);
    goldGroup.updateGroup(def.price, rangeLeftEdge - STAT_GROUP_GAP);
    // units.json stores one attack value + an attackType flag (0 physical, 1
    // magic) - matching UnitStoreDialog.update(), that's a single Attack stat
    // whose text color switches between physical/magic, not two separate
    // stat slots.
    atkText.setText(String(def.attack));
    atkText.setColor(def.attackType === 0 ? PHYSICAL_ATTACK_COLOR : MAGIC_ATTACK_COLOR);
    mdefText.setText(String(def.magicDefence));
    pdefText.setText(String(def.physicalDefence));
    moveText.setText(String(def.movementPoint));
    descText.setText(unitDescriptions[def.index] ?? "");

    // Affordability (gold, population capacity, team-alive) is checked
    // per-unit here rather than at listing time, so an out-of-reach unit
    // still shows its stats/description - only actually buying it is blocked.
    const canBuy = scene.game_.canBuyUnit(def.index, team);
    goldGroup.text.setColor(canBuy ? "#ffdd44" : "#dd4444");

    buyText.off("pointerdown");
    if (canBuy) {
      buyText.setColor("#44dd88");
      buyText.setInteractive();
      buyText.on("pointerdown", () => {
        strip.destroy();
        scene.modalOpen = false;
        container.destroy();
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
    } else {
      buyText.setColor("#666677");
      buyText.disableInteractive();
    }
  }

  const strip = createPurchaseStrip(scene, {
    parentContainer: container,
    parentX: containerX,
    parentY: containerY,
    x: 16,
    y: stripY,
    width: stripVisibleWidth,
    portraitSize,
    portraitGap,
    items: listed.map((def) => {
      const { key: textureKey, frame: frameIndex } = getUnitSpriteKey(def.index, team);
      return {
        id: def.index,
        textureKey,
        frameIndex,
        def,
        dimmed: !scene.game_.canBuyUnit(def.index, team),
        // Commander's body sprite is intentionally headless in the source art -
        // see render/units.js's on-board equivalent and statsPanel.js's stats-bar
        // portrait, both of which layer a separate team-colored head on top only
        // for isCommander units. unit.head isn't tracked per-instance anywhere in
        // this port (always frame 0 - a separate, pre-existing gap), so this uses
        // the same frame-0 fallback for consistency rather than inventing a
        // different convention just for the shop.
        headFrame: def.isCommander ? 0 : null,
      };
    }),
    onSelect: (item) => selectUnit(item.def),
  });

  cancelText.on("pointerdown", () => {
    strip.destroy();
    scene.modalOpen = false;
    container.destroy();
  });

  strip.select(listed[0].index);
}