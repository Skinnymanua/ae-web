	import unitsData from "@ae/shared/data/units.json";
import unitTextData from "@ae/shared/data/unit-text.json";
import { highlightPositionSet, clearHighlights } from "../render/tiles.js";
import { HUD_ICON, STAT_ICON } from "../constants.js";

const UNIT_TEXT_BY_INDEX = new Map(unitTextData.units.map((u) => [u.index, u]));

/** Simple modal Yes/No confirm box. Sets scene.modalOpen while shown, blocking board input. */
export function showConfirm(scene, message, onYes, onNo) {
  scene.modalOpen = true;
  const cam = scene.cameras.main;
  const container = scene.add.container(cam.width / 2, cam.height / 2);
  container.setScrollFactor(0);
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
 * Lists every unit the current team can currently afford. Picking one enters
 * placement mode (scene.buyMode + scene.pendingBuyUnitIndex), highlighting
 * owned/empty castle tiles — the actual placement click is handled by
 * input/boardInput.js's onTileClick.
 */
const CARD_WIDTH = 460;
const CARD_HEIGHT = 340;
const STRIP_ICON_SIZE = 36;
const STRIP_ICON_GAP = 8;
const STRIP_VISIBLE_WIDTH = 340;
const PORTRAIT_SIZE = 80;

/**
 * Paged unit-detail card modeled on the original mobile game's shop screen:
 * a single-row horizontal strip of every buyable unit's portrait at the top
 * (selecting one swaps the card below), scrollable via arrow buttons when it
 * overflows, then a big portrait, name, price/occupancy/range stats, a row
 * of combat stat badges, and the flavor description underneath.
 * Names/descriptions come from unit-text.json (sourced from the original's
 * en_US.dat, not present anywhere else in this repo's data).
 *
 * Unaffordable units are still listed (so the player can see what exists and
 * plan for it) but their card has no Recruit button — picking one shows the
 * card only, with no way to confirm a purchase, matching "look but can't buy".
 */
export function showBuyMenu(scene) {
  scene.modalOpen = true;
  const team = scene.game_.currentTeam;

  // Every real recruit — skeleton/crystal are spawned by game mechanics, not
  // bought, so they're excluded regardless of price.
  const buyable = unitsData.units.filter((def) => !def.isSkeleton && !def.isCrystal);

  const cam = scene.cameras.main;
  const container = scene.add.container(cam.width / 2 - CARD_WIDTH / 2, cam.height / 2 - CARD_HEIGHT / 2);
  container.setScrollFactor(0);

  const bg = scene.add.rectangle(CARD_WIDTH / 2, CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 0x161b2c, 0.96).setStrokeStyle(2, 0xffffff);
  container.add(bg);

  // --- Icon strip (top) — single row, all buyable units, horizontally
  // scrollable via arrow buttons when it doesn't fit STRIP_VISIBLE_WIDTH.
  const stripY = 16;
  const stripCenterX = CARD_WIDTH / 2;
  const stripStep = STRIP_ICON_SIZE + STRIP_ICON_GAP;
  const stripTotalWidth = buyable.length * STRIP_ICON_SIZE + (buyable.length - 1) * STRIP_ICON_GAP;
  const maxScroll = Math.max(0, stripTotalWidth - STRIP_VISIBLE_WIDTH);
  let scrollX = 0;

  let detailGroup = null;
  const stripIcons = [];

  const detailTop = stripY + STRIP_ICON_SIZE + 14;

  function renderDetail(def) {
    if (detailGroup) {
      detailGroup.destroy();
      detailGroup = null;
    }
    const affordable = scene.game_.canBuyUnit(def.index, team);
    const text = UNIT_TEXT_BY_INDEX.get(def.index);
    const name = text?.name ?? `Unit #${def.index}`;
    const description = text?.description || "";

    const group = scene.add.container(0, 0);
    detailGroup = group;
    container.add(group);

    // Big portrait
    const portraitBg = scene.add
      .rectangle(CARD_WIDTH / 2, detailTop + PORTRAIT_SIZE / 2, PORTRAIT_SIZE, PORTRAIT_SIZE, 0x0c0e16, 1)
      .setStrokeStyle(2, affordable ? 0xffffff : 0x555555);
    group.add(portraitBg);
    const portrait = scene.add.sprite(CARD_WIDTH / 2, detailTop + PORTRAIT_SIZE / 2, `unit_sheet_${team}`, def.index);
    portrait.setDisplaySize(PORTRAIT_SIZE - 16, PORTRAIT_SIZE - 16);
    if (!affordable) portrait.setTint(0x888888);
    group.add(portrait);

    // Name + price/occupancy row
    const nameY = detailTop + PORTRAIT_SIZE + 14;
    const nameText = scene.add
      .text(CARD_WIDTH / 2, nameY, name, {
        fontSize: "16px",
        fontStyle: "bold",
        color: affordable ? "#ffffff" : "#888888",
      })
      .setOrigin(0.5, 0);
    group.add(nameText);

    const priceText = scene.add
      .text(CARD_WIDTH / 2, nameY + 22, `${def.price}g   pop ${def.occupancy}   range ${def.minAttackRange}-${def.maxAttackRange}`, {
        fontSize: "11px",
        color: affordable ? "#cccccc" : "#777777",
      })
      .setOrigin(0.5, 0);
    group.add(priceText);

    // Stat badges: attack / physical def / magic def / move
    const badgeY = nameY + 44;
    const badges = [
      { icon: "icons_hud_battle", frame: HUD_ICON.ATTACK, value: def.attack },
      { icon: "icons_hud_battle", frame: HUD_ICON.PDEF, value: def.physicalDefence },
      { icon: "icons_hud_battle", frame: HUD_ICON.MDEF, value: def.magicDefence },
      { icon: "icons_action", frame: STAT_ICON.MOVE, value: def.movementPoint },
    ];
    const badgeGap = CARD_WIDTH / badges.length;
    badges.forEach((b, i) => {
      const bx = badgeGap * i + badgeGap / 2;
      const icon = scene.add.image(bx - 12, badgeY, b.icon, b.frame);
      icon.setDisplaySize(14, 14);
      if (!affordable) icon.setTint(0x777777);
      group.add(icon);
      const valText = scene.add
        .text(bx + 4, badgeY, String(b.value), { fontSize: "12px", color: affordable ? "#ffffff" : "#777777" })
        .setOrigin(0, 0.5);
      group.add(valText);
    });

    // Description
    if (description) {
      const descText = scene.add.text(16, badgeY + 22, description, {
        fontSize: "11px",
        color: affordable ? "#dddddd" : "#777777",
        wordWrap: { width: CARD_WIDTH - 32 },
        align: "center",
      });
      descText.setX(CARD_WIDTH / 2 - descText.width / 2);
      group.add(descText);
    }

    // Recruit button — only present when affordable, so unaffordable units
    // have no purchase confirmation action at all.
    const bottomY = CARD_HEIGHT - 30;
    if (affordable) {
      const recruitText = scene.add
        .text(CARD_WIDTH / 2, bottomY, "[ Recruit ]", { fontSize: "14px", color: "#44dd88" })
        .setOrigin(0.5, 0.5)
        .setInteractive();
      recruitText.on("pointerdown", () => {
        scene.modalOpen = false;
        maskShape.destroy();
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
      group.add(recruitText);
    } else {
      const cantAffordText = scene.add
        .text(CARD_WIDTH / 2, bottomY, "Can't afford", { fontSize: "13px", color: "#886666" })
        .setOrigin(0.5, 0.5);
      group.add(cantAffordText);
    }
  }

  // Masked scroll viewport for the strip, centered in the card.
  const stripViewportX = stripCenterX - STRIP_VISIBLE_WIDTH / 2;
  const stripLayer = scene.add.container(stripViewportX, 0);
  container.add(stripLayer);

  const maskShape = scene.make.graphics({ x: 0, y: 0, add: false });
  const updateMask = () => {
    const worldX = container.x + stripViewportX;
    const worldY = container.y + stripY - 2;
    maskShape.clear();
    maskShape.fillRect(worldX, worldY, STRIP_VISIBLE_WIDTH, STRIP_ICON_SIZE + 4);
  };
  updateMask();
  stripLayer.setMask(maskShape.createGeometryMask());

  // Invisible zone over the viewport that catches drags to scroll the strip.
  // A small movement threshold distinguishes a drag from a tap, so icon
  // clicks underneath still register normally when the pointer barely moves.
  const DRAG_THRESHOLD = 6;
  let dragStartX = 0;
  let dragStartScroll = 0;
  let dragMoved = false;

  const dragZone = scene.add
    .zone(stripViewportX + STRIP_VISIBLE_WIDTH / 2, stripY + STRIP_ICON_SIZE / 2, STRIP_VISIBLE_WIDTH, STRIP_ICON_SIZE + 4)
    .setInteractive({ draggable: true, useHandCursor: true });
  container.add(dragZone);

  dragZone.on("dragstart", (pointer) => {
    dragStartX = pointer.x;
    dragStartScroll = scrollX;
    dragMoved = false;
  });
  dragZone.on("drag", (pointer) => {
    const delta = pointer.x - dragStartX;
    if (Math.abs(delta) > DRAG_THRESHOLD) dragMoved = true;
    setScroll(dragStartScroll - delta);
  });

  buyable.forEach((def, i) => {
    const affordable = scene.game_.canBuyUnit(def.index, team);
    const sx = i * stripStep + STRIP_ICON_SIZE / 2;
    const sy = stripY + STRIP_ICON_SIZE / 2;

    const iconBg = scene.add.rectangle(sx, sy, STRIP_ICON_SIZE, STRIP_ICON_SIZE, 0x0c0e16, 1).setStrokeStyle(1, 0x555555);
    stripLayer.add(iconBg);
    const icon = scene.add.sprite(sx, sy, `unit_sheet_${team}`, def.index);
    icon.setDisplaySize(STRIP_ICON_SIZE - 6, STRIP_ICON_SIZE - 6);
    if (!affordable) icon.setTint(0x777777);
    stripLayer.add(icon);
    stripIcons.push(iconBg);
  });

  // Selection is handled by the drag zone's own pointerup (rather than
  // per-icon pointerdown) so a drag that passes over icons doesn't select
  // them, and a tap-without-drag hits whichever icon is under the pointer.
  dragZone.on("pointerup", (pointer) => {
    if (dragMoved) return;
    const localX = pointer.x - container.x - stripLayer.x;
    const index = Math.floor(localX / stripStep);
    const def = buyable[index];
    if (!def) return;
    stripIcons.forEach((s) => s.setStrokeStyle(1, 0x555555));
    if (stripIcons[index]) stripIcons[index].setStrokeStyle(2, 0xffdd66);
    renderDetail(def);
  });

  function setScroll(x) {
    scrollX = Math.max(0, Math.min(maxScroll, x));
    stripLayer.x = stripViewportX - scrollX;
  }

  function scrollToShow(index) {
    const iconLeft = index * stripStep;
    const iconRight = iconLeft + STRIP_ICON_SIZE;
    if (iconLeft < scrollX) setScroll(iconLeft);
    else if (iconRight > scrollX + STRIP_VISIBLE_WIDTH) setScroll(iconRight - STRIP_VISIBLE_WIDTH);
  }

  if (maxScroll > 0) {
    const arrowY = stripY + STRIP_ICON_SIZE / 2;
    const leftArrow = scene.add
      .text(stripViewportX - 16, arrowY, "<", { fontSize: "18px", color: "#ffffff" })
      .setOrigin(0.5)
      .setInteractive();
    leftArrow.on("pointerdown", () => setScroll(scrollX - stripStep * 3));
    container.add(leftArrow);

    const rightArrow = scene.add
      .text(stripViewportX + STRIP_VISIBLE_WIDTH + 16, arrowY, ">", { fontSize: "18px", color: "#ffffff" })
      .setOrigin(0.5)
      .setInteractive();
    rightArrow.on("pointerdown", () => setScroll(scrollX + stripStep * 3));
    container.add(rightArrow);
  }

  // Select the first affordable unit by default, or just the first unit if none are affordable.
  const initialDef = buyable.find((def) => scene.game_.canBuyUnit(def.index, team)) ?? buyable[0];
  const initialIndex = buyable.indexOf(initialDef);
  if (stripIcons[initialIndex]) stripIcons[initialIndex].setStrokeStyle(2, 0xffdd66);
  scrollToShow(initialIndex);
  renderDetail(initialDef);

  const cancelText = scene.add
    .text(CARD_WIDTH - 14, 14, "[ X ]", { fontSize: "13px", color: "#dd4444" })
    .setOrigin(1, 0)
    .setScrollFactor(0)
    .setInteractive();
  cancelText.on("pointerdown", () => {
    scene.modalOpen = false;
    maskShape.destroy();
    container.destroy();
  });
  container.add(cancelText);
}
