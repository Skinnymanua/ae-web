/**
 * A real HTML <input> hosted inside the Phaser canvas via a DOM game object
 * (this.add.dom) - Phaser has no native text field, and this is the
 * standard way to get real keyboard text entry into a scene. Requires
 * `dom: { createContainer: true }` in the Phaser.Game config (see main.js).
 *
 * Only used for session name/password entry (CreateGameScene, JoinGameScene)
 * - everywhere else in this port's menus uses bounded steppers instead (see
 * SkirmishSettingsScene), since a session name/password genuinely needs free
 * text and there's no sensible bounded-option alternative for those.
 */
export function createTextInput(scene, x, y, { placeholder = "", password = false, width = 220 } = {}) {
  const el = document.createElement("input");
  el.type = password ? "password" : "text";
  el.placeholder = placeholder;
  el.maxLength = 40;
  el.style.width = `${width}px`;
  el.style.fontSize = "14px";
  el.style.padding = "4px 6px";
  el.style.boxSizing = "border-box";
  el.style.background = "#3a4258";
  el.style.color = "#ffffff";
  el.style.border = "1px solid #5b93ab";
  el.style.borderRadius = "4px";
  el.style.outline = "none";

  const dom = scene.add.dom(x, y, el);

  // Phaser's default click-through behavior can let a click on the input
  // also register as a click on whatever's beneath it on the canvas (same
  // class of issue ui/dialogs.js's buttons guard against with
  // stopPropagation) - stopping propagation here keeps a click that focuses
  // the field from also triggering board/menu clicks underneath it.
  el.addEventListener("pointerdown", (event) => event.stopPropagation());
  el.addEventListener("click", (event) => event.stopPropagation());

  return {
    dom,
    getValue: () => el.value,
    setValue: (value) => {
      el.value = value;
    },
    focus: () => el.focus(),
    destroy: () => dom.destroy(),
  };
}
