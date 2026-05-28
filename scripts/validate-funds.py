#!/usr/bin/env python3
"""Validate config/funds.json before committing it.

Run with no args:
    python3 scripts/validate-funds.py

Mirrors scripts/validate-roster.py — a fast, dependency-free schema check
runnable locally before push or from the pre-commit hook. The same
validation runs server-side in lib/funds.ts's validateFund() before any
GitHub commit; this script exists so commits authored by hand (or by an
AI session like this one) get the same gate.

Catches the typo / lowercase-ticker / weights-don't-sum class of mistake
that would otherwise crash the Vercel build or leave the file in a state
that confuses the Mac mini's digest pipeline.
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FUNDS_FILE = REPO_ROOT / "config" / "funds.json"

TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
# Match lib/funds.ts: weights sum to 1.0 ± 0.5 basis points (slack for the
# 0.001-step UI which can produce 0.999 / 1.001 from rounding).
WEIGHT_TOLERANCE = 0.00005
MIN_WEIGHT = 0.001


def fail(msg: str) -> None:
    print(f"❌ funds.json: {msg}", file=sys.stderr)
    sys.exit(2)


def require(cond: bool, msg: str) -> None:
    if not cond:
        fail(msg)


def is_iso_timestamp(s) -> bool:
    if not isinstance(s, str):
        return False
    try:
        # Accept the Z suffix Node emits as well as +offset forms.
        datetime.fromisoformat(s.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def main() -> None:
    if not FUNDS_FILE.exists():
        fail(f"file not found at {FUNDS_FILE}")
    try:
        data = json.loads(FUNDS_FILE.read_text())
    except json.JSONDecodeError as e:
        fail(f"JSON parse error: {e}")

    require(isinstance(data, dict), "top-level must be an object")
    require("funds" in data, "missing top-level key 'funds'")
    funds = data["funds"]
    require(isinstance(funds, list), "funds must be an array")

    seen_ids: set[str] = set()
    active_count = 0
    archived_count = 0
    for i, f in enumerate(funds):
        prefix = f"funds[{i}]"
        require(isinstance(f, dict), f"{prefix} must be an object")
        for k in ("id", "name", "creator", "color", "createdAt", "updatedAt", "deletedAt", "holdings"):
            require(k in f, f"{prefix} missing '{k}'")

        fid = f["id"]
        require(isinstance(fid, str) and fid.strip(), f"{prefix}.id must be a non-empty string")
        require(fid not in seen_ids, f"duplicate fund id {fid!r}")
        seen_ids.add(fid)

        require(isinstance(f["name"], str) and f["name"].strip(),
                f"{prefix}.name must be a non-empty string")

        if f["creator"] is not None:
            require(isinstance(f["creator"], str), f"{prefix}.creator must be a string or null")

        require(isinstance(f["color"], str) and HEX_RE.match(f["color"]),
                f"{prefix}.color {f['color']!r} not a #RRGGBB hex code")

        require(is_iso_timestamp(f["createdAt"]),
                f"{prefix}.createdAt must be a valid ISO timestamp")
        require(is_iso_timestamp(f["updatedAt"]),
                f"{prefix}.updatedAt must be a valid ISO timestamp")
        if f["deletedAt"] is not None:
            require(is_iso_timestamp(f["deletedAt"]),
                    f"{prefix}.deletedAt must be null or a valid ISO timestamp")
            archived_count += 1
        else:
            active_count += 1

        holdings = f["holdings"]
        require(isinstance(holdings, list) and holdings,
                f"{prefix}.holdings must be a non-empty array")
        seen_tickers: set[str] = set()
        weight_sum = 0.0
        for j, h in enumerate(holdings):
            hprefix = f"{prefix}.holdings[{j}]"
            require(isinstance(h, dict), f"{hprefix} must be an object")
            require("ticker" in h and "weight" in h,
                    f"{hprefix} must have 'ticker' and 'weight'")
            t = h["ticker"]
            w = h["weight"]
            require(isinstance(t, str) and TICKER_RE.match(t),
                    f"{hprefix}.ticker {t!r} must be an uppercase symbol")
            require(t not in seen_tickers,
                    f"{hprefix}.ticker {t!r} appears more than once in this fund")
            seen_tickers.add(t)
            require(isinstance(w, (int, float)) and MIN_WEIGHT <= w <= 1,
                    f"{hprefix}.weight {w} must be in [{MIN_WEIGHT}, 1]")
            weight_sum += w
        diff_bp = (weight_sum - 1) * 10000
        require(
            abs(weight_sum - 1) <= WEIGHT_TOLERANCE,
            f"{prefix}.holdings weights must sum to 1.0 (got {weight_sum:.6f}, off by {diff_bp:.1f} bp)",
        )

    print(
        f"✅ funds.json OK — {active_count} active, {archived_count} archived, "
        f"{len(funds)} total"
    )


if __name__ == "__main__":
    main()
