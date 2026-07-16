# Local Qwen HardBench Report

- **UTC**: 20260715T191311Z
- **Model**: `qwen3.6:35b-a3b`
- **Endpoint**: `http://127.0.0.1:11434/api/chat`
- **Score**: **0/6** (0%)

| ID | Title | Result | Latency | Notes |
|----|-------|--------|---------|-------|
| H1 | 六约束逻辑排序 | ❌ FAIL | 0ms | exception: Remote end closed connection without response |
| H2 | 认知反射 CRT 球棒球 | ❌ FAIL | 0ms | exception: Remote end closed connection without response |
| H3 | 多阶段水池速率 | ❌ FAIL | 0ms | exception: Remote end closed connection without response |
| H4 | 周二男孩条件概率 | ❌ FAIL | 0ms | exception: Remote end closed connection without response |
| H5 | 严格JSON综合四问 | ❌ FAIL | 0ms | exception: Remote end closed connection without response |
| H6 | Python kth_smallest bug审查 | ❌ FAIL | 0ms | exception: Remote end closed connection without response |

## Answers
### H1 六约束逻辑排序
- expected: `B A C E D`
- got: ``
- done_reason: `error` eval_count: `None`
- note: empty content; answer extracted from thinking fallback

### H2 认知反射 CRT 球棒球
- expected: `0.05`
- got: ``
- done_reason: `error` eval_count: `None`
- note: empty content; answer extracted from thinking fallback

### H3 多阶段水池速率
- expected: `8.5`
- got: ``
- done_reason: `error` eval_count: `None`
- note: empty content; answer extracted from thinking fallback

### H4 周二男孩条件概率
- expected: `13/27`
- got: ``
- done_reason: `error` eval_count: `None`
- note: empty content; answer extracted from thinking fallback

### H5 严格JSON综合四问
- expected: `q1=no;q2=2;q3<=18hanzi;q4=206`
- got: ``
- done_reason: `error` eval_count: `None`
- note: empty content; answer extracted from thinking fallback

### H6 Python kth_smallest bug审查
- expected: `sort_none + off_by_one`
- got: ``
- done_reason: `error` eval_count: `None`
- note: empty content; answer extracted from thinking fallback

## One-liner

> Local Qwen 35B scored 0/6 on HardBench. See failures above.
