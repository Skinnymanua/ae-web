/**
 * Self-contained vertically-scrollable (drag or wheel) list of selectable
 * text rows, clipped to a fixed-height viewport. Adapts ui/purchaseStrip.js's
 * masking/drag technique for vertical text rows instead of horizontal
 * circular portrait badges - different enough visually/interactively that
 * this is its own small component, not a generalization of that one, but
 * every documented gotcha from that file (mask must be a Graphics object
 * not a Rectangle Shape - see its own comment on why; parentX/parentY must
 * be parentContainer's scene-space position, not container-local; the
 * hit-zone must be added to parentContainer using LOCAL x/y so Container.add
 * doesn't double-apply the parent's offset) applies identically here, since
 * it's the same underlying Phaser mechanics.
 *
 * Built for map lists (SkirmishSetupScene, CreateGameScene) that can grow
 * past their bordered panel's fixed height as more maps get added over
 * time, and reusable for anything else that's "a list of text rows that
 * might not all fit" - including JoinGameScene's session browser, whose
 * items can mark themselves item.dimmed (same convention as
 * ui/purchaseStrip.js's own per-item affordability hint) to render greyed
 * and unselectable, e.g. a full session.
 */
export function createScrollList(scene, opts) {
  const {
    parentContainer,
    parentX,
    parentY,
    x,
    y,
    width,
    height,
    rowHeight,
    items, // [{ id, label }, ...]
    onSelect, // (item) => void - called whenever selection changes, including the initial select()
  } = opts;

  const maskGraphics = scene.add.graphics();
  maskGraphics.setScrollFactor(0);
  maskGraphics.setVisible(false);
  maskGraphics.fillStyle(0xffffff);
  maskGraphics.fillRect(parentX + x, parentY + y, width, height);
  const mask = maskGraphics.createGeometryMask();

  const listContainer = scene.add.container(x, y);
  listContainer.setScrollFactor(0);
  listContainer.setMask(mask);
  parentContainer.add(listContainer);

  const totalHeight = items.length * rowHeight;
  const maxScroll = Math.max(0, totalHeight - height);
  let scrollY = 0;

  function applyScroll() {
    listContainer.y = y - scrollY;
  }

  // Dedicated invisible hit-zone (not the row texts themselves) drives both
  // drag-to-scroll and wheel-to-scroll, so drags/wheel work anywhere over
  // the list - not just when the pointer happens to start on a row's text.
  const hitZone = scene.add
    .rectangle(x, y, width, height, 0x000000, 0)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setInteractive();
  parentContainer.add(hitZone);

  // A press only becomes a scroll-drag once the pointer moves past
  // DRAG_THRESHOLD, so a plain tap still selects a row.
  const DRAG_THRESHOLD = 6;
  let dragging = false;
  let dragStartY = 0;
  let scrollStartY = 0;

  hitZone.on("pointerdown", (pointer) => {
    dragging = false;
    dragStartY = pointer.y;
    scrollStartY = scrollY;
  });
  hitZone.on("pointerup", (pointer, localX, localY, event) => {
    event.stopPropagation();
    if (dragging) return;
    const contentY = pointer.y - (parentY + y) + scrollY;
    const index = Math.floor(contentY / rowHeight);
    const item = items[index];
    if (item) select(item.id);
  });
  const endDrag = () => {
    dragging = false;
  };
  scene.input.on("pointerup", endDrag);
  scene.input.on("pointerupoutside", endDrag);

  const onPointerMove = (pointer) => {
    if (!pointer.isDown) return;
    const dy = pointer.y - dragStartY;
    if (!dragging) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      dragging = true;
    }
    scrollY = Math.max(0, Math.min(maxScroll, scrollStartY - dy));
    applyScroll();
  };
  scene.input.on("pointermove", onPointerMove);

  hitZone.on("wheel", (pointer, dx, dy) => {
    scrollY = Math.max(0, Math.min(maxScroll, scrollY + dy));
    applyScroll();
  });

  const entries = [];
  let selectedId = null;

  items.forEach((item, i) => {
    const rowY = i * rowHeight;
    const text = scene.add
      .text(6, rowY + rowHeight / 2, item.label, { fontSize: "14px", color: item.dimmed ? "#666677" : "#ffffff" })
      .setOrigin(0, 0.5);
    listContainer.add(text);
    entries.push({ item, text });
  });

  // item.dimmed (same convention as ui/purchaseStrip.js's own per-item
  // affordability hint) marks a row as unselectable - see JoinGameScene's
  // full sessions, shown in the list but never selectable, same as the
  // original text-row version's behavior (no click handler attached to a
  // full session's row at all).
  function select(id) {
    const item = items.find((it) => it.id === id);
    if (item?.dimmed) return;
    selectedId = id;
    for (const entry of entries) {
      entry.text.setColor(entry.item.dimmed ? "#666677" : entry.item.id === id ? "#44dd88" : "#ffffff");
    }
    onSelect?.(item);
  }

  function destroy() {
    scene.input.off("pointermove", onPointerMove);
    scene.input.off("pointerup", endDrag);
    scene.input.off("pointerupoutside", endDrag);
    maskGraphics.destroy();
    // listContainer, hitZone, and every row's text are all children of
    // parentContainer - the caller destroys that as a whole, so there's
    // nothing else to clean up here.
  }

  return {
    select,
    destroy,
    get selectedId() {
      return selectedId;
    },
  };
}
