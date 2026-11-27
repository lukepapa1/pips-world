import * as THREE from "three";
import { MOUSE, TOUCH } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { ClientState } from "../state";
import { pendingRequestCount, unreadDiaryCount } from "../state";
import { createAtmosphere } from "./atmosphere";
import { createLife } from "./life";
import { createSeasonFx } from "./seasonFx";
import { createPip } from "./pip";
import { loadQuality, saveQuality, type Quality } from "./quality";
import { actionOf, createVillage, type WorldAction } from "./village";

export type SceneHandle = {
  sync(state: ClientState): void;
  setChat(open: boolean, reply: string | null): void;
  dispose(): void;
};

export function mountScene(
  container: HTMLElement,
  onAction: (action: WorldAction | "chat") => void,
): SceneHandle {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 220);
  camera.position.set(13, 15, 15);

  let quality = loadQuality();
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  const labels = new CSS2DRenderer();
  labels.domElement.style.position = "absolute";
  labels.domElement.style.inset = "0";
  labels.domElement.style.pointerEvents = "none";
  container.append(labels.domElement);

  const atmosphere = createAtmosphere(scene, renderer);
  atmosphere.setQuality(quality);
  const village = createVillage(scene, quality);
  const life = createLife(scene);
  life.setQuality(quality);
  const seasonFx = createSeasonFx(scene, quality);
  seasonFx.setQuality(quality);
  const pip = createPip();
  scene.add(pip.group);

  const qualityButton = document.getElementById("quality");
  function applyQuality(next: Quality): void {
    quality = next;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, next === "high" ? 2 : 1));
    atmosphere.setQuality(next);
    village.setQuality(next);
    life.setQuality(next);
    seasonFx.setQuality(next);
    if (qualityButton) {
      qualityButton.textContent = next === "high" ? "High" : "Low";
      qualityButton.setAttribute("aria-pressed", next === "high" ? "true" : "false");
      qualityButton.setAttribute("aria-label", `Graphics quality: ${next}`);
    }
    resize();
  }
  const onQuality = () => {
    const next = quality === "high" ? "low" : "high";
    saveQuality(next);
    applyQuality(next);
  };
  qualityButton?.addEventListener("click", onQuality);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 8;
  controls.maxDistance = 34;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.85;
  // Two-finger gestures dolly (pinch zoom). Pan stays off, so the second finger only zooms.
  controls.mouseButtons = {
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.DOLLY,
    RIGHT: MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: TOUCH.ROTATE,
    TWO: TOUCH.DOLLY_PAN,
  };
  controls.update();
  let framed = false;
  applyQuality(quality);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downX = 0;
  let downY = 0;
  let moved = false;
  let tracking = false;

  function frameCamera(aspect: number): void {
    if (aspect < 0.85) {
      camera.fov = 56;
      camera.position.set(8, 22, 10);
      controls.minDistance = 12;
      controls.maxDistance = 40;
    } else {
      camera.fov = 40;
      camera.position.set(14, 13, 16);
      controls.minDistance = 9;
      controls.maxDistance = 36;
    }
    controls.target.set(0, 0, 0);
    camera.updateProjectionMatrix();
    controls.update();
  }

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    camera.aspect = width / height;
    if (!framed) {
      frameCamera(width / height);
      framed = true;
    }
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1));
    renderer.setSize(width, height, false);
    labels.setSize(width, height);
  }

  function setPointer(event: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  let chatting = false;
  const chatCam = new THREE.Vector3();
  const chatTarget = new THREE.Vector3();
  let chatFramed = false;

  function framePip(): void {
    const pipPos = new THREE.Vector3();
    pip.group.getWorldPosition(pipPos);
    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() < 1) offset.set(6, 8, 8);
    offset.y = Math.max(6, offset.y);
    const narrow = camera.aspect < 0.9;
    offset.setLength(narrow ? 12 : 9);
    controls.target.set(pipPos.x, narrow ? -1.1 : 0.7, pipPos.z);
    camera.position.set(pipPos.x, 0.9, pipPos.z).add(offset);
    controls.update();
  }

  function hitAction(event: PointerEvent): WorldAction | "chat" | null {
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const pipHit = raycaster.intersectObject(pip.group, true);
    if (pipHit.length > 0) return "chat";
    const hits = raycaster.intersectObjects(village.pickables, true);
    for (const hit of hits) {
      const action = actionOf(hit.object);
      if (action) return action;
    }
    return null;
  }

  const onDown = (event: PointerEvent) => {
    tracking = true;
    moved = false;
    downX = event.clientX;
    downY = event.clientY;
  };
  const onMove = (event: PointerEvent) => {
    if (tracking && Math.hypot(event.clientX - downX, event.clientY - downY) > 8) moved = true;
    if (event.target !== renderer.domElement) return;
    renderer.domElement.style.cursor = hitAction(event) ? "pointer" : "";
  };
  const onUp = (event: PointerEvent) => {
    if (!tracking) return;
    tracking = false;
    if (moved) return;
    const action = hitAction(event);
    if (action) onAction(action);
  };
  const onContext = (event: Event) => event.preventDefault();

  renderer.domElement.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("contextmenu", onContext);

  const observer = new ResizeObserver(() => resize());
  observer.observe(container);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    const elapsed = clock.elapsedTime;
    atmosphere.update(dt);
    village.setNight(atmosphere.night);
    village.setSeason(atmosphere.look.weights);
    seasonFx.update(elapsed, dt, atmosphere.look);
    village.update(elapsed);
    life.update(elapsed);
    if (chatting) pip.aim(camera.position);
    pip.update(dt);
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  };
  loop();

  function setBadge(badge: HTMLElement, count: number): void {
    badge.hidden = count <= 0;
    badge.textContent = count > 9 ? "9+" : String(count);
  }

  return {
    setChat(open, reply) {
      chatting = open;
      pip.setChatting(open);
      pip.setBubble(open ? reply : null);
      if (open && !chatFramed) {
        chatCam.copy(camera.position);
        chatTarget.copy(controls.target);
        chatFramed = true;
        framePip();
      } else if (!open && chatFramed) {
        camera.position.copy(chatCam);
        controls.target.copy(chatTarget);
        chatFramed = false;
        controls.update();
      }
    },
    sync(state) {
      setBadge(village.diaryBadge, unreadDiaryCount(state));
      setBadge(village.mailboxBadge, pendingRequestCount(state));
      pip.setPaused(state.paused);
      village.setBrowsing(state.browsing !== null);
      village.syncObjects(state.objects, state.blueprints, state.paths);
      if (state.world) atmosphere.setWorld(state.world);
      if (state.placement === "none" || !state.pipAt) return;
      const spot = village.stands[state.pipAt];
      if (!spot) return;
      if (state.placement === "jump") pip.placeAt(spot.stand, spot.door);
      else pip.walkTo(spot.stand, spot.door);
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("contextmenu", onContext);
      qualityButton?.removeEventListener("click", onQuality);
      controls.dispose();
      renderer.dispose();
    },
  };
}
