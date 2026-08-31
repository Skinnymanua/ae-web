import Phaser from "phaser";
import { MAPS } from "../maps/index.js";
import { GameSocket } from "../net/socket.js";
import { createTextInput } from "../ui/textInput.js";
import { SERVER_WS_URL } from "../constants.js";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";
import { createScrollList } from "../ui/scrollList.js";
import {
  MAX_LEVEL_OPTIONS,
  STARTING_GOLD_OPTIONS,
  UNIT_CAPACITY_OPTIONS,
  PLAYER_COUNT_OPTIONS,
  DEFAULT_MAX_LEVEL,
  DEFAULT_STARTING_GOLD,
  DEFAULT_UNIT_CAPACITY,
  DEFAULT_PLAYER_COUNT,
} from "./skirmishSettings.js";

const COLUMN_WIDTH = 360;
const COLUMN_HEIGHT = 340;
const COLUMN_Y = 64;
const LEFT_COLUMN_X = 24;
const RIGHT_COLUMN_X = 404;
const COLUMN_PADDING = 16;

/**
 * Networked game creation: same map + settings pattern as
 * SkirmishSetupScene/SkirmishSettingsScene (reuses the latter directly, see
 * #openSettings), plus a session name and optional password - see
 * ui/textInput.js for why those specifically need a real HTML input rather
 * than another bounded stepper.
 *
 * On success, connects to the server, creates the session, and lands in
 * NetworkLobbyScene to wait for the rest of the players.
 *
 * Styled with the same navy-panel treatment as MenuScene.js/
 * SkirmishSetupScene.js (see ui/menuPanel.js) - reached from the main
 * menu's Multiplayer submenu, so it should read as part of the same visual
 * flow. Map list uses the same scrollable component as SkirmishSetupScene
 * (ui/scrollList.js), for the same reason: it can grow past the panel's
 * fixed height as more maps get added. Session name/password stay real
 * HTML text inputs (ui/textInput.js), not beveled buttons - a different
 * control entirely.
 */
export class CreateGameScene extends Phaser.Scene {
  constructor() {
    super("CreateGameScene");
  }

