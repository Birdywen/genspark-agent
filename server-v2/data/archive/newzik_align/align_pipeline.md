# newzik-abc 音符坐标对齐流水线 (定稿 2026-06-02)

## 目标
把 abc2svg 渲染的音符精确映射到 newzik PDF 页面坐标(1019基准系), 用于标注漏音(reversed)和已检测音(measured)。最终精度: measured残差中位1.5px/均2.0px (触及newzik OCR数据天花板)。

## 核心思想 (踩坑得来)
1. **让abc2svg按newzik分行渲染**: 生成ABC时按newzik的(page,system)给小节分行, 强制每行小节数与newzik逐行一致(本例13行对13行)。否则跨行错位。
2. **普通小节**: abc2svg的BAR切段, 每个音算小节内相对位置rel, 映射到newzik该小节真实框[x1,x3]。NOT整行映射(小节不等宽会累积误差)。
3. **行首小节(每行第一个)**: 不能用LEAD常数猜(谱号占位留白m1=86/m70=110不固定)。用abc2svg精确rel(ABC绝对准确=ground truth) + 该小节newzik已检测measured音做最小二乘线性拟合 x=nL+rel*(nR-nL), 反解出'虚拟小节线'nL/nR。此法行首残差仅0.8px。
4. **y坐标**: 谱表几何公式 ymid + (staff_spacing/8)*(22 - diatonic(step,octave))。staff_spacing=(y3-y1)/8。
5. **合并**: 行首小节用反解版(mapped4), 普通小节用BAR映射版(mapped3), 各取所长 -> 总残差最低。

## 关键坑
- abc2svg多参数console.log格式化(%d/%.0f)在此node环境不展开, 调试打印用Python或单参数拼接。
- 分行靠abc2svg的x回跳(<prev-5)判断, x不会逐行归零。
- 金标'同音双源'(同midi不同sync的measured+reversed)是合法数据, 视觉上红绿因同y而贴近, 不是bug, 不要去重。
- midi有~6.5%因调号(F大调Bb/升降)与金标差±1半音, 影响y匹配但不影响绘制位置。

## 文件
- /tmp/gen_abc2.cjs: 按newzik分行生成ABC
- /tmp/final11.cjs: 渲染+普通小节BAR映射+行首虚拟小节线反解 -> mapped4.json (含mapped3逻辑可参照final9.cjs)
- /tmp/merge.py: 合并两版+出图+残差自检

## 输入依赖
- newzik ocr.json (measures含page/system/x1/x3, systems, chords)
- geometry.json (systems的y1/y3用于y公式)
- goldmap.json (measure/step/octave/midi/source/sync)
- abc2svg-1.js (viewer)
