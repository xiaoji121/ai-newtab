/**
 * Gemini homepage build loop via generateContent + function calling.
 *
 * Unlike the Anthropic Managed Agents path, there is no remote sandbox:
 * getPageHtml returns truncated HTML inline, and the model delivers the
 * PersonalizedHomepage component as a fenced ```tsx block in its final message.
 */

import { buildHistoryDigest } from "./history-digest";
import { GEMINI_HOMEPAGE_SYSTEM_PROMPT, buildGeminiKickoffMessage } from "./gemini-prompt";
import { DEFAULT_GEMINI_MODEL, type GeminiModel } from "./providers";
import { DEFAULTS, GET_HISTORY_SCHEMA, GET_PAGE_HTML_SCHEMA } from "./schemas";
import { DEFAULT_BLOCKED_SITES, isAllowedUrl, isBlocked, normalizeBlockList } from "./site-filter";
import type {
  BrowserBridge,
  GetHistoryResult,
  HomepageBuildResult,
  KVStore,
  RunCallbacks,
  RunPhase,
} from "./types";

interface Emit {
  phase(phase: RunPhase, detail?: string): void;
  text(chunk: string): void;
  log(line: string): void;
}

/** Soft cap per page so 8 pages stay within a comfortable context budget. */
const MAX_HTML_CHARS = 80_000;
/** Hard stop so a runaway tool loop can't burn the key. */
const MAX_TURNS = 16;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiRunOptions {
  apiKey: string;
  bridge: BrowserBridge;
  store: KVStore;
  userSystemPrompt?: string;
  blockedSites?: string[] | (() => Promise<string[]>);
  model?: GeminiModel;
  callbacks?: RunCallbacks;
  signal?: AbortSignal;
  now?: Date;
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: unknown } };

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string; status?: string; code?: number };
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "getHistory",
        description:
          "Returns a ranked digest of the user's most-visited domains over a recent " +
          "window: visit counts, unique page counts, last-visit timestamps, relevance " +
          "scores, and a few sample page titles per domain. Call this first, once.",
        parameters: GET_HISTORY_SCHEMA,
      },
      {
        name: "getPageHtml",
        description:
          "Loads URLs in the user's real, logged-in browser, sanitizes the HTML, and " +
          "returns each page's HTML inline (truncated when large). Prefer this over any " +
          "web fetch: it sees authenticated, JavaScript-rendered pages.",
        parameters: GET_PAGE_HTML_SCHEMA,
      },
    ],
  },
];

export async function runGeminiHomepageBuild(opts: GeminiRunOptions): Promise<HomepageBuildResult> {
  const { apiKey, bridge, callbacks, signal } = opts;
  const model = opts.model ?? DEFAULT_GEMINI_MODEL;
  const emit: Emit = {
    phase: (p, d) => callbacks?.onPhase?.(p, d),
    text: (t) => callbacks?.onText?.(t),
    log: (l) => callbacks?.onLog?.(l),
  };

  emit.phase("setup");
  emit.log(`provider=gemini model=${model}`);

  // Synthetic session id so storage/UI that expect one stay happy. Gemini has no
  // Managed Agents session to reattach to — resume is unsupported on this path.
  const sessionId = `gemini-${crypto.randomUUID()}`;
  await opts.store.set("activeSessionId", sessionId);

  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [
        {
          text: buildGeminiKickoffMessage({
            now: opts.now ?? new Date(),
            userSystemPrompt: opts.userSystemPrompt,
          }),
        },
      ],
    },
  ];

  let finalText = "";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal?.aborted) throw new Error("aborted");

      emit.phase(turn === 0 ? "session-create" : "thinking");
      const response = await generateContent({
        apiKey,
        model,
        contents,
        signal,
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      if (parts.length === 0) {
        throw new Error(
          `Gemini returned no content (finishReason=${candidate?.finishReason ?? "unknown"}). ` +
            (response.error?.message ?? ""),
        );
      }

      // Append the model turn as-is (function calls + any text).
      contents.push({ role: "model", parts });

      const functionCalls = parts.filter(
        (p): p is { functionCall: { name: string; args?: Record<string, unknown> } } =>
          "functionCall" in p && Boolean(p.functionCall),
      );
      const textParts = parts.filter((p): p is { text: string } => "text" in p && typeof p.text === "string");

      for (const p of textParts) {
        finalText += p.text;
        emit.text(p.text);
      }

      if (functionCalls.length === 0) {
        // Model is done — expect a fenced component.
        break;
      }

      const blockedSites = normalizeBlockList(
        (typeof opts.blockedSites === "function" ? await opts.blockedSites() : opts.blockedSites) ??
          DEFAULT_BLOCKED_SITES,
      );

      const responseParts: GeminiPart[] = [];
      for (const { functionCall } of functionCalls) {
        const name = functionCall.name;
        const args = functionCall.args ?? {};
        emit.log(`tool:${name}`);
        try {
          let result: unknown;
          if (name === "getHistory") {
            result = await runGetHistory(args, bridge, emit, blockedSites);
          } else if (name === "getPageHtml") {
            result = await runGetPageHtml(args, bridge, emit, blockedSites);
          } else {
            throw new Error(`Unknown tool: ${name}`);
          }
          responseParts.push({ functionResponse: { name, response: result } });
        } catch (err) {
          emit.log(`tool ${name} failed: ${String(err)}`);
          responseParts.push({
            functionResponse: { name, response: { error: String(err) } },
          });
        }
      }
      contents.push({ role: "user", parts: responseParts });
    }

    emit.phase("writing");
    const code = extractComponent(finalText);
    if (!code) {
      throw new Error(
        `Gemini produced no homepage fence. Final message: ${finalText.slice(0, 400)}`,
      );
    }
    emit.phase("done");
    return { code, sessionId, source: "message-fence" };
  } finally {
    emit.phase("cleanup");
    await opts.store.remove("activeSessionId");
  }
}