  init(data) {
    this.selectedMapId = data?.selectedMapId ?? MAPS[0]?.id ?? null;
    this.maxLevelIndex = data?.maxLevelIndex ?? MAX_LEVEL_OPTIONS.indexOf(DEFAULT_MAX_LEVEL);
    this.startingGoldIndex = data?.startingGoldIndex ?? STARTING_GOLD_OPTIONS.indexOf(DEFAULT_STARTING_GOLD);
    this.unitCapacityIndex = data?.unitCapacityIndex ?? UNIT_CAPACITY_OPTIONS.indexOf(DEFAULT_UNIT_CAPACITY);
    this.playerCountIndex = data?.playerCountIndex ?? PLAYER_COUNT_OPTIONS.indexOf(DEFAULT_PLAYER_COUNT);
    this.sessionNameValue = data?.sessionNameValue ?? "";
    this.passwordValue = data?.passwordValue ?? "";
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, 24, "Create Game", { fontSize: "26px", color: "#e8e8e8", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    // Footer first - buildMapList's scroll list restores the previously
    // selected map (if any) by calling select(), which fires onSelect and
    // needs this.createButton to already exist to update its enabled state.
    this.buildFooter();
    this.buildSettingsSummary();
    this.buildMapList();
  }

  buildMapList() {
    drawMenuPanel(this, LEFT_COLUMN_X, COLUMN_Y, COLUMN_WIDTH, COLUMN_HEIGHT);

    const startX = LEFT_COLUMN_X + COLUMN_PADDING;
    const labelY = COLUMN_Y + COLUMN_PADDING;
    this.add.text(startX, labelY, "Select Map", { fontSize: "16px", color: "#cccccc" });

    if (MAPS.length === 0) {
      this.add.text(startX, labelY + 22, "(no maps found in src/maps/)", { fontSize: "13px", color: "#888888" });
      return;
    }

    const listY = labelY + 26;
    const listWidth = COLUMN_WIDTH - COLUMN_PADDING * 2;
    const listHeight = COLUMN_Y + COLUMN_HEIGHT - COLUMN_PADDING - listY;
    const rowHeight = 28;

    const wrapper = this.add.container(0, 0);

    this.mapList = createScrollList(this, {
      parentContainer: wrapper,
      parentX: 0,
      parentY: 0,
      x: startX,
      y: listY,
      width: listWidth,
      height: listHeight,
      rowHeight,
      items: MAPS.map((map) => ({
        id: map.id,
        label: `${map.name}  (${map.width}x${map.height}, ${map.unitCount} units)`,
      })),
      onSelect: (item) => {
        this.selectedMapId = item?.id ?? null;
        this.createButton.setEnabled(!!this.selectedMapId);
      },
    });

    if (this.selectedMapId) this.mapList.select(this.selectedMapId);
    // No explicit this.mapList.destroy() needed - see
    // SkirmishSetupScene.js's identical comment on why: this list lives for
    // the whole duration of this scene, and Phaser tears its InputPlugin
    // down automatically on scene shutdown.
  }

  buildSettingsSummary() {
    drawMenuPanel(this, RIGHT_COLUMN_X, COLUMN_Y, COLUMN_WIDTH, COLUMN_HEIGHT);

    const startX = RIGHT_COLUMN_X + COLUMN_PADDING;
    const labelY = COLUMN_Y + COLUMN_PADDING;
    this.add.text(startX, labelY, "Game Settings", { fontSize: "16px", color: "#cccccc" });

    this.settingsSummaryText = this.add.text(startX, labelY + 22, "", {
      fontSize: "14px",
      color: "#ffffff",
      lineSpacing: 10,
    });
    this.updateSettingsSummary();

    const columnInnerWidth = COLUMN_WIDTH - COLUMN_PADDING * 2;
    addMenuButton(this, startX, labelY + 130, columnInnerWidth, 36, {
      label: "Settings",
      fontSize: "14px",
      onClick: () => this.openSettings(),
    });

    this.buildSessionFields(startX, labelY + 182, columnInnerWidth);
  }

  updateSettingsSummary() {
    const lines = [
      `Max Level: ${MAX_LEVEL_OPTIONS[this.maxLevelIndex]}`,
      `Starting Gold: ${STARTING_GOLD_OPTIONS[this.startingGoldIndex]}`,
      `Max Units: ${UNIT_CAPACITY_OPTIONS[this.unitCapacityIndex]}`,
      `Players: ${PLAYER_COUNT_OPTIONS[this.playerCountIndex]}`,
    ];
    this.settingsSummaryText.setText(lines.join("\n"));
  }

  openSettings() {
    this.scene.start("SkirmishSettingsScene", {
      selectedMapId: this.selectedMapId,
      maxLevelIndex: this.maxLevelIndex,
      startingGoldIndex: this.startingGoldIndex,
      unitCapacityIndex: this.unitCapacityIndex,
      playerCountIndex: this.playerCountIndex,
      returnScene: "CreateGameScene",
      // Session name/password aren't part of the shared settings round trip
      // (SkirmishSettingsScene knows nothing about them) - carried through
      // returnExtra instead so they survive the trip to Settings and back.
      returnExtra: { sessionNameValue: this.sessionNameValue, passwordValue: this.passwordValue },
    });
  }

  buildSessionFields(startX, startY, fieldWidth) {
    this.nameInput = createTextInput(this, startX - 20 , startY + 182, { placeholder: "Session name", width: fieldWidth });
    this.nameInput.setValue(this.sessionNameValue);

    this.passwordInput = createTextInput(this, startX - 20 , startY + 220, {
      placeholder: "Password (optional)",
      password: true,
      width: fieldWidth,
    });
    this.passwordInput.setValue(this.passwordValue);
  }

  buildFooter() {
    const { width, height } = this.cameras.main;
    const buttonWidth = 160;
    const buttonHeight = 42;
    const gap = 16;

    this.statusText = this.add.text(width / 2, height - 92, "", { fontSize: "13px", color: "#ff8888" }).setOrigin(0.5);

    this.createButton = addMenuButton(this, width / 2 - buttonWidth - gap / 2, height - 60, buttonWidth, buttonHeight, {
      label: "Create",
      enabled: !!this.selectedMapId,
      onClick: () => this.createGame(),
    });

    addMenuButton(this, width / 2 + gap / 2, height - 60, buttonWidth, buttonHeight, {
      label: "Back",
      onClick: () => this.scene.start("NetworkMenuScene"),
    });
  }

  async createGame() {
    if (!this.selectedMapId) return;
    const map = MAPS.find((m) => m.id === this.selectedMapId);
    if (!map) return;

    this.sessionNameValue = this.nameInput.getValue();
    this.passwordValue = this.passwordInput.getValue();

    this.createButton.setEnabled(false);
    this.statusText.setColor("#ffdd44");
    this.statusText.setText("Connecting...");

    const socket = new GameSocket(SERVER_WS_URL);
    try {
      await socket.connect();
      const created = await socket.request(
        "create_session",
        {
          name: this.sessionNameValue || undefined,
          mapId: map.id,
          mapData: map.data,
          maxLevel: MAX_LEVEL_OPTIONS[this.maxLevelIndex],
          startingGold: STARTING_GOLD_OPTIONS[this.startingGoldIndex],
          unitCapacity: UNIT_CAPACITY_OPTIONS[this.unitCapacityIndex],
          maxPlayers: PLAYER_COUNT_OPTIONS[this.playerCountIndex],
          password: this.passwordValue || undefined,
        },
        "session_created"
      );
      this.scene.start("NetworkLobbyScene", { socket, session: created.session, team: created.team, gameState: created.gameState });
    } catch (err) {
      this.statusText.setColor("#ff4444");
      this.statusText.setText("Failed to create game - is the server running?");
      this.createButton.setEnabled(true);
      socket.close();
    }
  }
}
