import Phaser from "phaser";
import { GameSocket } from "../net/socket.js";
import { SERVER_WS_URL } from "../constants.js";
import { MENU_WIDTH, MENU_HEIGHT } from "../constants.js";
import { loadActiveSession, clearActiveSession } from "../net/sessionPersistence.js";

/**
 * First scene in the boot list (see main.js) - runs before MenuScene ever
 * shows, so a page refresh mid-game doesn't dump the player back at the
 * main menu with their match gone. Checks sessionPersistence.js for a
 * session saved by CreateGameScene/JoinGameScene; if there isn't one, this
 * is a completely ordinary boot and it falls straight through to MenuScene
 * with nothing shown.
 *
 * If there IS one, attempts to rejoin it as the SAME team via
 * join_session's optional `team` field (see server/src/sessions.js's
 * joinSession) - not a fresh join, which could hand the seat to whichever
 * of the two reconnecting players' requests the server happens to process
 * first. `session.started` in the response (see sessions.js's `started`
 * meta field) decides where to land: straight into BoardScene if the match
 * was already underway, or back into NetworkLobbyScene if it hadn't
 * started yet (e.g. refreshing while still waiting for an opponent).
 *
 * Any failure here - server unreachable, session already gone (opponent
 * won/left/it timed out), wrong-password edge case if the stored password
 * somehow doesn't match anymore - just clears the stale entry and falls
 * through to the normal menu rather than getting stuck. Nothing about a
 * failed resume is treated as an error the player needs to see; the normal
 * menu is always a safe landing spot.
 */
export class ReconnectScene extends Phaser.Scene {
  constructor() {
    super("ReconnectScene");
  }

  create() {
    const saved = loadActiveSession();
    if (!saved?.sessionId) {
      this.scene.start("MenuScene");
      return;
    }

    this.scale.resize(MENU_WIDTH, MENU_HEIGHT);
    this.cameras.main.setSize(MENU_WIDTH, MENU_HEIGHT);
    this.add.rectangle(0, 0, MENU_WIDTH, MENU_HEIGHT, 0x222222).setOrigin(0, 0);
    this.add
      .text(MENU_WIDTH / 2, MENU_HEIGHT / 2, "Reconnecting...", { fontSize: "18px", color: "#cccccc" })
      .setOrigin(0.5);

    this.resume(saved);
  }

  async resume(saved) {
    const socket = new GameSocket(SERVER_WS_URL);
    try {
      await socket.connect();
      const joined = await socket.request(
        "join_session",
        { sessionId: saved.sessionId, password: saved.password, team: saved.team },
        "session_joined",
        ["join_error"]
      );
      if (joined.session.started) {
        this.scene.start("BoardScene", {
          networked: true,
          socket,
          session: joined.session,
          team: joined.team,
          gameState: joined.gameState,
        });
      } else {
        this.scene.start("NetworkLobbyScene", {
          socket,
          session: joined.session,
          team: joined.team,
          gameState: joined.gameState,
        });
      }
    } catch (err) {
      // Session gone, server unreachable, or (rarely) the resume request
      // itself timed out - either way there's nothing left to resume.
      clearActiveSession();
      socket.close();
      this.scene.start("MenuScene");
    }
  }
}
