#!/usr/bin/env node
/**
 * Stock Game Scheduler — local web UI for managing the cron entry that
 * drives scripts/cron-update.sh on the Mac mini.
 *
 * Run:   npm run scheduler
 * Open:  http://localhost:3737
 *
 * Stays minimal on purpose: no framework, single file, vanilla JS in the
 * browser. Reads and writes the user's crontab via shell, identifies its
 * own entry by a marker comment so it never touches anything else you've
 * scheduled.
 */
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(__dirname, "..");
const SCRIPT = resolve(REPO_DIR, "scripts", "cron-update.sh");
const LOG_FILE = "/tmp/stock-game.log";
const MARKER = "# stock-game-scheduler";
const PORT = 3737;

const PRESETS = [
  { id: "5min", label: "Every 5 minutes", expr: "*/5 * * * *" },
  { id: "15min", label: "Every 15 minutes", expr: "*/15 * * * *" },
  { id: "30min", label: "Every 30 minutes", expr: "*/30 * * * *" },
  { id: "hourly", label: "Every hour, on the hour", expr: "0 * * * *" },
  {
    id: "weekdays-close",
    label: "Weekdays at 4:30 PM ET (after market close)",
    expr: "30 16 * * 1-5",
  },
  { id: "daily-evening", label: "Daily at 8:00 PM", expr: "0 20 * * *" },
];

