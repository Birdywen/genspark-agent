# 并行执行设计方案

## 目标

在 ΩBATCH 中支持并行执行，提升性能。

## 使用场景

### 示例1：并行读取多个文件

```javascript
ΩBATCH{"steps":[
  {"tool":"read_file","params":{"path":"file1.txt"},"saveAs":"f1","parallel":true},
  {"tool":"read_file","params":{"path":"file2.txt"},"saveAs":"f2","parallel":true},
  {"tool":"read_file","params":{"path":"file3.txt"},"saveAs":"f3","parallel":true},
  {"tool":"run_command","params":{"command":"echo 'All files loaded'"}}
]}ΩEND
```

**效果**：前3步并行执行，第4步等待前3步完成后执行

### 示例2：环境检查

```javascript
ΩBATCH{"steps":[
  {"tool":"run_command","params":{"command":"node -v"},"parallel":true},
  {"tool":"run_command","params":{"command":"npm -v"},"parallel":true},
  {"tool":"run_command","params":{"command":"git --version"},"parallel":true},
  {"tool":"run_command","params":{"command":"echo 'Check complete'"}}
]}ΩEND
```

## 实现方案

### 方案A：分组执行（推荐）

```javascript
// 1. 将步骤按 parallel 标记分组
const groups = groupStepsByParallel(steps);
// [[step0,step1,step2], [step3]]

// 2. 每组内并行执行
for (const group of groups) {
  if (group.length === 1 || !group[0].parallel) {
    // 单步或非并行：顺序执行
    await executeStep(group[0]);
  } else {
    // 并行执行
    await Promise.all(group.map(step => executeStep(step)));
  }
}
```

**优点**：
- 简单直观
- 不破坏现有逻辑
- 保持执行顺序可预测

**缺点**：
- 需要连续的 parallel:true 才能并行
- 不能跨组并行

### 方案B：依赖分析（复杂）

使用 TaskPlanner 的依赖分析能力，自动识别可并行步骤。

**优点**：
- 自动优化
- 最大化并行度

**缺点**：
- 复杂度高
- 需要分析 saveAs 依赖
- 可能难以调试

## 选择：方案A

因为：
1. 简单可控
2. 用户明确意图
3. 易于调试
4. 性能提升明显

## 实现步骤

### 1. 添加分组函数

```javascript
groupStepsByParallel(steps) {
  const groups = [];
  let currentGroup = [];
  
  for (const step of steps) {
    if (step.parallel && currentGroup.length > 0 && currentGroup[0].parallel) {
      // 加入当前并行组
      currentGroup.push(step);
    } else {
      // 开始新组
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [step];
    }
  }
  
  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups;
}
```

### 2. 修改 executeBatch

```javascript
async executeBatch(batchId, steps, options = {}, onStepComplete = null) {
  const groups = this.groupStepsByParallel(steps);
  
  for (const group of groups) {
    if (group.length === 1 || !group[0].parallel) {
      // 顺序执行
      await this.executeStep(batchId, group[0], options, onStepComplete);
    } else {
      // 并行执行
      await Promise.all(
        group.map(step => this.executeStep(batchId, step, options, onStepComplete))
      );
    }
  }
}
```

### 3. 提取 executeStep

将单步执行逻辑提取为独立方法。

## 测试用例

### 测试1：基本并行

```javascript
ΩBATCH{"steps":[
  {"tool":"run_command","params":{"command":"sleep 2 && echo 'A'"},"parallel":true},
  {"tool":"run_command","params":{"command":"sleep 2 && echo 'B'"},"parallel":true},
  {"tool":"run_command","params":{"command":"echo 'Done'"}}
]}ΩEND
```

**预期**：总耗时约2秒（不是4秒）

### 测试2：条件执行

```javascript
ΩBATCH{"steps":[
  {"tool":"run_command","params":{"command":"echo 'OK'"},"saveAs":"check","parallel":true},
  {"tool":"run_command","params":{"command":"echo 'PASS'"},"saveAs":"check2","parallel":true},
  {"tool":"run_command","params":{"command":"echo 'Both OK'"},
   "when":{"var":"check","success":true}}
]}ΩEND
```

### 测试3：错误处理

```javascript
ΩBATCH{"steps":[
  {"tool":"run_command","params":{"command":"echo 'OK'"},"parallel":true},
  {"tool":"run_command","params":{"command":"cat /nonexistent"},"parallel":true},
  {"tool":"run_command","params":{"command":"echo 'Continue'"}}
],"stopOnError":false}ΩEND
```

## 性能提升预估

| 场景 | 顺序执行 | 并行执行 | 提升 |
|------|----------|----------|------|
| 读取5个文件 | 2.5s | 0.5s | 80% |
| 环境检查（3命令） | 1.5s | 0.5s | 67% |
| 10个独立命令 | 5s | 0.5s | 90% |

## 后续优化

1. 支持 `maxParallel` 限制并发数
2. 支持 `timeout` 单步超时
3. 支持 `retryParallel` 并行重试
