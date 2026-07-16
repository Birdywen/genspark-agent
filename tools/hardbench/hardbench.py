#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local-Qwen HardBench — real eval harness for omega/local-qwen.

Features:
- Talks to Ollama chat API through local tunnel (127.0.0.1:11434)
- Handles Qwen3.6 thinking-only empty content by extracting final answer from thinking
- Objective graders for logic / CRT / rates / probability / JSON suite / code bugs
- Writes machine-readable JSON + shareable Markdown report
- Nonzero exit if connectivity fails; always writes artifacts
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

DEFAULT_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_MODEL = "qwen3.6:35b-a3b"


@dataclass
class ItemResult:
    id: str
    title: str
    ok: bool
    expected: str
    got: str
    raw_content: str
    raw_thinking_tail: str
    latency_ms: int
    done_reason: str
    eval_count: int | None
    notes: str = ""


def http_json(url: str, payload: dict, timeout: float) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def extract_json_blob(text: str) -> Optional[dict]:
    if not text:
        return None
    # fenced
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
    if m:
        cand = m.group(1).strip()
        try:
            return json.loads(cand)
        except Exception:
            pass
    # balanced-ish outermost object
    starts = [i for i, ch in enumerate(text) if ch == "{"]
    for i in starts:
        depth = 0
        for j in range(i, len(text)):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    blob = text[i : j + 1]
                    try:
                        return json.loads(blob)
                    except Exception:
                        break
    return None


def first_line(text: str) -> str:
    return (text or "").strip().splitlines()[0].strip() if (text or "").strip() else ""


def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def extract_answer(content: str, thinking: str, kind: str) -> str:
    """Prefer content; fall back to thinking for thinking-models that emit empty content."""
    c = (content or "").strip()
    t = (thinking or "").strip()

    if kind == "json":
        obj = extract_json_blob(c) or extract_json_blob(t)
        if obj is not None:
            return json.dumps(obj, ensure_ascii=False, sort_keys=True)
        return c or t[-2000:]

    if kind == "rank":
        # five letters
        for src in (c, t):
            m = re.search(r"\b([ABCDE](?:\s+[ABCDE]){4})\b", src.upper())
            if m:
                return normalize_ws(m.group(1).upper())
        return normalize_ws(first_line(c) or first_line(t)).upper()

    if kind == "number":
        for src in (c, t):
            # prefer fraction then decimal
            m = re.search(r"\b\d+\s*/\s*\d+\b", src)
            if m:
                a, b = m.group(0).split("/")
                return f"{int(a.strip())}/{int(b.strip())}"
            m = re.search(r"(?<!\d)(\d+\.\d+|\d+)(?!\d)", src)
            if m:
                return m.group(1)
        return first_line(c) or first_line(t)

    if kind == "bugs":
        src = c if c else t
        # keep last BUGS/FIX block if present
        m = re.search(r"BUGS:\s*(.*?)(?:\nFIX:\s*(.*))?(?:\n\n|$)", src, re.I | re.S)
        if m:
            bugs = normalize_ws(m.group(1))
            fix = normalize_ws(m.group(2) or "")
            return f"BUGS: {bugs}\nFIX: {fix}"
        return src.strip()[-1500:]

    return c or t[-1500:]


def grade_rank(got: str, expected: str) -> tuple[bool, str]:
    g = normalize_ws(got).upper()
    e = normalize_ws(expected).upper()
    return (g == e, f"got={g!r} expected={e!r}")


def grade_number(got: str, expected: str) -> tuple[bool, str]:
    g = normalize_ws(got)
    e = normalize_ws(expected)
    # exact string or numeric equivalence
    if g == e:
        return True, "exact"
    try:
        def to_f(x: str) -> float:
            if "/" in x:
                a, b = x.split("/", 1)
                return float(a) / float(b)
            return float(x)
        if abs(to_f(g) - to_f(e)) < 1e-9:
            return True, "numeric-eq"
    except Exception:
        pass
    return False, f"got={g!r} expected={e!r}"


def grade_fraction(got: str, expected: str) -> tuple[bool, str]:
    g = normalize_ws(got).replace(" ", "")
    e = normalize_ws(expected).replace(" ", "")
    if g == e:
        return True, "exact"
    try:
        def frac(x: str) -> tuple[int, int]:
            a, b = x.split("/")
            return int(a), int(b)
        ga, gb = frac(g)
        ea, eb = frac(e)
        if ga * eb == ea * gb:
            return True, "equiv-fraction"
    except Exception:
        pass
    return False, f"got={g!r} expected={e!r}"