function exec(cmd, args, opts = {}) {
  return new Promise((resolveP) => {
    execFile(cmd, args, { encoding: "utf8", ...opts }, (err, stdout, stderr) => {
      resolveP({ ok: !err, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

async function readCrontab() {
  const r = await exec("crontab", ["-l"]);
  // crontab -l exits non-zero when the user has no crontab — treat as empty
  return r.stdout || "";
}

function findOurEntry(crontab) {
  const lines = crontab.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === MARKER && lines[i + 1]) {
      const expr = lines[i + 1]
        .split(/\s+/)
        .slice(0, 5)
        .join(" ");
      return { expr, line: lines[i + 1] };
    }
  }
  return null;
}

function buildEntry(cronExpr) {
  // Use a node-less PATH so cron can find brew, npm, git, vercel even when
  // launchd/cron strips the PATH.
  const wrapped = `${cronExpr} ${SCRIPT} >> ${LOG_FILE} 2>&1`;
  return `\n${MARKER}\n${wrapped}\n`;
}

function stripOurEntry(crontab) {
  const lines = crontab.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === MARKER) {
      i += 1; // skip the entry line too
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function writeCrontab(content) {
  return new Promise((resolveP) => {
    const child = spawn("crontab", ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) =>
      resolveP({ ok: code === 0, stderr })
    );
    child.stdin.write(content);
    child.stdin.end();
  });
}

async function setSchedule(expr) {
  const current = await readCrontab();
  const stripped = stripOurEntry(current);
  const next = stripped + buildEntry(expr);
  return writeCrontab(next);
}

async function clearSchedule() {
  const current = await readCrontab();
  const stripped = stripOurEntry(current);
  return writeCrontab(stripped);
}

async function runNow() {
  return new Promise((resolveP) => {
    const child = spawn("bash", [SCRIPT], { detached: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) =>
      resolveP({ ok: code === 0, code, stdout, stderr })
    );
  });
}

function tailLog(lines = 60) {
  if (!existsSync(LOG_FILE)) return "";
  const data = readFileSync(LOG_FILE, "utf8");
  const arr = data.split("\n");
  return arr.slice(-lines - 1).join("\n");
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Stock Game Scheduler</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #000;
    --card: #0e0e10;
    --border: #1f1f23;
    --text: #f4f4f5;
    --dim: #71717a;
    --accent: #00C805;
    --accent-2: #5AC8FA;
    --warn: #FF453A;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); }
  body { font: 15px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; min-height: 100vh; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 26px; font-weight: 700; margin: 0 0 4px; }
  .sub { color: var(--dim); font-size: 13px; margin-bottom: 28px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; margin-bottom: 18px; }
  h2 { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); margin: 0 0 12px; }
  .row { display: flex; align-items: center; gap: 12px; }
  .row + .row { margin-top: 10px; }
  button {
    appearance: none; border: 1px solid var(--border); background: #18181b; color: var(--text);
    padding: 8px 14px; border-radius: 8px; font: inherit; font-weight: 600; cursor: pointer;
    white-space: nowrap;
  }
  button:hover { background: #27272a; }
  button.primary { background: var(--accent); color: #000; border-color: transparent; }
  button.primary:hover { background: #00e006; }
  button.danger { color: var(--warn); border-color: #3f1f20; }
  button.danger:hover { background: #2a1a1c; }
  .preset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .preset {
    text-align: left; background: #18181b; border: 1px solid var(--border); padding: 10px 12px;
    border-radius: 10px; cursor: pointer; color: var(--text);
  }
  .preset:hover { background: #27272a; }
  .preset.active { background: var(--accent); color: #000; border-color: transparent; }
  .preset .label { font-size: 13px; font-weight: 600; }
  .preset .expr { font-family: ui-monospace, "SF Mono", monospace; font-size: 11px; opacity: 0.7; margin-top: 2px; }
  .preset.active .expr { opacity: 0.9; }
  .custom-input { display: flex; gap: 8px; margin-top: 10px; }
  .custom-input input {
    flex: 1; background: #18181b; border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 8px 12px; font: ui-monospace, "SF Mono", monospace; font-size: 13px;
  }
  .pill { display: inline-block; background: var(--card); border: 1px solid var(--border); padding: 4px 9px; border-radius: 999px; font-size: 12px; }
  .pill.on { background: rgba(0,200,5,0.12); color: var(--accent); border-color: rgba(0,200,5,0.3); }
  .pill.off { color: var(--dim); }
  pre.log {
    background: #050507; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
    margin: 0; max-height: 320px; overflow: auto; font: 11.5px ui-monospace, "SF Mono", monospace;
    color: #d4d4d8; white-space: pre-wrap; word-break: break-word;
  }
  .status-grid { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; align-items: baseline; }
  .status-grid dt { color: var(--dim); font-size: 12px; }
  .status-grid dd { margin: 0; font-size: 14px; font-weight: 500; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: var(--card); border: 1px solid var(--border); padding: 10px 16px;
    border-radius: 10px; font-size: 13px; opacity: 0; transition: opacity 0.2s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Stock Game Scheduler</h1>
  <div class="sub">Controls the cron entry that runs <code>scripts/cron-update.sh</code> on this Mac mini.</div>

  <div class="card">
    <h2>Status</h2>
    <dl class="status-grid">
      <dt>Schedule</dt><dd id="status-active"><span class="pill off">Loading…</span></dd>
      <dt>Cron expression</dt><dd id="status-expr">—</dd>
      <dt>Log file</dt><dd id="status-log">—</dd>
    </dl>
    <div class="row" style="margin-top: 16px;">
      <button class="primary" id="run-now">Run now</button>
      <button class="danger" id="stop">Stop schedule</button>
    </div>
  </div>

  <div class="card">
    <h2>Schedule</h2>
    <div class="preset-grid" id="presets"></div>
    <div class="custom-input">
      <input id="custom-expr" placeholder="custom cron expression e.g. '*/10 * * * *'" />
      <button id="apply-custom">Apply</button>
    </div>
  </div>

  <div class="card">
    <h2>Recent log</h2>
    <pre class="log" id="log">(no log yet — run the script once to populate)</pre>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const PRESETS = ${JSON.stringify(PRESETS)};
const presetEl = document.getElementById("presets");
const toast = document.getElementById("toast");

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 2400);
}

function renderPresets(activeExpr) {
  presetEl.innerHTML = "";
  for (const p of PRESETS) {
    const b = document.createElement("button");
    b.className = "preset" + (p.expr === activeExpr ? " active" : "");
    b.innerHTML = '<div class="label">' + p.label + '</div><div class="expr">' + p.expr + '</div>';
    b.onclick = () => apply(p.expr);
    presetEl.appendChild(b);
  }
}

async function refresh() {
  const r = await fetch("/api/status").then((r) => r.json());
  const expr = r.expr;
  document.getElementById("status-active").innerHTML = expr
    ? '<span class="pill on">Active</span>'
    : '<span class="pill off">Not scheduled</span>';
  document.getElementById("status-expr").textContent = expr || "—";
  document.getElementById("status-log").textContent = r.log_file;
  document.getElementById("log").textContent = r.log || "(no log yet)";
  renderPresets(expr);
  document.getElementById("custom-expr").value = expr && !PRESETS.some((p) => p.expr === expr) ? expr : "";
}

async function apply(expr) {
  const r = await fetch("/api/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expr }),
  }).then((r) => r.json());
  if (r.ok) showToast("Schedule applied");
  else showToast("Failed: " + (r.error || "unknown"));
  await refresh();
}

document.getElementById("apply-custom").onclick = () => {
  const v = document.getElementById("custom-expr").value.trim();
  if (!v) return showToast("Enter a cron expression first");
  apply(v);
};

document.getElementById("stop").onclick = async () => {
  const r = await fetch("/api/schedule", { method: "DELETE" }).then((r) => r.json());
  if (r.ok) showToast("Schedule stopped");
  else showToast("Failed: " + (r.error || "unknown"));
  await refresh();
};

document.getElementById("run-now").onclick = async () => {
  showToast("Running…");
  const r = await fetch("/api/run", { method: "POST" }).then((r) => r.json());
  showToast(r.ok ? "Run complete" : "Run failed (exit " + r.code + ")");
  await refresh();
};

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveP) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolveP(JSON.parse(data || "{}"));
      } catch {
        resolveP({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      send(res, 200, HTML, "text/html; charset=utf-8");
      return;
    }
    if (req.method === "GET" && req.url === "/api/status") {
      const ct = await readCrontab();
      const entry = findOurEntry(ct);
      send(res, 200, {
        expr: entry?.expr ?? null,
        log_file: LOG_FILE,
        log: tailLog(),
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/schedule") {
      const body = await readBody(req);
      const expr = (body.expr || "").trim();
      if (!expr || expr.split(/\s+/).length !== 5) {
        send(res, 400, { ok: false, error: "expression must have 5 fields" });
        return;
      }
      const r = await setSchedule(expr);
      send(res, r.ok ? 200 : 500, { ok: r.ok, error: r.stderr });
      return;
    }
    if (req.method === "DELETE" && req.url === "/api/schedule") {
      const r = await clearSchedule();
      send(res, r.ok ? 200 : 500, { ok: r.ok, error: r.stderr });
      return;
    }
    if (req.method === "POST" && req.url === "/api/run") {
      const r = await runNow();
      send(res, 200, { ok: r.ok, code: r.code });
      return;
    }
    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Stock Game Scheduler — open ${url}`);
  // Open the browser automatically on macOS
  spawn("open", [url]).on("error", () => {});
});
