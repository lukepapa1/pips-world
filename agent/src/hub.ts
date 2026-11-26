import type { ServerMessage } from "@pips/shared";
import { WebSocket } from "ws";

const sockets = new Set<WebSocket>();

export function addSocket(socket: WebSocket): void {
  sockets.add(socket);
}

export function removeSocket(socket: WebSocket): void {
  sockets.delete(socket);
}

export function broadcast(message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(data);
  }
}