def grade_json_suite(got: str) -> tuple[bool, str]:
    obj = None
    try:
        obj = json.loads(got)
    except Exception:
        obj = extract_json_blob(got)
    if not isinstance(obj, dict):
        return False, "not-json"
    need = {"q1", "q2", "q3", "q4"}
    if set(obj.keys()) != need:
        return False, f"keys={sorted(obj.keys())}"
    notes = []
    ok = True

    def ans(q):
        v = obj.get(q, {})
        if not isinstance(v, dict):
            return None
        return v.get("answer")

    a1 = str(ans("q1")).strip().lower()
    if a1 not in {"no", "n", "false"}:
        ok = False
        notes.append(f"q1 want no got {a1!r}")
    else:
        notes.append("q1 ok")

    try:
        a2 = int(ans("q2"))
        if a2 != 2:
            ok = False
            notes.append(f"q2 want 2 got {a2}")
        else:
            notes.append("q2 ok")
    except Exception:
        ok = False
        notes.append("q2 not int")

    a3 = str(ans("q3") or "")
    hanzi = len(re.findall(r"[\u4e00-\u9fff]", a3))
    if hanzi == 0 or hanzi > 18:
        ok = False
        notes.append(f"q3 hanzi={hanzi} out of 1..18")
    else:
        # soft semantic: must mention speed/cost/risk-ish keywords
        if not any(k in a3 for k in ("快", "速", "贵", "成本", "价", "风险", "维护")):
            ok = False
            notes.append("q3 missing core semantics")
        else:
            notes.append(f"q3 ok hanzi={hanzi}")

    try:
        a4 = int(ans("q4"))
        if a4 != 206:
            ok = False
            notes.append(f"q4 want 206 got {a4}")
        else:
            notes.append("q4 ok")
    except Exception:
        ok = False
        notes.append("q4 not int")

    return ok, "; ".join(notes)


def grade_bugs(got: str) -> tuple[bool, str]:
    g = got.lower()
    checks = []
    # sort returns None / in-place
    c1 = ("none" in g or "inplace" in g or "in-place" in g or "返回none" in got.lower() or "返回 none" in got.lower() or "sort()" in g)
    # off-by-one / k-1
    c2 = ("k-1" in g or "k - 1" in g or "从0" in got or "0-based" in g or "0 based" in g or "下标" in got)
    # fix mentions sorted or equivalent
    c3 = ("sorted(" in g or "sorted(arr)" in g or "arr.copy" in g or "copy()" in g or "[:]" in g)
    ok = c1 and c2
    checks.append(f"none/sort={c1}")
    checks.append(f"index={c2}")
    checks.append(f"fix_hint={c3}")
    return ok, ", ".join(checks)