async function generateContent(opts: {
  apiKey: string;
  model: string;
  contents: GeminiContent[];
  signal?: AbortSignal;
}): Promise<GeminiResponse> {
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: GEMINI_HOMEPAGE_SYSTEM_PROMPT }] },
    contents: opts.contents,
    tools: TOOLS,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 16384,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  const json = (await res.json()) as GeminiResponse;
  if (!res.ok) {
    const msg = json.error?.message ?? res.statusText;
    throw new Error(`Gemini API ${res.status}: ${msg}`);
  }
  if (json.error?.message) {
    throw new Error(`Gemini API error: ${json.error.message}`);
  }
  return json;
}

async function runGetHistory(
  input: Record<string, unknown>,
  bridge: BrowserBridge,
  emit: Emit,
  blockedSites: string[],
): Promise<GetHistoryResult> {
  const daysToAnalyze =
    typeof input.daysToAnalyze === "number" ? input.daysToAnalyze : DEFAULTS.daysToAnalyze;
  const maxResults = typeof input.maxResults === "number" ? input.maxResults : DEFAULTS.maxResults;

  emit.phase("history", `${daysToAnalyze}d`);
  const { sites, totalSitesSeen } = await bridge.getHistory({ daysToAnalyze, maxResults });
  const allowed = sites.filter((site) => !isBlocked(site.domain, blockedSites));
  const digest = buildHistoryDigest(allowed, {
    daysToAnalyze,
    maxResults,
    totalSitesSeen: totalSitesSeen - (sites.length - allowed.length),
  });
  emit.log(`history: ${digest.sites.length} of ${digest.totalSitesSeen} domains`);
  return digest;
}

async function runGetPageHtml(
  input: Record<string, unknown>,
  bridge: BrowserBridge,
  emit: Emit,
  blockedSites: string[],
): Promise<{
  pages: Array<{ url: string; title: string; html: string; bytes: number; truncated: boolean }>;
  failed: Array<{ url: string; reason: string }>;
}> {
  const urls = Array.isArray(input.urls) ? (input.urls as string[]).slice(0, 8) : [];
  const loadDelayMs =
    typeof input.loadDelayMs === "number" ? input.loadDelayMs : DEFAULTS.loadDelayMs;

  emit.phase("scraping", `${urls.length} pages`);

  const allowed: string[] = [];
  const blocked: Array<{ url: string; reason: string }> = [];
  for (const url of urls) {
    if (isAllowedUrl(url, blockedSites)) allowed.push(url);
    else blocked.push({ url, reason: "blocked by the user's settings" });
  }

  const { pages: loaded, failed } = allowed.length
    ? await bridge.getPageHtml({ urls: allowed, loadDelayMs })
    : { pages: [], failed: [] };

  const pages = [];
  const mountFailures = [...blocked, ...failed];

  for (const page of loaded) {
    if (page.finalUrl && !isAllowedUrl(page.finalUrl, blockedSites)) {
      mountFailures.push({ url: page.url, reason: "blocked by the user's settings" });
      continue;
    }
    const truncated = page.html.length > MAX_HTML_CHARS;
    const html = truncated ? page.html.slice(0, MAX_HTML_CHARS) : page.html;
    pages.push({
      url: page.url,
      title: page.title,
      html,
      bytes: page.html.length,
      truncated,
    });
    emit.log(
      `scraped ${page.url} (${page.html.length}b${truncated ? `, truncated to ${MAX_HTML_CHARS}` : ""})`,
    );
  }

  if (blocked.length) emit.log(`blocked: ${blocked.length} url(s)`);
  emit.phase("analyzing", `${pages.length} pages`);

  return { pages, failed: mountFailures };
}

function extractComponent(text: string): string | null {
  const re = /```(?:tsx|jsx|ts|js|typescript|javascript)?\s*\n([\s\S]*?)```/g;
  for (const m of text.matchAll(re)) {
    const body = m[1]?.trim() ?? "";
    if (body.includes("PersonalizedHomepage")) return body;
  }
  return null;
}
