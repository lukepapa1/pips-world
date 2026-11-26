import { randomUUID } from "node:crypto";
import { BUILDINGS, TICKS_PER_DAY, type BuildingId } from "@pips/shared";

// DEMO_MODE stand-in copy. It narrates fake ticks so the world has a stream
// to render. It is not Pip's mind, and it does not set interests or plans.

const REQUESTS: Array<{ title: string; body: string }> = [
  {
    title: "Publish a one-page note",
    body: "I wrote a short page. It would stay labelled AI-made. May I put the draft where you can read it?",
  },
  {
    title: "Open a project draft",
    body: "I want a project slot called Untitled. It would not be published and it would not spend anything.",
  },
  {
    title: "Buy a book",
    body: "There is a book I can't read from here without paying. I will not buy it unless you approve.",
  },
  {
    title: "Hang a picture in the gallery",
    body: "I made a small picture. May I hang the draft in the gallery? It would be labelled AI-made.",
  },
];

function atPlace(place: BuildingId): string {
  if (place === "home") return "at home";
  if (place === "library") return "at the library";
  if (place === "workshop") return "at the workshop";
  if (place === "gallery") return "at the gallery";
  return "at the mailbox";
}

function pick(items: string[], n: number): string {
  return items[Math.abs(n) % items.length] ?? items[0];
}

export function diaryBody(place: BuildingId, tick: number, hour: number): string {
  const where = atPlace(place);
  const openers = [
    `Hour ${hour} was spent ${where}.`,
    `Hour ${hour} passed ${where}.`,
    `I used hour ${hour} ${where}.`,
    `Most of hour ${hour} happened ${where}.`,
  ];
  const middles = [
    "I stood still long enough to notice the light on the ground.",
    "The trees at the edge moved, and the middle of the village stayed bright.",
    "I looked around and kept two details.",
    "It was quiet, so the note is quiet too.",
    "I stayed near the entrance and watched the path.",
    "Nothing large happened, and the small things were enough to note.",
    "I read back the last line, then added this one.",
    "Most of the hour was just looking.",
  ];
  const closers = [
    "I closed the note there.",
    "That is the whole hour.",
    "I'll leave the rest for the next page.",
    "Enough for now.",
    "Then I was ready to move again.",
    "I put the pen down.",
  ];
  const count = 2 + (Math.abs(tick) % 3);
  const sentences = [pick(openers, tick)];
  if (count >= 3) sentences.push(pick(middles, tick + 1));
  if (count === 4) sentences.push(pick(middles, tick + 4));
  sentences.push(pick(closers, tick + 2));
  return sentences.join(" ");
}

export function journalBody(day: number): string {
  const variants = [
    `Day ${day} is finished. I moved through the village and left an hourly note each time. Whatever still needs an answer is in the mailbox.`,
    `End of day ${day}. The hours were short visits, one building after another, with a diary line for each. I am leaving the day here.`,
    `Day ${day} closed. I kept the diary as I went and left the day the size it actually was. The mailbox can hold what is still open.`,
  ];
  return variants[(day - 1) % variants.length] ?? variants[0];
}

export function nextRequest(tick: number): { title: string; body: string } {
  return REQUESTS[Math.floor(tick / 6) % REQUESTS.length] ?? REQUESTS[0];
}

export function otherBuilding(current: BuildingId | null): BuildingId {
  const choices = current ? BUILDINGS.filter((id) => id !== current) : [...BUILDINGS];
  return choices[Math.floor(Math.random() * choices.length)] ?? "home";
}

export function shouldWriteJournal(tick: number): boolean {
  return tick > 0 && tick % TICKS_PER_DAY === 0;
}

export function shouldWriteRequest(tick: number): boolean {
  return tick === 1 || tick % 6 === 0;
}

export function newId(): string {
  return randomUUID();
}
