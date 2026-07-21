#!/usr/bin/env python3
"""Validate config/roster.json before committing it.

Run with no args:
    python3 scripts/validate-roster.py

What it checks (in priority order — first failure exits with rc=2):
  1. The JSON parses.
  2. Required top-level keys exist with the right types.
  3. start_date is YYYY-MM-DD.
  4. starting_dollars is a positive number.
  5. baseline has the right shape + non-empty ticker.
  6. users is a non-empty list; each user has id/name/color/color_rgb/
     tickers; each id is unique; ticker symbols are non-empty uppercase
     strings; each user has at least one ticker.
  7. ticker_names is a dict of uppercase ticker → non-empty display name,
     and EVERY ticker referenced by users (+ baseline.ticker) has a
     ticker_names entry (so the UI never shows a raw symbol).
  8. Color strings look like a valid #RRGGBB hex code.

This is a fast sanity check, not a comprehensive lint — its job is to
catch the typo / missing-comma / typo'd-key class of mistakes that would
otherwise break the Vercel build or the Mac mini's next digest run after
a roster push.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ROSTER_FILE = REPO_ROOT / "config" / "roster.json"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")


def fail(msg: str) -> None:
    print(f"❌ roster.json: {msg}", file=sys.stderr)
    sys.exit(2)


def require(cond: bool, msg: str) -> None:
    if not cond:
        fail(msg)


def main() -> None:
    if not ROSTER_FILE.exists():
        fail(f"file not found at {ROSTER_FILE}")
    try:
        roster = json.loads(ROSTER_FILE.read_text())
    except json.JSONDecodeError as e:
        fail(f"JSON parse error: {e}")

    require(isinstance(roster, dict), "top-level must be an object")
    for key in ("start_date", "starting_dollars", "baseline", "users", "ticker_names"):
        require(key in roster, f"missing top-level key '{key}'")

    require(
        isinstance(roster["start_date"], str) and DATE_RE.match(roster["start_date"]),
        "start_date must be YYYY-MM-DD",
    )
    sd = roster["starting_dollars"]
    require(
        isinstance(sd, (int, float)) and sd > 0,
        "starting_dollars must be a positive number",
    )

    b = roster["baseline"]
    require(isinstance(b, dict), "baseline must be an object")
    for k in ("id", "name", "color", "color_rgb", "ticker"):
        require(k in b and isinstance(b[k], str) and b[k].strip(),
                f"baseline.{k} must be a non-empty string")
    require(HEX_RE.match(b["color"]), f"baseline.color {b['color']!r} not a #RRGGBB hex code")
    require(
        TICKER_RE.match(b["ticker"]),
        f"baseline.ticker {b['ticker']!r} must be an uppercase symbol",
    )

    users = roster["users"]
    require(isinstance(users, list) and users, "users must be a non-empty array")
    seen_ids: set[str] = set()
    referenced_tickers: set[str] = set()
    for i, u in enumerate(users):
        require(isinstance(u, dict), f"users[{i}] must be an object")
        for k in ("id", "name", "color", "color_rgb", "tickers"):
            require(k in u, f"users[{i}] missing '{k}'")
        uid = u["id"]
        require(
            isinstance(uid, str) and uid.strip() and uid == uid.lower() and " " not in uid,
            f"users[{i}].id {uid!r} must be a non-empty lowercase identifier with no spaces",
        )
        require(uid not in seen_ids, f"duplicate user id {uid!r}")
        seen_ids.add(uid)
        require(isinstance(u["name"], str) and u["name"].strip(),
                f"users[{i}].name must be a non-empty string")
        require(HEX_RE.match(u["color"]),
                f"users[{i}].color {u['color']!r} not a #RRGGBB hex code")
        if "color_p3" in u:
            require(isinstance(u["color_p3"], str)
                    and u["color_p3"].startswith("color(display-p3 ")
                    and u["color_p3"].endswith(")"),
                    f"users[{i}].color_p3 {u.get('color_p3')!r} must be a "
                    f"'color(display-p3 R G B)' CSS string")
        require(isinstance(u["tickers"], list) and u["tickers"],
                f"users[{i}].tickers must be a non-empty array")
        for t in u["tickers"]:
            require(isinstance(t, str), f"users[{i}].tickers contains a non-string entry")
            require(TICKER_RE.match(t),
                    f"users[{i}].tickers contains invalid symbol {t!r} (must be uppercase, 1-10 chars)")
            referenced_tickers.add(t)

    referenced_tickers.add(b["ticker"])

    tn = roster["ticker_names"]
    require(isinstance(tn, dict), "ticker_names must be an object")
    for t, n in tn.items():
        require(TICKER_RE.match(t),
                f"ticker_names key {t!r} must be an uppercase symbol")
        require(isinstance(n, str) and n.strip(),
                f"ticker_names[{t}] must be a non-empty string")
    missing = sorted(referenced_tickers - set(tn.keys()))
    require(not missing,
            f"the following tickers are owned by a player or baseline but missing from ticker_names: {missing}")

    print(
        f"✅ roster.json OK — {len(users)} user(s), "
        f"{len(referenced_tickers)} unique ticker(s), "
        f"baseline={b['ticker']} ({b['name']})"
    )


if __name__ == "__main__":
    main()
