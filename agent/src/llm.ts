import OpenAI, { APIError } from "openai";
import type {
  ChatCompletionContentPart,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { webContent } from "./web.js";

export class RateLimitError extends Error {
  constructor(message = "Rate limit persisted.") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class BusyError extends Error {
  constructor(message = "Model unavailable.") {
    super(message);
    this.name = "BusyError";
  }
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export class CapError extends Error {
  readonly limit: "calls" | "tokens";

  constructor(limit: "calls" | "tokens") {
    super(limit === "calls" ? "Daily call cap reached." : "Daily token cap reached.");
    this.name = "CapError";
    this.limit = limit;
  }
}

export type Meter = {
  chargeCall: () => void;
  addTokens: (count: number) => void;
};

export type LookImage = {
  mediaType: string;
  data: string;
  url: string;
};

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  required: string[];
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type RejectedCall = {
  id: string;
  name: string;
  reason: string;
};

export type Turn = {
  text: string | null;
  calls: ToolCall[];
  rejected: RejectedCall[];
};

let client: OpenAI | null = null;

export function tickModel(): string {
  const model = process.env.LLM_MODEL;
  if (!model) throw new LlmError("LLM_MODEL is required.");
  return model;
}

export function reflectModel(): string {
  const named = process.env.LLM_MODEL_REFLECT?.trim();
  return named || tickModel();
}

function openai(): OpenAI {
  const baseURL = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  if (!baseURL || !apiKey || !process.env.LLM_MODEL) {
    throw new LlmError("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL are required.");
  }
  if (!client) client = new OpenAI({ baseURL, apiKey, timeout: 240_000 });
  return client;
}

function redact(text: string): string {
  const key = process.env.LLM_API_KEY;
  if (!key) return text;
  return text.split(key).join("[redacted]");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): error is APIError {
  return error instanceof APIError && (error.status === 429 || error.status === 503);
}

function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof APIError) || !error.headers) return null;
  const headers = error.headers as { get?: (name: string) => string | null };
  const raw = typeof headers.get === "function" ? headers.get("retry-after") : null;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(raw);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

function backoffMs(attempt: number, error: unknown): number {
  const hinted = retryAfterMs(error);
  if (hinted !== null) return Math.min(hinted, 20_000);
  return Math.min(1000 * 2 ** attempt, 20_000);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseArguments(raw: unknown): { args: Record<string, unknown> } | { reason: string } {
  if (typeof raw === "string") {
    if (!raw.trim()) return { args: {} };
    try {
      const parsed = asRecord(JSON.parse(raw));
      if (!parsed) return { reason: "arguments were not an object" };
      return { args: parsed };
    } catch {
      return { reason: "arguments were not JSON" };
    }
  }
  const parsed = asRecord(raw);
  if (!parsed) return { reason: "arguments were not an object" };
  return { args: parsed };
}

function requiredOk(args: Record<string, unknown>, required: string[]): string | null {
  for (const key of required) {
    const value = args[key];
    if (typeof value !== "string" || value.trim() === "") return `${key} is missing`;
  }
  return null;
}

function apiTools(specs: ToolSpec[]): ChatCompletionTool[] {
  return specs.map((spec) => ({
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  }));
}

type RawToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};

function parseTurn(message: ChatCompletionMessage | undefined, specs: ToolSpec[]): Turn {
  const known = new Map(specs.map((spec) => [spec.name, spec]));
  const calls: ToolCall[] = [];
  const rejected: RejectedCall[] = [];
  const rawCalls = (message?.tool_calls ?? []) as RawToolCall[];

  rawCalls.forEach((raw, index) => {
    if (!raw.id || !raw.id.trim()) raw.id = `call_${index}`;
    const id = raw.id;
    const name = raw.function?.name?.trim() || "unknown";
    const spec = known.get(name);
    if (!spec) {
      rejected.push({ id, name, reason: "unknown tool" });
      return;
    }
    const parsed = parseArguments(raw.function?.arguments);
    if ("reason" in parsed) {
      rejected.push({ id, name, reason: parsed.reason });
      return;
    }
    const missing = requiredOk(parsed.args, spec.required);
    if (missing) {
      rejected.push({ id, name, reason: missing });
      return;
    }
    calls.push({ id, name, args: parsed.args });
  });

  return { text: message?.content ?? null, calls, rejected };
}

async function request(
  messages: ChatCompletionMessageParam[],
  specs: ToolSpec[],
  meter: Meter,
  model: string,
  force?: string,
  maxTokens = 1200,
): Promise<{ turn: Turn; message: ChatCompletionMessage | undefined }> {
  const openaiClient = openai();
  const maxAttempts = 4;
  let lastStatus = 429;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    meter.chargeCall();
    try {
      const response = await openaiClient.chat.completions.create({
        model,
        messages,
        ...(specs.length > 0
          ? {
              tools: apiTools(specs),
              tool_choice: force ? { type: "function" as const, function: { name: force } } : ("auto" as const),
            }
          : {}),
        max_tokens: maxTokens,
      });
      const usage = response.usage;
      let tokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
      if (tokens <= 0) {
        tokens = Math.ceil(JSON.stringify(messages).length / 4) + 32;
      }
      meter.addTokens(tokens);
      const message = response.choices[0]?.message;
      return { turn: parseTurn(message, specs), message };
    } catch (error) {
      if (error instanceof CapError) throw error;
      if (!isRetryable(error)) {
        const message = error instanceof Error ? error.message : "LLM request failed.";
        throw new LlmError(redact(message));
      }
      lastStatus = error.status ?? 503;
      if (attempt === maxAttempts - 1) break;
      const wait = backoffMs(attempt, error);
      console.warn(`LLM unavailable (${lastStatus}), retrying in ${wait}ms.`);
      await sleep(wait);
    }
  }

  if (lastStatus === 429) throw new RateLimitError();
  throw new BusyError();
}

