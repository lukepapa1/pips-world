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
  }
}

export function eventHour(event: WorldEvent): number {
  return hourFromTick(event.tick);
}
