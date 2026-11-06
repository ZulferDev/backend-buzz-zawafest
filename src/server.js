import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import { createApp } from "./app.js";
import { createStateStore } from "./database.js";

const port = Number(process.env.PORT ?? 3000);
const databasePath = process.env.SQLITE_PATH ?? "./data/zawa.sqlite";
const allowedOrigins = (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT harus berupa bilangan bulat antara 1 dan 65535.");
}

const store = createStateStore(databasePath);
const clients = new Set();
const originAllowed = (origin) => !origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin);
const broadcast = (message) => {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (error) {
        console.error("[ws] Gagal mengirim pembaruan:", error);
        clients.delete(client);
      }
    } else {
      clients.delete(client);
    }
  }
};
const app = createApp({ store, allowedOrigins, broadcast });
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on("upgrade", (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname !== "/api/ws" || !originAllowed(request.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (client) => {
    websocketServer.emit("connection", client, request);
  });
});

websocketServer.on("connection", (client) => {
  clients.add(client);
  client.send(JSON.stringify({ type: "state", ...store.read() }));
  client.on("message", (data) => {
    if (data.toString() === "ping" || data.toString() === '"ping"') client.send('"pong"');
  });
  client.on("close", () => clients.delete(client));
  client.on("error", (error) => {
    console.error("[ws] Koneksi WebSocket gagal:", error);
    clients.delete(client);
  });
});

console.log(`ZAWA backend listening on http://localhost:${port}`);
console.log(`SQLite database: ${databasePath}`);

function shutdown() {
  for (const client of clients) client.terminate();
  clients.clear();
  websocketServer.close();
  server.close((error) => {
    if (error) {
      console.error("[server] Gagal menutup server:", error);
      process.exitCode = 1;
    }
    store.close();
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
