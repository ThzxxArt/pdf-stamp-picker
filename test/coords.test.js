/**
 * 坐标换算单测（v4.9.1 起：测【真身】而非公式副本）
 *
 * 历史教训：旧版把换算公式在测试里又抄了一份，库里改坏了测试照样绿。
 * 现在库把换算提取为纯函数（makeGeom / pdfCoordFromScreen / screenCoordFromPdf），
 * 并【同时】通过 PdfStampPicker.prototype.screenToPdf 暴露；本测试两条路都测：
 *   ① _internals 的纯函数（底层）
 *   ② 原型方法（真实调用路径，无需 DOM）
 * 任一路径被改坏都会失败。
 */
'use strict';
const assert = require('assert');
const path = require('path');

const Picker = require(path.join(__dirname, '..', 'pdf-stamp-picker.js'));
const I = Picker._internals;

assert.ok(I && I.makeGeom && I.pdfCoordFromScreen && I.screenCoordFromPdf,
  '库必须导出坐标换算纯函数（_internals.makeGeom / pdfCoordFromScreen / screenCoordFromPdf）');

const A4 = { w: 595.28, h: 841.89 };

function approx(a, b, msg) {
  assert.ok(Math.abs(a - b) < 1e-6, msg + '（得到 ' + a + '，期望 ' + b + '）');
}

/* ---------- 用原型方法构造一个"无 DOM 实例"：真实调用路径 ---------- */
function fakeInstance(pdfW, pdfH, rotation, displayW, displayH, offsetX, offsetY) {
  return {
    _pdfW: pdfW, _pdfH: pdfH, _rotation: rotation,
    _displayW: displayW, _displayH: displayH,
    _offsetX: offsetX || 0, _offsetY: offsetY || 0,
    _geom: Picker.prototype._geom,
    screenToPdf: Picker.prototype.screenToPdf,
    pdfToScreen: Picker.prototype.pdfToScreen
  };
}

/* 该组几何下，PDF 四个角在屏幕上的位置（用库自己的 pdfToScreen 求，不另写公式） */
function corners(inst) {
  const g = inst._geom();
  return {
    tl: inst.pdfToScreen(0, g.height),          // PDF 左上（PDF 原点在左下）
    tr: inst.pdfToScreen(g.width, g.height),
    bl: inst.pdfToScreen(0, 0),
    br: inst.pdfToScreen(g.width, 0)
  };
}

let cases = 0;
const rotations = [0, 90, 180, 270];
const zoomScales = [0.5, 1, 1.5, 2.37];

/* ---------- 1. 旋转 × 缩放：四角往返 + 中点往返 ---------- */
rotations.forEach(rot => {
  zoomScales.forEach(sc => {
    // 显示区域 = 旋转后的跨度 × 缩放（旋转 90/270 时宽高互换）——与库 _spanW/_spanH 语义一致
    const spanW = (rot === 90 || rot === 270) ? A4.h : A4.w;
    const spanH = (rot === 90 || rot === 270) ? A4.w : A4.h;
    const dispW = spanW * sc, dispH = spanH * sc;
    const inst = fakeInstance(A4.w, A4.h, rot, dispW, dispH, 0, 0);

    const g = inst._geom();
    approx(g.sx, dispW / spanW, `sx (rot=${rot}, scale=${sc})`);
    approx(g.sy, dispH / spanH, `sy (rot=${rot}, scale=${sc})`);

    // 四角：pdf → screen → pdf 必须回到原点
    const c = corners(inst);
    [['tl', 0, A4.h], ['tr', A4.w, A4.h], ['bl', 0, 0], ['br', A4.w, 0]].forEach(([name, px, py]) => {
      const s = inst.pdfToScreen(px, py);
      const back = inst.screenToPdf(s.x, s.y);
      approx(back.x, px, `往返 x (${name}, rot=${rot}, scale=${sc})`);
      approx(back.y, py, `往返 y (${name}, rot=${rot}, scale=${sc})`);
      cases++;
    });

    // 居中点往返
    const mid = inst.screenToPdf(dispW / 2, dispH / 2);
    approx(mid.x, A4.w / 2, `中点 x (rot=${rot}, scale=${sc})`);
    approx(mid.y, A4.h / 2, `中点 y (rot=${rot}, scale=${sc})`);
    cases++;

    // 四角必须落在显示区域边界内（不能跑到画布外）
    [c.tl, c.tr, c.bl, c.br].forEach(p => {
      assert.ok(p.x > -1e-6 && p.x < dispW + 1e-6, `角点 x 越界 (rot=${rot})：${p.x}`);
      assert.ok(p.y > -1e-6 && p.y < dispH + 1e-6, `角点 y 越界 (rot=${rot})：${p.y}`);
    });
  });
});

