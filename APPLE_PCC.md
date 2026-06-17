# Apple Foundation Models & Private Cloud Compute — Integration Guide

How to use Apple Intelligence (on-device, Private Cloud Compute, and a cloud
fallback) from code on the Mac mini, and how to wire responses into the web apps.
Read this before asking for "PCC code" — it captures hard-won rules that aren't obvious.

> **Verified on:** Mac mini (Apple M1, 8 GB), macOS 27 dev beta (build `26A5353q`),
> signed-in Apple Account with Apple Intelligence enabled.

---

## TL;DR — the rules that actually matter

1. **Three engines:** on-device, Private Cloud Compute (PCC), and a cloud LLM.
2. **PCC works only when the `fm` process runs inside a *foreground GUI-app context* (Terminal.app).**
   A background service (launchd/daemon/cron) calling `fm --model pcc` *directly* fails with
   `PCC inference is not available in this context`. **But a background server CAN orchestrate it:**
   tell Terminal to run the command (Apple Events) and read the result — *that* runs in a PCC-eligible
   context. **Verified working 2026-06-17.**
3. **So PCC *can* be automated** via a Terminal-hosted `fm` — best as a persistent **`fm serve`**
   you launch in Terminal, which your server then hits over localhost. Requirements: the mini is
   **logged into its GUI session**, the orchestrator has **Automation (TCC) permission** to control
   Terminal, and you stay within the **personal Apple-Intelligence quota** (low volume).
4. **The Python SDK (`apple_fm_sdk`) is on-device only** — no PCC. PCC is reachable only via the
   `fm` CLI (`--model pcc`).
5. **The in-process Swift `PrivateCloudComputeLanguageModel` API needs an App-Store entitlement**
   (SBP + <2M downloads + an App-Store-distributed app). Not relevant to our daemons/web apps — ignore it.

| Engine | Quality | Automatable on the server? | Cost / limits | How to call |
|---|---|---|---|---|
| **On-device** | good (small, ~4k ctx) | ✅ easily (works in any context, incl. launchd) | free, unlimited | `fm --model system`, `apple_fm_sdk`, Swift `SystemLanguageModel` |
| **PCC** | better (bigger, ~32k ctx, reasoning) | ✅ **yes, but only via a Terminal-hosted `fm`** (see below) | personal AI daily quota | `fm --model pcc` run inside Terminal / `fm serve` in Terminal |
| **Cloud (e.g. Claude)** | best | ✅ easily | API cost | HTTP from the server |

---

## Automating PCC from your server (the important part)

PCC requires the **executing** process to live in a foreground GUI-app context. A background
LaunchAgent fails — *but it can drive Terminal.app, which qualifies.* Two proven methods:

### Method 1 — persistent `fm serve` in Terminal (recommended)
`fm serve` is an OpenAI-compatible Chat Completions server and **supports `model: pcc`.**
Launch it once *inside Terminal* (so it holds the PCC-eligible context); your server then just
makes localhost HTTP calls — no per-request Terminal spawn.

Bootstrap (e.g. at login, or from the media-server once):
```bash
osascript -e 'tell application "Terminal" to do script "fm serve --port 8799"'
```
Then call it like any OpenAI endpoint:
```bash
curl -s localhost:8799/v1/chat/completions -H 'content-type: application/json' -d '{
  "model": "pcc",
  "messages": [{"role":"user","content":"Summarize: …"}],
  "stream": false
}'
# → {"choices":[{"message":{"content":"…"}}], "model":"pcc", ...}   (verified)
```
Endpoints: `POST /v1/chat/completions`, `GET /v1/models`, `GET /health`.
(`fm serve` also supports `--socket /tmp/fm.sock` for a Unix socket instead of TCP.)

> To auto-start at login: a LaunchAgent (or login item) that runs the `osascript … do script
> "fm serve …"` line — the osascript runs in the background but *Terminal* hosts `fm serve`, so it
> lands in the PCC-eligible context. (A LaunchAgent that runs `fm serve` *directly* would NOT get PCC.)

### Method 2 — one-shot `osascript` per request (simpler, noisier)
```bash
osascript -e 'tell application "Terminal" to do script \
  "fm respond --model pcc \"<prompt>\" > /tmp/fm_out.txt 2>&1"'
# …then read /tmp/fm_out.txt
```
Works (verified), but opens a Terminal window per call and hands off via a file. Prefer Method 1.

