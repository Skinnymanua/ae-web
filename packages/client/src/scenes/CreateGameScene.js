import Phaser from "phaser";
import { MAPS } from "../maps/index.js";
import { GameSocket } from "../net/socket.js";
import { createTextInput } from "../ui/textInput.js";
import { SERVER_WS_URL } from "../constants.js";
import {
  MAX_LEVEL_OPTIONS,
  STARTING_GOLD_OPTIONS,
  UNIT_CAPACITY_OPTIONS,
  DEFAULT_MAX_LEVEL,
  DEFAULT_STARTING_GOLD,
  DEFAULT_UNIT_CAPACITY,
} from "./skirmishSettings.js";

/**
 * Networked game creation: same map + settings pattern as
 * SkirmishSetupScene/SkirmishSettingsScene (reuses the latter directly, see
 * #openSettings), plus a session name and optional password - see
 * ui/textInput.js for why those specifically need a real HTML input rather
 * than another bounded stepper.
 *
 * On success, connects to the server, creates the session, and lands in a
 * simple "waiting for opponent" holding screen - NOT yet BoardScene itself,
 * since BoardScene doesn't have a networked mode to receive this into yet
 * (see the session_created handshake this scene completes; a later change
 * wires BoardScene up to actually consume it).
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
    this.sessionNameValue = data?.sessionNameValue ?? "";
    this.passwordValue = data?.passwordValue ?? "";
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, 24, "Create Game", { fontSize: "24px", color: "#ffdd44", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    this.mapRowTexts = [];
    this.buildMapList();
    this.buildSettingsSummary();
    this.buildSessionFields();
    this.buildFooter();
  }

  buildMapList() {
    const startX = 40;
    const startY = 90;
    this.add.text(startX, startY - 26, "Select Map", { fontSize: "16px", color: "#cccccc" });

    if (MAPS.length === 0) {
      this.add.text(startX, startY, "(no maps found in src/maps/)", { fontSize: "13px", color: "#888888" });
      return;
    }

    MAPS.forEach((map, i) => {
      const y = startY + i * 26;
      const label = `${map.name}  (${map.width}x${map.height}, ${map.unitCount} units)`;
      const text = this.add.text(startX, y, label, { fontSize: "14px", color: "#ffffff" }).setInteractive();
      text.on("pointerup", (pointer, localX, localY, event) => {
        event.stopPropagation();
        this.selectMap(map.id);
      });
      this.mapRowTexts.push({ id: map.id, text });
    });

    this.updateMapSelectionHighlight();
  }

  selectMap(id) {
    this.selectedMapId = id;
    this.updateMapSelectionHighlight();
    this.updateCreateButtonState();
  }

  updateMapSelectionHighlight() {
    for (const { id, text } of this.mapRowTexts) {
      text.setColor(id === this.selectedMapId ? "#44dd88" : "#ffffff");
    }
  }

  buildSettingsSummary() {
    const startX = 420;
    const startY = 90;
    this.add.text(startX, startY - 26, "Game Settings", { fontSize: "16px", color: "#cccccc" });

    this.settingsSummaryText = this.add.text(startX, startY, "", {
      fontSize: "14px",
      color: "#ffffff",
      lineSpacing: 10,
    });
    this.updateSettingsSummary();

    const settingsButton = this.add
      .text(startX, startY + 90, "[ Settings ]", { fontSize: "16px", color: "#44aaff" })
      .setInteractive();
    settingsButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.openSettings();
    });
  }

  updateSettingsSummary() {
    const lines = [
      `Max Level: ${MAX_LEVEL_OPTIONS[this.maxLevelIndex]}`,
      `Starting Gold: ${STARTING_GOLD_OPTIONS[this.startingGoldIndex]}`,
      `Max Units: ${UNIT_CAPACITY_OPTIONS[this.unitCapacityIndex]}`,
    ];
    this.settingsSummaryText.setText(lines.join("\n"));
  }

  openSettings() {
    this.scene.start("SkirmishSettingsScene", {
      selectedMapId: this.selectedMapId,
      maxLevelIndex: this.maxLevelIndex,
      startingGoldIndex: this.startingGoldIndex,
      unitCapacityIndex: this.unitCapacityIndex,
      returnScene: "CreateGameScene",
      // Session name/password aren't part of the shared settings round trip
      // (SkirmishSettingsScene knows nothing about them) - carried through
      // returnExtra instead so they survive the trip to Settings and back.
      returnExtra: { sessionNameValue: this.sessionNameValue, passwordValue: this.passwordValue },
    });
  }

  buildSessionFields() {
    const startX = 420;
    const startY = 220;
    this.add.text(startX, startY - 20, "Session Name", { fontSize: "14px", color: "#cccccc" });
    this.nameInput = createTextInput(this, startX, startY, { placeholder: "My Game" });
    this.nameInput.setValue(this.sessionNameValue);

    this.add.text(startX, startY + 40, "Password (optional)", { fontSize: "14px", color: "#cccccc" });
    this.passwordInput = createTextInput(this, startX, startY + 60, { placeholder: "leave blank for public", password: true });
    this.passwordInput.setValue(this.passwordValue);
  }

  buildFooter() {
    const { width, height } = this.cameras.main;

    this.statusText = this.add.text(width / 2, height - 80, "", { fontSize: "13px", color: "#ff8888" }).setOrigin(0.5);

    this.createButton = this.add
      .text(width / 2 - 80, height - 50, "[ Create ]", { fontSize: "18px", color: "#44dd88" })
      .setInteractive();
    this.createButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.createGame();
    });

    const backButton = this.add
      .text(width / 2 + 80, height - 50, "[ Back ]", { fontSize: "18px", color: "#dd4444" })
      .setInteractive();
    backButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.scene.start("NetworkMenuScene");
    });

    this.updateCreateButtonState();
  }

  updateCreateButtonState() {
    if (this.selectedMapId) {
      this.createButton.setColor("#44dd88");
      this.createButton.setInteractive();
    } else {
      this.createButton.setColor("#666677");
      this.createButton.disableInteractive();
    }
  }

  async createGame() {
    if (!this.selectedMapId) return;
    const map = MAPS.find((m) => m.id === this.selectedMapId);
    if (!map) return;

    this.sessionNameValue = this.nameInput.getValue();
    this.passwordValue = this.passwordInput.getValue();

    this.createButton.disableInteractive();
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
          password: this.passwordValue || undefined,
        },
        "session_created"
      );
      this.scene.start("NetworkLobbyScene", { socket, session: created.session, team: created.team, gameState: created.gameState });
    } catch (err) {
      this.statusText.setColor("#ff4444");
      this.statusText.setText("Failed to create game - is the server running?");
      this.createButton.setInteractive();
      socket.close();
    }
  }
}
