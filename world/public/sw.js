const SHELL = "pips-shell-1";
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function leaveToNetwork(url, request) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  const path = url.pathname;
  if (path.startsWith("/api") || path.startsWith("/ws")) return true;
  if (path === "/health" || path === "/login" || path === "/logout") return true;
  return false;
}

async function offlinePage() {
  const cache = await caches.open(SHELL);
  const page = await cache.match("/offline.html");
  if (page) return page;
  return new Response("Pip's village is waking up", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function networkShell(request) {
  const cache = await caches.open(SHELL);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const copy = fresh.clone();
      const text = await copy.text();
      if (text.includes('id="scene"')) await cache.put("/shell", fresh.clone());
    }
    return fresh;
  } catch {
    const shell = await cache.match("/shell");
    return shell || offlinePage();
  }
}

async function cachedAsset(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  const fetched = fetch(request)
    .then((response) => {
      if (response.ok && response.type === "basic") cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const fresh = await fetched;
  return fresh || offlinePage();
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (leaveToNetwork(url, event.request)) return;
  if (event.request.mode === "navigate") {
    event.respondWith(networkShell(event.request));
    return;
  }
  event.respondWith(cachedAsset(event.request));
});

self.addEventListener("push", (event) => {
  let payload = { title: "Pip", body: "", url: "/" };
  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === "object") payload = { ...payload, ...parsed };
  } catch {
    payload.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Pip", {
      body: payload.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const window of windows) {
        if (window.url === target && "focus" in window) return window.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return undefined;
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription?.options;
  if (!options) return;
  event.waitUntil(
    self.registration.pushManager.subscribe(options).then((subscription) =>
      fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(subscription),
      }),
    ),
  );
});