CASES: list[dict[str, Any]] = [
    {
        "id": "H1",
        "title": "六约束逻辑排序",
        "kind": "rank",
        "expected": "B A C E D",
        "grader": grade_rank,
        "system": "封闭评测。严格检查逻辑。按要求格式输出，不要多余客套。",
        "prompt": (
            "五个学生 A B C D E 考试排名1到5无并列(1=最好)。已知:\n"
            "(1) A不是第一也不是最后\n(2) B比C名次靠前\n(3) D的名次紧挨在E后面\n"
            "(4) C比D名次靠前\n(5) A比B名次靠后\n(6) A比C名次靠前\n"
            "求五人从第1到第5的排名。只回复5个字母用空格分隔,格式如 X X X X X,不要任何解释。"
        ),
        "num_predict": 2048,
    },
    {
        "id": "H2",
        "title": "认知反射 CRT 球棒球",
        "kind": "number",
        "expected": "0.05",
        "grader": grade_number,
        "system": "封闭评测。只输出最终答案，不要过程。",
        "prompt": "球棒和球共1.10元，球棒比球贵1.00元。球多少钱？只回复数字（元），可带小数，不要单位和解释。",
        "num_predict": 1024,
    },
    {
        "id": "H3",
        "title": "多阶段水池速率",
        "kind": "number",
        "expected": "8.5",
        "grader": grade_number,
        "system": "封闭评测。只输出最终数字答案。",
        "prompt": (
            "一个水池有进水管A、B和出水管C。A单独注满要6小时，B单独注满要8小时，C单独排空要12小时。"
            "三管同时开，2小时后关掉A，再过1小时关掉B，只开C。问从开始到池空总共多少小时？"
            "若结果是分数用最简假分数或小数。只回复一个数，不要单位和解释。"
        ),
        "num_predict": 3072,
    },
    {
        "id": "H4",
        "title": "周二男孩条件概率",
        "kind": "number",
        "expected": "13/27",
        "grader": grade_fraction,
        "system": "封闭评测。严格检查概率样本空间。只回复最简分数。",
        "prompt": (
            "随机家庭有两个孩子，性别独立等概率，星期几出生独立等概率(7天)。"
            "已知至少有一个是星期二出生的男孩。两个都是男孩的条件概率是多少？只回复最简分数，不要解释。"
        ),
        "num_predict": 4096,
    },
    {
        "id": "H5",
        "title": "严格JSON综合四问",
        "kind": "json",
        "expected": "q1=no;q2=2;q3<=18hanzi;q4=206",
        "grader": lambda got, expected=None: grade_json_suite(got),
        "system": "封闭评测。最终正文必须是合法JSON对象，不要Markdown围栏，不要前后说明。",
        "prompt": (
            "返回JSON对象，顶层键只能是 q1,q2,q3,q4。每项必须含 answer, confidence(0到1数字)。\n"
            "Q1: 所有玫瑰都是花，部分花会快速凋谢。能否必然推出部分玫瑰会快速凋谢？answer用 yes/no。\n"
            "Q2: 8枚外观相同硬币1枚较轻，无砝码天平，最少称几次一定找出轻币？answer用整数。\n"
            "Q3: 把句子「虽然方案A更快，但它更贵，而且长期维护风险尚未验证」改写成不超过18个汉字、语义完整且中性的中文。answer为改写后字符串。\n"
            "Q4: 计算 (2^10 - 24) / 5 + 3! 的值。answer为整数。"
        ),
        "num_predict": 8192,
    },
    {
        "id": "H6",
        "title": "Python kth_smallest bug审查",
        "kind": "bugs",
        "expected": "sort_none + off_by_one",
        "grader": lambda got, expected=None: grade_bugs(got),
        "system": "封闭评测。你是严格代码审查员。",
        "prompt": (
            "下面Python函数意图：返回列表中第k小的元素(k从1开始)。指出会导致错误的所有问题；"
            "若有多个用分号分隔的短句。最后一行单独给出正确实现的一行核心表达式或算法名。\n\n"
            "```python\ndef kth_smallest(arr, k):\n    arr = arr.sort()\n    return arr[k]\n```\n\n"
            "输出格式：\nBUGS: ...\nFIX: ..."
        ),
        "num_predict": 3072,
    },
]


def ask(url: str, model: str, system: str, prompt: str, num_predict: int, timeout: float, temperature: float = 0.0) -> dict:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "options": {
            "temperature": temperature,
            "top_p": 0.95,
            "num_predict": num_predict,
        },
    }
    t0 = time.time()
    data = http_json(url, payload, timeout=timeout)
    latency_ms = int((time.time() - t0) * 1000)
    msg = data.get("message") or {}
    return {
        "content": msg.get("content") or "",
        "thinking": msg.get("thinking") or "",
        "done_reason": data.get("done_reason") or "",
        "eval_count": data.get("eval_count"),
        "model": data.get("model") or model,
        "latency_ms": latency_ms,
        "raw": data,
    }