### Requirements & caveats
- **The mini must be logged into its GUI (Aqua) session** — not sitting at the login screen.
- **Automation/TCC permission** to control Terminal (approve the prompt once).
- **Personal Apple-Intelligence quota** applies (`fm quota-usage`) — keep volume low; not for high-traffic multi-user.
- `fm --model pcc` **never silently falls back** — if you get text + exit 0, it's genuinely PCC.

---

## A) On-device — the simplest automatable engine

Always available, no network, no quota, works in **any** context (incl. our launchd services).

```bash
fm respond --model system "Summarize this: <text>"
```
Python (`apple_fm_sdk`; needs full Xcode + Apple silicon + Python 3.10+):
```python
import apple_fm_sdk as fm
session = fm.LanguageModelSession(instructions="Summarize concisely.")
text = await session.respond("…")                          # respond() is async

@fm.generable("A short summary")                            # structured output
class Summary:
    bullets: list[str] = fm.guide("Key points as short bullets")
result = await session.respond("Summarize: …", generating=Summary)
```
Tools via `fm.Tool` (+ `@fm.generable` Arguments). Also: `GenerationOptions`, `SamplingMode`,
`Attachment`/`ImageAttachment` (image prompts), `Transcript`, errors `RateLimitedError`,
`GuardrailViolationError`, `ExceededContextWindowSizeError`, `RefusalError`. **SDK = on-device only.**

Swift in-process (what `fm-service` uses):
```swift
import FoundationModels
let session = LanguageModelSession(model: SystemLanguageModel.default, instructions: "Summarize.")
let reply = try await session.respond(to: text)
// PrivateCloudComputeLanguageModel() here → ModelManagerError 1046 (entitlement-gated)
```

## B) Cloud LLM — automatable + best quality
For automated high-quality output, call a cloud model (e.g. the Claude API) over HTTPS from the
mini's server. No Apple context rules, no quota; costs API $$.

---

## `fm` CLI quick reference
```
fm respond  --model {system|pcc} [--stream] [--image f] [--schema f] [--instructions t] [--save-transcript n] '<prompt>'
fm chat                     # interactive; /model pcc to switch
fm serve    [--port N | --socket path] [--host H]    # OpenAI-compatible API, supports model "pcc"
fm schema object --name N --string field --array     # build a JSON schema
fm token-count | fm available | fm quota-usage
```

## How this Mac mini is wired
- **launchd LaunchAgents** in the GUI session (`~/Library/LaunchAgents`, RunAtLoad+KeepAlive):
  - `com.mlr.media-server` → `caffeinate -is node server.js` (Express, 8787)
  - `com.mlr.fm-service` → Swift AI service, `127.0.0.1:8788` (answers on-device; in-process API can't reach PCC)
- **Data path:** web app (Vercel) → tunnel → mini server → engine → store/return.
- For **PCC** content, the server routes through a **Terminal-hosted `fm`/`fm serve`** (above); for
  on-device or cloud it calls directly.

## Gotchas
- **`PCC inference is not available in this context`** → the `fm` call ran in a background context.
  Route it through Terminal (`fm serve` in Terminal, or `osascript … do script`). Don't call `fm --model pcc`
  straight from a launchd service.
- **SDK build fails `SwiftToolingError … full Xcode required`** → `sudo xcode-select -s /path/to/Xcode-beta.app/Contents/Developer`,
  then `sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch`, then reinstall.
- **`apple_fm_sdk` needs** Apple silicon, Python ≥3.10, full Xcode, Apple Intelligence enabled.
- **PCC has a personal daily quota; on-device is unlimited.** Don't build high-volume features on PCC.
- A paid Apple Developer account does **not** unlock the in-process PCC API for a daemon/web app
  (that path is App-Store-distribution only) — but you don't need it: the Terminal-hosted `fm` route above works.

## References
- Python SDK: <https://github.com/apple/python-apple-fm-sdk> · docs <https://apple.github.io/python-apple-fm-sdk/>
- WWDC26 sessions 334 (fm CLI + Python SDK), 241 (Foundation Models), 319 (PCC)
- `fm --help`, `fm respond --help`, `fm serve --help`
