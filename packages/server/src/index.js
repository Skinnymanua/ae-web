import { WebSocketServer } from "ws";
import { loadUnits, loadTiles, getDamage } from "@ae/shared";

const PORT = process.env.PORT || 8080;

const units = loadUnits();
const tiles = loadTiles();
console.log(`Loaded ${units.length} units and ${tiles.length} tiles from @ae/shared`);

// Smoke test: reuse the same commander-vs-defence-20 case verified earlier,
// confirms the shared combat module resolves correctly from inside the server package.
const commander = units.find((u) => u.isCommander);
const grassTile = tiles.find((t) => t.typeName === "LAND");
const testDamage = getDamage({
  attacker: { x: 0, y: 0, attack: commander.attack, attackType: commander.attackType, currentHp: commander.maxHp, maxHp: commander.maxHp, abilities: commander.abilities, team: 0 },
  defender: { x: 1, y: 0, physicalDefence: 20, magicDefence: 20, currentHp: 100, abilities: [], team: 1 },
  attackerTile: grassTile,
  defenderTile: grassTile,
  applyRng: false,
});
console.log(`Startup combat smoke test: commander vs 20 defence = ${testDamage} damage`);

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (socket) => {
  console.log("Client connected");
  socket.send(JSON.stringify({ type: "welcome", unitCount: units.length, tileCount: tiles.length }));

  socket.on("message", (raw) => {
    console.log("Received:", raw.toString());
    socket.send(JSON.stringify({ type: "echo", payload: raw.toString() }));
  });

  socket.on("close", () => console.log("Client disconnected"));
});

console.log(`WebSocket server listening on ws://localhost:${PORT}`);
