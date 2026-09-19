import Phaser from "phaser";
import { drawCornerBracketPanel, addTitleBar } from "../ui/menuPanel.js";
import { createScrollList } from "../ui/scrollList.js";
import { getMenuSize } from "../constants.js";
import unitsData from "@ae/shared/data/units.json";
import unitNames from "@ae/shared/data/unit-names.json";
import unitDescriptions from "@ae/shared/data/unit-descriptions.json";
import abilityNames from "@ae/shared/data/ability-names.json";
import abilityDescriptions from "@ae/shared/data/ability-descriptions.json";
import statusNames from "@ae/shared/data/status-names.json";
import statusDescriptions from "@ae/shared/data/status-descriptions.json";

const PANEL_Y = 84;
const TITLE_BAR_HEIGHT = 44;
const CATEGORY_WIDTH = 270;
const PANEL_GAP = 12;
const PANEL_MARGIN_X = 20;
const PANEL_PADDING = 16;

// Ported from screen/wiki/Wiki.java's WIKI_GAMEPLAY_* text (android/assets/
// lang/en_US.dat) - the original splits each of these across 1-4 numbered
// paragraph keys (WIKI_GAMEPLAY_ATTACKING_P1, _P2, ...); kept as arrays
// here for the same reason it was split there (each entry reads as one
// paragraph, not one run-on block).
const GAMEPLAY_PAGES = {
  gp_objectives: {
    title: "Objectives",
    paragraphs: [
      "For skirmish games the objectives are quite simple: you need to eliminate all enemy units and capture all enemy castles (excluding neutral ones). To achieve this you need to recruit units and fight enemy armies with some strategy.",
    ],
  },
  gp_recruiting: {
    title: "Recruiting",
    paragraphs: [
      "You can recruit units from your castles. However you can only recruit units when there's no unit on the castle except your commander. Recruiting units costs gold coins, and each unit takes up a certain amount of unit capacity - so remember to check that before recruiting.",
      "Commanders work a little differently: you can only recruit a new commander once your current one has fallen in battle, and the recruiting price increases by 100 every time your commander dies. Note that even at maximum unit capacity, you can still recruit your fallen commander.",
    ],
  },
  gp_attacking: {
    title: "Attacking",
    paragraphs: [
      "To attack an enemy, select and move a unit toward it - as long as the enemy is within your unit's attack range, you can attack.",
      "There are two attack types, physical and magic, and two matching defence types. Always try to attack an enemy that's weak to your unit's attack type.",
      "A unit that can perform melee attacks can always counter melee attacks, but ranged attacks cannot be countered.",
      "The lower a unit's HP, the less damage it can deal when attacking.",
    ],
  },
  gp_healing: {
    title: "Healing",
    paragraphs: [
      "Units with healing-related abilities can heal allies. Some heals can push a target above its max HP, but the excess is removed once that unit goes standby or its next turn starts.",
      "Ground units cannot heal flying units, but flying units can heal everyone.",
    ],
  },
  gp_income: {
    title: "Income",
    paragraphs: [
      "Your income mainly comes from villages and castles - each village gives 50 gold per turn, each castle 100. Capture as many as you can to gain an advantage.",
      "A living commander also contributes income: 50 gold per turn at base, increasing by 50 every time your commander levels up.",
    ],
  },
  gp_status: {
    title: "Status Effects",
    paragraphs: [
      "Some units can attach a status effect to other units - an important thing to consider when fighting.",
      "A unit already carrying one status is immune to a different type of status, but reapplying the SAME type refreshes its remaining duration instead.",
    ],
  },
};

// Ported from Wiki.java's terrain listing (TilePage, one page per raw tile
// index with no name, just numeric mp-cost/defence-bonus/hp-recovery
// stats) - condensed here to the 4 underlying terrain TYPES instead of all
// ~89 individual tile graphics, since those numbers vary a lot even within
// one type (a plain, a road, a village and a castle are all LAND but cost
// and defend very differently - see combat.js's getTileDefenceBonus and
// movement.js's per-tile step cost) and a wiki page per near-duplicate
// tile sprite wasn't actually more informative than this.
const TERRAIN_PAGES = {
  terrain_land: {
    title: "Land",
    paragraphs: [
      "Covers plains, roads, villages, castles and temples. Movement cost and defence bonus vary a lot by the specific tile - plain roads are the cheapest to cross, while castles and temples grant a larger defence bonus and, for castles/temples, HP recovery at turn start.",
    ],
  },
  terrain_water: {
    title: "Water",
    paragraphs: [
      "Most water tiles cost 3 movement points to cross and grant no defence bonus. Units with a water-related ability (Fighter/Son of the Water) treat it much more favourably - see the Abilities section.",
    ],
  },
  terrain_forest: {
    title: "Forest",
    paragraphs: ["Forest costs 2 movement points to enter and grants a 10 defence bonus."],
  },
  terrain_mountain: {
    title: "Mountain",
    paragraphs: [
      "Mountain terrain costs 2-3 movement points to enter and grants a 10-15 defence bonus - the best defensive terrain in the game.",
    ],
  },
};