/* ---------- 2. 偏移量（语义：PDF 空间的 CropBox 原点平移，非屏幕偏移） ---------- */
{
  const inst = fakeInstance(A4.w, A4.h, 0, A4.w, A4.h, 12, -7);
  const s = inst.pdfToScreen(100, 200);
  const back = inst.screenToPdf(s.x, s.y);
  approx(back.x, 100, '偏移往返 x');
  approx(back.y, 200, '偏移往返 y');
  cases += 2;

  const noOff = fakeInstance(A4.w, A4.h, 0, A4.w, A4.h, 0, 0);
  const base = noOff.pdfToScreen(100, 200);
  // PDF 空间原点右移 +12 → 同一 PDF 点在屏幕上的 x 反而【减小】12（sx=1 时 1:1）
  approx(s.x, base.x - 12, 'offsetX 生效方向（屏幕 x 反向平移）');
  approx(s.y, base.y - 7, 'offsetY 生效方向（偏移在 PDF 空间相加）');
  cases += 2;
}

/* ---------- 2b. 偏移不变量：任意旋转下，偏移都在【PDF 空间】精确平移 ---------- */
rotations.forEach(rot => {
  const spanW = (rot === 90 || rot === 270) ? A4.h : A4.w;
  const spanH = (rot === 90 || rot === 270) ? A4.w : A4.h;
  const withOff = fakeInstance(A4.w, A4.h, rot, spanW, spanH, 12, -7);
  const noOff = fakeInstance(A4.w, A4.h, rot, spanW, spanH, 0, 0);
  // 同一个屏幕点：带偏移算出的 PDF 坐标 - 不带偏移的 = (offX, offY)
  const p1 = withOff.screenToPdf(123, 456);
  const p0 = noOff.screenToPdf(123, 456);
  approx(p1.x - p0.x, 12, `偏移在 PDF 空间平移 x (rot=${rot})`);
  approx(p1.y - p0.y, -7, `偏移在 PDF 空间平移 y (rot=${rot})`);
  cases += 2;
});

/* ---------- 3. 方向性：PDF 原点在左下 ---------- */
{
  const inst = fakeInstance(A4.w, A4.h, 0, A4.w, A4.h, 0, 0);
  // 屏幕最下方 → PDF y=0；屏幕最上方 → PDF y=H
  approx(inst.screenToPdf(0, A4.h).y, 0, '屏幕底部 = PDF y=0（原点在左下）');
  approx(inst.screenToPdf(0, 0).y, A4.h, '屏幕顶部 = PDF y=H');
  // 屏幕 x 向右增大
  assert.ok(inst.screenToPdf(100, 0).x < inst.screenToPdf(200, 0).x, '屏幕 x 增大 → PDF x 增大');
  cases += 3;
}

/* ---------- 4. 旋转 90/270 时轴必须互换 ---------- */
{
  const dispW = A4.h, dispH = A4.w;   // 旋转 90°：显示宽高互换
  const i90 = fakeInstance(A4.w, A4.h, 90, dispW, dispH, 0, 0);
  const i0 = fakeInstance(A4.w, A4.h, 0, A4.w, A4.h, 0, 0);
  // 同一屏幕点，旋转 90° 后 x/y 来源互换
  const p90 = i90.screenToPdf(30, 40);
  const p0 = i0.screenToPdf(30, 40);
  assert.ok(Math.abs(p90.x - p0.x) > 1e-6 || Math.abs(p90.y - p0.y) > 1e-6, '旋转 90° 必须改变映射');
  const back = i90.screenToPdf(i90.pdfToScreen(120, 340).x, i90.pdfToScreen(120, 340).y);
  approx(back.x, 120, '旋转 90° 往返 x');
  approx(back.y, 340, '旋转 90° 往返 y');  cases += 2;
}

/* ---------- 5. 退化输入：尺寸为 0 不得产生 NaN ---------- */
{
  const g = I.makeGeom(0, 0, 0, 100, 100, 0, 0);
  assert.strictEqual(g.sx, 1, '宽为 0 时 sx 应退化为 1（不产生 NaN/Infinity）');
  assert.strictEqual(g.sy, 1, '高为 0 时 sy 应退化为 1');
  const p = I.pdfCoordFromScreen(10, 10, g);
  assert.ok(isFinite(p.x) && isFinite(p.y), '退化几何下坐标仍必须是有限数');
  cases += 3;
}

