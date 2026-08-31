import Phaser from "phaser";
import { MenuScene } from "./scenes/MenuScene.js";
import { SkirmishSetupScene } from "./scenes/SkirmishSetupScene.js";
import { SkirmishSettingsScene } from "./scenes/SkirmishSettingsScene.js";
import { GameSettingScene } from "./scenes/GameSettingScene.js";
import { NetworkMenuScene } from "./scenes/NetworkMenuScene.js";
import { CreateGameScene } from "./scenes/CreateGameScene.js";
import { JoinGameScene } from "./scenes/JoinGameScene.js";
import { NetworkLobbyScene } from "./scenes/NetworkLobbyScene.js";
import { BoardScene } from "./scenes/BoardScene.js";
import { ReconnectScene } from "./scenes/ReconnectScene.js";
import { MENU_WIDTH, MENU_HEIGHT } from "./constants.js";

// Fixed viewport for the menu flow (see constants.js's MENU_WIDTH/HEIGHT) -
// map choice happens at runtime in SkirmishSetupScene, and BoardScene itself
// resizes the canvas dynamically to fit whichever map gets chosen (see its
// own create()), so this is only ever the STARTING size, not a permanent one.
new Phaser.Game({
  type: Phaser.AUTO,
  width: MENU_WIDTH,
  height: MENU_HEIGHT,
  parent: "game",
  backgroundColor: "#222222",
  // Needed for ui/textInput.js's HTML <input> overlay (session name/password
  // entry) - Phaser has no native text field, this is the standard way to
  // host real HTML form elements positioned within a Phaser scene.
  dom: { createContainer: true },
  // ReconnectScene runs first (Phaser starts scene[0] by default) - it
  // checks for a persisted networked session (see net/sessionPersistence.js)
  // and either resumes straight into NetworkLobbyScene/BoardScene or falls
  // through to MenuScene immediately, so a page refresh only ever costs an
  // instant blank frame on an ordinary (non-networked) boot.
  scene: [
    ReconnectScene,
    MenuScene,
    SkirmishSetupScene,
    SkirmishSettingsScene,
    GameSettingScene,
    NetworkMenuScene,
    CreateGameScene,
    JoinGameScene,
    NetworkLobbyScene,
    BoardScene,
  ],
});
