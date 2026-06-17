# Apple Foundation Models & Private Cloud Compute — Integration Guide

How to use Apple Intelligence (on-device, Private Cloud Compute, and a cloud
fallback) from code on the Mac mini, and how to wire responses into the web apps.
Read this before asking for "PCC code" — it captures hard-won rules that aren't obvious.

> **Environment this was verified on:** Mac mini (Apple M1, 8 GB), macOS 27 dev beta
> (build `26A5353q`), signed-in Apple Account with Apple Intelligence enabled.

---

## TL;DR — the rules that actually matter

1. **There are three engines:** on-device, Private Cloud Compute (PCC), and a cloud LLM.
2. **PCC is interactive-only on this machine.** It answers from a Terminal you're sitting at, but is **refused from every background/automated context** — launchd agents, daemons, cron, subprocesses — with `PCC inference is not available in this context`. *Verified 2026-06-17* by running `fm respond --model pcc` from a GUI-session LaunchAgent (the exact context our services use) → it failed.
3. **Therefore: anything automated (the web-app features) must use on-device or a cloud LLM.** Use PCC only for manual, you-run-it tasks where you want the bigger model.
4. **The Python SDK (`apple_fm_sdk`) is on-device only** — there is no PCC class in it. PCC is reachable **only via the `fm` CLI** (`fm respond --model pcc`), on your personal Apple-Intelligence quota.
5. **The in-process Swift `PrivateCloudComputeLanguageModel` API needs an App-Store entitlement** (Small Business Program + <2M downloads + an app distributed on the App Store). Not relevant to our daemons/web apps — ignore it.

| Engine | Quality | Automatable on the server? | Cost / limits | How to call |
|---|---|---|---|---|
| **On-device** | good (small, ~4k ctx) | ✅ yes (works in our LaunchAgent context) | free, unlimited, local | `fm --model system`, `apple_fm_sdk`, or Swift `SystemLanguageModel` |
| **PCC** | better (bigger, ~32k ctx, reasoning) | ❌ **no** — interactive Terminal only | personal AI daily quota | `fm --model pcc` (CLI only), run by hand |
| **Cloud (e.g. Claude)** | best | ✅ yes | API cost | HTTP from the server |

---

## A) On-device — the engine for automated features

Always available, no network, no quota, and it **works in our server's launchd context**. This is what the web apps should use for automated summaries.

### From the `fm` CLI (pre-installed on macOS 27)
```bash
fm respond --model system "Summarize this: <text>"
```

### From Python (`apple_fm_sdk`)
Install once (needs **full Xcode**, not just Command Line Tools — see Gotchas):
```bash
sudo xcode-select -s /Applications/Xcode-beta.app/Contents/Developer   # full Xcode
pip3 install --user apple_fm_sdk                                        # Python 3.10+, Apple silicon
```
```python
import apple_fm_sdk as fm

# availability
model = fm.SystemLanguageModel()
ok, reason = model.is_available()

# basic (respond is async)
session = fm.LanguageModelSession(instructions="Summarize concisely.")
text = await session.respond("…long content…")

# structured / type-safe output
@fm.generable("A short summary")
class Summary:
    bullets: list[str] = fm.guide("Key points as short bullets")
result = await session.respond("Summarize: …", generating=Summary)

# tool calling
class GetOrders(fm.Tool):
    name = "get_past_orders"
    description = "Retrieve the user's recent orders."
    @fm.generable("args")
    class Arguments:
        n: str = fm.guide("How many orders")
    @property
    def arguments_schema(self) -> fm.GenerationSchema:
        return self.Arguments.generation_schema()
    async def call(self, args: fm.GeneratedContent) -> str:
        return await load_orders(args.value(int, for_property="n"))
session = fm.LanguageModelSession(instructions="…", tools=[GetOrders()])
```
Useful classes (from the SDK): `GenerationOptions`, `SamplingMode`, `Attachment` / `ImageAttachment`
(image prompts, v0.2.0+), `Transcript` (multi-turn), and errors `RateLimitedError`,
`GuardrailViolationError`, `ExceededContextWindowSizeError`, `RefusalError`,
`ConcurrentRequestsError`. **Note: the SDK cannot target PCC — on-device only.**

### From Swift in-process (what `fm-service` uses)
```swift
import FoundationModels
let model = SystemLanguageModel.default          // on-device, no entitlement
let session = LanguageModelSession(model: model, instructions: "Summarize concisely.")
let reply = try await session.respond(to: text)
```
(Swapping to `PrivateCloudComputeLanguageModel()` throws `ModelManagerError 1046` here — entitlement-gated.)

---

## B) Private Cloud Compute — interactive only, higher quality

Bigger model, larger context, better on complex prompts. **Only reachable via the `fm` CLI, and only from a Terminal you're actively in.** It will fail from any script the server runs unattended.

```bash
fm respond --model pcc "Provide a comprehensive regex in Swift to parse an email"
fm respond --model pcc "What apps are in this screenshot?" --image Screenshot.png
fm chat                       # interactive; then  /model pcc  to switch
fm quota-usage                # see remaining PCC quota (confirms it's really PCC, not on-device)
```
Structured output via CLI:
```bash
fm schema object --name Triage --string final_files --array --string draft_files --array > schema.json
fm respond --instructions "Sort these files…" "$files" --schema schema.json --model pcc
```

**Using PCC results in an app:** generate them **by hand in Terminal**, save the output
(file / DB), and let the web app read the saved result. The server cannot generate them on a schedule.

---

## C) Cloud LLM — automatable + best quality

For automated, high-quality summaries in the web apps, call a cloud model (e.g. the
Claude API) from the mini's server. No Apple context limits, no quota; costs API $$.
This is the recommended path when on-device quality isn't enough for an automated feature.

---

## How this Mac mini is wired

- **Process manager: launchd** (no pm2). Two **LaunchAgents** in the GUI login session
  (`~/Library/LaunchAgents`, `RunAtLoad` + `KeepAlive`):
  - `com.mlr.media-server` → `caffeinate -is node server.js` (Express, port 8787).
  - `com.mlr.fm-service` → Swift AI service, `127.0.0.1:8788`, shared-secret header,
    answers **on-device** (uses the in-process API, so never PCC).
- **Web apps (Vercel) → tunnel → mini → engine → store/return.** Because these run as
  background services, **only on-device (or cloud) is available to them — never PCC.**

---

## Gotchas (learned the hard way)

- **`PCC inference is not available in this context`** → you're calling PCC from a
  non-interactive/background process. Expected. Use on-device (or cloud) for anything automated.
- **SDK build fails with `SwiftToolingError … full Xcode required`** → the toolchain points at
  Command Line Tools. Fix: `sudo xcode-select -s /path/to/Xcode-beta.app/Contents/Developer`,
  then `sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch`, then reinstall.
- **`apple_fm_sdk` requires** Apple silicon, Python ≥ 3.10, full Xcode, Apple Intelligence enabled.
- **PCC has a personal daily quota; on-device is unlimited.** Don't build a high-volume
  multi-user feature on PCC even where it works.
- **A paid Apple Developer account does NOT unlock PCC for a daemon/web app** — the entitlement
  path is for apps distributed on the App Store only.

---

## References
- Python SDK: <https://github.com/apple/python-apple-fm-sdk> · docs <https://apple.github.io/python-apple-fm-sdk/>
- WWDC26: "Build AI-powered scripts with the fm CLI and Python SDK" (session 334),
  "What's new in the Foundation Models framework" (241),
  "Build with the new Apple Foundation Model on Private Cloud Compute" (319)
- `fm --help`, `fm respond --help`
