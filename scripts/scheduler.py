"""Stock Game scheduler — tkinter desktop app modeled on data_schedule.py.

The app IS the scheduler: it stays open and fires `scripts/cron-update.sh`
on a threading.Timer. While open it runs `caffeinate` so the Mac mini
doesn't sleep between scheduled runs.

Run:
    python3 scripts/scheduler.py
or  npm run scheduler
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
LOG_FILE = "/tmp/stock-game.log"


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

        self.run_lock = threading.Lock()
        self.run_cond = threading.Condition(self.run_lock)
        self.is_running = False
        self.last_run_text = "—"
        self.last_run_ok = None

        self.keep_awake_process = None

        self._create_refresh_section()
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

        # Defaults assume Central Time host (US market hours 9:30am-4:00pm ET = 8:30am-3:00pm CT)
        tk.Label(self.root, text="Run Time Range:").grid(row=3, column=0, padx=5, pady=5)
        self.start_hour_var = tk.StringVar(value="8")
        tk.OptionMenu(self.root, self.start_hour_var, *range(1, 13)).grid(row=3, column=1)
        self.start_minute_var = tk.StringVar(value="30")
        tk.OptionMenu(
            self.root,
            self.start_minute_var,
            *["{:02d}".format(i) for i in range(0, 60, 5)],
        ).grid(row=3, column=2)
        self.start_ampm_var = tk.StringVar(value="AM")
        tk.OptionMenu(self.root, self.start_ampm_var, "AM", "PM").grid(row=3, column=3)

        self.end_hour_var = tk.StringVar(value="3")
        tk.OptionMenu(self.root, self.end_hour_var, *range(1, 13)).grid(row=4, column=1)
        self.end_minute_var = tk.StringVar(value="00")
        tk.OptionMenu(
            self.root,
            self.end_minute_var,
            *["{:02d}".format(i) for i in range(0, 60, 5)],
        ).grid(row=4, column=2)
        self.end_ampm_var = tk.StringVar(value="PM")
        tk.OptionMenu(self.root, self.end_ampm_var, "AM", "PM").grid(row=4, column=3)

    def _create_status_labels(self):
        self.next_run_label = tk.Label(self.root, text="No refresh scheduled.")
        self.next_run_label.grid(row=5, column=0, columnspan=4, padx=5, pady=(10, 2))
        self.last_run_label = tk.Label(self.root, text="Last run: —")
        self.last_run_label.grid(row=6, column=0, columnspan=4, padx=5, pady=2)
        self.repo_label = tk.Label(
            self.root,
            text=f"Script: {REFRESH_SCRIPT}",
            fg="#666",
            font=("", 9),
        )
        self.repo_label.grid(row=7, column=0, columnspan=4, padx=5, pady=(0, 4))

    def _create_buttons(self):
        self.schedule_button = tk.Button(
            self.root, text="Schedule Run", command=self.schedule_task
        )
        self.schedule_button.grid(
            row=8, column=0, columnspan=2, sticky="ew", padx=5, pady=5
        )
        self.run_now_button = tk.Button(
            self.root, text="Run Now", command=self.run_now
        )
        self.run_now_button.grid(
            row=8, column=2, columnspan=2, sticky="ew", padx=5, pady=5
        )

        self.stop_button = tk.Button(self.root, text="Stop", command=self.stop_task)
        self.stop_button.grid(row=9, column=0, columnspan=4, sticky="ew", padx=5, pady=5)

        self.open_log_button = tk.Button(
            self.root, text="Open Log", command=self.open_log
        )
        self.open_log_button.grid(
            row=10, column=0, columnspan=4, sticky="ew", padx=5, pady=(0, 8)
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

            self.update_next_run_label()
            self.schedule_button.config(state=tk.DISABLED)
            print(f"Scheduled refresh at {target_time}.")
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
        if self._wait_and_start():
            try:
                self._run_refresh()
            finally:
                self._finish_run()
        else:
            print("Skipped scheduled refresh: another task held the lock.")

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
        if self.refresh_timer is None:
            messagebox.showwarning("No Schedule", "No refresh is currently scheduled.")
            return
        self.refresh_timer.cancel()
        self.refresh_timer = None
        self.refresh_scheduled_time = None
        self.interval_minutes = None
        self.run_start_minutes = None
        self.run_end_minutes = None
        self.window_wraps_midnight = False
        self.update_next_run_label()
        self.schedule_button.config(state=tk.NORMAL)
        messagebox.showinfo("Stopped", "Scheduled refresh stopped.")

    def run_now(self):
        if not self._try_start_run():
            messagebox.showwarning("Task Running", "A task is already running.")
            return
        threading.Thread(target=self._run_with_guard, daemon=True).start()

    # ---------------- RUNNERS ----------------
    def _run_with_guard(self):
        try:
            self._run_refresh()
        finally:
            self._finish_run()

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
                return start_today
            return start_today + timedelta(days=1)
        if current_minutes < self.run_start_minutes:
            return start_today
        return start_today + timedelta(days=1)

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

    def _try_start_run(self):
        with self.run_lock:
            if self.is_running:
                return False
            self.is_running = True
            return True

    def _wait_and_start(self, timeout_seconds=6 * 3600):
        deadline = time.monotonic() + timeout_seconds
        with self.run_cond:
            while self.is_running:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self.run_cond.wait(timeout=remaining)
            self.is_running = True
            return True

    def _finish_run(self):
        with self.run_cond:
            self.is_running = False
            self.run_cond.notify_all()

    def _on_main_thread(self, func, *args, **kwargs):
        self.root.after(0, lambda: func(*args, **kwargs))

    def _maybe_reenable_schedule_button(self):
        if self.refresh_timer is None:
            self.schedule_button.config(state=tk.NORMAL)

    def update_next_run_label(self):
        if self.refresh_scheduled_time:
            self.next_run_label.config(
                text=f"Next refresh: {self.refresh_scheduled_time.strftime('%Y-%m-%d %I:%M %p')}"
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
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = SchedulerApp(root)
    root.mainloop()