def probe(url: str, model: str, timeout: float = 20.0) -> dict:
    tags_url = url.replace("/api/chat", "/api/tags")
    req = urllib.request.Request(tags_url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        tags = json.loads(resp.read().decode("utf-8"))
    names = [m.get("name") for m in tags.get("models", [])]
    return {"ok": True, "models": names, "wanted": model, "present": model in names}


def run_bench(args: argparse.Namespace) -> int:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    results: list[ItemResult] = []

    try:
        p = probe(args.url, args.model)
    except Exception as e:
        report = {
            "success": False,
            "error": f"probe failed: {e}",
            "url": args.url,
            "model": args.model,
            "ts": ts,
        }
        (out_dir / f"hardbench-{ts}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    print(f"[HardBench] model={args.model} url={args.url} models_available={p.get('models')}", flush=True)

    for case in CASES:
        if args.only and case["id"] not in args.only:
            continue
        print(f"[HardBench] running {case['id']} {case['title']} ...", flush=True)
        try:
            resp = ask(
                args.url,
                args.model,
                case["system"],
                case["prompt"],
                num_predict=int(case.get("num_predict") or args.num_predict),
                timeout=args.timeout,
                temperature=args.temperature,
            )
            got = extract_answer(resp["content"], resp["thinking"], case["kind"])
            grader: Callable = case["grader"]
            # graders have two shapes
            try:
                ok, notes = grader(got, case.get("expected"))
            except TypeError:
                ok, notes = grader(got)
            item = ItemResult(
                id=case["id"],
                title=case["title"],
                ok=bool(ok),
                expected=str(case.get("expected")),
                got=got[:2000],
                raw_content=(resp["content"] or "")[:2000],
                raw_thinking_tail=(resp["thinking"] or "")[-1500:],
                latency_ms=resp["latency_ms"],
                done_reason=str(resp.get("done_reason") or ""),
                eval_count=resp.get("eval_count"),
                notes=str(notes),
            )
        except Exception as e:
            item = ItemResult(
                id=case["id"],
                title=case["title"],
                ok=False,
                expected=str(case.get("expected")),
                got="",
                raw_content="",
                raw_thinking_tail="",
                latency_ms=0,
                done_reason="error",
                eval_count=None,
                notes=f"exception: {e}",
            )
        results.append(item)
        print(f"[HardBench] {item.id} -> {'PASS' if item.ok else 'FAIL'} ({item.latency_ms}ms) {item.notes}", flush=True)

    passed = sum(1 for r in results if r.ok)
    total = len(results)
    summary = {
        "success": True,
        "ts": ts,
        "model": args.model,
        "url": args.url,
        "passed": passed,
        "total": total,
        "score": f"{passed}/{total}",
        "pass_rate": (passed / total) if total else 0.0,
        "probe": p,
        "results": [asdict(r) for r in results],
    }

    json_path = out_dir / f"hardbench-{ts}.json"
    md_path = out_dir / f"hardbench-{ts}.md"
    latest_json = out_dir / "latest.json"
    latest_md = out_dir / "latest.md"

    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    latest_json.write_text(json_path.read_text(encoding="utf-8"), encoding="utf-8")

    lines = []
    lines.append(f"# Local Qwen HardBench Report")
    lines.append("")
    lines.append(f"- **UTC**: {ts}")
    lines.append(f"- **Model**: `{args.model}`")
    lines.append(f"- **Endpoint**: `{args.url}`")
    lines.append(f"- **Score**: **{passed}/{total}** ({summary['pass_rate']:.0%})")
    lines.append("")
    lines.append("| ID | Title | Result | Latency | Notes |")
    lines.append("|----|-------|--------|---------|-------|")
    for r in results:
        flag = "✅ PASS" if r.ok else "❌ FAIL"
        notes = (r.notes or "").replace("|", "\\|")
        lines.append(f"| {r.id} | {r.title} | {flag} | {r.latency_ms}ms | {notes} |")
    lines.append("")
    lines.append("## Answers")
    for r in results:
        lines.append(f"### {r.id} {r.title}")
        lines.append(f"- expected: `{r.expected}`")
        lines.append(f"- got: `{r.got}`")
        lines.append(f"- done_reason: `{r.done_reason}` eval_count: `{r.eval_count}`")
        if not (r.raw_content or "").strip():
            lines.append("- note: empty content; answer extracted from thinking fallback")
        lines.append("")
    lines.append("## One-liner")
    lines.append("")
    if passed == total and total > 0:
        lines.append("> Local Qwen 35B cleared HardBench objective suite. Not a toy.")
    else:
        lines.append(f"> Local Qwen 35B scored {passed}/{total} on HardBench. See failures above.")
    lines.append("")

    md = "\n".join(lines)
    md_path.write_text(md, encoding="utf-8")
    latest_md.write_text(md, encoding="utf-8")

    print("\n" + md, flush=True)
    print(f"\n[HardBench] wrote {json_path}", flush=True)
    print(f"[HardBench] wrote {md_path}", flush=True)
    return 0 if passed == total and total > 0 else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Local-Qwen HardBench")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "out"))
    ap.add_argument("--timeout", type=float, default=420.0)
    ap.add_argument("--num-predict", type=int, default=4096)
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--only", nargs="*", help="optional subset like H1 H5")
    args = ap.parse_args(argv)
    return run_bench(args)


if __name__ == "__main__":
    sys.exit(main())
