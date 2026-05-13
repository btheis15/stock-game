"""Stock Game scheduler — tkinter desktop app modeled on data_schedule.py.

The app IS the scheduler: it stays open and fires `scripts/cron-update.sh`
on a threading.Timer. While open it runs `caffeinate` so the Mac mini
doesn't sleep between scheduled runs.

Run:
    python3 scripts/stockgame_schedule.py
or  npm run stockgame
"""

import json
import os
import py_compile
import re
import shutil
import subprocess
import sys
import threading
import time
import tkinter as tk
from datetime import datetime, timedelta
from tkinter import messagebox, ttk

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT_PATH = os.path.abspath(__file__)
REFRESH_SCRIPT = os.path.join(REPO_DIR, "scripts", "cron-update.sh")
DIGEST_SCRIPT = os.path.join(REPO_DIR, "scripts", "digest-update.sh")
LOG_FILE = "/tmp/stock-game.log"
# Persisted schedule state so the auto-restart on GitHub update is seamless —
# stockgame_schedule.py re-execs, then on launch re-applies whatever schedule
# was active before. Lives outside the repo so it doesn't leak into commits.
STATE_FILE = os.path.expanduser("~/.stockgame-schedule.json")
# How often to recheck whether the on-disk source is newer than the version
# this process loaded. The bash cron pulls every ~15 min; one-minute polling
# means the auto-restart fires within ~60 s of a `git pull` landing.
CODE_CHECK_INTERVAL_MS = 60_000

# Mon=0 ... Sun=6
WEEKEND = {5, 6}
SATURDAY = 5
SUNDAY = 6

# --- Briefing progress parsing ---------------------------------------------
# digest.swift logs each phase line-by-line. We don't modify Swift; we parse
# its existing stdout to drive a tk progress bar. The patterns below match
# the exact log() output sites in scripts/digest.swift; touching those
# formatters means updating these regexes.

# Header — emitted once, gives us the ticker count and scope so we can
# compute the total step count for the whole run.
RE_PROGRESS_HEADER = re.compile(
    r"Stock News Digest — (\d+) ticker\(s\), scope=(\w+)"
)
# RSS+Stage-2 phase completion line for one ticker:
#   "  PFE: 20 fetched → 0 keyword-rejected → 1 AI-rejected (...) → 19 stored"
RE_PROGRESS_RSS_DONE = re.compile(
    r"^\s+[A-Z][A-Z0-9.\-]{0,5}:\s+\d+\s+fetched\s+→.*→\s+\d+\s+stored"
)
# Per-window completion for a ticker or a player portfolio. Same shape both:
#   "  PFE 1W → ✓ (26 articles, maturity=partial)"
#   "  Brian 1W → ✓ (...)"
# Treats both "✓" and "—" as a completed step (— = insufficient data, still
# a step done).
RE_PROGRESS_WINDOW = re.compile(
    r"^\s+[A-Za-z][A-Za-z']*\s+(?:1D|1W|1M|3M|1Y|ALL)\s+→\s+[✓—]"
)
# Game-summary windows:  "  Game 1D → ✓ (..)"
RE_PROGRESS_GAME = re.compile(
    r"^\s+Game\s+(?:1D|1W|1M|3M|1Y|ALL)\s+→\s+[✓—]"
)
# Output-written marker — appears once at the end of the swift run.
RE_PROGRESS_DONE = re.compile(r"^✓\s+wrote\s+.*digests\.json")

# Steps per scope for a 45-ticker / 5-player roster, broken out by phase.
# These mirror digest.swift's runMain branching: daily fetches RSS for every
# ticker then generates 1D+1W per ticker, 1D+1W per portfolio, and all 6
# game windows; weekly skips RSS and generates 1M/3M/1Y/ALL per ticker + per
# portfolio with no game windows; fast does template re-renders only and is
# fast enough that no progress bar is useful.
PROGRESS_STEPS_PER_TICKER = {"daily": 1 + 2, "weekly": 4, "fast": 0, "game": 0}        # RSS + per-window
PROGRESS_STEPS_PER_PORTFOLIO = {"daily": 2, "weekly": 4, "fast": 0, "game": 0}
PROGRESS_STEPS_GAME = {"daily": 6, "weekly": 0, "fast": 0, "game": 6}
PLAYER_COUNT = 5


class SchedulerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Stock Game Scheduler")
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # mtime of stockgame_schedule.py at process startup. _check_for_code_update
        # compares against this to spot when cron-update.sh's `git pull` brings
        # down a newer version. Stored as float seconds — exact comparison only,
        # no tolerance needed since git writes the file with a fresh mtime.
        try:
            self.script_loaded_mtime = os.path.getmtime(SCRIPT_PATH)
        except OSError:
            self.script_loaded_mtime = 0.0
        self.code_update_pending = False
        self.is_restarting = False

        self.refresh_timer = None
        self.refresh_scheduled_time = None
        self.interval_minutes = None
        self.run_start_minutes = None
        self.run_end_minutes = None
        self.window_wraps_midnight = False

        # Daily digest (briefings) — separate timer, fires once per weekday
        # at the configured time. Runs scripts/digest-update.sh which calls
        # the Swift Apple Intelligence pipeline + commits + pushes.
        self.digest_timer = None
        self.digest_scheduled_time = None
        self.digest_minutes = None
        self.last_digest_text = "—"
        self.last_digest_ok = None

        # Two independent locks: the price refresh (cron-update.sh) and the
        # digest pipeline (digest-update.sh) are allowed to run concurrently
        # so a long digest run never blocks the 15-min stock interval. Within
        # each pipeline we still serialize — a second tick won't fire while
        # the prior one is still running. The bash scripts handle the git
        # push race (each commits a different file; push retries on
        # non-fast-forward).
        self.refresh_lock = threading.Lock()
        self.refresh_cond = threading.Condition(self.refresh_lock)
        self.is_refresh_running = False
        self.digest_lock = threading.Lock()
        self.digest_cond = threading.Condition(self.digest_lock)
        self.is_digest_running = False
        self.last_run_text = "—"
        self.last_run_ok = None

        # Briefing progress — populated by the stdout reader thread while
        # _run_digest is in flight, then frozen when the run ends. Kept in
        # primitives so the reader thread can mutate them lock-free; the UI
        # always polls them on the main thread via _on_main_thread.
        self._progress_total = 0           # estimated total step count
        self._progress_done = 0            # steps observed so far
        self._progress_start_ts = 0.0      # time.monotonic at run start
        self._progress_phase = ""          # human label for the current phase

        self.keep_awake_process = None

        self._create_refresh_section()
        self._create_digest_section()
        self._create_status_labels()
        self._create_buttons()
        self._start_keep_awake()
        # Restore any active schedule from a prior session (covers the
        # auto-restart-on-GitHub-update path; on a fresh manual launch the
        # state file just doesn't exist).
        self._restore_state_if_present()
        # Start the file-mtime watcher loop.
        self.root.after(CODE_CHECK_INTERVAL_MS, self._check_for_code_update)

    # ---------------- UI ----------------
    def _create_refresh_section(self):
        # Each tick now does TWO things: fetches fresh prices AND re-renders
        # the game-wide 1D/1W/1M briefing templates with the new live pcts
        # (no AI; sub-second). Section title reflects both.
        tk.Label(
            self.root,
            text="Stock prices + fast briefing re-render",
            font=("", 12, "bold"),
        ).grid(row=0, column=0, columnspan=4, padx=5, pady=(8, 4), sticky="w")

        tk.Label(self.root, text="Select Start Time:").grid(row=1, column=0, padx=5, pady=5)
        self.hour_var = tk.StringVar(value="8")
        tk.OptionMenu(self.root, self.hour_var, *range(1, 13)).grid(row=1, column=1)
        self.minute_var = tk.StringVar(value="30")
        tk.OptionMenu(
            self.root, self.minute_var, *["{:02d}".format(i) for i in range(0, 60, 5)]
        ).grid(row=1, column=2)
        self.ampm_var = tk.StringVar(value="AM")
        tk.OptionMenu(self.root, self.ampm_var, "AM", "PM").grid(row=1, column=3)

        tk.Label(self.root, text="Select Interval:").grid(
            row=2, column=0, padx=5, pady=5
        )
        self.interval_var = tk.StringVar(value="15 min")
        interval_options = [
            "None",
            "5 min",
            "10 min",
            "15 min",
            "30 min",
            "1 hr",
            "2 hr",
            "3 hr",
            "4 hr",
            "6 hr",
            "8 hr",
            "12 hr",
            "24 hr",
        ]
        tk.OptionMenu(self.root, self.interval_var, *interval_options).grid(
            row=2, column=1, columnspan=2, sticky="w"
        )

        # Defaults assume Central Time host. Extended US market hours run
        # 4:00 AM ET (pre-market) through 8:00 PM ET (after-hours close)
        # = 3:00 AM CT through 7:00 PM CT.
        tk.Label(self.root, text="Run Time Range:").grid(row=3, column=0, padx=5, pady=5)
        self.start_hour_var = tk.StringVar(value="3")
        tk.OptionMenu(self.root, self.start_hour_var, *range(1, 13)).grid(row=3, column=1)
        self.start_minute_var = tk.StringVar(value="00")
        tk.OptionMenu(
            self.root,
            self.start_minute_var,
            *["{:02d}".format(i) for i in range(0, 60, 5)],
        ).grid(row=3, column=2)
        self.start_ampm_var = tk.StringVar(value="AM")
        tk.OptionMenu(self.root, self.start_ampm_var, "AM", "PM").grid(row=3, column=3)

        self.end_hour_var = tk.StringVar(value="7")
        tk.OptionMenu(self.root, self.end_hour_var, *range(1, 13)).grid(row=4, column=1)
        self.end_minute_var = tk.StringVar(value="00")
        tk.OptionMenu(
            self.root,
            self.end_minute_var,
            *["{:02d}".format(i) for i in range(0, 60, 5)],
        ).grid(row=4, column=2)
        self.end_ampm_var = tk.StringVar(value="PM")
        tk.OptionMenu(self.root, self.end_ampm_var, "AM", "PM").grid(row=4, column=3)

        # Mon–Fri only — weekends skip both the price refresh and the digest.
        self.weekdays_only_var = tk.BooleanVar(value=True)
        tk.Checkbutton(
            self.root,
            text="Weekdays only (skip Sat/Sun)",
            variable=self.weekdays_only_var,
        ).grid(row=5, column=0, columnspan=4, padx=5, pady=(2, 0), sticky="w")

    def _create_digest_section(self):
        tk.Label(
            self.root,
            text="AI briefings (digests)",
            font=("", 12, "bold"),
        ).grid(row=6, column=0, columnspan=4, padx=5, pady=(12, 4), sticky="w")

        tk.Label(self.root, text="Briefing time:").grid(row=7, column=0, padx=5, pady=5)
        self.digest_hour_var = tk.StringVar(value="7")
        tk.OptionMenu(self.root, self.digest_hour_var, *range(1, 13)).grid(row=7, column=1)
        self.digest_minute_var = tk.StringVar(value="00")
        tk.OptionMenu(
            self.root,
            self.digest_minute_var,
            *["{:02d}".format(i) for i in range(0, 60, 5)],
        ).grid(row=7, column=2)
        self.digest_ampm_var = tk.StringVar(value="AM")
        tk.OptionMenu(self.root, self.digest_ampm_var, "AM", "PM").grid(row=7, column=3)

        # Prose summary of the cadence used to live on row 8 next to the
        # skip-fetch checkbox — it duplicated what the "Refresh cadence"
        # table below already says, so it's been removed. The skip-fetch
        # checkbox now has row 8 to itself.
        #
        # When checked, skip the slow RSS fetch + Stage-2 AI scoring step
        # and just regenerate digests from the existing article archive.
        # Useful for iterating on the prompt or for a quick prose refresh
        # without burning the full fetch pipeline. The Saturday weekly tier
        # ignores this checkbox — it never fetches RSS regardless.
        self.skip_fetch_var = tk.BooleanVar(value=False)
        tk.Checkbutton(
            self.root,
            text=(
                "Skip article fetch (regenerate from existing archive — faster, "
                "ignored on Saturday weekly tier)"
            ),
            variable=self.skip_fetch_var,
            wraplength=380,
            justify="left",
        ).grid(row=8, column=0, columnspan=4, padx=5, pady=(8, 4), sticky="w")

    def _create_status_labels(self):
        # Compact reference card so the cadence is visible at a glance —
        # mirrors the three tiers the digest pipeline runs on.
        cadence_text = (
            "Refresh cadence:\n"
            "  • Every 15 min  →  game 1D / 1W / 1M briefings (live-pct re-render, no AI)\n"
            "  • Mon–Fri AM   →  daily briefing: 1D + 1W per-stock, 1D + 1W per-portfolio, all game windows\n"
            "  • Saturday AM  →  weekly briefing: 1M / 3M / 1Y / ALL per-stock + per-portfolio (no RSS)\n"
            "  • Sunday        →  silent"
        )
        # Light gray for dark-mode legibility — #444 was unreadable on the
        # tkinter dark-mode background that ships with current macOS.
        self.cadence_label = tk.Label(
            self.root,
            text=cadence_text,
            fg="#aaa",
            font=("Menlo", 10),
            justify="left",
            anchor="w",
        )
        self.cadence_label.grid(row=9, column=0, columnspan=4, padx=5, pady=(8, 6), sticky="w")

        self.next_run_label = tk.Label(self.root, text="No refresh scheduled.")
        self.next_run_label.grid(row=10, column=0, columnspan=4, padx=5, pady=(6, 2))
        self.last_run_label = tk.Label(self.root, text="Last run: —")
        self.last_run_label.grid(row=11, column=0, columnspan=4, padx=5, pady=2)
        self.next_digest_label = tk.Label(self.root, text="No briefing scheduled.")
        self.next_digest_label.grid(row=12, column=0, columnspan=4, padx=5, pady=(8, 2))
        self.last_digest_label = tk.Label(self.root, text="Last briefing: —")
        self.last_digest_label.grid(row=13, column=0, columnspan=4, padx=5, pady=2)

        # Progress bar — only visible while a briefing is mid-run. The reader
        # thread updates self._progress_done as digest.swift's stdout streams
        # in; _update_progress_ui (main-thread callback) reads the snapshot
        # and refreshes both the bar and the label below it.
        self.progress_bar = ttk.Progressbar(
            self.root, orient="horizontal", mode="determinate", length=400
        )
        self.progress_label = tk.Label(
            self.root, text="", fg="#aaa", font=("", 9)
        )
        # Hidden by default. Shown by _start_progress_ui; hidden again by
        # _stop_progress_ui when the run ends.
        # (grid_remove() preserves the row config so a later grid() re-shows.)

        self.repo_label = tk.Label(
            self.root,
            text=f"Script: {REFRESH_SCRIPT}",
            fg="#888",
            font=("", 9),
        )
        self.repo_label.grid(row=16, column=0, columnspan=4, padx=5, pady=(0, 4))

    def _create_buttons(self):
        self.schedule_button = tk.Button(
            self.root, text="Schedule Run", command=self.schedule_task
        )
        self.schedule_button.grid(
            row=17, column=0, columnspan=2, sticky="ew", padx=5, pady=5
        )
        self.run_now_button = tk.Button(
            self.root, text="Run Now", command=self.run_now
        )
        self.run_now_button.grid(
            row=17, column=2, columnspan=2, sticky="ew", padx=5, pady=5
        )

        self.stop_button = tk.Button(self.root, text="Stop", command=self.stop_task)
        self.stop_button.grid(row=18, column=0, columnspan=4, sticky="ew", padx=5, pady=5)

        # Explicit per-scope briefing buttons. Each forces a specific scope
        # regardless of which day it is. The scheduled morning timer still
        # auto-picks (daily on Mon-Fri, weekly on Sat) — these buttons are
        # for manual mid-day runs where the user wants explicit control.
        #
        #   Daily       Mon-Fri-style refresh: 1D + 1W per-stock + per-portfolio,
        #               all 6 game windows. RSS fetch + scoring. ~25-30 min.
        #   Weekly      Saturday-style refresh: 1M / 3M / 1Y / ALL per-stock +
        #               per-portfolio (no game). No RSS. ~10-15 min steady state
        #               (much longer on the very first run after Phase 2 ships —
        #               see the daily-tier vs weekly-tier comments in
        #               digest.swift's hierarchical-summary section).
        #   Game        6 game-wide windows only, from the existing article
        #               archive. No RSS, no per-stock or per-portfolio work.
        #               ~30 s. For previewing prompt-tuning changes mid-day.
        #   All         Daily, then Weekly back-to-back. ~40-45 min combined
        #               steady state. Useful right after a roster change or
        #               during the initial Phase 2 backfill so every scope
        #               gets caught up in one shot.
        self.run_daily_briefing_button = tk.Button(
            self.root, text="Run Daily Briefing",
            command=lambda: self._fire_briefing_scope("daily"),
        )
        self.run_daily_briefing_button.grid(
            row=19, column=0, columnspan=2, sticky="ew", padx=5, pady=(0, 5)
        )
        self.run_weekly_briefing_button = tk.Button(
            self.root, text="Run Weekly Briefing",
            command=lambda: self._fire_briefing_scope("weekly"),
        )
        self.run_weekly_briefing_button.grid(
            row=19, column=2, columnspan=2, sticky="ew", padx=5, pady=(0, 5)
        )

        self.run_game_briefing_button = tk.Button(
            self.root, text="Re-run Game Briefings Only",
            command=lambda: self._fire_briefing_scope("game"),
        )
        self.run_game_briefing_button.grid(
            row=20, column=0, columnspan=2, sticky="ew", padx=5, pady=(0, 5)
        )
        self.run_all_briefings_button = tk.Button(
            self.root, text="Run All Briefings (Daily + Weekly)",
            command=self.run_all_briefings_now,
        )
        self.run_all_briefings_button.grid(
            row=20, column=2, columnspan=2, sticky="ew", padx=5, pady=(0, 5)
        )

        self.open_log_button = tk.Button(
            self.root, text="Open Log", command=self.open_log
        )
        self.open_log_button.grid(
            row=21, column=0, columnspan=4, sticky="ew", padx=5, pady=(0, 4)
        )

        # --- GitHub sync row (auto-pulled by the cron's `git pull --rebase` ---
        # The bash + Swift + TS pieces of the pipeline are re-read from disk on
        # every fire. The tkinter app is the one exception: it loads its source
        # once at launch. This row detects when cron-update.sh has pulled down
        # a newer version of this file and offers (or auto-fires) a clean
        # re-exec that re-applies the current schedule from STATE_FILE.
        tk.Label(
            self.root,
            text="GitHub sync",
            font=("", 12, "bold"),
        ).grid(row=22, column=0, columnspan=4, padx=5, pady=(12, 2), sticky="w")
        self.auto_restart_var = tk.BooleanVar(value=True)
        tk.Checkbutton(
            self.root,
            text="Auto-restart this app when a new version is pushed to GitHub",
            variable=self.auto_restart_var,
            wraplength=380,
            justify="left",
        ).grid(row=23, column=0, columnspan=4, padx=5, pady=(0, 2), sticky="w")
        self.code_sync_label = tk.Label(
            self.root,
            text="Code: in sync with origin/main",
            fg="#0a7",
            font=("", 9),
        )
        self.code_sync_label.grid(row=24, column=0, columnspan=4, padx=5, pady=(2, 4), sticky="w")
        self.restart_button = tk.Button(
            self.root, text="Restart now (pull + re-exec)", command=self.restart_now
        )
        self.restart_button.grid(
            row=25, column=0, columnspan=4, sticky="ew", padx=5, pady=(0, 8)
        )

    # ---------------- SCHEDULING ----------------
    def schedule_task(self):
        if self.refresh_timer is not None:
            messagebox.showwarning(
                "Already Scheduled",
                "Stop the current schedule before scheduling a new one.",
            )
            return

        try:
            now = datetime.now()
            self.interval_minutes = self._parse_interval(self.interval_var.get())

            self.run_start_minutes = self._parse_minutes(
                self.start_hour_var, self.start_minute_var, self.start_ampm_var
            )
            self.run_end_minutes = self._parse_minutes(
                self.end_hour_var, self.end_minute_var, self.end_ampm_var
            )
            self.window_wraps_midnight = (
                self.run_end_minutes <= self.run_start_minutes
            )

            target_time = self._parse_time(
                self.hour_var, self.minute_var, self.ampm_var
            )
            if self.interval_minutes:
                # If interval is set, anchor first run from now (within window),
                # not from the literal start-time field.
                target_time = self._next_valid_run_time(
                    target_time, self.interval_minutes, now
                )
            elif target_time <= now:
                target_time += timedelta(days=1)
            self._schedule_refresh_at(target_time)

            # Schedule the daily AI digest as well — once per weekday at the
            # configured briefing time. Independent timer; runs whether or not
            # the price-refresh interval is firing.
            self.digest_minutes = self._parse_minutes(
                self.digest_hour_var, self.digest_minute_var, self.digest_ampm_var
            )
            digest_target = self._next_daily_digest_time(now)
            self._schedule_digest_at(digest_target)

            self.update_next_run_label()
            self.update_next_digest_label()
            self.schedule_button.config(state=tk.DISABLED)
            print(f"Scheduled refresh at {target_time}; first briefing at {digest_target}.")
        except Exception as e:
            messagebox.showerror("Error", str(e))

    def _schedule_refresh_at(self, run_at):
        delay = max(0.0, (run_at - datetime.now()).total_seconds())
        self.refresh_timer = threading.Timer(
            delay, self._fire_refresh, args=(run_at,)
        )
        self.refresh_timer.daemon = True
        self.refresh_timer.start()
        self.refresh_scheduled_time = run_at

    def _fire_refresh(self, scheduled_for):
        # Refresh tick fires on its own lock so a long digest run can't push
        # the next 15-min stock refresh past its window. If a prior refresh
        # is somehow still running (network hang etc.) we wait briefly.
        if self._wait_and_start_refresh():
            try:
                self._run_refresh()
            finally:
                self._finish_refresh()
        else:
            print("Skipped scheduled refresh: prior refresh still running.")

        if self.interval_minutes:
            next_run = self._next_valid_run_time(
                scheduled_for + timedelta(minutes=self.interval_minutes),
                self.interval_minutes,
                datetime.now(),
            )
            self._schedule_refresh_at(next_run)
        else:
            self.refresh_timer = None
            self.refresh_scheduled_time = None
            self._on_main_thread(self._maybe_reenable_schedule_button)
        self._on_main_thread(self.update_next_run_label)

    def stop_task(self):
        had_refresh = self.refresh_timer is not None
        had_digest = self.digest_timer is not None
        if not had_refresh and not had_digest:
            messagebox.showwarning("No Schedule", "Nothing is currently scheduled.")
            return
        if self.refresh_timer is not None:
            self.refresh_timer.cancel()
            self.refresh_timer = None
        if self.digest_timer is not None:
            self.digest_timer.cancel()
            self.digest_timer = None
        self.refresh_scheduled_time = None
        self.digest_scheduled_time = None
        self.interval_minutes = None
        self.run_start_minutes = None
        self.run_end_minutes = None
        self.window_wraps_midnight = False
        self.digest_minutes = None
        self.update_next_run_label()
        self.update_next_digest_label()
        self.schedule_button.config(state=tk.NORMAL)
        messagebox.showinfo("Stopped", "Schedule stopped.")

    def run_now(self):
        if not self._try_start_refresh():
            messagebox.showwarning(
                "Refresh Running",
                "A stock refresh is already running.",
            )
            return
        threading.Thread(target=self._run_with_guard, daemon=True).start()

    def _fire_briefing_scope(self, scope):
        """Manual trigger for a specific briefing scope. The scheduled
        morning timer still auto-picks based on the calendar day; these
        buttons override that for one-shot runs (e.g. force a Weekly run
        on a Tuesday, or a Game-only re-run mid-day to validate a prompt
        change). Refuses if any briefing is already running."""
        if not self._try_start_digest():
            messagebox.showwarning(
                "Briefing Running",
                "A briefing is already running. Wait for it to finish, then try again.",
            )
            return
        threading.Thread(
            target=self._run_digest_with_guard_for_scope,
            args=(scope,),
            daemon=True,
        ).start()

    def run_all_briefings_now(self):
        """Run Daily, then Weekly back-to-back. Useful right after a roster
        change or during the Phase 2 backfill so every scope catches up in
        one shot. Combined runtime: ~40-45 min steady state (~3+ hours on
        the very first run after Phase 2 ships, while the chain backfills
        ~3 months of daily/weekly/monthly summaries per ticker)."""
        if not self._try_start_digest():
            messagebox.showwarning(
                "Briefing Running",
                "A briefing is already running. Wait for it to finish, then try again.",
            )
            return
        threading.Thread(target=self._run_all_with_guard, daemon=True).start()

    def _run_all_with_guard(self):
        """Chains daily → weekly under the same digest lock so concurrent
        manual triggers can't double-fire."""
        try:
            self._run_digest(scope="daily")
            self._run_digest(scope="weekly")
        finally:
            self._finish_digest()

    def _run_digest_with_guard_for_scope(self, scope):
        try:
            self._run_digest(scope=scope)
        finally:
            self._finish_digest()

    # ---------------- DAILY DIGEST ----------------
    def _digest_scope_for_day(self, weekday):
        """Mon-Fri → daily briefing. Saturday → weekly slow-tier (1M/3M/1Y/ALL
        of holdings + portfolios). Sunday → skip entirely."""
        if weekday == SATURDAY:
            return "weekly"
        if weekday == SUNDAY:
            return None
        return "daily"

    def _next_daily_digest_time(self, now):
        """Next datetime to fire a digest. Today at the configured time if it
        hasn't passed yet, otherwise tomorrow. Always skips Sunday. When
        weekdays-only is on, also skips Saturday — otherwise Saturday runs the
        weekly slow tier."""
        if self.digest_minutes is None:
            return None
        candidate = datetime(now.year, now.month, now.day) + timedelta(minutes=self.digest_minutes)
        if candidate <= now:
            candidate += timedelta(days=1)
        while True:
            scope = self._digest_scope_for_day(candidate.weekday())
            if scope is None:
                candidate += timedelta(days=1)
                continue
            if scope == "weekly" and self.weekdays_only_var.get():
                candidate += timedelta(days=1)
                continue
            break
        return candidate

    def _schedule_digest_at(self, run_at):
        if run_at is None:
            return
        delay = max(0.0, (run_at - datetime.now()).total_seconds())
        self.digest_timer = threading.Timer(
            delay, self._fire_digest, args=(run_at,)
        )
        self.digest_timer.daemon = True
        self.digest_timer.start()
        self.digest_scheduled_time = run_at

    def _fire_digest(self, scheduled_for):
        # Independent of the refresh lock — digest can run while the 15-min
        # stock refresh is firing on its own cadence. The bash scripts handle
        # the git push race (they commit different files and retry on
        # non-fast-forward push).
        if self._wait_and_start_digest():
            try:
                scope = self._digest_scope_for_day(scheduled_for.weekday())
                if scope is None:
                    print("Skipping briefing (Sunday).")
                else:
                    self._run_digest(scope=scope)
            finally:
                self._finish_digest()
        else:
            print("Skipped scheduled briefing: prior briefing still running.")

        # Re-arm for the next weekday.
        next_run = self._next_daily_digest_time(datetime.now() + timedelta(minutes=1))
        self._schedule_digest_at(next_run)
        self._on_main_thread(self.update_next_digest_label)

    def _run_digest(self, scope=None):
        if not os.path.exists(DIGEST_SCRIPT):
            print(f"Digest script not found: {DIGEST_SCRIPT}")
            return
        if scope is None:
            scope = self._digest_scope_for_day(datetime.now().weekday()) or "daily"
        try:
            start_time = datetime.now().strftime("%m/%d/%Y %-I:%M:%S%p")
            mode = "digests-only" if self.skip_fetch_var.get() else "full"
            print(f"Briefing started at {start_time} (scope={scope}, mode={mode}).")
            self._on_main_thread(
                self.last_digest_label.config,
                text=f"Briefing running… (started {start_time}, scope={scope}, mode={mode})",
                fg="#aaa",
            )
            # Pass scope + mode through env — digest-update.sh reads both and
            # picks the right --scope / --digests-only flags for digest.swift.
            env = os.environ.copy()
            env["DIGEST_MODE"] = mode
            env["DIGEST_SCOPE"] = scope

            # Estimate the total step count from the scope before the swift
            # script's own header line lands. We re-derive once the header
            # arrives in case the roster has changed (the swift script
            # iterates DEFAULT_TICKERS which is its own hardcoded list).
            self._progress_total = self._estimate_progress_total(scope)
            self._progress_done = 0
            self._progress_start_ts = time.monotonic()
            self._progress_phase = "starting"
            self._on_main_thread(self._start_progress_ui)

            # Stream stdout line-by-line so we can drive the progress bar
            # off log markers (no Swift changes needed). stderr is merged
            # into stdout so warnings, ownership-violation lines, etc.
            # still hit the log.
            proc = subprocess.Popen(
                ["bash", DIGEST_SCRIPT],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=1,
                text=True,
            )
            assert proc.stdout is not None
            for raw in proc.stdout:
                line = raw.rstrip()
                # Mirror the line to our own stdout so /tmp/stock-game.log
                # still gets the same content the old subprocess.run did.
                print(line)
                self._parse_progress_line(line)
            proc.wait()
            returncode = proc.returncode

            finish_time = datetime.now().strftime("%m/%d/%Y %-I:%M%p")
            elapsed_min = (time.monotonic() - self._progress_start_ts) / 60.0
            if returncode == 0:
                self.last_digest_ok = True
                self.last_digest_text = (
                    f"Last briefing: {finish_time} ({scope}) ✓ — ran {elapsed_min:.1f} min"
                )
                print(f"Briefing completed at {finish_time} (scope={scope}, {elapsed_min:.1f} min).")
            else:
                self.last_digest_ok = False
                self.last_digest_text = (
                    f"Last briefing failed: {finish_time} ({scope}) (exit {returncode})"
                )
                print(self.last_digest_text)
            self._on_main_thread(
                self.last_digest_label.config,
                text=self.last_digest_text,
                fg="#0a7" if self.last_digest_ok else "#c33",
            )
            self._on_main_thread(self._stop_progress_ui)
        except Exception as e:
            self.last_digest_text = f"Briefing error: {e}"
            print(self.last_digest_text)
            self._on_main_thread(
                self.last_digest_label.config, text=self.last_digest_text, fg="#c33"
            )
            self._on_main_thread(self._stop_progress_ui)

    def update_next_digest_label(self):
        if self.digest_scheduled_time:
            scope = self._digest_scope_for_day(self.digest_scheduled_time.weekday()) or "daily"
            when = self.digest_scheduled_time.strftime("%a %Y-%m-%d %I:%M %p")
            self.next_digest_label.config(text=f"Next briefing: {when} ({scope})")
        else:
            self.next_digest_label.config(text="No briefing scheduled.")

    # ---------------- BRIEFING PROGRESS ----------------
    def _estimate_progress_total(self, scope, ticker_count=None):
        """Rough total-step estimate before the swift header lands. Refined
        once we see "Stock News Digest — N ticker(s)" with the real N."""
        if ticker_count is None:
            ticker_count = 45            # current roster size; refined from header
        st = (
            ticker_count * PROGRESS_STEPS_PER_TICKER.get(scope, 0)
            + PLAYER_COUNT * PROGRESS_STEPS_PER_PORTFOLIO.get(scope, 0)
            + PROGRESS_STEPS_GAME.get(scope, 0)
        )
        return max(st, 1)

    def _parse_progress_line(self, line):
        """Pattern-match the line against the known progress markers. Each
        match increments self._progress_done (or recomputes total). Called
        from the stdout reader thread; UI updates are scheduled on the
        main thread."""
        m = RE_PROGRESS_HEADER.search(line)
        if m:
            ticker_count = int(m.group(1))
            scope = m.group(2)
            self._progress_total = self._estimate_progress_total(scope, ticker_count)
            self._progress_phase = "fetching"
            self._on_main_thread(self._update_progress_ui)
            return
        if RE_PROGRESS_RSS_DONE.match(line):
            self._progress_done += 1
            self._progress_phase = "fetching news"
            self._on_main_thread(self._update_progress_ui)
            return
        if RE_PROGRESS_GAME.match(line):
            self._progress_done += 1
            self._progress_phase = "game-wide briefing"
            self._on_main_thread(self._update_progress_ui)
            return
        if RE_PROGRESS_WINDOW.match(line):
            self._progress_done += 1
            # Heuristic phase label: if the previous line was "• Brian's
            # portfolio: start", we're in portfolios; otherwise per-stock.
            # The label is cosmetic; the bar percent is the load-bearing
            # signal.
            if "'s portfolio:" in (self._progress_phase or "") or "portfolio" in line:
                self._progress_phase = "portfolio briefings"
            else:
                self._progress_phase = "per-stock briefings"
            self._on_main_thread(self._update_progress_ui)
            return
        if "'s portfolio: start" in line:
            self._progress_phase = "portfolio briefings"
            self._on_main_thread(self._update_progress_ui)
            return
        if RE_PROGRESS_DONE.match(line):
            # Force the bar to 100% in case some steps under-counted.
            self._progress_done = self._progress_total
            self._progress_phase = "done"
            self._on_main_thread(self._update_progress_ui)
            return

    def _start_progress_ui(self):
        """Show the bar + label and reset to 0%. Called on the main thread."""
        self.progress_bar["value"] = 0
        self.progress_bar["maximum"] = self._progress_total
        self.progress_bar.grid(row=14, column=0, columnspan=4, padx=5, pady=(2, 0), sticky="ew")
        self.progress_label.grid(row=15, column=0, columnspan=4, padx=5, pady=(0, 4), sticky="w")
        self.progress_label.config(text=f"Starting briefing… (0 / {self._progress_total})")

    def _update_progress_ui(self):
        """Refresh bar + label from current state. Called on the main thread."""
        total = max(self._progress_total, 1)
        done = min(self._progress_done, total)
        self.progress_bar["maximum"] = total
        self.progress_bar["value"] = done
        pct = (done / total) * 100.0
        elapsed = max(time.monotonic() - self._progress_start_ts, 0.1)
        if done > 0:
            per_step = elapsed / done
            remaining_sec = max(per_step * (total - done), 0)
            eta = self._format_eta(remaining_sec)
        else:
            eta = "—"
        phase = self._progress_phase or "running"
        self.progress_label.config(
            text=f"{phase}: {done} / {total} ({pct:.0f}%) · ETA {eta}"
        )

    def _stop_progress_ui(self):
        """Hide the bar + label. Called on the main thread when the run ends."""
        self.progress_bar.grid_remove()
        self.progress_label.grid_remove()

    @staticmethod
    def _format_eta(seconds):
        """Human-friendly ETA — "45s", "3 min", "2h 12m"."""
        if seconds < 60:
            return f"{int(seconds)}s"
        minutes = seconds / 60.0
        if minutes < 60:
            return f"{minutes:.0f} min"
        hours = int(minutes // 60)
        mins = int(minutes - hours * 60)
        return f"{hours}h {mins}m"

    # ---------------- RUNNERS ----------------
    def _run_with_guard(self):
        try:
            self._run_refresh()
        finally:
            self._finish_refresh()

    def _run_refresh(self):
        if not os.path.exists(REFRESH_SCRIPT):
            print(f"Script not found: {REFRESH_SCRIPT}")
            return
        try:
            start_time = datetime.now().strftime("%m/%d/%Y %-I:%M:%S%p")
            print(f"Refresh started at {start_time}.")
            self._on_main_thread(
                self.last_run_label.config, text=f"Running… (started {start_time})"
            )
            result = subprocess.run(["bash", REFRESH_SCRIPT], check=False)
            finish_time = datetime.now().strftime("%m/%d/%Y %-I:%M%p")
            if result.returncode == 0:
                self.last_run_ok = True
                self.last_run_text = f"Last run: {finish_time} ✓"
                print(f"Refresh completed at {finish_time}.")
            else:
                self.last_run_ok = False
                self.last_run_text = (
                    f"Last run failed: {finish_time} (exit {result.returncode})"
                )
                print(self.last_run_text)
            self._on_main_thread(
                self.last_run_label.config,
                text=self.last_run_text,
                fg="#0a7" if self.last_run_ok else "#c33",
            )
        except Exception as e:
            self.last_run_text = f"Error: {e}"
            print(self.last_run_text)
            self._on_main_thread(
                self.last_run_label.config, text=self.last_run_text, fg="#c33"
            )

    def open_log(self):
        if not os.path.exists(LOG_FILE):
            messagebox.showinfo("No log yet", f"{LOG_FILE} doesn't exist yet.")
            return
        subprocess.Popen(["open", LOG_FILE])

    # ---------------- HELPERS (mirrors data_schedule.py) ----------------
    def _parse_time(self, hour_var, minute_var, ampm_var):
        hour = int(hour_var.get())
        minute = int(minute_var.get())
        ampm = ampm_var.get()
        if ampm == "PM" and hour != 12:
            hour += 12
        if ampm == "AM" and hour == 12:
            hour = 0
        now = datetime.now()
        return datetime(now.year, now.month, now.day, hour, minute)

    def _parse_minutes(self, hour_var, minute_var, ampm_var):
        hour = int(hour_var.get())
        minute = int(minute_var.get())
        ampm = ampm_var.get()
        if ampm == "PM" and hour != 12:
            hour += 12
        if ampm == "AM" and hour == 12:
            hour = 0
        return (hour * 60) + minute

    def _minutes_from_datetime(self, value):
        return (value.hour * 60) + value.minute

    def _is_within_window(self, value):
        # Weekend skip — Mon=0, Sun=6. The user usually leaves the scheduler
        # running through the weekend; this stops both the refresh + digest
        # from firing on Sat/Sun without forcing them to hit Stop on Friday.
        if self.weekdays_only_var.get() and value.weekday() in WEEKEND:
            return False
        if self.run_start_minutes is None or self.run_end_minutes is None:
            return True
        current_minutes = self._minutes_from_datetime(value)
        if self.window_wraps_midnight:
            return (
                current_minutes >= self.run_start_minutes
                or current_minutes < self.run_end_minutes
            )
        return self.run_start_minutes <= current_minutes < self.run_end_minutes

    def _align_to_window(self, value):
        if self._is_within_window(value):
            return value
        start_today = datetime.combine(
            value.date(), datetime.min.time()
        ) + timedelta(minutes=self.run_start_minutes)
        current_minutes = self._minutes_from_datetime(value)
        if self.window_wraps_midnight:
            if current_minutes < self.run_start_minutes:
                candidate = start_today
            else:
                candidate = start_today + timedelta(days=1)
        elif current_minutes < self.run_start_minutes:
            candidate = start_today
        else:
            candidate = start_today + timedelta(days=1)
        # Skip weekend days entirely — bump candidate forward until we land on
        # a weekday that's actually inside the run window.
        if self.weekdays_only_var.get():
            while candidate.weekday() in WEEKEND:
                candidate += timedelta(days=1)
        return candidate

    def _parse_interval(self, raw):
        raw = (raw or "").strip()
        if raw in ("", "None"):
            return None
        parts = raw.split()
        if len(parts) != 2:
            raise ValueError(f"Could not parse interval '{raw}'.")
        n = int(parts[0])
        unit = parts[1].lower()
        if unit.startswith("min"):
            mins = n
        elif unit.startswith("hr") or unit.startswith("hour"):
            mins = n * 60
        else:
            raise ValueError(f"Unknown interval unit '{unit}'.")
        if mins <= 0:
            raise ValueError("Interval must be greater than 0.")
        return mins

    def _next_valid_run_time(self, candidate, interval_minutes, now):
        step = timedelta(minutes=interval_minutes)
        candidate = candidate.replace(second=0, microsecond=0)
        if candidate < now:
            elapsed = now - candidate
            missed = int(elapsed.total_seconds() // step.total_seconds()) + 1
            candidate += step * missed
        search_limit = int((7 * 24 * 60) / max(interval_minutes, 1)) + 8
        for _ in range(search_limit):
            if self._is_within_window(candidate):
                return candidate
            candidate += step
        return self._align_to_window(candidate)

    def _try_start_refresh(self):
        with self.refresh_lock:
            if self.is_refresh_running:
                return False
            self.is_refresh_running = True
            return True

    def _wait_and_start_refresh(self, timeout_seconds=600):
        # Refresh waits at most 10 min for a prior refresh to finish — at the
        # 15-min cadence anything longer means we should just skip this tick.
        deadline = time.monotonic() + timeout_seconds
        with self.refresh_cond:
            while self.is_refresh_running:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self.refresh_cond.wait(timeout=remaining)
            self.is_refresh_running = True
            return True

    def _finish_refresh(self):
        with self.refresh_cond:
            self.is_refresh_running = False
            self.refresh_cond.notify_all()

    def _try_start_digest(self):
        with self.digest_lock:
            if self.is_digest_running:
                return False
            self.is_digest_running = True
            return True

    def _wait_and_start_digest(self, timeout_seconds=6 * 3600):
        # Digest waits up to 6 hours for a prior digest. Plenty for ~15 min
        # full runs; mainly protects against accidental double-fire.
        deadline = time.monotonic() + timeout_seconds
        with self.digest_cond:
            while self.is_digest_running:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self.digest_cond.wait(timeout=remaining)
            self.is_digest_running = True
            return True

    def _finish_digest(self):
        with self.digest_cond:
            self.is_digest_running = False
            self.digest_cond.notify_all()

    def _on_main_thread(self, func, *args, **kwargs):
        self.root.after(0, lambda: func(*args, **kwargs))

    def _maybe_reenable_schedule_button(self):
        if self.refresh_timer is None:
            self.schedule_button.config(state=tk.NORMAL)

    def update_next_run_label(self):
        if self.refresh_scheduled_time:
            self.next_run_label.config(
                text=f"Next refresh: {self.refresh_scheduled_time.strftime('%a %Y-%m-%d %I:%M %p')}"
            )
        else:
            self.next_run_label.config(text="No refresh scheduled.")

    def _start_keep_awake(self):
        if os.name != "posix":
            return
        if self.keep_awake_process and self.keep_awake_process.poll() is None:
            return
        caffeinate_path = shutil.which("caffeinate")
        if not caffeinate_path:
            print("caffeinate not found; system may sleep between runs.")
            return
        try:
            self.keep_awake_process = subprocess.Popen(
                [caffeinate_path, "-i", "-w", str(os.getpid())],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            print("Sleep prevention enabled while scheduler is open.")
        except Exception as exc:
            self.keep_awake_process = None
            print(f"Could not enable sleep prevention: {exc}")

    def _stop_keep_awake(self):
        process = self.keep_awake_process
        self.keep_awake_process = None
        if process and process.poll() is None:
            try:
                process.terminate()
            except Exception:
                pass

    # ---------------- AUTO-SYNC WITH GITHUB ----------------
    def _background_pull(self):
        """Fire-and-forget `git fetch + git pull --rebase --autostash`. Runs on
        a daemon thread so the UI never blocks. The cron + digest pipelines
        also pull on their own cadence; whichever wins the .git/index.lock
        race goes first, the others retry next interval. Origin pushes from
        the laptop or Claude Code mobile land on disk here within
        CODE_CHECK_INTERVAL_MS — not "next 15-min cron tick" — so a phone
        commit at 9pm is live within ~60 s instead of overnight."""
        try:
            subprocess.run(
                ["git", "-C", REPO_DIR, "fetch", "--quiet", "origin", "main"],
                check=False,
                timeout=30,
                capture_output=True,
            )
            subprocess.run(
                ["git", "-C", REPO_DIR, "pull", "--rebase", "--autostash",
                 "--quiet", "origin", "main"],
                check=False,
                timeout=30,
                capture_output=True,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            # Network blip / lock contention / git missing — silently retry
            # next interval. Persistent failures get caught by _restart_self's
            # pull when an actual restart is attempted.
            pass

    def _check_for_code_update(self):
        """Polled every CODE_CHECK_INTERVAL_MS. Two jobs:

        1. Kick off a background `git pull` so origin/main lands on disk
           even when cron-update.sh hasn't fired recently (overnight, on
           weekends with weekdays-only enabled, between manual stops, etc.).
        2. Compare the on-disk mtime against process-load mtime; if newer,
           flag the update + auto-restart when idle.

        The pull is async — its result lands on disk and gets picked up by
        the *next* poll cycle's mtime check, not this one. That's fine; we
        accept up to one extra 60-s tick of latency in exchange for never
        blocking the UI thread on git."""
        if self.is_restarting:
            return
        # Job 1: kick off the background pull. No await — result lands on
        # disk and the next mtime check picks it up.
        threading.Thread(target=self._background_pull, daemon=True).start()

        # Job 2: detect mtime change + auto-restart
        try:
            current_mtime = os.path.getmtime(SCRIPT_PATH)
        except OSError:
            self.root.after(CODE_CHECK_INTERVAL_MS, self._check_for_code_update)
            return
        if current_mtime > self.script_loaded_mtime and not self.code_update_pending:
            self.code_update_pending = True
            self.code_sync_label.config(
                text="Code: update pending — will restart when idle",
                fg="#a60",
            )
        if self.code_update_pending and self.auto_restart_var.get():
            if not self.is_refresh_running and not self.is_digest_running:
                self._restart_self()
                return        # _restart_self never returns control on success
        self.root.after(CODE_CHECK_INTERVAL_MS, self._check_for_code_update)

    def restart_now(self):
        """Manual escape hatch — always attempts a restart, even if no code
        change has been detected (useful after a `git pull` you did by hand)."""
        if self.is_refresh_running or self.is_digest_running:
            messagebox.showwarning(
                "Pipeline Running",
                "A price refresh or briefing is currently running. "
                "Try again once it finishes.",
            )
            return
        self._restart_self(force=True)

    def _restart_self(self, force=False):
        """Persist active state, syntax-check the freshly-pulled source, and
        re-exec. If the new source has a Python syntax error we abort the
        restart, leave the old process running, and surface the error so the
        user can push a fix from the laptop."""
        if self.is_restarting:
            return
        self.is_restarting = True
        # Try a git pull first so the manual button picks up un-pulled commits.
        # The cron's own pull might not have fired yet on a manual click. We
        # capture stderr separately so a network failure shows up in the UI
        # rather than silently leaving us on stale code.
        try:
            pull = subprocess.run(
                ["git", "-C", REPO_DIR, "pull", "--rebase", "--autostash", "origin", "main"],
                check=False,
                capture_output=True,
                text=True,
            )
            if pull.returncode != 0:
                self.code_sync_label.config(
                    text=f"Code: git pull failed (rc={pull.returncode}) — see log",
                    fg="#c33",
                )
                print(f"[restart] git pull failed:\n{pull.stderr}")
                self.is_restarting = False
                self.root.after(CODE_CHECK_INTERVAL_MS, self._check_for_code_update)
                return
        except Exception as exc:
            self.code_sync_label.config(text=f"Code: git pull error: {exc}", fg="#c33")
            self.is_restarting = False
            self.root.after(CODE_CHECK_INTERVAL_MS, self._check_for_code_update)
            return

        # Syntax-check the (possibly just-pulled) source before we re-exec.
        try:
            py_compile.compile(SCRIPT_PATH, doraise=True)
        except py_compile.PyCompileError as exc:
            self.code_sync_label.config(
                text="Code: new version has a syntax error — staying on current",
                fg="#c33",
            )
            print(f"[restart] py_compile failed:\n{exc}")
            self.is_restarting = False
            self.code_update_pending = False        # don't keep retrying
            self.root.after(CODE_CHECK_INTERVAL_MS, self._check_for_code_update)
            return

        # Persist whatever schedule is active so the restarted process can
        # re-arm cleanly.
        self._persist_state()

        self.code_sync_label.config(text="Code: re-launching with latest version…", fg="#888")
        self.root.update_idletasks()

        # Stop caffeinate before we re-exec (the new process will start its own).
        self._stop_keep_awake()
        if self.refresh_timer is not None:
            self.refresh_timer.cancel()
        if self.digest_timer is not None:
            self.digest_timer.cancel()

        # Re-exec replaces this process image. tkinter teardown is implicit.
        os.execv(sys.executable, [sys.executable] + sys.argv)

    def _persist_state(self):
        """Snapshot the currently-active schedule + UI selections to
        STATE_FILE. _restore_state_if_present picks it up on next launch."""
        state = {
            "scheduled": self.refresh_timer is not None,
            "interval_minutes": self.interval_minutes,
            "run_start_minutes": self.run_start_minutes,
            "run_end_minutes": self.run_end_minutes,
            "window_wraps_midnight": self.window_wraps_midnight,
            "weekdays_only": self.weekdays_only_var.get(),
            "digest_scheduled": self.digest_timer is not None,
            "digest_minutes": self.digest_minutes,
            "skip_fetch": self.skip_fetch_var.get(),
            "auto_restart": self.auto_restart_var.get(),
            "saved_at": datetime.now().isoformat(),
        }
        try:
            with open(STATE_FILE, "w") as f:
                json.dump(state, f, indent=2)
        except OSError as exc:
            print(f"[restart] could not write state file: {exc}")

    def _restore_state_if_present(self):
        """On startup, re-apply the schedule we were running before. Only
        kicks in if STATE_FILE exists and `scheduled: true`. The state file
        is consumed (deleted) after restore so a manual launch always starts
        from a clean slate."""
        if not os.path.exists(STATE_FILE):
            return
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[restart] could not read state file: {exc}")
            return
        try:
            os.remove(STATE_FILE)
        except OSError:
            pass

        self.auto_restart_var.set(bool(state.get("auto_restart", True)))
        self.weekdays_only_var.set(bool(state.get("weekdays_only", True)))
        self.skip_fetch_var.set(bool(state.get("skip_fetch", False)))

        if state.get("scheduled") and state.get("interval_minutes"):
            self.interval_minutes = state["interval_minutes"]
            self.run_start_minutes = state.get("run_start_minutes")
            self.run_end_minutes = state.get("run_end_minutes")
            self.window_wraps_midnight = bool(state.get("window_wraps_midnight"))
            now = datetime.now()
            next_run = self._next_valid_run_time(now, self.interval_minutes, now)
            self._schedule_refresh_at(next_run)
            self.schedule_button.config(state=tk.DISABLED)
            self.update_next_run_label()

        if state.get("digest_scheduled") and state.get("digest_minutes") is not None:
            self.digest_minutes = state["digest_minutes"]
            next_digest = self._next_daily_digest_time(datetime.now())
            self._schedule_digest_at(next_digest)
            self.update_next_digest_label()

        if state.get("scheduled") or state.get("digest_scheduled"):
            saved_at = state.get("saved_at", "—")
            self.code_sync_label.config(
                text=f"Code: re-launched with latest version (state restored from {saved_at[:19]})",
                fg="#0a7",
            )

    def on_close(self):
        self._stop_keep_awake()
        if self.refresh_timer is not None:
            self.refresh_timer.cancel()
            self.refresh_timer = None
        if self.digest_timer is not None:
            self.digest_timer.cancel()
            self.digest_timer = None
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = SchedulerApp(root)
    root.mainloop()
