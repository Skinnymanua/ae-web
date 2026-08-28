/**
 * Self-contained horizontally-scrollable (drag or wheel) strip of selectable
 * unit portraits. Each item is a circle badge (ported from CircleButton's
 * LARGE type - frame 0 is the normal ring, frame 1 is the pressed/selected
 * ring, see ResourceManager.getBigCircleTexture / CircleButton.draw in the
 * original) with the unit sprite centered on top.
 *
 * Extracted out of dialogs.js's showBuyMenu() so the scroll/mask/hit-testing
 * logic isn't tangled up with the buy panel's stat fields - anything that
 * needs "a row of selectable unit portraits" can reuse this instead of
 * re-implementing drag-vs-click thresholds and geometry masking from scratch.
 *
 * Coordinates: `parentX`/`parentY` must be the *scene-space* (not
 * container-local) position of `parentContainer` - Phaser's mask and hit-zone
 * geometry both need scene/world space regardless of what local coordinate
 * system the container's children are drawn in. Every current caller is a
 * top-level scrollFactor(0) dialog container, so its own x/y already *is*
 * scene-space (no camera transform to account for) - if a future caller ever
 * nests this inside another container, parentX/parentY need to be that
 * ancestor chain's cumulative scene-space position, not just the immediate
 * parent's local x/y.
 */
export function createPurchaseStrip(scene, opts) {
  const {
    parentContainer,
    parentX,
    parentY,
    x,
    y,
    width,
    portraitSize = 40,
    portraitGap = 6,
    badgeSheet = "circle_big",
    items, // [{ id, textureKey, frameIndex }, ...] - extra fields are ignored, so callers can stash their own data on each item
    onSelect, // (item) => void - called with the full item object whenever selection changes, including the initial select()
  } = opts;

  const stripHeight = portraitSize + 8;

  // Mask source must be a Graphics object, not a Rectangle Shape: Phaser's
  // canvas renderer path for GeometryMask calls the mask source's renderCanvas
  // with a trailing "allowClip" flag telling it to build a clip path instead of
  // actually painting pixels - Graphics implements that branch, but Rectangle
  // (and shapes generally) ignore the flag and just fillRect() as normal,
  // painting an opaque block over the strip instead of clipping it. This was
  // the actual cause of an earlier "no units show" bug - not a coordinate or
  // z-order issue - so don't swap this for `scene.add.rectangle(...)`.
  const maskGraphics = scene.add.graphics();
  maskGraphics.setScrollFactor(0);
  maskGraphics.setVisible(false);
  maskGraphics.fillStyle(0xffffff);
  maskGraphics.fillRect(parentX + x, parentY + y, width, stripHeight);
  const mask = maskGraphics.createGeometryMask();

  const stripContainer = scene.add.container(x, y);
  stripContainer.setScrollFactor(0);
  stripContainer.setMask(mask);
  parentContainer.add(stripContainer);

  const totalWidth = items.length * (portraitSize + portraitGap) - portraitGap;
  const maxScroll = Math.max(0, totalWidth - width);
  let scrollX = 0;

  function applyScroll() {
    stripContainer.x = x - scrollX;
  }

  // Dedicated invisible hit-zone (not the portraits themselves) drives both
  // drag-to-scroll and wheel-to-scroll, so drags/wheel work anywhere over the
  // strip - not just when the pointer happens to start on a portrait.
  //
  // Positioned in LOCAL coordinates (x, y - same convention as stripContainer
  // above), NOT parentX+x/parentY+y. Container.add() doesn't preserve world
  // position - it reinterprets whatever x/y the object already has as local
  // coordinates relative to the new parent. Building this at the absolute
  // scene position and only afterward calling parentContainer.add(hitZone)
  // meant parentContainer's own offset got applied a SECOND time on top of
  // the offset already baked into hitZone's x/y, landing it far from the
  // visible strip - hit-testing failed silently since hitZone was never
  // actually where the strip is drawn. (maskGraphics above is different: it's
  // never added to any container, so its absolute scene-space position is
  // correct as-is - don't "fix" that one the same way.)
  const hitZone = scene.add
    .rectangle(x, y, width, stripHeight, 0x000000, 0)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setInteractive();
  parentContainer.add(hitZone);

  // A press only becomes a scroll-drag once the pointer moves past
  // DRAG_THRESHOLD, so a plain tap still reaches a portrait's own "pointerup".
  const DRAG_THRESHOLD = 6;
  let dragging = false;
  let dragStartX = 0;
  let scrollStartX = 0;

  hitZone.on("pointerdown", (pointer) => {
    dragging = false;
    dragStartX = pointer.x;
    scrollStartX = scrollX;
  });
  // hitZone is the sole authority for clicks on the strip, not the badges
  // themselves - see the note above the badge/sprite creation below for why.
  // pointer.x is screen-space (matches how dragStartX above is already used
  // directly with no offset, since everything here is scrollFactor(0));
  // subtracting the strip's own screen-space left edge and adding back the
  // current scroll offset converts that into "unscrolled content space",
  // the same space portraits are laid out in via px = i * (size + gap).
  hitZone.on("pointerup", (pointer) => {
    if (dragging) return;
    const contentX = pointer.x - (parentX + x) + scrollX;
    const index = Math.floor(contentX / (portraitSize + portraitGap));
    const item = items[index];
    if (item && contentX - index * (portraitSize + portraitGap) <= portraitSize) {
      select(item.id);
    }
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

  hitZone.on("wheel", (pointer, dx, dy) => {
    scrollX = Math.max(0, Math.min(maxScroll, scrollX + dy));
    applyScroll();
  });

  const entries = [];
  let selectedId = null;

  items.forEach((item, i) => {
    const px = i * (portraitSize + portraitGap);
    const py = 4;
    // The badge is purely visual - hitZone (above) is the sole click
    // authority for the whole strip, now that its position bug (see the
    // comment above hitZone's creation) is fixed. An earlier version made the
    // badge itself interactive instead; that "worked" only in the sense that
    // hitZone was silently receiving no real hits at all (mispositioned), not
    // because of any actual competition between the two - so it's simpler and
    // more robust to keep click detection in one place (hitZone) rather than
    // split across two separately-hit-tested objects that both claim to
    // handle the same clicks.
    const badge = scene.add.image(px + portraitSize / 2, py + portraitSize / 2, badgeSheet, 0);
    badge.setDisplaySize(portraitSize - 4, portraitSize - 4);
    const sprite = scene.add.sprite(px + portraitSize / 2, py + portraitSize / 2, item.textureKey, item.frameIndex);
    sprite.setDisplaySize(portraitSize - 6, portraitSize - 6);
    stripContainer.add([badge, sprite]);

    entries.push({ item, badge });
  });

  function select(id) {
    selectedId = id;
    for (const entry of entries) {
      entry.badge.setFrame(entry.item.id === id ? 1 : 0);
    }
    onSelect?.(items.find((it) => it.id === id));
  }

  function destroy() {
    scene.input.off("pointermove", onPointerMove);
    scene.input.off("pointerup", endDrag);
    scene.input.off("pointerupoutside", endDrag);
    maskGraphics.destroy();
    // stripContainer, hitZone, and every portrait's badge/sprite are all
    // children of parentContainer - the caller destroys that as a whole, so
    // there's nothing else to clean up here.
  }

  return {
    select,
    destroy,
    get selectedId() {
      return selectedId;
    },
  };
}
