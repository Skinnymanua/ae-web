import Phaser from "phaser";
import { GameSocket } from "../net/socket.js";
import { createTextInput } from "../ui/textInput.js";
import { SERVER_WS_URL } from "../constants.js";

/**
 * Session browser: connects, requests the open session list, and shows each
 * one with a lock icon if it's password-protected. Clicking a row either
 * joins directly (public) or reveals a password field + confirm (protected)
 * - see #selectSession/#confirmJoin.
 */
export class JoinGameScene extends Phaser.Scene {
  constructor() {
    super("JoinGameScene");
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, 24, "Join Game", { fontSize: "24px", color: "#ffdd44", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    this.statusText = this.add.text(40, 70, "Connecting...", { fontSize: "14px", color: "#cccccc" });
    this.rowTexts = [];
    this.passwordPromptElements = [];
    this.selectedSession = null;

    this.buildFooter();
    this.connectAndListSessions();
  }

  async connectAndListSessions() {
    this.socket = new GameSocket(SERVER_WS_URL);
    try {
      await this.socket.connect();
      const { sessions } = await this.socket.request("list_sessions", {}, "session_list");
      this.statusText.setText(sessions.length ? "" : "No open games right now.");
      this.renderSessionList(sessions);
    } catch (err) {
      this.statusText.setColor("#ff4444");
      this.statusText.setText("Couldn't reach the server.");
    }
  }

  renderSessionList(sessions) {
    const startX = 40;
    const startY = 100;
    sessions.forEach((session, i) => {
      const y = startY + i * 30;
      const lock = session.hasPassword ? "🔒 " : "";
      const label = `${lock}${session.name}  (${session.mapId}, ${session.connectedPlayerCount}/${session.maxPlayers})`;
      const full = session.connectedPlayerCount >= session.maxPlayers;
      const text = this.add.text(startX, y, label, {
        fontSize: "15px",
        color: full ? "#666677" : "#ffffff",
      });
      if (!full) {
        text.setInteractive();
        text.on("pointerup", (pointer, localX, localY, event) => {
          event.stopPropagation();
          this.selectSession(session);
        });
      }
      this.rowTexts.push(text);
    });
  }

  /** Public session: joins immediately. Protected: reveals a password field
   * + confirm button right under the row instead of joining right away. */
  selectSession(session) {
    this.clearPasswordPrompt();
    this.selectedSession = session;

    if (!session.hasPassword) {
      this.confirmJoin(undefined);
      return;
    }

    const { width, height } = this.cameras.main;
    const promptY = height - 130;
    const label = this.add.text(40, promptY, `Password for "${session.name}"`, { fontSize: "14px", color: "#cccccc" });
    const input = createTextInput(this, 40, promptY + 22, { placeholder: "password", password: true, width: 200 });
    const confirm = this.add
      .text(260, promptY + 22, "[ Join ]", { fontSize: "15px", color: "#44dd88" })
      .setInteractive();
    confirm.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.confirmJoin(input.getValue());
    });
    input.focus();
    this.passwordPromptElements = [label, input, confirm];
  }

  clearPasswordPrompt() {
    for (const el of this.passwordPromptElements) el.destroy();
    this.passwordPromptElements = [];
  }

  async confirmJoin(password) {
    this.statusText.setColor("#ffdd44");
    this.statusText.setText("Joining...");
    try {
      const joined = await this.socket.request(
        "join_session",
        { sessionId: this.selectedSession.id, password },
        "session_joined",
        ["join_error"]
      );
      this.scene.start("NetworkLobbyScene", {
        socket: this.socket,
        session: joined.session,
        team: joined.team,
        gameState: joined.gameState,
      });
    } catch (err) {
      this.statusText.setColor("#ff4444");
      const reason = err?.reason ?? "unknown error";
      this.statusText.setText(
        reason === "wrong_password" ? "Wrong password." : reason === "full" ? "That game is full." : "Couldn't join that game."
      );
    }
  }

  buildFooter() {
    const { width, height } = this.cameras.main;
    const backButton = this.add
      .text(width / 2, height - 50, "[ Back ]", { fontSize: "18px", color: "#dd4444" })
      .setOrigin(0.5)
      .setInteractive();
    backButton.on("pointerup", (pointer, localX, localY, event) => {
      event.stopPropagation();
      this.socket?.close();
      this.scene.start("NetworkMenuScene");
    });
  }
}