const ABOUT_PARAGRAPHS = [
  "Ancient Empires Reloaded is a turn-based tactics game originally created by toyknight. This is a browser port of that game, built with Phaser 3.",
  "This Help & Documentation section is itself ported from the original game's in-app wiki, adapted to this port's own data where the two differ (e.g. new units and abilities added here that don't exist in the original).",
];

function formatAttackType(attackType) {
  return attackType === 1 ? "Magic" : "Physical";
}

/**
 * In-game reference covering gameplay basics, terrains, units, abilities,
 * and status effects - ported from screen/wiki/Wiki.java's dialog (a tree
 * of categories on the left, a detail page on the right, see that file's
 * own class doc for the full original shape this is based on).
 *
 * Deliberately narrower than the original in two ways:
 *  - Terrain pages are grouped by the 4 underlying types instead of all
 *    ~89 individual tile graphics (see TERRAIN_PAGES above for why).
 *  - No Multiplayer category: the original's pages describe its desktop
 *    lobby/chat-command flow (e.g. "/assign 0"), which doesn't match this
 *    port's own multiplayer screens (NetworkMenuScene/CreateGameScene/
 *    JoinGameScene/NetworkLobbyScene) closely enough to just copy over -
 *    left for a future pass that documents THIS port's actual flow instead.
 *
 * Reached from MenuScene's "Help" button (previously disabled - see that
 * scene's own doc comment). There's no in-game pause menu yet for this to
 * also hang off of the way the original's GameMenu did (see boardInput.js/
 * ui/bottomBar.js - no such menu exists in this port at all yet), so this
 * is reachable from the main menu only for now.
 */
export class HelpScene extends Phaser.Scene {
  constructor() {
    super("HelpScene");
  }

  create() {
    const { width: menuWidth, height: menuHeight } = getMenuSize();
    this.scale.resize(menuWidth, menuHeight);
    this.cameras.main.setSize(menuWidth, menuHeight);

    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x1a1a1a).setOrigin(0, 0);

    const totalWidth = width - PANEL_MARGIN_X * 2;
    const panelX = PANEL_MARGIN_X;
    const panelHeight = height - PANEL_Y - 20;

    addTitleBar(this, panelX, 24, totalWidth, TITLE_BAR_HEIGHT, {
      title: "Help & Documentation",
      onBack: () => this.scene.start("MenuScene"),
    });

    const categoryWidth = Math.min(CATEGORY_WIDTH, totalWidth * 0.4);
    const contentX = panelX + categoryWidth + PANEL_GAP;
    const contentWidth = totalWidth - categoryWidth - PANEL_GAP;

    this.buildContentPanel(contentX, PANEL_Y, contentWidth, panelHeight);
    this.buildCategoryList(panelX, PANEL_Y, categoryWidth, panelHeight);

