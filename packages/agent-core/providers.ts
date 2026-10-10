/**
 * Provider + model catalog. Anthropic keeps Managed Agents; Gemini uses a
 * generateContent function-calling loop in gemini-orchestrator.ts.
 */

export const PROVIDERS = ["anthropic", "gemini"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
] as const;

/**
 * Defaults to Gemini 2.5 Flash: 1M context, function calling, stable ID.
 * If Google limits 2.5 to prior users, switch to gemini-3.8-flash in Settings.
 */
export const GEMINI_MODELS = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
] as const;

export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number]["id"];
export type GeminiModel = (typeof GEMINI_MODELS)[number]["id"];
export type HomepageModel = AnthropicModel | GeminiModel;

/** @deprecated Prefer ANTHROPIC_MODELS + GEMINI_MODELS; kept for Anthropic-only call sites. */
export const MODEL_CHOICES = ANTHROPIC_MODELS;

export const DEFAULT_PROVIDER: Provider = "anthropic";
export const DEFAULT_ANTHROPIC_MODEL: AnthropicModel = "claude-sonnet-5-5";
export const DEFAULT_GEMINI_MODEL: GeminiModel = "gemini-2.5-flash";
/** Backward-compatible alias used by existing Anthropic paths. */
export const DEFAULT_MODEL: HomepageModel = DEFAULT_ANTHROPIC_MODEL;

export function modelsFor(provider: Provider): readonly { id: HomepageModel; label: string }[] {
  return provider === "gemini" ? GEMINI_MODELS : ANTHROPIC_MODELS;
}

export function defaultModelFor(provider: Provider): HomepageModel {
  return provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_ANTHROPIC_MODEL;
}

export function providerForModel(model: string): Provider {
  return model.startsWith("gemini-") ? "gemini" : "anthropic";
}

export function isValidModel(provider: Provider, model: string): model is HomepageModel {
  return modelsFor(provider).some((m) => m.id === model);
}

/** Rough key shape checks for the setup screen — not cryptographic validation. */
export function looksLikeAnthropicKey(key: string): boolean {
  return key.trim().startsWith("sk-ant-");
}

export function looksLikeGeminiKey(key: string): boolean {
  const k = key.trim();
  // Google AI Studio keys are typically AIza…; also accept bare keys ≥20 chars.
  return k.startsWith("AIza") || (!looksLikeAnthropicKey(k) && k.length >= 20);
}

export function detectProviderFromKey(key: string): Provider | null {
  const k = key.trim();
  if (!k) return null;
  if (looksLikeAnthropicKey(k)) return "anthropic";
  if (k.startsWith("AIza")) return "gemini";
  return null;
}
