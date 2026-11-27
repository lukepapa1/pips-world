import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { repoRoot } from "./env.js";

function threeBuildDir(): string | null {
  const candidates = [
    path.join(repoRoot(), "node_modules/three/build"),
    path.join(repoRoot(), "world/node_modules/three/build"),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "three.module.js"))) ?? null;
}

export function previewHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Blueprint preview</title>
    <style>
      html, body, canvas { margin: 0; width: 100%; height: 100%; display: block; background: #d7e4c8; }
    </style>
  </head>
  <body>
    <script type="importmap">{ "imports": { "three": "/vendor/three.module.js" } }</script>
    <script type="module">
      try {
      const THREE = await import("three");
      const params = new URLSearchParams(location.search);
      const name = params.get("name") || "";
      const response = await fetch("/api/blueprint-spec?name=" + encodeURIComponent(name));
      const body = await response.json();
      const spec = body.spec;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor("#d7e4c8");
      document.body.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight("#ffffff", 0.85));
      const sun = new THREE.DirectionalLight("#fff4e0", 1.3);
      sun.position.set(3, 6, 2);
      scene.add(sun);
      const group = new THREE.Group();
      scene.add(group);
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(3.2, 40),
        new THREE.MeshStandardMaterial({ color: "#b7c99a", roughness: 1 }),
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      if (spec && Array.isArray(spec.primitives)) {
        for (const primitive of spec.primitives) {
          const size = primitive.size;
          let geometry;
          if (primitive.shape === "box") geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
          else if (primitive.shape === "cylinder") geometry = new THREE.CylinderGeometry(size[0] / 2, size[2] / 2, size[1], 6);
          else if (primitive.shape === "cone") geometry = new THREE.ConeGeometry(Math.max(size[0], size[2]) / 2, size[1], 7);
          else {
            geometry = new THREE.IcosahedronGeometry(0.5, 0);
            geometry.scale(size[0], size[1], size[2]);
          }
          const material = new THREE.MeshStandardMaterial({
            color: primitive.colour,
            roughness: 0.86,
            flatShading: true,
            emissive: primitive.emissive ? primitive.colour : "#000000",
            emissiveIntensity: primitive.emissive ? 0.35 : 0,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(primitive.position[0], primitive.position[1], primitive.position[2]);
          mesh.rotation.set(primitive.rotation[0], primitive.rotation[1], primitive.rotation[2]);
          group.add(mesh);
        }
      }
      const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 40);
      const bounds = new THREE.Box3().setFromObject(group);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 0.8);
      camera.position.set(center.x + radius * 1.35, center.y + radius * 0.45, center.z + radius * 1.9);
      camera.lookAt(center);
      renderer.render(scene, camera);
      window.__previewReady = true;
    } catch (error) {
      window.__previewError = error instanceof Error ? error.message : "Preview failed.";
      window.__previewReady = true;
      }
    </script>
  </body>
</html>`;
}

export async function captureBlueprint(port: number, name: string): Promise<Buffer> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${port}/blueprint-preview?name=${encodeURIComponent(name)}`, {
      waitUntil: "networkidle",
    });
    await page.waitForFunction(() => (window as unknown as { __previewReady?: boolean }).__previewReady === true, {
      timeout: 15_000,
    });
    const previewError = await page.evaluate(
      () => (window as unknown as { __previewError?: string }).__previewError ?? "",
    );
    if (previewError) throw new Error(previewError);
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

export function servePreview(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  if (req.method !== "GET") return false;
  if (pathname === "/blueprint-preview") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(previewHtml());
    return true;
  }
  if (pathname.startsWith("/vendor/")) {
    const name = pathname.slice("/vendor/".length);
    const dir = threeBuildDir();
    if (!dir || !/^three[a-z0-9.]*\.js$/.test(name)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found.");
      return true;
    }
    const file = path.join(dir, name);
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found.");
      return true;
    }
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  return false;
}
