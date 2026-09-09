import Phaser from "phaser";
import { TEAM_COLOR } from "../constants.js";
import { drawCornerBracketPanel, addTitleBar, addCircleButton } from "../ui/menuPanel.js";
import { clearActiveSession } from "../net/sessionPersistence.js";

const PANEL_WIDTH = 340;
const PANEL_Y = 96;
const TITLE_BAR_HEIGHT = 44;

/**
 * Holding screen after creating or joining a networked session - shows who's
 * connected, live (via the socket's player_joined/player_disconnected
 * broadcasts), and who you are (team 0/1). Either player can hit "Start
 * Game" once both are connected - that sends start_game to the server,
 * which broadcasts game_started back to BOTH sockets (see
 * server/src/index.js), so both clients transition into BoardScene
 * together regardless of who clicked it.
 *
 * Restyled with the circular-button kit (ui/menuPanel.js's addTitleBar/
 * drawCornerBracketPanel/addCircleButton), matching the Skirmish flow's own
 * redesign - reached from both CreateGameScene and JoinGameScene, so it
 * should look like the same design language either way you got here. The
 * title bar's own back button and the big circular one both "Leave" here
 * (same reasoning as SkirmishSetupScene's redundant Back pair) - there's
 * nothing else a "back" action from this screen could mean.
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
    this.add.rectangle(0, 0, width, height, 0x1a1a1a).setOrigin(0, 0);

    const panelX = width / 2 - PANEL_WIDTH / 2;

    addTitleBar(this, panelX, 24, PANEL_WIDTH, TITLE_BAR_HEIGHT, {
      title: this.session.name,
      onBack: () => this.leave(),
    });

    drawCornerBracketPanel(this, panelX, PANEL_Y, PANEL_WIDTH, 130);

    this.add
      .text(width / 2, PANEL_Y + 24, `Map: ${this.session.mapId}`, { fontSize: "14px", color: "#cccccc" })
      .setOrigin(0.5);
    this.add
      .text(width / 2, PANEL_Y + 48, `You are Team ${this.team}`, {
        fontSize: "16px",
        // Same 4-color palette the bottom bar uses (see constants.js's
        // TEAM_COLOR) instead of a hardcoded blue/orange binary choice -
        // that only ever distinguished team 0 from "everything else",
        // which stopped making sense once there could be teams 2 and 3 too.
        color: `#${TEAM_COLOR[this.team].toString(16).padStart(6, "0")}`,
      })
      .setOrigin(0.5);

    this.statusText = this.add.text(width / 2, PANEL_Y + 90, "", { fontSize: "14px", color: "#44dd88" }).setOrigin(0.5);

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

    this.buildFooterButtons();

    this.events.on("shutdown", () => this.cleanupListeners());
  }

  buildFooterButtons() {
    const { width, height } = this.cameras.main;
    const radius = 32;

    addCircleButton(this, radius + 20, height - radius - 20, radius, {
      icon: "back",
      onClick: () => this.leave(),
    });

    this.startButton = addCircleButton(this, width - radius - 20, height - radius - 20, radius, {
      icon: "confirm",
      enabled: false,
      onClick: () => this.socket.send("start_game"),
    });
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
