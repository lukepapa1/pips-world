import { connect, send } from "./socket";
import "./shell.css";
import { mountScene, type SceneHandle } from "./render/scene";
import { createUI } from "./ui";
import { getState, subscribe } from "./state";
import { mountPlotMap } from "./plotMap";

const sceneHost = document.getElementById("scene");
if (!sceneHost) throw new Error("Missing #scene");

let scene: SceneHandle;
const ui = createUI(send, (visual) => scene.setChat(visual.open, visual.reply));
scene = mountScene(sceneHost, (action) => {
  if (action === "diary") ui.openDiary();
  if (action === "mailbox") ui.openMailbox();
  if (action === "studio") {
    scene.frameBuilding("workshop");
    ui.openCreations();
  }
  if (action === "gallery") {
    scene.frameBuilding("gallery");
    ui.openCreations();
  }
  if (action === "chat") ui.openChat();
  if (action === "pip") ui.openPip();
  if (typeof action === "object" && action.kind === "creation") ui.openCreation(action.id);
});

subscribe((state) => {
  scene.sync(state);
  ui.sync(state);
});

ui.sync(getState());
scene.sync(getState());
mountPlotMap();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // The village still opens if the app shell cannot be cached.
  });
}
connect();