/* ---------- 6. 旋转值容错（非 0/90/180/270 走默认分支，不得 NaN） ---------- */
{
  const g = I.makeGeom(A4.w, A4.h, 45, A4.w, A4.h, 0, 0);
  const p = I.pdfCoordFromScreen(10, 10, g);
  assert.ok(isFinite(p.x) && isFinite(p.y), '未支持的旋转角不得产生 NaN');
  cases++;
}

/* ---------- 7. 单一真源守卫：原型方法与纯函数必须一致 ---------- */
{
  const inst = fakeInstance(A4.w, A4.h, 270, A4.h, A4.w, 3, 5);
  const viaProto = inst.screenToPdf(77, 133);
  const viaPure = I.pdfCoordFromScreen(77, 133, I.makeGeom(A4.w, A4.h, 270, A4.h, A4.w, 3, 5));
  assert.deepStrictEqual(viaProto, viaPure, '原型方法与纯函数结果必须完全一致（防再次出现公式副本）');
  assert.strictEqual(Picker.version, require('../package.json').version, '版本号必须一致');
  cases += 2;
}

/* ---------- 8. 绝对方向快照：屏幕四角 → PDF 四角（防"自洽但方向错"） ----------
 * ★ 为什么必须有这一节：
 *   上面 1–7 节全是"自洽性"断言（往返、中心、轴互换）——它们对"整体镜像/翻转"是**盲的**：
 *   rot=180 时把 y 也镜像（y = H - cy/sy），往返依然闭合、中心依然对中心，测试全绿，
 *   但导出的 JSON 坐标在 pdf.js / 后端盖章器里会上下颠倒到页面对侧（v4.9.0 及以前的真实 bug）。
 *   所以这里把【绝对方向】钉死：每行期望值都来自 pdf.js PageViewport.transform 的解析结论，
 *   并在浏览器里用 viewport.convertToPdfPoint() 逐点对账到 0.0000 偏差
 *   （见 demo/coords-vs-pdfjs-test.html 与 demo/rot-coords-e2e-test.html）。
 *   对照旧实现：rot=180 屏幕左上旧值 =(W, H)（右上，镜像），正确值 =(W, 0)（右下，真旋转）。
 */
{
  const span = r => (r === 90 || r === 270) ? { w: A4.h, h: A4.w } : { w: A4.w, h: A4.h };
  // 屏幕四角：左上/右上/右下/左下 → 期望的 PDF 坐标
  const expectCorners = {
    0:   [[0, A4.h], [A4.w, A4.h], [A4.w, 0], [0, 0]],
    90:  [[0, 0],    [0, A4.h],    [A4.w, A4.h], [A4.w, 0]],
    180: [[A4.w, 0], [0, 0],       [0, A4.h],    [A4.w, A4.h]],
    270: [[A4.w, A4.h], [A4.w, 0], [0, 0],       [0, A4.h]]
  };
  const names = ['左上', '右上', '右下', '左下'];
  rotations.forEach(r => {
    const s = span(r);
    const inst = fakeInstance(A4.w, A4.h, r, s.w, s.h, 0, 0);
    const screens = [[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]];
    screens.forEach((sc, i) => {
      const got = inst.screenToPdf(sc[0], sc[1]);
      const exp = expectCorners[r][i];
      assert.ok(Math.abs(got.x - exp[0]) < 1e-6 && Math.abs(got.y - exp[1]) < 1e-6,
        `rot=${r} 屏幕${names[i]}(${sc[0]},${sc[1]}) → 期望 PDF(${exp[0]},${exp[1]})，得到 (${got.x},${got.y})`);
      cases++;
    });
    // 反向也必须落在同一个角（用同一份期望值反查，双向锁死）
    const back = inst.pdfToScreen(expectCorners[r][0][0], expectCorners[r][0][1]);
    assert.ok(Math.abs(back.x) < 1e-6 && Math.abs(back.y) < 1e-6,
      `rot=${r} 屏幕左上角对应的 PDF 点应被画回屏幕(0,0)，得到 (${back.x},${back.y})`);
    cases++;
  });
}

console.log('=== 坐标换算测试通过：' + cases + ' 项断言（4 旋转 × 4 缩放往返 + 偏移/方向/退化/绝对方向快照/单一真源守卫）===');
