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
  const hitZone = scene.add
    .rectangle(parentX + x, parentY + y, width, stripHeight, 0x000000, 0)
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
    // The badge itself is the click target - not a separately-positioned
    // invisible rectangle. Two objects independently computing "the same"
    // position (one via (px, py), the other via (px + size/2, py + size/2))
    // is exactly the kind of setup that silently drifts apart if either
    // formula ever changes without the other - see actionBar.js's bg/iconImg
    // hit-area bug. Image objects (badge has a real texture) get a correct
    // default hit area from setInteractive() with no explicit shape - that's
    // the standard, well-supported Phaser pattern, unlike Arc/Shape objects.
    const badge = scene.add.image(px + portraitSize / 2, py + portraitSize / 2, badgeSheet, 0).setScrollFactor(0).setInteractive();
    badge.setDisplaySize(portraitSize - 4, portraitSize - 4);
    const sprite = scene.add.sprite(px + portraitSize / 2, py + portraitSize / 2, item.textureKey, item.frameIndex);
    sprite.setDisplaySize(portraitSize - 6, portraitSize - 6);
    stripContainer.add([badge, sprite]);

    // pointerup (not pointerdown), and skip if this press turned into a
    // drag - same rationale as render/tiles.js's tile clicks vs camera drag.
    badge.on("pointerup", () => {
      if (dragging) return;
      select(item.id);
    });

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
