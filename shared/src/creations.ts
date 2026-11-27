export const CREATION_TYPES = ["art", "writing", "design", "game", "site", "mechanic"] as const;

export type CreationType = (typeof CREATION_TYPES)[number];

export const CREATION_STATUSES = ["draft", "finished", "published"] as const;

export type CreationStatus = (typeof CREATION_STATUSES)[number];

export type CreationFileInfo = {
  name: string;
  bytes: number;
};

export type CreationVersionView = {
  version: number;
  createdAt: string;
  thumbnailUrl: string | null;
  files: CreationFileInfo[];
};

export type CreationView = {
  id: string;
  type: CreationType;
  title: string;
  description: string;
  pipNotes: string;
  status: CreationStatus;
  season: string;
  createdAt: string;
  updatedAt: string;
  favourite: boolean;
  archived: boolean;
  inspiredBy: string;
  diaryIds: string[];
  domains: string[];
  versions: CreationVersionView[];
};

export type CreationsLibrary = {
  items: CreationView[];
  usedBytes: number;
  budgetBytes: number;
  maxCreationBytes: number;
  publicEnabled: boolean;
};

export function isCreationType(value: unknown): value is CreationType {
  return typeof value === "string" && (CREATION_TYPES as readonly string[]).includes(value);
}

export function isCreationStatus(value: unknown): value is CreationStatus {
  return typeof value === "string" && (CREATION_STATUSES as readonly string[]).includes(value);
}

export function isCreationView(value: unknown): value is CreationView {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CreationView>;
  return typeof row.id === "string" && isCreationType(row.type) && typeof row.title === "string" && isCreationStatus(row.status);
}

/** Finished pieces for the gallery: starred first, then newest. Archived pieces stay in the library. */
export function galleryPicks(items: CreationView[], limit = 40): CreationView[] {
  return items
    .filter((item) => !item.archived && (item.status === "finished" || item.status === "published"))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

/** Drafts still on the workbench, newest first. */
export function studioDrafts(items: CreationView[]): CreationView[] {
  return items
    .filter((item) => !item.archived && item.status === "draft")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
