type PushKind = "digest" | "request" | "project" | "quiet";

type PushPrefs = Record<PushKind, boolean>;

type PushState = {
  publicKey: string | null;
  prefs: PushPrefs;
};

const KINDS: PushKind[] = ["digest", "request", "project", "quiet"];

function emptyPrefs(): PushPrefs {
  return { digest: true, request: true, project: true, quiet: true };
}

function embeddedBrowser(): boolean {
  return /\bElectron\b/.test(navigator.userAgent);
}

function subscribeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/push service not available/i.test(message) || embeddedBrowser()) {
    return "This browser has no notification service. Open the village in Chrome or Safari.";
  }
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Notifications stayed off.";
  if (error instanceof DOMException && error.name === "InvalidAccessError") {
    return "The server's notification key was rejected.";
  }
  if (message === "Failed to fetch") return "Could not reach the server.";
  return "Could not turn on notifications.";
}

function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as unknown;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export function mountAlerts(showToast: (text: string) => void): {
  open(): void;
  close(): void;
  isOpen(): boolean;
} {
  const panel = document.getElementById("alerts");
  const note = document.getElementById("alerts-note");
  const enable = document.getElementById("alerts-enable");
  const test = document.getElementById("alerts-test");
  if (
    !(panel instanceof HTMLElement) ||
    !(note instanceof HTMLElement) ||
    !(enable instanceof HTMLButtonElement) ||
    !(test instanceof HTMLButtonElement)
  ) {
    throw new Error("Missing alerts panel");
  }
  const root = panel;
  const status = note;
  const enableButton = enable;
  const testButton = test;

  let state: PushState = { publicKey: null, prefs: emptyPrefs() };

  function boxes(): HTMLInputElement[] {
    return [...root.querySelectorAll("input[data-kind]")].filter(
      (input): input is HTMLInputElement => input instanceof HTMLInputElement,
    );
  }

  function paint(): void {
    for (const box of boxes()) {
      const kind = box.dataset.kind;
      if (kind === "digest" || kind === "request" || kind === "project" || kind === "quiet") {
        box.checked = state.prefs[kind];
      }
    }
  }

  async function load(): Promise<void> {
    const response = await fetch("/api/push");
    if (response.status === 401) {
      location.href = "/login";
      return;
    }
    const body = await readJson(response);
    const prefs = emptyPrefs();
    if (body.prefs && typeof body.prefs === "object") {
      const raw = body.prefs as Partial<PushPrefs>;
      for (const kind of KINDS) {
        if (typeof raw[kind] === "boolean") prefs[kind] = raw[kind];
      }
    }
    state = { publicKey: typeof body.publicKey === "string" ? body.publicKey : null, prefs };
    paint();
    const pushHere = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
    const registration = pushHere ? await navigator.serviceWorker.getRegistration() : null;
    const existing = registration ? await registration.pushManager.getSubscription() : null;
    const here = embeddedBrowser();
    enableButton.hidden = !pushHere || !state.publicKey || Boolean(existing) || here;
    testButton.disabled = !pushHere || !state.publicKey || !existing || here;
    if (!state.publicKey) status.textContent = "Web push is not configured on the server.";
    else if (here) status.textContent = "This browser has no notification service. Open the village in Chrome or Safari.";
    else if (!pushHere) status.textContent = "This browser cannot show web alerts until Pip is installed.";
    else if (Notification.permission === "denied") status.textContent = "Notifications are blocked for this site.";
    else if (!existing) status.textContent = "Turn on notifications to receive alerts on this device.";
    else status.textContent = "Each switch covers this device and the ntfy fallback.";
  }

  async function subscribe(): Promise<void> {
    if (!state.publicKey) {
      showToast("Web push is not configured.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      showToast("Notifications stayed off.");
      await load();
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const applicationServerKey = urlBase64ToBytes(state.publicKey).buffer;
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      }));
    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription),
    });
    if (response.status === 401) {
      location.href = "/login";
      return;
    }
    if (!response.ok) {
      showToast("Could not save this device.");
      return;
    }
    showToast("This device can receive alerts.");
    await load();
  }

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const kind = target.dataset.kind;
    if (kind !== "digest" && kind !== "request" && kind !== "project" && kind !== "quiet") return;
    const enabled = target.checked;
    state.prefs[kind] = enabled;
    fetch("/api/push/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [kind]: enabled }),
    })
      .then((response) => {
        if (response.status === 401) location.href = "/login";
        else if (!response.ok) showToast("That switch did not save.");
      })
      .catch(() => showToast("That switch did not save."));
  });

  enableButton.addEventListener("click", () => {
    subscribe().catch((error: unknown) => {
      const text = subscribeFailure(error);
      status.textContent = text;
      showToast(text);
    });
  });

  testButton.addEventListener("click", () => {
    testButton.disabled = true;
    fetch("/api/push/test", { method: "POST" })
      .then(async (response) => {
        if (response.status === 401) {
          location.href = "/login";
          return;
        }
        const body = await readJson(response);
        const message = typeof body.message === "string" ? body.message : "";
        showToast(message || (response.ok ? "Test sent." : "Test did not send."));
      })
      .catch(() => showToast("Test did not send."))
      .finally(() => {
        testButton.disabled = false;
      });
  });

  return {
    isOpen: () => !root.hidden,
    open() {
      root.hidden = false;
      load().catch(() => {
        status.textContent = "Alert settings did not load.";
      });
    },
    close() {
      root.hidden = true;
    },
  };
}
