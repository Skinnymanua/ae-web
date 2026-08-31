import Phaser from "phaser";
import { GameSocket } from "../net/socket.js";
import { saveActiveSession } from "../net/sessionPersistence.js";
import { createTextInput } from "../ui/textInput.js";
import { SERVER_WS_URL } from "../constants.js";
import { drawMenuPanel, addMenuButton } from "../ui/menuPanel.js";
import { createScrollList } from "../ui/scrollList.js";

const PANEL_X = 24;
const PANEL_Y = 90;
const PANEL_WIDTH = 752;
const PANEL_HEIGHT = 280;
const PANEL_PADDING = 16;
const ROW_HEIGHT = 30;

/**
 * Session browser: connects, requests the open session list, and shows each
 * one with a lock icon if it's password-protected. Clicking a row either
 * joins directly (public) or reveals a password field + confirm (protected)
 * - see #selectSession/#confirmJoin.
 *
 * Styled with the same navy-panel treatment as the rest of this project's
 * menus (see ui/menuPanel.js), and the session list is now the scrollable
 * component (ui/scrollList.js) SkirmishSetupScene/CreateGameScene's map
 * lists use, for the same reason: it can hold more rows than fit in the
 * panel at once (open games, not just maps, so this one's list length is
 * also just less predictable than either of those). A full session marks
 * itself item.dimmed so it shows in the list (matching the original
 * behavior) but can't actually be selected.
 *
 * The password prompt used to appear directly under the clicked row -
 * that stopped making sense once rows can scroll: the row you clicked
 * might scroll out of view while its own prompt stayed anchored to a
 * position that no longer means anything. It now has its own fixed spot
 * below the panel instead, independent of scroll position.
 */
export class JoinGameScene extends Phaser.Scene {
  constructor() {
    super("JoinGameScene");
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x222222).setOrigin(0, 0);

    this.add
      .text(width / 2, 24, "Join Game", { fontSize: "26px", color: "#e8e8e8", fontStyle: "bold" })
      .setOrigin(0.5, 0);

    this.statusText = this.add.text(PANEL_X, 64, "Connecting...", { fontSize: "14px", color: "#cccccc" });
    this.passwordPromptElements = [];
    this.selectedSession = null;
    this.sessionList = null;

    drawMenuPanel(this, PANEL_X, PANEL_Y, PANEL_WIDTH, PANEL_HEIGHT);

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
    if (sessions.length === 0) return;

    const listX = PANEL_X + PANEL_PADDING;
    const listY = PANEL_Y + PANEL_PADDING;
    const listWidth = PANEL_WIDTH - PANEL_PADDING * 2;
    const listHeight = PANEL_HEIGHT - PANEL_PADDING * 2;

    const wrapper = this.add.container(0, 0);

    this.sessionList = createScrollList(this, {
      parentContainer: wrapper,
      parentX: 0,
      parentY: 0,
      x: listX,
      y: listY,
      width: listWidth,
      height: listHeight,
      rowHeight: ROW_HEIGHT,
      items: sessions.map((session) => {
        const lock = session.hasPassword ? "🔒 " : "";
        const full = session.connectedPlayerCount >= session.maxPlayers;
        return {
          id: session.id,
          label: `${lock}${session.name}  (${session.mapId}, ${session.connectedPlayerCount}/${session.maxPlayers})`,
          dimmed: full,
          session,
        };
      }),
      onSelect: (item) => this.selectSession(item.session),
    });
    // No explicit this.sessionList.destroy() needed - see
    // SkirmishSetupScene.js's identical comment on why: this list lives for
    // the whole duration of this scene, and Phaser tears its InputPlugin
    // down automatically on scene shutdown.
  }

  /** Public session: joins immediately. Protected: reveals a password field
   * + confirm button in the fixed prompt area below the panel. */
  selectSession(session) {
    this.clearPasswordPrompt();
    this.selectedSession = session;

    if (!session.hasPassword) {
      this.confirmJoin(undefined);
      return;
    }

    const promptY = PANEL_Y + PANEL_HEIGHT + 20;
    const label = this.add.text(PANEL_X, promptY, `Password for "${session.name}"`, { fontSize: "14px", color: "#cccccc" });
    const input = createTextInput(this, PANEL_X, promptY + 22, { placeholder: "password", password: true, width: 200 });
    const confirmButton = addMenuButton(this, PANEL_X + 220, promptY + 20, 100, 34, {
      label: "Join",
      fontSize: "14px",
      onClick: () => this.confirmJoin(input.getValue()),
    });
    input.focus();
    this.passwordPromptElements = [label, input, confirmButton];
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
      // See CreateGameScene's identical call for why - lets a refresh from
      // here on resume as this same team (net/sessionPersistence.js,
      // ReconnectScene.js).
      saveActiveSession({ sessionId: joined.session.id, team: joined.team, password });
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
    addMenuButton(this, width / 2 - 80, height - 60, 160, 42, {
      label: "Back",
      onClick: () => {
        this.socket?.close();
        this.scene.start("NetworkMenuScene");
      },
    });
  }
}
