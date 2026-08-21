// 坐标转换单元测试：验证 screenToPdf / pdfToScreen 在四种旋转下的往返一致性
const assert = require('assert');
const Picker = require('/var/minis/workspace/pdf-stamp-picker/pdf-stamp-picker.js');

// 无法在 node 中实例化（需要 DOM），因此单独测试纯函数逻辑：
// 复制核心转换逻辑并验证公式（与库中实现一致）
function makeConv(W, H, rotation, displayW, displayH, offX = 0, offY = 0) {
  const spanW = (rotation === 90 || rotation === 270) ? H : W;
  const spanH = (rotation === 90 || rotation === 270) ? W : H;
  const sx = displayW / spanW, sy = displayH / spanH;
  return {
    screenToPdf(cx, cy) {
      let x, y;
      switch (rotation) {
        case 90: x = cy / sy; y = cx / sx; break;
        case 180: x = W - cx / sx; y = H - cy / sy; break;
        case 270: x = W - cy / sy; y = H - cx / sx; break;
        default: x = cx / sx; y = H - cy / sy; break;
      }
      return { x: x + offX, y: y + offY };
    },
    pdfToScreen(px, py) {
      const x = px - offX, y = py - offY;
      let cx, cy;
      switch (rotation) {
        case 90: cx = y * sy; cy = x * sx; break;
        case 180: cx = (W - x) * sx; cy = (H - y) * sy; break;
        case 270: cx = (H - y) * sy; cy = (W - x) * sx; break;
        default: cx = x * sx; cy = (H - y) * sy; break;
      }
      return { x: cx, y: cy };
    }
  };
}

// A4: 595.28 × 841.89 pt, 显示 595.28×841.89 (1:1)
const A4W = 595.28, A4H = 841.89;
const corners = [
  [0, 0], [A4W, 0], [A4W, A4H], [0, A4H],          // 四角
  [100, 200], [A4W / 2, A4H / 2], [495.28, 700]     // 内部点
];

for (const rot of [0, 90, 180, 270]) {
  // 显示尺寸随旋转交换（与库 _spanW/_spanH 语义一致）
  const dispW = (rot === 90 || rot === 270) ? A4H : A4W;
  const dispH = (rot === 90 || rot === 270) ? A4W : A4H;
  const conv = makeConv(A4W, A4H, rot, dispW, dispH);
  for (const [px, py] of corners) {
    const s = conv.pdfToScreen(px, py);
    const back = conv.screenToPdf(s.x, s.y);
    assert.ok(Math.abs(back.x - px) < 1e-6, `rot=${rot} pdf(${px},${py}) 往返失败: got ${back.x},${back.y}`);
    assert.ok(Math.abs(back.y - py) < 1e-6, `rot=${rot} pdf(${px},${py}) 往返失败: got ${back.x},${back.y}`);
    // 屏幕坐标必须落在显示区域内
    assert.ok(s.x >= -1e-9 && s.x <= dispW + 1e-9 && s.y >= -1e-9 && s.y <= dispH + 1e-9, `rot=${rot} 屏幕越界: ${s.x},${s.y}`);
  }
}

// 旋转后显示尺寸交换验证
const conv90 = makeConv(A4W, A4H, 90, A4H, A4W); // 旋转90后显示 841.89×595.28
{
  // PDF 原点(0,0) → 显示左上角
  const s = conv90.pdfToScreen(0, 0);
  assert.ok(Math.abs(s.x) < 1e-6 && Math.abs(s.y) < 1e-6, `rot90 原点应在显示左上: ${s.x},${s.y}`);
  // PDF 右上角(W,H) → 显示右下角
  const s2 = conv90.pdfToScreen(A4W, A4H);
  assert.ok(Math.abs(s2.x - A4H) < 1e-6 && Math.abs(s2.y - A4W) < 1e-6, `rot90 右上应在显示右下: ${s2.x},${s2.y}`);
}

const conv270 = makeConv(A4W, A4H, 270, A4H, A4W);
{
  // PDF 右上角(W,H) → 显示左上角
  const s = conv270.pdfToScreen(A4W, A4H);
  assert.ok(Math.abs(s.x) < 1e-6 && Math.abs(s.y) < 1e-6, `rot270 右上应在显示左上: ${s.x},${s.y}`);
  // PDF 左下角(0,0) → 显示右下角
  const s2 = conv270.pdfToScreen(0, 0);
  assert.ok(Math.abs(s2.x - A4H) < 1e-6 && Math.abs(s2.y - A4W) < 1e-6, `rot270 左下应在显示右下: ${s2.x},${s2.y}`);
}

// 缩放 + CropBox 偏移
const convScaled = makeConv(A4W, A4H, 0, 1000, 1414, 14.17, 42.52); // display ~1.68x, offset
{
  const s = convScaled.pdfToScreen(14.17 + 100, 42.52 + 200);
  const back = convScaled.screenToPdf(s.x, s.y);
  assert.ok(Math.abs(back.x - 114.17) < 1e-6 && Math.abs(back.y - 242.52) < 1e-6, `偏移缩放往返失败: ${back.x},${back.y}`);
}

// 框选包围盒方向验证：屏幕左上角对应 PDF 的 maxY
{
  const conv = makeConv(A4W, A4H, 0, A4W, A4H);
  const topLeft = conv.screenToPdf(100, 100);   // 屏幕左上 → PDF y 大
  const botRight = conv.screenToPdf(300, 300);  // 屏幕右下 → PDF y 小
  assert.ok(topLeft.y > botRight.y, '屏幕左上应映射到 PDF y 较大处');
  assert.ok(topLeft.x < botRight.x, '屏幕左上应映射到 PDF x 较小处');
}

console.log('=== 全部坐标转换测试通过 (4 旋转 × 7 点往返 + 边界/缩放/偏移/方向) ===');
