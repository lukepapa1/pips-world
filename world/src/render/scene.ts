import * as THREE from "three";
import { MOUSE, TOUCH } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { fromTemplate, type BuildingId } from "@pips/shared";
import { makeBuildingMesh, setWindowsGlow } from "./buildingMesh";
import type { ClientState } from "../state";
import { pendingRequestCount, unreadDiaryCount } from "../state";
import { createAtmosphere } from "./atmosphere";
import { createLife } from "./life";
import { createSeasonFx } from "./seasonFx";
import { createPip } from "./pip";
import { loadQuality, saveQuality, type Quality } from "./quality";
import { actionOf, createVillage, type WorldAction } from "./village";
import { createPlots } from "./plots";
import { notePip } from "../plotMap";

export type SceneHandle = {
  sync(state: ClientState): void;
  setChat(open: boolean, reply: string | null): void;
  frameBuilding(id: BuildingId): void;
  dispose(): void;
};

export function mountScene(
  container: HTMLElement,
  onAction: (action: WorldAction | "chat" | "pip") => void,
): SceneHandle {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
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
  const plots = createPlots(scene);
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
      qualityButton.textContent = next === "high" ? "Graphics: high" : "Graphics: low";
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
  controls.maxDistance = 64;
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
    if (aspect < 0.75) {
      camera.fov = 50;
      camera.position.set(20, 33, 24);
      controls.minDistance = 5;
      controls.maxDistance = 64;
    } else if (aspect < 0.85) {
      camera.fov = 48;
      camera.position.set(14, 24, 16);
      controls.minDistance = 5;
      controls.maxDistance = 64;
    } else {
      camera.fov = 40;
      camera.position.set(14, 13, 16);
      controls.minDistance = 4;
      controls.maxDistance = 64;
    }
    controls.target.set(0, 0.2, 0);
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

  function hitAction(event: PointerEvent): WorldAction | "chat" | "pip" | null {
    setPointer(event);
    raycaster.setFromCamera(pointer, camera);
    const pipHit = raycaster.intersectObject(pip.group, true);
    if (pipHit.length > 0) return "pip";
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
    if (action && typeof action === "object" && action.kind === "enter") {
      enterBuilding(action.id);
      return;
    }
    if (entered && !action) {
      leaveBuilding();
      return;
    }
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
  let lastPlace: BuildingId | null = null;
  let goal: BuildingId | null = null;
  let homeGoal: BuildingId | null = null;
  let carryUntil = 0;
  let carrying = false;
  const seenFinished = new Set<string>();
  let primedFinished = false;

  const leaveButton = document.getElementById("leave-building");
  let entered: string | null = null;
  let enterAmount = 0;
  const savedCam = new THREE.Vector3();
  const savedTarget = new THREE.Vector3();
  let savedMin = 3.5;
  let savedMax = 28;
  let doorFade = 0;
  let doorWatch: BuildingId | null = null;
  const glideCam = new THREE.Vector3();
  const glideTarget = new THREE.Vector3();
  let gliding = false;

  function enterBuilding(id: string, snap = false): void {
    const view = village.interiorView(id);
    if (!view) return;
    if (!entered) {
      savedCam.copy(camera.position);
      savedTarget.copy(controls.target);
      savedMin = controls.minDistance;
      savedMax = controls.maxDistance;
    }
    entered = id;
    enterAmount = snap ? 1 : 0;
    if (leaveButton) leaveButton.hidden = false;
    controls.minDistance = 0.4;
    controls.maxDistance = 6;
    camera.fov = 62;
    camera.updateProjectionMatrix();
    glideCam.copy(view.position);
    glideTarget.copy(view.target);
    gliding = true;
    if (snap || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      camera.position.copy(view.position);
      controls.target.copy(view.target);
      gliding = false;
      controls.update();
    }
  }

  function leaveBuilding(): void {
    if (!entered) return;
    entered = null;
    enterAmount = 0;
    if (leaveButton) leaveButton.hidden = true;
    controls.minDistance = savedMin;
    controls.maxDistance = savedMax;
    camera.fov = 42;
    camera.updateProjectionMatrix();
    camera.position.copy(savedCam);
    controls.target.copy(savedTarget);
    village.setEntered(null, 0);
    controls.update();
  }

  leaveButton?.addEventListener("click", () => leaveBuilding());

  function sendPip(id: BuildingId, jump: boolean): void {
    const spot = village.stands[id];
    if (!spot) return;
    if (jump) {
      pip.placeAt(spot.inside, spot.door);
      lastPlace = id;
      goal = id;
      return;
    }
    if (goal === id) {
      pip.walkTo(spot.inside, spot.door, [spot.stand]);
      return;
    }
    const stops = village.route(lastPlace, id);
    pip.walkTo(spot.inside, spot.door, [...stops, spot.stand]);
    lastPlace = id;
    goal = id;
    doorWatch = id;
  }

  const loop = () => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    const elapsed = clock.elapsedTime;
    atmosphere.update(dt);
    village.setNight(atmosphere.night);
    village.setSeason(atmosphere.look.weights);
    seasonFx.update(elapsed, dt, atmosphere.look);
    village.update(elapsed);
    if (entered) {
      enterAmount = Math.min(1, enterAmount + dt * (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 8 : 2.4));
      village.setEntered(entered, enterAmount);
      if (gliding) {
        camera.position.lerp(glideCam, 0.14);
        controls.target.lerp(glideTarget, 0.14);
        if (camera.position.distanceTo(glideCam) < 0.08) gliding = false;
      }
    }
    if (doorWatch && goal) {
      const door = village.stands[goal]?.stand;
      if (door && pip.group.position.distanceTo(door) < 0.7) {
        doorWatch = null;
        doorFade = 0.45;
      }
    }
    if (doorFade > 0) {
      doorFade = Math.max(0, doorFade - dt);
      pip.group.visible = doorFade < 0.2;
    } else if (!pip.group.visible) {
      pip.group.visible = true;
    }
    const insideSpot = goal ? village.stands[goal]?.inside : null;
    const arrived = Boolean(goal && insideSpot && pip.group.position.distanceTo(insideSpot) < 0.85);
    village.setOccupied(arrived ? goal : null, entered === goal && arrived);
    village.dressLabels(camera);
    life.update(elapsed);
    const now = performance.now();
    if (carryUntil > now) {
      if (!carrying) {
        carrying = true;
        goal = null;
        sendPip("gallery", false);
      }
    } else if (carrying) {
      carrying = false;
      goal = null;
      if (homeGoal) sendPip(homeGoal, false);
    }
    if (chatting) pip.aim(camera.position);
    pip.update(dt);
    const pipAt = new THREE.Vector3();
    pip.group.getWorldPosition(pipAt);
    plots.update(dt, camera, pipAt, quality, atmosphere.look.weights);
    notePip(pipAt.x, pipAt.z);
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  };
  loop();

  function setBadge(badge: HTMLElement, count: number): void {
    badge.hidden = count <= 0;
    badge.textContent = count > 9 ? "9+" : String(count);
  }

  function frameBuilding(id: BuildingId): void {
    const pose = village.frontView(id);
    controls.minDistance = 3.5;
    controls.target.copy(pose.target);
    camera.position.copy(pose.position);
    controls.update();
    village.setFocus(id);
    village.dressLabels(camera);
  }

  function showShot(angle: "village" | "studio" | "gallery" | "expand", time: "dawn" | "noon" | "night"): void {
    const hours = time === "dawn" ? 6.15 : time === "night" ? 21.6 : 13;
    atmosphere.holdHours(hours);
    framed = true;
    controls.minDistance = 3;
    controls.maxDistance = 80;
    if (angle === "expand") {
      camera.position.set(4, 14, 4);
      controls.target.set(18, 0.6, 18);
    } else if (angle === "village") {
      camera.position.set(9.2, 8.2, 11.6);
      controls.target.set(-0.4, 0.8, -1.4);
    } else {
      const pose = village.frontView(angle === "studio" ? "workshop" : "gallery");
      camera.position.copy(pose.position);
      controls.target.copy(pose.target);
    }
    camera.updateProjectionMatrix();
    controls.update();
    village.dressLabels(camera);
  }

  if (new URLSearchParams(location.search).has("shot")) {
    const shot = {
      show: showShot,
      showBuilding(id: BuildingId, time: "dawn" | "noon" | "night", view: "out" | "in") {
        showShot(id === "workshop" ? "studio" : id === "gallery" ? "gallery" : "village", time);
        if (view === "out") {
          leaveBuilding();
          frameBuilding(id);
          return;
        }
        enterBuilding(id, true);
        village.setEntered(id, 1);
      },
      leave() {
        leaveBuilding();
      },
      enter(id: BuildingId) {
        enterBuilding(id, false);
      },
      occupy(id: BuildingId) {
        sendPip(id, true);
        village.setOccupied(id, false);
      },
      showDesigned(time: "dawn" | "noon" | "night", view: "out" | "in") {
        showShot("village", time);
        leaveBuilding();
        let mesh = scene.getObjectByName("designed-barn");
        if (!mesh) {
          const made = fromTemplate("barn", { wall_colour: "#c4a574", roof_colour: "#6d4034", roof_style: "gable", window_count: 4, door_side: "front", chimney: true, size: 1 }, undefined, "Barn");
          mesh = makeBuildingMesh(made.spec);
          mesh.name = "designed-barn";
          scene.add(mesh);
        }
        mesh.position.set(0, 0, 0);
        mesh.rotation.y = 0.4;
        mesh.updateMatrixWorld(true);
        for (const id of ["home", "library", "workshop", "gallery", "mailbox"] as BuildingId[]) {
          const host = scene.getObjectByName(id);
          if (host) host.visible = false;
        }
        setWindowsGlow(mesh, time === "night" ? 1 : time === "dawn" ? 0.35 : 0);
        if (view === "in") {
          mesh.traverse((node) => {
            if (node.name === "roof" || node.name === "front") node.visible = false;
            if (node.name === "interior") node.visible = true;
          });
          camera.position.copy(mesh.localToWorld(new THREE.Vector3(0.4, 1.55, 2.6)));
          controls.target.copy(mesh.localToWorld(new THREE.Vector3(0, 0.7, 0)));
        } else {
          mesh.traverse((node) => {
            if (node.name === "roof" || node.name === "front") node.visible = true;
            if (node.name === "interior") node.visible = false;
          });
          camera.position.copy(mesh.localToWorld(new THREE.Vector3(2.2, 2.5, 6.6)));
          controls.target.copy(mesh.localToWorld(new THREE.Vector3(0, 1.2, 0)));
        }
        controls.update();
      },
    };
    Object.assign(window, { __pipShot: shot });
  }

  return {
    frameBuilding,
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
      village.syncCreations(state.creations?.items ?? [], state.growth?.topicsThisWeek ?? [], state.displays);
      plots.sync(state.plots);
      if (state.world) atmosphere.setWorld(state.world);
      if (!primedFinished) {
        for (const event of state.events) {
          if (event.kind === "creation_finished") seenFinished.add(event.id);
        }
        primedFinished = true;
      } else {
        for (const event of state.events) {
          if (event.kind !== "creation_finished" || seenFinished.has(event.id)) continue;
          seenFinished.add(event.id);
          carryUntil = performance.now() + 4800;
        }
      }
      if (state.placement === "none") return;
      if (state.wander) {
        const point = new THREE.Vector3(state.wander.x, 0, state.wander.z);
        const face = new THREE.Vector3(state.wander.x, 0, state.wander.z + 1);
        goal = null;
        if (state.placement === "jump") pip.placeAt(point, face);
        else pip.walkTo(point, face);
        return;
      }
      if (!state.pipAt) return;
      homeGoal = state.pipAt;
      if (carrying) return;
      sendPip(state.pipAt, state.placement === "jump");
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
