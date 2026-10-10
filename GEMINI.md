# Gemini provider (feat/gemini-provider)

This fork adds a **Google Gemini** path alongside the original Anthropic Managed Agents flow.

## What changed

| Area | Change |
| --- | --- |
| Provider picker | New-tab setup + Settings let you choose **Google Gemini** or **Anthropic** |
| Agent loop | `packages/agent-core/gemini-orchestrator.ts` — `generateContent` + function calling (`getHistory`, `getPageHtml`) |
| Page HTML | Returned **inline** (truncated at 80 KB/page). No Anthropic file upload / sandbox mount |
| Deliverable | Model must emit `PersonalizedHomepage` inside a ` ```tsx ` fence (no sandbox `write`) |
| Models | Default **`gemini-2.5-flash`** (1M context, function calling). Also: `gemini-2.5-pro`, `gemini-3.8-flash` |
| Resume | **Not supported** on Gemini (no Managed Agents session). Anthropic resume unchanged |

Anthropic path is untouched: Managed Agents, sandbox `grep`/`read`/`write`, session cleanup.

## Configure a Gemini API key

1. Open [Google AI Studio → API keys](https://aistudio.google.com/apikey) and create a key (`AIza…`).
2. After loading the extension, open a new tab.
3. Choose **Google Gemini**, paste the key, **Save key**.
4. Click **Build today's homepage**.
5. Optional: ⚙️ Settings → switch model (Flash / Pro / 3.8 Flash).

The key is stored in `chrome.storage.local` on your machine. On each build, history digests and scraped page HTML are sent to **Google** (`generativelanguage.googleapis.com`) with that key.

If `gemini-2.5-flash` returns an access/capacity error for new projects, switch the model to **`gemini-3.8-flash`** in Settings.

## Build & load unpacked

```bash
git clone <this-repo>   # or copy the tree
cd ai-newtab
git checkout feat/gemini-provider   # if using the branch
npx pnpm@10.11.1 install
npx pnpm@10.11.1 build
```

Load in Chrome:

1. `chrome://extensions` → Developer mode on
2. **Load unpacked** → select:

```
apps/extension/.output/chrome-mv3
```

3. Keep the new-tab change when Chrome asks.

## Known limits vs Anthropic Managed Agents

| | Anthropic | Gemini (this branch) |
| --- | --- | --- |
| Orchestration | Managed Agents session + event stream | Client-side turn loop via `generateContent` |
| HTML handling | Upload + mount; agent `grep`/`read` in sandbox | Truncated HTML in tool JSON |
| Deliverable | Session output file (fence fallback) | Fence only |
| Resume interrupted build | Yes | No |
| Bash in sandbox | Off (by design) | N/A |
| Privacy cleanup | Deletes session + uploads | No remote session; nothing to delete server-side beyond Google’s API retention |

## Privacy (same posture, chosen provider)

To build a homepage the extension sends:

- a summary of browsing history (domains, counts, sample titles), and
- cleaned HTML of up to 8 pages (Gemini: truncated)

to **whichever provider you selected**, using **your** API key. Pages are opened in your signed-in browser, so they can include private content. See README and ARCHITECTURE.md.
