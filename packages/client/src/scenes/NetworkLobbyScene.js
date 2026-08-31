import Phaser from "phaser";
import { TEAM_COLOR } from "../constants.js";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";
import { clearActiveSession } from "../net/sessionPersistence.js";

const PANEL_WIDTH = 340;

/**
 * Holding screen after creating or joining a networked session - shows who's
 * connected, live (via the socket's player_joined/player_disconnected
 * broadcasts), and who you are (team 0/1). Either player can hit "Start
 * Game" once both are connected - that sends start_game to the server,
 * which broadcasts game_started back to BOTH sockets (see
 * server/src/index.js), so both clients transition into BoardScene
 * together regardless of who clicked it.
 *
 * Styled with the same navy-panel treatment as the rest of this project's
 * menus (see ui/menuPanel.js) - reached from both CreateGameScene and
 * JoinGameScene, so it should read as part of the same visual flow either
 * way you got here.
 */
export class NetworkLobbyScene extends Phaser.Scene {
  constructor() {
    super("NetworkLobbyScene");
  }

  init(data) {
    this.socket = data.socket;
    this.session = data.session;
    this.team = data.team;
    this.gameState = data.gameState;
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, 40, this.session.name, { fontSize: "26px", color: "#e8e8e8", fontStyle: "bold" })
      .setOrigin(0.5);

    const panelX = width / 2 - PANEL_WIDTH / 2;
    const panelY = 90;
    drawMenuPanel(this, panelX, panelY, PANEL_WIDTH, 130);

    this.add
      .text(width / 2, panelY + 24, `Map: ${this.session.mapId}`, { fontSize: "14px", color: "#cccccc" })
      .setOrigin(0.5);
    this.add
      .text(width / 2, panelY + 48, `You are Team ${this.team}`, {
        fontSize: "16px",
        // Same 4-color palette the bottom bar uses (see constants.js's
        // TEAM_COLOR) instead of a hardcoded blue/orange binary choice -
        // that only ever distinguished team 0 from "everything else",
        // which stopped making sense once there could be teams 2 and 3 too.
        color: `#${TEAM_COLOR[this.team].toString(16).padStart(6, "0")}`,
      })
      .setOrigin(0.5);

    this.statusText = this.add.text(width / 2, panelY + 90, "", { fontSize: "14px", color: "#44dd88" }).setOrigin(0.5);

    this.startButton = addMenuButton(this, width / 2 - 90, panelY + 160, 180, 44, {
      label: "Start Game",
      enabled: false,
      onClick: () => this.socket.send("start_game"),
    });

    this.updateStatus(this.session.connectedPlayerCount);

    this.unsubJoined = this.socket.on("player_joined", () => {
      this.updateStatus((this.statusPlayerCount ?? this.session.connectedPlayerCount) + 1);
    });
    this.unsubDisconnected = this.socket.on("player_disconnected", () => {
      this.updateStatus(Math.max(1, (this.statusPlayerCount ?? this.session.connectedPlayerCount) - 1));
    });
    this.unsubClose = this.socket.on("_close", () => {
      this.statusText.setColor("#ff4444");
      this.statusText.setText("Disconnected from server.");
    });
    // Fires for BOTH players regardless of who clicked Start - see
    // server/src/index.js's start_game handler broadcasting to everyone in
    // the session, sender included.
    this.unsubStarted = this.socket.on("game_started", () => this.startGame());

    addMenuButton(this, width / 2 - 80, height - 60, 160, 42, {
      label: "Leave",
      onClick: () => this.leave(),
    });

    this.events.on("shutdown", () => this.cleanupListeners());
  }

  updateStatus(playerCount) {
    this.statusPlayerCount = playerCount;
    const maxPlayers = this.session.maxPlayers;
    this.statusText.setText(
      playerCount >= maxPlayers
        ? "All players connected - ready to start."
        : `Waiting for players... (${playerCount} of ${maxPlayers} connected)`
    );
    // Disabled (not just discouraged) until every slot is filled - starting
    // early would leave an unconnected team's turn permanently stuck (no
    // socket registered for it, so nothing could ever act on its behalf) -
    // matching the same disabled-until-valid pattern SkirmishSetupScene's
    // own Start button uses for "no map selected yet".
    this.startButton.setEnabled(playerCount >= maxPlayers);
  }

  cleanupListeners() {
    this.unsubJoined?.();
    this.unsubDisconnected?.();
    this.unsubClose?.();
    this.unsubStarted?.();
  }

  /** Hands off to BoardScene's networked mode - see its own init() for how
   * these fields get consumed. Nothing has run any game actions between
   * joining and here (the lobby doesn't allow any), so the snapshot
   * received at create/join time is still an accurate starting point. */
  startGame() {
    this.cleanupListeners();
    this.scene.start("BoardScene", {
      networked: true,
      socket: this.socket,
      session: this.session,
      team: this.team,
      gameState: this.gameState,
    });
  }

  leave() {
    this.cleanupListeners();
    // Deliberately choosing to leave, as opposed to a refresh - nothing to
    // resume anymore, so drop the persisted session (see
    // net/sessionPersistence.js) rather than leaving it around to be
    // (unsuccessfully) resumed later.
    clearActiveSession();
    this.socket.send("leave_session");
    this.socket.close();
    this.scene.start("NetworkMenuScene");
  }
}
