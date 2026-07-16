#!/usr/bin/env python3
"""Daily Coverage-only Rating Push (professional EOD board).

- Source: genspark finance API ratingRecommendation only (no Qwen)
- Push: single summary to ntfy topic yay-agent
- No-rating symbols excluded from main board (footnote only)
- Trading-day gate for America/New_York
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, date
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

DEFAULT_SYMBOLS = [
    "BABA", "FUN", "AAPL", "AMZN", "SPCX", "NEM", "JNJ", "IBM",
    "ON", "TSLA", "NVDA", "TXN", "CRWV", "INTC",
]

NTFY_TOPIC_DEFAULT = "yay-agent"
FINANCE_URL = "https://www.genspark.ai/api/spark/finance?symbol={symbol}"
USER_AGENT = "daily-rating-push/1.1"

# US market holidays 2026-2027 (NYSE core closures). Extend yearly as needed.
US_MARKET_HOLIDAYS = {
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3),
    date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7),
    date(2026, 11, 26), date(2026, 12, 25),
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26),
    date(2027, 5, 31), date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6),
    date(2027, 11, 25), date(2027, 12, 24),
}


def ny_now() -> datetime:
    if ZoneInfo is None:
        return datetime.utcnow()
    return datetime.now(ZoneInfo("America/New_York"))


def is_us_trading_day(d: date | None = None) -> bool:
    d = d or ny_now().date()
    if d.weekday() >= 5:
        return False
    if d in US_MARKET_HOLIDAYS:
        return False
    return True


def map_signal(rec: str) -> str:
    r = (rec or "").strip().lower()
    if r in ("strong sell", "sell"):
        return "SELL"
    if r in ("strong buy", "buy"):
        return "BUY"
    if r in ("neutral", "hold"):
        return "HOLD"
    return ""


def fmt_px(v: Any) -> str:
    if v is None:
        return "—"
    try:
        return f"{float(v):.2f}"
    except Exception:
        return str(v)


def fmt_chg(v: Any) -> str:
    if v is None:
        return ""
    try:
        x = float(v)
        return f"+{x:.2f}" if x > 0 else f"{x:.2f}"
    except Exception:
        return str(v)


def fetch_one(symbol: str, timeout: float = 25.0) -> dict:
    url = FINANCE_URL.format(symbol=symbol)
    t0 = time.time()
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        outlook = ((payload.get("data") or {}).get("outlook") or {})
        profile = outlook.get("profile") or {}
        rating_list = outlook.get("rating") or []
        rating = rating_list[0] if isinstance(rating_list, list) and rating_list else {}
        rec = rating.get("ratingRecommendation") or ""
        signal = map_signal(rec)
        return {
            "symbol": symbol,
            "ok": True,
            "price": profile.get("price"),
            "change": profile.get("changes"),
            "letter": rating.get("rating") or "",
            "score": rating.get("ratingScore"),
            "recommendation": rec,
            "signal": signal,
            "covered": bool(signal),
            "ms": int((time.time() - t0) * 1000),
            "error": None,
        }
    except Exception as e:
        return {
            "symbol": symbol,
            "ok": False,
            "price": None,
            "change": None,
            "letter": "",
            "score": None,
            "recommendation": "",
            "signal": "",
            "covered": False,
            "ms": int((time.time() - t0) * 1000),
            "error": str(e)[:160],
        }


def line_item(r: dict) -> str:
    letter = (r.get("letter") or "—").strip() or "—"
    px = fmt_px(r.get("price"))
    chg = fmt_chg(r.get("change"))
    chg_part = f"  {chg}" if chg else ""
    return f"  {r['symbol']:<4}  {letter:<2}  {px:>8}{chg_part}"


def build_message(results: list[dict], when: datetime) -> tuple[str, str, dict]:
    covered = [r for r in results if r.get("ok") and r.get("covered")]
    no_cov = [r for r in results if r.get("ok") and not r.get("covered")]
    errs = [r for r in results if not r.get("ok")]

    buy = [r for r in covered if r["signal"] == "BUY"]
    sell = [r for r in covered if r["signal"] == "SELL"]
    hold = [r for r in covered if r["signal"] == "HOLD"]

    buy.sort(key=lambda x: (-(x.get("score") or 0), x["symbol"]))
    sell.sort(key=lambda x: ((x.get("score") or 99), x["symbol"]))
    hold.sort(key=lambda x: x["symbol"])

    day = when.strftime("%b %d")
    asof = when.strftime("%H:%M ET")

    parts: list[str] = []
    parts.append(f"Daily Rating · {day}")
    parts.append(
        f"Coverage {len(covered)} · Buy {len(buy)} · Sell {len(sell)} · Hold {len(hold)}"
    )
    parts.append("────────────────")

    if buy:
        parts.append("BUY")
        parts.extend(line_item(r) for r in buy)
    if sell:
        if buy:
            parts.append("")
        parts.append("SELL")
        parts.extend(line_item(r) for r in sell)
    if hold:
        if buy or sell:
            parts.append("")
        parts.append("HOLD")
        parts.extend(line_item(r) for r in hold)

    if not covered:
        parts.append("No covered names today.")

    parts.append("────────────────")
    if no_cov:
        names = ", ".join(r["symbol"] for r in sorted(no_cov, key=lambda x: x["symbol"]))
        parts.append(f"No coverage: {names}")
    if errs:
        names = ", ".join(r["symbol"] for r in sorted(errs, key=lambda x: x["symbol"]))
        parts.append(f"Fetch error: {names}")
    parts.append(f"Quant rating (DCF/ROE/ROA/D-E/P-E/P-B) · as of {asof}")
    parts.append("Not investment advice")

    body = "\n".join(parts)
    title = f"Daily Rating {day}: {len(buy)} BUY / {len(sell)} SELL / {len(hold)} HOLD"
    stats = {
        "coverage": len(covered),
        "buy": len(buy),
        "sell": len(sell),
        "hold": len(hold),
        "no_coverage": [r["symbol"] for r in no_cov],
        "errors": [r["symbol"] for r in errs],
    }
    return title, body, stats


def ntfy_push(topic: str, title: str, body: str, priority: str = "default") -> dict:
    title_safe = title.encode("latin-1", "ignore").decode("latin-1") or "Daily Rating"
    url = f"https://ntfy.sh/{topic}"
    req = Request(
        url,
        data=body.encode("utf-8"),
        method="POST",
        headers={
            "Title": title_safe,
            "Priority": priority,
            "Tags": "chart_with_upwards_trend,chart_with_downwards_trend",
            "Content-Type": "text/plain; charset=utf-8",
        },
    )
    with urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8", "replace")
        return {"http": resp.status, "body": raw}


def load_symbols(path: str | None) -> list[str]:
    if not path:
        return list(DEFAULT_SYMBOLS)
    p = Path(path)
    text = p.read_text(encoding="utf-8").strip()
    if not text:
        return list(DEFAULT_SYMBOLS)
    parts: list[str] = []
    for line in text.replace(",", "\n").splitlines():
        s = line.strip().upper()
        if s and not s.startswith("#"):
            parts.append(s)
    return parts or list(DEFAULT_SYMBOLS)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Daily coverage-only rating → ntfy")
    ap.add_argument("--symbols-file", default=os.environ.get("DAILY_RATING_SYMBOLS_FILE"))
    ap.add_argument("--topic", default=os.environ.get("NTFY_TOPIC", NTFY_TOPIC_DEFAULT))
    ap.add_argument("--force", action="store_true", help="run even on weekend/holiday")
    ap.add_argument("--dry-run", action="store_true", help="print only, do not push")
    ap.add_argument("--out-dir", default=os.environ.get("DAILY_RATING_OUT", "/tmp/daily_rating_prod"))
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args(argv)

    when = ny_now()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not args.force and not is_us_trading_day(when.date()):
        msg = f"SKIP non-trading day {when.date().isoformat()} ET"
        print(msg)
        (out_dir / "last_skip.txt").write_text(msg + "\n", encoding="utf-8")
        return 0

    symbols = load_symbols(args.symbols_file)
    seen = set()
    symbols = [s for s in symbols if not (s in seen or seen.add(s))]

    results: list[dict] = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        futs = {ex.submit(fetch_one, s): s for s in symbols}
        for fut in as_completed(futs):
            results.append(fut.result())
    order = {s: i for i, s in enumerate(symbols)}
    results.sort(key=lambda r: order.get(r["symbol"], 999))
    total_ms = int((time.time() - t0) * 1000)

    title, body, stats = build_message(results, when)

    artifact = {
        "when_et": when.isoformat(),
        "topic": args.topic,
        "title": title,
        "body": body,
        "stats": stats,
        "total_ms": total_ms,
        "symbols": symbols,
        "results": results,
    }
    (out_dir / "last_run.json").write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "last_message.txt").write_text(body, encoding="utf-8")

    print("TITLE:", title)
    print(body)
    print("STATS:", json.dumps(stats, ensure_ascii=False), "total_ms", total_ms)

    if stats["coverage"] == 0 and stats["errors"]:
        alert_title = "Daily Rating ALERT: fetch failed"
        alert_body = (
            f"Daily Rating failed for all symbols at {when.strftime('%H:%M ET')}\n"
            f"Errors: {', '.join(stats['errors'])}\n"
            f"Not investment advice"
        )
        if args.dry_run:
            print("DRY_RUN_ALERT", alert_title)
            print(alert_body)
            return 2
        resp = ntfy_push(args.topic, alert_title, alert_body, priority="high")
        print("NTFY_ALERT", resp.get("http"), str(resp.get("body"))[:200])
        return 2

    if args.dry_run:
        print("DRY_RUN_OK")
        return 0

    resp = ntfy_push(args.topic, title, body)
    print("NTFY", resp.get("http"), str(resp.get("body"))[:240])
    print("PUSH_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
