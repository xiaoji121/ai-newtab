import { useMemo, useState } from "react";
import {
  detectProviderFromKey,
  looksLikeAnthropicKey,
  looksLikeGeminiKey,
  type Provider,
} from "@homepage/agent-core";
import { btn } from "./ui";

export function ApiKeySetup({
  onSave,
}: {
  onSave: (key: string, provider: Provider) => void;
}) {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [value, setValue] = useState("");

  const detected = detectProviderFromKey(value);
  const effectiveProvider = detected ?? provider;

  const valid = useMemo(() => {
    const k = value.trim();
    if (!k) return false;
    if (effectiveProvider === "anthropic") return looksLikeAnthropicKey(k);
    return looksLikeGeminiKey(k);
  }, [value, effectiveProvider]);

  const placeholder =
    effectiveProvider === "anthropic" ? "sk-ant-..." : "AIza... (Google AI Studio key)";

  return (
    <div style={{ maxWidth: 520, margin: "12vh auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24 }}>Connect your API key</h1>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        The agent runs inside this extension and talks to Anthropic or Google Gemini
        directly. Your key is stored in <code>chrome.storage.local</code> on this machine
        and is never sent anywhere else — except to the provider you choose when a build
        runs (history summaries and page HTML go with it).
      </p>

      <label style={{ display: "block", marginBottom: 12, color: "#333", fontSize: 14 }}>
        Provider
        <select
          value={effectiveProvider}
          onChange={(e) => setProvider(e.target.value as Provider)}
          style={{
            display: "block",
            marginTop: 8,
            padding: "8px 12px",
            fontSize: 14,
            borderRadius: 4,
            border: "1px solid #ddd",
            width: "100%",
          }}
        >
          <option value="gemini">Google Gemini</option>
          <option value="anthropic">Anthropic (Claude Managed Agents)</option>
        </select>
      </label>

      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: 12,
          fontSize: 14,
          borderRadius: 4,
          border: "1px solid #ddd",
          fontFamily: "ui-monospace, monospace",
          boxSizing: "border-box",
        }}
      />
      <p style={{ color: "#888", fontSize: 12, marginTop: 8 }}>
        {effectiveProvider === "gemini" ? (
          <>
            Get a key at{" "}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Google AI Studio
            </a>
            . Keys usually start with <code>AIza</code>.
          </>
        ) : (
          <>
            Get a key at{" "}
            <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">
              Anthropic Console
            </a>
            . Keys start with <code>sk-ant-</code>.
          </>
        )}
      </p>
      <button
        style={{ ...btn, marginTop: 16, opacity: valid ? 1 : 0.5 }}
        disabled={!valid}
        onClick={() => onSave(value.trim(), effectiveProvider)}
      >
        Save key
      </button>
    </div>
  );
}
