import * as THREE from "three";
import type { Quality } from "./quality";

type Flyer = {
  group: THREE.Group;
  left: THREE.Object3D;
  right: THREE.Object3D;
  radius: number;
  speed: number;
  phase: number;
  height: number;
  wobble: number;
  flap: number;
  keep: boolean;
};

export type Life = {
  update(time: number): void;
  setQuality(quality: Quality): void;
};

export function createLife(scene: THREE.Scene): Life {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const flyers: Flyer[] = [];
  const look = new THREE.Vector3();

  const birdMat = new THREE.MeshStandardMaterial({ color: "#4c5964", roughness: 0.72, flatShading: true });
  const wingMat = new THREE.MeshStandardMaterial({ color: "#3c4650", roughness: 0.7, flatShading: true, side: THREE.DoubleSide });
  const beakMat = new THREE.MeshStandardMaterial({ color: "#e0a15a", roughness: 0.6 });

  for (let i = 0; i < 4; i += 1) {
    const bird = makeBird(birdMat, wingMat, beakMat);
    const flyer: Flyer = {
      group: bird.group,
      left: bird.left,
      right: bird.right,
      radius: 6.4 + i * 0.85,
      speed: 0.18 + i * 0.035,
      phase: i * 1.5,
      height: 3.7 + (i % 2) * 0.7,
      wobble: 0.85,
      flap: 7.5,
      keep: i < 2,
    };
    scene.add(bird.group);
    flyers.push(flyer);
  }

  const petalColors = ["#e07a5f", "#f2cc8f", "#e7a0bf", "#f7f3ea", "#f0a36b"];
  for (let i = 0; i < 7; i += 1) {
    const color = petalColors[i % petalColors.length] ?? "#f2cc8f";
    const bug = makeButterfly(color);
    const inner = i < 3;
    const flyer: Flyer = {
      group: bug.group,
      left: bug.left,
      right: bug.right,
      radius: inner ? 2.3 + i * 0.35 : 9.8 + (i - 3) * 0.4,
      speed: 0.28 + (i % 3) * 0.05,
      phase: i * 0.9,
      height: inner ? 0.85 + (i % 2) * 0.25 : 1.35,
      wobble: inner ? 0.35 : 0.55,
      flap: 11,
      keep: i < 3,
    };
    scene.add(bug.group);
    flyers.push(flyer);
  }

  let quality: Quality = "high";

  function place(flyer: Flyer, time: number): void {
    const motion = reduce ? 0 : 1;
    const angle = flyer.phase + time * flyer.speed * motion;
    const x = Math.cos(angle) * flyer.radius + Math.sin(angle * 2) * flyer.wobble * motion;
    const z = Math.sin(angle) * flyer.radius * 0.86 + Math.cos(angle * 1.6) * flyer.wobble * 0.6;
    const y = flyer.height + Math.sin(time * 1.3 * Math.max(motion, 0.15) + flyer.phase) * 0.28 * Math.max(motion, 0.2);
    flyer.group.position.set(x, y, z);
    const ahead = angle + 0.08;
    look.set(
      Math.cos(ahead) * flyer.radius,
      y + Math.cos(time + flyer.phase) * 0.05,
      Math.sin(ahead) * flyer.radius * 0.86,
    );
    flyer.group.lookAt(look);
    const flap = Math.sin(time * flyer.flap + flyer.phase) * (reduce ? 0.15 : 0.7);
    flyer.left.rotation.z = flap;
    flyer.right.rotation.z = -flap;
    flyer.group.visible = quality === "high" || flyer.keep;
  }

  flyers.forEach((flyer) => place(flyer, 0));

  return {
    update(time: number) {
      for (const flyer of flyers) place(flyer, time);
    },
    setQuality(next: Quality) {
      quality = next;
      for (const flyer of flyers) flyer.group.visible = next === "high" || flyer.keep;
    },
  };
}

function makeBird(
  bodyMat: THREE.Material,
  wingMat: THREE.Material,
  beakMat: THREE.Material,
): { group: THREE.Group; left: THREE.Object3D; right: THREE.Object3D } {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.24, 5), bodyMat);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  group.add(body);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 4), beakMat);
  beak.rotation.x = Math.PI / 2;
  beak.position.z = -0.14;
  group.add(beak);

  const left = new THREE.Group();
  const right = new THREE.Group();
  const wingGeo = new THREE.BoxGeometry(0.16, 0.012, 0.07);
  wingGeo.translate(0.09, 0, 0);
  const leftWing = new THREE.Mesh(wingGeo, wingMat);
  const rightWing = new THREE.Mesh(wingGeo, wingMat);
  rightWing.scale.x = -1;
  left.add(leftWing);
  right.add(rightWing);
  left.position.set(-0.03, 0.01, 0.02);
  right.position.set(0.03, 0.01, 0.02);
  group.add(left, right);
  return { group, left, right };
}

function makeButterfly(color: string): { group: THREE.Group; left: THREE.Object3D; right: THREE.Object3D } {
  const group = new THREE.Group();
  const wingMat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  const wingGeo = new THREE.CircleGeometry(0.075, 5);
  wingGeo.translate(0.06, 0, 0);
  const left = new THREE.Mesh(wingGeo, wingMat);
  const right = new THREE.Mesh(wingGeo, wingMat);
  right.scale.x = -1;
  left.position.x = -0.01;
  right.position.x = 0.01;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.012, 0.07, 2, 4),
    new THREE.MeshStandardMaterial({ color: "#2a241c", roughness: 0.6 }),
  );
  body.rotation.x = Math.PI / 2;
  group.add(left, right, body);
  return { group, left, right };
}
