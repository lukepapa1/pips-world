import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

export type Pip = {
  group: THREE.Group;
  placeAt(point: THREE.Vector3, face: THREE.Vector3): void;
  walkTo(point: THREE.Vector3, face: THREE.Vector3): void;
  setPaused(paused: boolean): void;
  setChatting(chatting: boolean): void;
  aim(point: THREE.Vector3): void;
  setBubble(text: string | null): void;
  update(dt: number): void;
};

function softBlob(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw Pip's shadow.");
  const wash = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  wash.addColorStop(0, "rgba(28, 22, 16, 0.38)");
  wash.addColorStop(0.55, "rgba(28, 22, 16, 0.16)");
  wash.addColorStop(1, "rgba(28, 22, 16, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createPip(): Pip {
  const root = new THREE.Group();
  root.name = "pip";
  const body = new THREE.Group();
  root.add(body);

  const skin = new THREE.MeshStandardMaterial({ color: "#f0c7a4", roughness: 0.62 });
  const coat = new THREE.MeshStandardMaterial({ color: "#2f6d78", roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: "#f4efe4", roughness: 0.75 });
  const pants = new THREE.MeshStandardMaterial({ color: "#3c4a38", roughness: 0.85 });
  const scarfMat = new THREE.MeshStandardMaterial({ color: "#d4653e", roughness: 0.65 });
  const shoe = new THREE.MeshStandardMaterial({ color: "#3a2a22", roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: "#241c18", roughness: 0.4 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.22, 4, 10), coat);
  torso.position.y = 0.52;
  torso.castShadow = true;
  body.add(torso);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), shirt);
  belly.position.set(0, 0.46, 0.12);
  body.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 14), skin);
  head.position.y = 0.86;
  head.castShadow = true;
  body.add(head);

  const beanie = new THREE.Mesh(
    new THREE.SphereGeometry(0.162, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    scarfMat,
  );
  beanie.position.y = 0.9;
  beanie.castShadow = true;
  body.add(beanie);

  const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.16), scarfMat);
  scarf.position.set(0, 0.72, 0.04);
  body.add(scarf);

  const eyeGeo = new THREE.SphereGeometry(0.026, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, dark);
  eyeL.position.set(-0.055, 0.88, 0.13);
  const eyeR = new THREE.Mesh(eyeGeo, dark);
  eyeR.position.set(0.055, 0.88, 0.13);
  body.add(eyeL, eyeR);

  function limb(x: number, material: THREE.Material): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.16, 3, 6), material);
    mesh.position.y = -0.14;
    mesh.castShadow = true;
    pivot.add(mesh);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.11), shoe);
    foot.position.set(0, -0.26, 0.02);
    foot.castShadow = true;
    pivot.add(foot);
    body.add(pivot);
    return pivot;
  }

  function arm(x: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.66, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.14, 3, 6), coat);
    mesh.position.y = -0.12;
    mesh.castShadow = true;
    pivot.add(mesh);
    body.add(pivot);
    return pivot;
  }

  const legL = limb(-0.08, pants);
  const legR = limb(0.08, pants);
  const armL = arm(-0.2);
  const armR = arm(0.2);

  const shadowMat = new THREE.MeshBasicMaterial({
    map: softBlob(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  shadow.renderOrder = 2;
  root.add(shadow);

  const tag = document.createElement("div");
  tag.className = "sign pip-sign";
  tag.textContent = "Pip";
  const label = new CSS2DObject(tag);
  label.center.set(0.5, 1);
  label.position.set(0, 1.28, 0);
  root.add(label);

  const bubbleEl = document.createElement("div");
  bubbleEl.className = "sign pip-bubble";
  bubbleEl.hidden = true;
  const bubble = new CSS2DObject(bubbleEl);
  bubble.center.set(0.5, 1);
  bubble.position.set(0, 1.72, 0);
  root.add(bubble);

  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const facePoint = new THREE.Vector3();
  let t = 1;
  let paused = false;
  let chatting = false;
  const look = new THREE.Vector3();
  let age = 0;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function faceToward(point: THREE.Vector3): void {
    const dx = point.x - root.position.x;
    const dz = point.z - root.position.z;
    if (dx * dx + dz * dz < 0.0001) return;
    root.rotation.y = Math.atan2(dx, dz);
  }

  function settle(): void {
    faceToward(facePoint);
    legL.rotation.x = 0;
    legR.rotation.x = 0;
    armL.rotation.x = 0;
    armR.rotation.x = 0;
    body.position.y = 0;
    body.rotation.z = 0;
    body.rotation.x = 0;
    head.position.y = 0.86;
    shadow.scale.setScalar(1);
    shadowMat.opacity = 1;
  }

  function bob(phase: number, lift: number): void {
    const swing = Math.sin(phase) * 0.52;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.48;
    armR.rotation.x = swing * 0.48;
    body.position.y = lift;
    body.rotation.z = Math.sin(phase) * 0.04;
    body.rotation.x = 0.05;
    head.position.y = 0.86 + lift * 0.35;
    const weight = lift / 0.05;
    shadow.scale.setScalar(1 - weight * 0.16);
    shadowMat.opacity = 1 - weight * 0.2;
  }

  return {
    group: root,
    placeAt(point, face) {
      from.copy(point);
      to.copy(point);
      facePoint.copy(face);
      root.position.copy(point);
      t = 1;
      settle();
    },
    walkTo(point, face) {
      facePoint.copy(face);
      if (root.position.distanceToSquared(point) < 0.0004 && t >= 1) {
        settle();
        return;
      }
      if (reduceMotion) {
        this.placeAt(point, face);
        return;
      }
      from.copy(root.position);
      to.copy(point);
      t = 0;
    },
    setPaused(next) {
      paused = next;
    },
    setChatting(next) {
      chatting = next;
    },
    aim(point) {
      look.copy(point);
    },
    setBubble(text) {
      bubbleEl.hidden = !text;
      bubbleEl.textContent = text ?? "";
    },
    update(dt) {
      age += dt;
      if (t < 1 && !paused) {
        t = Math.min(1, t + dt / 2.3);
        const eased = t * t * (3 - 2 * t);
        root.position.lerpVectors(from, to, eased);
        faceToward(to);
        if (!reduceMotion) {
          const phase = t * Math.PI * 6;
          bob(phase, Math.abs(Math.sin(phase)) * 0.05);
        }
        if (t >= 1) settle();
        return;
      }
      if (chatting) faceToward(look);
      if (paused || reduceMotion) return;
      const idle = (Math.sin(age * 1.7) + 1) * 0.008;
      body.position.y = idle;
      head.position.y = 0.86 + idle * 0.4;
      shadow.scale.setScalar(1 - idle * 1.2);
      shadowMat.opacity = 1;
    },
  };
}
