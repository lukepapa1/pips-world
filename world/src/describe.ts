import {
  hourFromTick,
  isBuildingId,
  BUILDING_NAMES,
  type WorldEvent,
} from "@pips/shared";

export function eventLabel(event: WorldEvent): string {
  switch (event.kind) {
    case "move":
      return "Move";
    case "diary":
      return "Diary";
    case "journal":
      return "Journal";
    case "request":
      return "Request";
    case "request_decision":
      return event.payload.decision === "approved" ? "Approved" : "Denied";
    case "pause":
      return "Paused";
    case "resume":
      return "Running";
    case "season_change":
      return "Season";
    case "chat":
      return "Chat";
    case "browse":
      return "Web";
    case "build":
      return "Built";
    case "blueprint":
      return "Blueprint";
    case "creation_started":
    case "creation_updated":
      return "Making";
    case "creation_finished":
      return "Finished";
  }
}

export function eventClass(event: WorldEvent): string {
  if (event.kind === "request_decision") return event.payload.decision;
  return event.kind;
}

export function eventText(event: WorldEvent): string {
  switch (event.kind) {
    case "move": {
      const to = isBuildingId(event.payload.to) ? BUILDING_NAMES[event.payload.to] : "somewhere";
      const from = isBuildingId(event.payload.from) ? BUILDING_NAMES[event.payload.from] : null;
      return from ? `Pip walked from ${from} to ${to}.` : `Pip walked to ${to}.`;
    }
    case "diary":
    case "journal":
      return event.payload.body;
    case "request":
      return `${event.payload.title}. ${event.payload.body}`;
    case "request_decision":
      return event.payload.decision === "approved"
        ? `You approved “${event.payload.title}”.`
        : `You denied “${event.payload.title}”.`;
    case "pause":
      return "You paused Pip.";
    case "resume":
      return "You resumed Pip.";
    case "season_change": {
      const name = event.payload.to.charAt(0).toUpperCase() + event.payload.to.slice(1);
      return `The season turned to ${name}.`;
    }
    case "chat":
      return "Pip is talking with the owner.";
    case "browse":
      if (event.payload.tool === "web_search") {
        return `Pip searched the web for “${event.payload.query ?? ""}”.`;
      }
      if (event.payload.tool === "view_image") return `Pip looked at an image at ${event.payload.url}.`;
      return `Pip read ${event.payload.url}.`;
    case "build": {
      const name = event.payload.type.replaceAll("_", " ");
      if (event.payload.action === "add") return `Pip placed a ${name}.`;
      if (event.payload.action === "move") return `Pip moved a ${name}.`;
      return `Pip removed a ${name}.`;
    }
    case "blueprint": {
      const { action, name, version, status } = event.payload;
      if (action === "preview") return `Blueprint ${name} version ${version} was previewed.`;
      if (action === "rollback") return `Blueprint ${name} rolled back to version ${version}.`;
      if (action === "approve") return `Blueprint ${name} version ${version} is live.`;
      return status === "live"
        ? `Blueprint ${name} version ${version} is live.`
        : `Blueprint ${name} version ${version} is waiting for approval.`;
    }
    case "creation_started":
      return `Pip started “${event.payload.title}” in the studio.`;
    case "creation_updated":
      return `Pip saved version ${event.payload.version} of “${event.payload.title}”.`;
    case "creation_finished":
      return `Pip finished “${event.payload.title}”.`;
  }
}

export function eventHour(event: WorldEvent): number {
  return hourFromTick(event.tick);
}
