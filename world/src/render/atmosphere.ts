import * as THREE from "three";
import { SEASONS, type Season, type WorldState } from "@pips/shared";
import type { Quality } from "./quality";

export type SeasonLook = {
  weights: Record<Season, number>;
  night: number;
  dusk: number;
};

export type Atmosphere = {
  sun: THREE.DirectionalLight;
  readonly night: number;
  readonly look: SeasonLook;
  setWorld(state: WorldState): void;
  update(dt: number): void;
  setQuality(quality: Quality): void;
};

export function createAtmosphere(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Atmosphere {
  const hemi = new THREE.HemisphereLight("#d7ecff", "#6d8a48", 0.78);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight("#fff1d6", 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 64;
  sun.shadow.camera.left = -22;
  sun.shadow.camera.right = 22;
  sun.shadow.camera.top = 22;
  sun.shadow.camera.bottom = -22;
  sun.shadow.bias = -0.00028;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;
  sun.shadow.camera.updateProjectionMatrix();
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight("#d5e4ff", 0.3);
  fill.position.set(-8, 6, -6);
  scene.add(fill);

  const fog = new THREE.Fog("#d7e8f4", 36, 82);
  scene.fog = fog;

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color("#8ec8ef") },
      horizonColor: { value: new THREE.Color("#f6e7cf") },
      belowColor: { value: new THREE.Color("#d5c4a4") },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 belowColor;
      void main() {
        float h = normalize(vDir).y;
        vec3 col = mix(belowColor, horizonColor, smoothstep(-0.5, -0.02, h));
        col = mix(col, topColor, smoothstep(-0.05, 0.26, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 28, 18), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -2;
  scene.add(sky);

  const starPositions = new Float32Array(40 * 3);
  const starRng = mulberry(4);
  for (let i = 0; i < 40; i += 1) {
    const theta = starRng() * Math.PI * 2;
    const y = 0.22 + starRng() * 0.75;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const radius = 118;
    starPositions[i * 3] = Math.cos(theta) * ring * radius;
    starPositions[i * 3 + 1] = y * radius;
    starPositions[i * 3 + 2] = Math.sin(theta) * ring * radius;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMat = new THREE.PointsMaterial({
    color: "#fff8ee",
    size: 3.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -1;
  scene.add(stars);

  const sunDisc = new THREE.Group();
  const sunCoreMat = new THREE.MeshBasicMaterial({ color: "#ffe7b0", fog: false });
  const sunHaloMat = new THREE.MeshBasicMaterial({
    color: "#ffd39a",
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    fog: false,
  });
  const sunCore = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), sunCoreMat);
  const sunHalo = new THREE.Mesh(new THREE.SphereGeometry(2.15, 12, 8), sunHaloMat);
  sunDisc.add(sunHalo, sunCore);
  scene.add(sunDisc);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 8, 6),
    new THREE.MeshBasicMaterial({ color: "#e4eef8", fog: false }),
  );
  scene.add(moon);

  const palette = {
    spring: tone("#b9dcff", "#f5fbff", "#c6e6a4", "#fff6d2"),
    summer: tone("#79c4f5", "#fff1cc", "#6eae45", "#fff3c4"),
    autumn: tone("#e7a56a", "#ffd7a1", "#c4a15a", "#ffb15a"),
    winter: tone("#8ea0b4", "#d5dee8", "#8b917c", "#e4edf5"),
  };
  const setTop = new THREE.Color("#e07a62");
  const setHorizon = new THREE.Color("#ffc48a");
  const nightTop = new THREE.Color("#1a2744");
  const nightHorizon = new THREE.Color("#3c4d72");
  const setSun = new THREE.Color("#ff9a55");
  const moonLight = new THREE.Color("#b7c7ea");
  const nightGround = new THREE.Color("#243028");
  const dayFill = new THREE.Color("#d5e4ff");
  const nightFill = new THREE.Color("#8ea0c4");
  const top = new THREE.Color();
  const horizon = new THREE.Color();
  const below = new THREE.Color();
  const daySun = new THREE.Color();
  const grass = new THREE.Color();
  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const lightDir = new THREE.Vector3();

  const shown = {
    weights: { spring: 1, summer: 0, autumn: 0, winter: 0 } as Record<Season, number>,
    sunrise: 6.2,
    sunset: 18.4,
    noon: 1.02,
  };
  const look: SeasonLook = { weights: shown.weights, night: 0, dusk: 0 };
  let target: WorldState | null = null;
  let snapped = false;
  let night = 0;

  function placeOnSky(azimuth: number, elevation: number, radius: number, target: THREE.Vector3): void {
    const ring = Math.cos(elevation);
    target.set(Math.cos(azimuth) * ring, Math.sin(elevation), Math.sin(azimuth) * ring).multiplyScalar(radius);
  }

  function setWorld(state: WorldState): void {
    target = state;
    if (snapped) return;
    snapped = true;
    const weights = weightOf(state);
    for (const season of SEASONS) shown.weights[season] = weights[season];
    shown.sunrise = state.sunrise;
    shown.sunset = state.sunset;
    shown.noon = state.noonElevation;
  }

  function update(dt: number): void {
    if (target && snapped) {
      const step = 1 - Math.exp(-Math.max(0, dt) * 1.5);
      const weights = weightOf(target);
      let sum = 0;
      for (const season of SEASONS) {
        shown.weights[season] += (weights[season] - shown.weights[season]) * step;
        sum += shown.weights[season];
      }
      if (sum > 0) {
        for (const season of SEASONS) shown.weights[season] /= sum;
      }
      shown.sunrise += (target.sunrise - shown.sunrise) * step;
      shown.sunset += (target.sunset - shown.sunset) * step;
      shown.noon += (target.noonElevation - shown.noon) * step;
    }

    const hours = clockHours(target);
    const span = Math.max(1, shown.sunset - shown.sunrise);
    const mid = (shown.sunrise + shown.sunset) / 2;
    const elev = shown.noon * Math.cos((Math.PI * (hours - mid)) / span);
    const angle = ((hours - mid) / span) * Math.PI;
    night = THREE.MathUtils.smoothstep(-elev, -0.04, 0.42);
    const sunset = Math.exp(-(elev * elev) * 4.2) * (1 - night * 0.55);
    look.night = night;
    look.dusk = Math.max(0, 1 - Math.abs(elev) / 0.45) * (1 - night * 0.35);

    mixPalette(shown.weights, (season) => palette[season].top, top);
    mixPalette(shown.weights, (season) => palette[season].horizon, horizon);
    mixPalette(shown.weights, (season) => palette[season].sun, daySun);
    mixPalette(shown.weights, (season) => palette[season].grass, grass);
    top.lerp(setTop, Math.min(1, sunset));
    top.lerp(nightTop, night);
    horizon.lerp(setHorizon, Math.min(1, sunset));
    horizon.lerp(nightHorizon, night);
    below.copy(horizon).multiplyScalar(0.8);

    skyMat.uniforms.topColor.value.copy(top);
    skyMat.uniforms.horizonColor.value.copy(horizon);
    skyMat.uniforms.belowColor.value.copy(below);
    fog.color.copy(horizon);
    scene.background = horizon;

    hemi.color.copy(top);
    hemi.groundColor.copy(grass).lerp(nightGround, night);
    hemi.intensity = THREE.MathUtils.lerp(0.78, 0.2, night);
    const mist = shown.weights.winter;
    fog.near = THREE.MathUtils.lerp(36, 16, mist);
    fog.far = THREE.MathUtils.lerp(82, 46, mist);

    placeOnSky(angle, Math.max(elev, 0.12), 1, sunDir);
    placeOnSky(angle + Math.PI, Math.max(-elev, 0.22), 1, moonDir);
    slerpUnit(sunDir, moonDir, night, lightDir);
    if (lightDir.y < 0.2) {
      lightDir.y = 0.2;
      lightDir.normalize();
    }
    sun.position.copy(lightDir).multiplyScalar(28);
    sun.color.copy(daySun).lerp(setSun, Math.min(1, sunset));
    sun.color.lerp(moonLight, night);
    const summerBoost = shown.weights.summer * 0.18;
    sun.intensity = THREE.MathUtils.lerp(1.35 + summerBoost, 1.05, Math.min(1, sunset));
    sun.intensity = THREE.MathUtils.lerp(sun.intensity, 0.28, night);

    fill.color.copy(dayFill).lerp(nightFill, night);
    fill.intensity = THREE.MathUtils.lerp(0.3, 0.05, night);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(1.06, 0.84, night);

    placeOnSky(angle, elev, 102, sunDisc.position);
    sunDisc.visible = elev > -0.04;
    sunCoreMat.color.copy(daySun).lerp(setSun, Math.min(1, sunset + 0.2));
    sunHaloMat.opacity = 0.22 + sunset * 0.28;
    sunDisc.scale.setScalar(1 + sunset * 0.18);

    placeOnSky(angle + Math.PI, -elev, 102, moon.position);
    moon.visible = -elev > -0.04;
    starMat.opacity = night;
  }

  function setQuality(quality: Quality): void {
    const size = quality === "high" ? 2048 : 1024;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.radius = quality === "high" ? 2.5 : 1;
    const map = sun.shadow.map;
    if (map) {
      map.dispose();
      sun.shadow.map = null;
    }
  }

  update(0);

  return {
    sun,
    look,
    get night() {
      return night;
    },
    setWorld,
    update,
    setQuality,
  };
}

function tone(top: string, horizon: string, grass: string, sun: string) {
  return {
    top: new THREE.Color(top),
    horizon: new THREE.Color(horizon),
    grass: new THREE.Color(grass),
    sun: new THREE.Color(sun),
  };
}

function weightOf(state: WorldState): Record<Season, number> {
  const weights: Record<Season, number> = { spring: 0, summer: 0, autumn: 0, winter: 0 };
  weights[state.season] += 1 - THREE.MathUtils.clamp(state.blend, 0, 1);
  weights[state.nextSeason] += THREE.MathUtils.clamp(state.blend, 0, 1);
  return weights;
}

function mixPalette(
  weights: Record<Season, number>,
  pick: (season: Season) => THREE.Color,
  out: THREE.Color,
): void {
  out.setRGB(0, 0, 0);
  for (const season of SEASONS) {
    const color = pick(season);
    const weight = weights[season];
    out.r += color.r * weight;
    out.g += color.g * weight;
    out.b += color.b * weight;
  }
}

function clockHours(state: WorldState | null): number {
  const now = new Date();
  if (!state) return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  const elapsed = (Date.now() - Date.parse(state.sampledAt)) / 3_600_000;
  const extra = Number.isFinite(elapsed) ? elapsed : 0;
  let hours = state.timeOfDay * 24 + extra;
  hours %= 24;
  if (hours < 0) hours += 24;
  return hours;
}

function slerpUnit(a: THREE.Vector3, b: THREE.Vector3, t: number, target: THREE.Vector3): void {
  const dot = THREE.MathUtils.clamp(a.dot(b), -0.999, 0.999);
  const omega = Math.acos(dot);
  const sin = Math.sin(omega);
  if (sin < 0.0001) {
    target.copy(a);
    return;
  }
  const w0 = Math.sin((1 - t) * omega) / sin;
  const w1 = Math.sin(t * omega) / sin;
  target.set(a.x * w0 + b.x * w1, a.y * w0 + b.y * w1, a.z * w0 + b.z * w1).normalize();
}

function mulberry(seed: number): () => number {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
