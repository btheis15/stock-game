"""Stock Game scheduler — tkinter desktop app modeled on data_schedule.py.

The app IS the scheduler: it stays open and fires `scripts/cron-update.sh`
on a threading.Timer. While open it runs `caffeinate` so the Mac mini
doesn't sleep between scheduled runs.

Run:
    python3 scripts/stockgame_schedule.py
or  npm run stockgame
"""

import os
import shutil
import subprocess
import threading
import time
import tkinter as tk
from datetime import datetime, timedelta
from tkinter import messagebox

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFRESH_SCRIPT = os.path.join(REPO_DIR, "scripts", "cron-update.sh")
DIGEST_SCRIPT = os.path.join(REPO_DIR, "scripts", "digest-update.sh")
LOG_FILE = "/tmp/stock-game.log"

# Mon=0 ... Sun=6
WEEKEND = {5, 6}
SATURDAY = 5
SUNDAY = 6


class SchedulerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Stock Game Scheduler")
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

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

        self.keep_awake_process = None

        self._create_refresh_section()
        self._create_digest_section()
        self._create_status_labels()
        self._create_buttons()
        self._start_keep_awake()

    # ---------------- UI ----------------
    def _create_refresh_section(self):
        tk.Label(
            self.root,
            text="Stock Game refresh + deploy",
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
            text="Daily AI briefings (digests)",
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

        tk.Label(
            self.root,
            text=(
                "Mon–Fri fires the daily briefing (1D + 1W holdings/portfolios, "
                "all game windows). Saturday fires the weekly slow tier (1M/3M/1Y/ALL "
                "holdings/portfolios, no RSS). Sunday skips. Independent of the 15-min "
                "stock refresh — both can run concurrently."
            ),
            fg="#666",
            font=("", 9),
            wraplength=400,
            justify="left",
        ).grid(row=8, column=0, columnspan=4, padx=5, pady=(0, 4), sticky="w")

        # When checked, skip the slow RSS fetch + Stage-2 AI scoring step
        # and just regenerate digests from the existing article archive.
        # Cuts a full ~10-15 min run to ~8 min and avoids ~150-300 Apple
        # Intelligence relevance-scoring calls. The trade-off: today's
        # newest headlines aren't pulled in, so digests reflect yesterday's
        # archive. Useful for a quick refresh of digest prose after a code
        # change without burning the full pipeline.
        self.skip_fetch_var = tk.BooleanVar(value=False)
        tk.Checkbutton(
            self.root,
            text="Skip article fetch (regenerate digests from existing archive — faster)",
            variable=self.skip_fetch_var,
            wraplength=380,
            justify="left",
        ).grid(row=8, column=0, columnspan=4, padx=5, pady=(20, 4), sticky="w")

    def _create_status_labels(self):
        self.next_run_label = tk.Label(self.root, text="No refresh scheduled.")
        self.next_run_label.grid(row=9, column=0, columnspan=4, padx=5, pady=(10, 2))
        self.last_run_label = tk.Label(self.root, text="Last run: —")
        self.last_run_label.grid(row=10, column=0, columnspan=4, padx=5, pady=2)
        self.next_digest_label = tk.Label(self.root, text="No briefing scheduled.")
        self.next_digest_label.grid(row=11, column=0, columnspan=4, padx=5, pady=(8, 2))
        self.last_digest_label = tk.Label(self.root, text="Last briefing: —")
        self.last_digest_label.grid(row=12, column=0, columnspan=4, padx=5, pady=2)
        self.repo_label = tk.Label(
            self.root,
            text=f"Script: {REFRESH_SCRIPT}",
            fg="#666",
            font=("", 9),
        )
        self.repo_label.grid(row=13, column=0, columnspan=4, padx=5, pady=(0, 4))

    def _create_buttons(self):
        self.schedule_button = tk.Button(
            self.root, text="Schedule Run", command=self.schedule_task
        )
        self.schedule_button.grid(
            row=14, column=0, columnspan=2, sticky="ew", padx=5, pady=5
        )
        self.run_now_button = tk.Button(
            self.root, text="Run Now", command=self.run_now
        )
        self.run_now_button.grid(
            row=14, column=2, columnspan=2, sticky="ew", padx=5, pady=5
        )

        self.stop_button = tk.Button(self.root, text="Stop", command=self.stop_task)
        self.stop_button.grid(row=15, column=0, columnspan=4, sticky="ew", padx=5, pady=5)

        self.run_digest_button = tk.Button(
            self.root, text="Run Briefing Now", command=self.run_digest_now
        )
        self.run_digest_button.grid(
            row=16, column=0, columnspan=4, sticky="ew", padx=5, pady=(0, 5)
        )

        self.open_log_button = tk.Button(
            self.root, text="Open Log", command=self.open_log
        )
        self.open_log_button.grid(
            row=17, column=0, columnspan=4, sticky="ew", padx=5, pady=(0, 8)
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

    def run_digest_now(self):
        if not self._try_start_digest():
            messagebox.showwarning(
                "Briefing Running",
                "The daily briefing is already running.",
            )
            return
        threading.Thread(target=self._run_digest_with_guard, daemon=True).start()

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

    def _run_digest_with_guard(self):
        try:
            self._run_digest()
        finally:
            self._finish_digest()

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
                fg="#666",
            )
            # Pass scope + mode through env — digest-update.sh reads both and
            # picks the right --scope / --digests-only flags for digest.swift.
            env = os.environ.copy()
            env["DIGEST_MODE"] = mode
            env["DIGEST_SCOPE"] = scope
            result = subprocess.run(["bash", DIGEST_SCRIPT], check=False, env=env)
            finish_time = datetime.now().strftime("%m/%d/%Y %-I:%M%p")
            if result.returncode == 0:
                self.last_digest_ok = True
                self.last_digest_text = f"Last briefing: {finish_time} ✓"
                print(f"Briefing completed at {finish_time}.")
            else:
                self.last_digest_ok = False
                self.last_digest_text = (
                    f"Last briefing failed: {finish_time} (exit {result.returncode})"
                )
                print(self.last_digest_text)
            self._on_main_thread(
                self.last_digest_label.config,
                text=self.last_digest_text,
                fg="#0a7" if self.last_digest_ok else "#c33",
            )
        except Exception as e:
            self.last_digest_text = f"Briefing error: {e}"
            print(self.last_digest_text)
            self._on_main_thread(
                self.last_digest_label.config, text=self.last_digest_text, fg="#c33"
            )

    def update_next_digest_label(self):
        if self.digest_scheduled_time:
            self.next_digest_label.config(
                text=f"Next briefing: {self.digest_scheduled_time.strftime('%a %Y-%m-%d %I:%M %p')}"
            )
        else:
            self.next_digest_label.config(text="No briefing scheduled.")

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