    // Opens on the overview page rather than nothing selected, same as the
    // original's Wiki#display always choosing content_list's first node.
    this.categoryList.select("overview");
  }

  buildCategoryList(x, y, width, height) {
    drawCornerBracketPanel(this, x, y, width, height);

    const items = [{ id: "overview", label: "Overview" }];

    const addHeader = (label) => items.push({ id: `header_${items.length}`, label: `— ${label} —`, dimmed: true });
    const addEntry = (id, label) => items.push({ id, label: `  ${label}` });

    addHeader("GAMEPLAY");
    for (const [id, page] of Object.entries(GAMEPLAY_PAGES)) addEntry(id, page.title);

    addHeader("TERRAINS");
    for (const [id, page] of Object.entries(TERRAIN_PAGES)) addEntry(id, page.title);

    addHeader("UNITS");
    const listedUnits = unitsData.units
      .filter((def) => !def.isSkeleton && !def.isCrystal)
      .sort((a, b) => a.index - b.index);
    for (const def of listedUnits) addEntry(`unit_${def.index}`, unitNames[def.index] ?? `Unit #${def.index}`);

    addHeader("ABILITIES");
    for (const idStr of Object.keys(abilityNames).sort((a, b) => Number(a) - Number(b))) {
      addEntry(`ability_${idStr}`, abilityNames[idStr]);
    }

    addHeader("STATUS EFFECTS");
    for (const idStr of Object.keys(statusNames).sort((a, b) => Number(a) - Number(b))) {
      addEntry(`status_${idStr}`, statusNames[idStr]);
    }

    addHeader("ABOUT");
    addEntry("about", "About");

    const wrapper = this.add.container(0, 0);
    const padding = PANEL_PADDING;
    this.categoryList = createScrollList(this, {
      parentContainer: wrapper,
      parentX: 0,
      parentY: 0,
      x: x + padding,
      y: y + padding,
      width: width - padding * 2,
      height: height - padding * 2,
      rowHeight: 26,
      items,
      onSelect: (item) => this.showPage(item.id),
    });
  }

  buildContentPanel(x, y, width, height) {
    drawCornerBracketPanel(this, x, y, width, height);

    const padding = PANEL_PADDING;
    this.contentTitle = this.add.text(x + padding, y + padding, "", {
      fontSize: "20px",
      color: "#ffffff",
      fontStyle: "bold",
    });

    const bodyY = y + padding + 32;
    const bodyHeight = y + height - padding - bodyY;
    const bodyWidth = width - padding * 2;

    // Same masked-scroll technique as ui/scrollList.js (see that file's own
    // doc comment for the gotchas this mirrors: Graphics mask not a
    // Rectangle Shape, parentX/Y in scene space, hit-zone added via the
    // parent container so it doesn't get the offset applied twice) but for
    // one scrollable block of free-form content rather than a list of
    // selectable rows - a unit/ability page's text + stat lines don't fit
    // that row model, so this is its own small variant rather than a
    // forced reuse of createScrollList.
    const maskGraphics = this.add.graphics();
    maskGraphics.setVisible(false);
    maskGraphics.fillStyle(0xffffff);
    maskGraphics.fillRect(x + padding, bodyY, bodyWidth, bodyHeight);
    this.contentInner = this.add.container(x + padding, bodyY);
    this.contentInner.setMask(maskGraphics.createGeometryMask());

    const hitZone = this.add.rectangle(x + padding, bodyY, bodyWidth, bodyHeight, 0x000000, 0).setOrigin(0, 0).setInteractive();

    this.contentBodyWidth = bodyWidth;
    this.contentBodyHeight = bodyHeight;
    this.contentScrollY = 0;
    this.contentMaxScroll = 0;
    // {x0, y0, x1, y1, abilityId} rects in contentInner's own LOCAL space
    // (same coordinate space showPage's cursorY builds in) - see this
    // function's own doc comment on why ability links are hit-tested
    // manually against this list from the single hitZone below, rather
    // than each link being its own setInteractive() object.
    this.contentLinks = [];

    const applyScroll = () => {
      this.contentInner.y = bodyY - this.contentScrollY;
    };
    this.applyContentScroll = applyScroll;

    let dragging = false;
    let dragStartY = 0;
    let scrollStartY = 0;
    const DRAG_THRESHOLD = 6;
    hitZone.on("pointerdown", (pointer) => {
      dragging = false;
      dragStartY = pointer.y;
      scrollStartY = this.contentScrollY;
    });
    // A plain (non-drag) release is checked against this.contentLinks for
    // an ability-link hit - see addAbilityLink below for why this can't
    // just be each link's own setInteractive() handler instead (masked,
    // scrolled container - same class of hit-test unreliability
    // ui/scrollList.js's own doc comment warns about for its row list,
    // worked around there the same way: one hit-zone, manual math).
    hitZone.on("pointerup", (pointer, localX, localY, event) => {
      if (dragging) return;
      event.stopPropagation();
      const contentX = pointer.x - (x + padding);
      const contentY = pointer.y - bodyY + this.contentScrollY;
      const hit = this.contentLinks.find(
        (r) => contentX >= r.x0 && contentX <= r.x1 && contentY >= r.y0 && contentY <= r.y1
      );
      if (hit) this.categoryList.select(`ability_${hit.abilityId}`);
    });
    this.input.on("pointermove", (pointer) => {
      if (!pointer.isDown) return;
      const dy = pointer.y - dragStartY;
      if (!dragging) {
        if (Math.abs(dy) < DRAG_THRESHOLD) return;
        dragging = true;
      }
      this.contentScrollY = Math.max(0, Math.min(this.contentMaxScroll, scrollStartY - dy));
      applyScroll();
    });
    hitZone.on("wheel", (pointer, dx, dy) => {
      this.contentScrollY = Math.max(0, Math.min(this.contentMaxScroll, this.contentScrollY + dy));
      applyScroll();
    });
  }

  /** Clears the content pane and rebuilds it top-down for `id`, resetting
   * scroll to the top - same "destroy and recreate" convention this whole
   * codebase uses for anything that changes per-selection (see e.g.
   * render/units.js's refreshUnits doc comment) rather than trying to diff
   * against whatever the previous page happened to contain. */
  showPage(id) {
    this.contentInner.removeAll(true);
    this.contentScrollY = 0;
    this.contentLinks = [];

    let cursorY = 0;
    const width = this.contentBodyWidth;

    const addParagraph = (text, style = {}) => {
      const t = this.add.text(0, cursorY, text, {
        fontSize: "13px",
        color: "#dddddd",
        wordWrap: { width },
        lineSpacing: 3,
        ...style,
      });
      this.contentInner.add(t);
      cursorY += t.height + 10;
    };

    const addStatLine = (label, value, color = "#ffffff") => {
      const t = this.add.text(0, cursorY, `${label}: `, { fontSize: "13px", color: "#999999" });
      this.contentInner.add(t);
      const v = this.add.text(t.width, cursorY, `${value}`, { fontSize: "13px", color });
      this.contentInner.add(v);
      cursorY += 18;
    };

    // NOT its own setInteractive() object - see buildContentPanel's own
    // comment on why a link inside this masked, scrolled container can't
    // rely on Phaser's normal per-object hit test (confirmed live: clicks
    // landing squarely within the rendered text's own bounds never fired
    // its handler). Registers a rect in this.contentLinks instead, tested
    // manually from the single content hitZone's pointerup handler.
    const addAbilityLink = (abilityId, label) => {
      const t = this.add.text(12, cursorY, `• ${label}`, { fontSize: "13px", color: "#7fb2ff" });
      this.contentInner.add(t);
      this.contentLinks.push({ x0: 12, y0: cursorY, x1: 12 + t.width, y1: cursorY + t.height, abilityId });
      cursorY += 20;
    };

    if (id === "overview") {
      this.contentTitle.setText("Overview");
      addParagraph(
        "This is the in-game help, built to get you up to speed on how to play. Pick a topic from the list on the left - gameplay basics, terrain types, and a full reference for every unit, ability, and status effect in the game."
      );
    } else if (GAMEPLAY_PAGES[id]) {
      const page = GAMEPLAY_PAGES[id];
      this.contentTitle.setText(page.title);
      page.paragraphs.forEach((p) => addParagraph(p));
    } else if (TERRAIN_PAGES[id]) {
      const page = TERRAIN_PAGES[id];
      this.contentTitle.setText(page.title);
      page.paragraphs.forEach((p) => addParagraph(p));
    } else if (id.startsWith("unit_")) {
      const index = Number(id.slice("unit_".length));
      const def = unitsData.units.find((u) => u.index === index);
      this.contentTitle.setText(unitNames[index] ?? `Unit #${index}`);
      if (def) {
        addStatLine("Price", def.price, "#ffdd44");
        addStatLine("Occupancy", def.occupancy);
        addStatLine("Max HP", def.maxHp);
        addStatLine("Attack", `${def.attack} (${formatAttackType(def.attackType)})`, def.attackType === 1 ? "#6699ff" : "#88dd88");
        addStatLine("Physical Defence", def.physicalDefence);
        addStatLine("Magic Defence", def.magicDefence);
        addStatLine("Movement", def.movementPoint);
        addStatLine(
          "Attack Range",
          def.minAttackRange === def.maxAttackRange ? def.minAttackRange : `${def.minAttackRange}-${def.maxAttackRange}`
        );
        cursorY += 6;
      }
      addParagraph(unitDescriptions[index] ?? "");
      if (def?.abilities?.length > 0) {
        cursorY += 4;
        const heading = this.add.text(0, cursorY, "Abilities", { fontSize: "13px", color: "#999999", fontStyle: "bold" });
        this.contentInner.add(heading);
        cursorY += 20;
        for (const ability of def.abilities) addAbilityLink(ability.id, abilityNames[ability.id] ?? ability.name);
      }
    } else if (id.startsWith("ability_")) {
      const index = id.slice("ability_".length);
      this.contentTitle.setText(abilityNames[index] ?? `Ability #${index}`);
      addParagraph(abilityDescriptions[index] ?? "");
    } else if (id.startsWith("status_")) {
      const index = id.slice("status_".length);
      this.contentTitle.setText(statusNames[index] ?? `Status #${index}`);
      addParagraph(statusDescriptions[index] ?? "");
    } else if (id === "about") {
      this.contentTitle.setText("About");
      ABOUT_PARAGRAPHS.forEach((p) => addParagraph(p));
    }

    // A GeometryMask doesn't expose its own rect's height back out, so the
    // viewport height buildContentPanel computed is stashed on the scene
    // (contentBodyHeight) instead of being re-derived here.
    this.contentMaxScroll = Math.max(0, cursorY - this.contentBodyHeight);
    this.applyContentScroll();
  }
}