export async function speak(
  system: string,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  meter: Meter,
  maxTokens: number,
  model = tickModel(),
): Promise<string> {
  const openaiClient = openai();
  const maxAttempts = 4;
  let lastStatus = 429;
  const body: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...messages,
  ];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    meter.chargeCall();
    try {
      const response = await openaiClient.chat.completions.create({
        model,
        messages: body,
        max_tokens: maxTokens,
      });
      const usage = response.usage;
      let tokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
      if (tokens <= 0) tokens = Math.ceil(JSON.stringify(body).length / 4) + 32;
      meter.addTokens(tokens);
      return response.choices[0]?.message?.content?.trim() ?? "";
    } catch (error) {
      if (error instanceof CapError) throw error;
      if (!isRetryable(error)) {
        const message = error instanceof Error ? error.message : "LLM request failed.";
        throw new LlmError(redact(message));
      }
      lastStatus = error.status ?? 503;
      if (attempt === maxAttempts - 1) break;
      const wait = backoffMs(attempt, error);
      console.warn(`LLM unavailable (${lastStatus}), retrying in ${wait}ms.`);
      await sleep(wait);
    }
  }

  if (lastStatus === 429) throw new RateLimitError();
  throw new BusyError();
}

export class Chat {
  private readonly messages: ChatCompletionMessageParam[];
  private readonly model: string;

  private constructor(messages: ChatCompletionMessageParam[], model: string) {
    this.messages = messages;
    this.model = model;
  }

  static start(system: string, user: string, model = tickModel()): Chat {
    return new Chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      model,
    );
  }

  addUser(text: string): void {
    this.messages.push({ role: "user", content: text });
  }

  addToolResult(id: string, name: string, content: string): void {
    this.messages.push({
      role: "tool",
      tool_call_id: id,
      content,
    });
  }

  addImages(images: LookImage[]): void {
    if (images.length === 0) return;
    const content: ChatCompletionContentPart[] = [
      {
        type: "text",
        text: webContent(images.map((image) => `Image from ${image.url}`).join("\n")),
      },
    ];
    for (const image of images) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${image.mediaType};base64,${image.data}` },
      });
    }
    this.messages.push({ role: "user", content });
  }

  async turn(specs: ToolSpec[], meter: Meter, force?: string, maxTokens = 1200): Promise<Turn> {
    const first = await request(this.messages, specs, meter, this.model, force, maxTokens);
    if (first.turn.rejected.length === 0) {
      this.pushAssistant(first.message);
      return first.turn;
    }

    console.warn("Malformed tool call, retrying once.");
    try {
      const second = await request(this.messages, specs, meter, this.model, force, maxTokens);
      this.pushAssistant(second.message);
      for (const bad of second.turn.rejected) {
        console.warn(`Malformed tool call ignored: ${bad.name} (${bad.reason}).`);
      }
      return second.turn;
    } catch (error) {
      if (!(error instanceof CapError)) throw error;
      console.warn("Malformed tool call ignored: retry blocked by the daily cap.");
      this.pushAssistant(first.message);
      for (const bad of first.turn.rejected) {
        console.warn(`Malformed tool call ignored: ${bad.name} (${bad.reason}).`);
      }
      return first.turn;
    }
  }

  private pushAssistant(message: ChatCompletionMessage | undefined): void {
    // Gemini rejects the next turn if the thought signature on a tool call is dropped.
    if (!message) {
      this.messages.push({ role: "assistant", content: "" });
      return;
    }
    this.messages.push(message as ChatCompletionMessageParam);
  }
}
