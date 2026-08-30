import Phaser from "phaser";

/**
 * Holding screen after creating or joining a networked session - shows who's
 * connected, live (via the socket's player_joined/player_disconnected
 * broadcasts), and who you are (team 0/1). Either player can hit "Start
 * Game" once both are connected - that sends start_game to the server,
 * which broadcasts game_started back to BOTH sockets (see
 * server/src/index.js), so both clients transition into BoardScene
 * together regardless of who clicked it.
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
      .text(width / 2, 40, this.session.name, { fontSize: "24px", color: "#ffdd44", fontStyle: "bold" })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 75, `Map: ${this.session.mapId}`, { fontSize: "14px", color: "#cccccc" })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 100, `You are Team ${this.team}`, { fontSize: "16px", color: this.team === 0 ? "#4488ff" : "#ff8844" })
      .setOrigin(0.5);

    this.statusText = this.add.text(width / 2, height * 0.45, "", { fontSize: "16px", color: "#44dd88" }).setOrigin(0.5);

    this.startButton = this.add
      .text(width / 2, height * 0.6, "[ Start Game ]", { fontSize: "20px", color: "#44dd88" })
      .setOrigin(0.5)
      .setInteractive();
    this.startButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.socket.send("start_game");
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

    const leaveButton = this.add
      .text(width / 2, height - 50, "[ Leave ]", { fontSize: "18px", color: "#dd4444" })
      .setOrigin(0.5)
      .setInteractive();
    leaveButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.leave();
    });

    this.events.on("shutdown", () => this.cleanupListeners());
  }

  updateStatus(playerCount) {
    this.statusPlayerCount = playerCount;
    this.statusText.setText(
      playerCount >= 2 ? "Both players connected - ready to start." : "Waiting for an opponent to join..."
    );
    // Disabled (not just discouraged) below 2 players - starting a
    // "networked" game against no one doesn't mean anything, matching the
    // same disabled-until-valid pattern SkirmishSetupScene's own Start
    // button uses for "no map selected yet".
    if (playerCount >= 2) {
      this.startButton.setColor("#44dd88");
      this.startButton.setInteractive();
    } else {
      this.startButton.setColor("#666677");
      this.startButton.disableInteractive();
    }
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
    this.socket.send("leave_session");
    this.socket.close();
    this.scene.start("NetworkMenuScene");
  }
}
