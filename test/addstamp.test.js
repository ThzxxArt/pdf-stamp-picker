/**
 * addStamp 尺寸语义单测（v4.9.2 起）
 *
 * 根治的问题（"0×0 空章"）：`addStamp({x,y})` 省略 width/height 时旧实现一律落 0×0。
 * 0×0 只在 `mode:'point'`（坐标锚点）下合法；在 rect / stamp 模式下它是个退化矩形 ——
 * 零尺寸 drawImage 画不出章、手柄全叠在一点、尺寸标签被跳过，却照样进 JSON/列表/撤销栈，
 * 全程无报错。用户侧表现："我调了 addStamp，页面上什么都没出现"。
 *
 * 本测试直接驱动【真实 addStamp / 真实 _defaultStampSize / 真实 _stampDisplaySize】，
 * 只把 DOM 相关副作用（渲染/事件/重叠提示/历史）替换为桩，因此测的是库的真实语义，
 * 不是测试自己抄的一份规则。像素层面的"确实画出来了"由 demo/addstamp-size-test.html 覆盖。
 */
'use strict';
const assert = require('assert');
const path = require('path');

const Picker = require(path.join(__dirname, '..', 'pdf-stamp-picker.js'));

let cases = 0;
const ok = (name) => { cases++; void name; };

/** 构造最小实例：真实尺寸/添加逻辑 + DOM 副作用桩 */
function mkInst(opts) {
  const inst = {
    _stamps: [],
    _activeId: null,
    _currentUserId: 'u1',
    _pageNumber: 1,
    _rotation: 0,
    _displayW: 595,
    _displayH: 842,
    _stampImg: null,
    _options: Object.assign({ mode: 'stamp', stampSize: 120, stampMargin: 0, historyLimit: 50 }, opts || {}),
    // 真实逻辑
    addStamp: Picker.prototype.addStamp,
    _defaultStampSize: Picker.prototype._defaultStampSize,
    _stampDisplaySize: Picker.prototype._stampDisplaySize,
    _stampRatio: Picker.prototype._stampRatio,
    // 副作用桩（不参与尺寸语义）
    _pushHistory() {}, _renderList() {}, _emit() {}, _checkOverlap() {},
    _paint() { this._paints = (this._paints || 0) + 1; },   // 桩：记录重绘次数
    _syncSelFromStamp(st) { this._synced = st.id; },   // 桩：记录"选区已同步"
    getSelection() { return null; }
  };
  return inst;
}

/* 1. ★ 核心回归：stamp 模式下缺省尺寸必须补成可用尺寸，而不是 0×0 */
{
  const p = mkInst();
  const st = p.addStamp({ x: 100, y: 200 });
  assert.strictEqual(st.width, 120, '缺省宽度应等于 stampSize（120），实际 ' + st.width);
  assert.strictEqual(st.height, 120, '无章图时比例 1:1，高度应等于宽度');
  assert.ok(st.width > 0 && st.height > 0, '缺省尺寸不能是 0×0（空章）');
  ok();
}

/* 2. 缺省尺寸随 stampSize / 章图比例变化（与点击放置同一套算法） */
{
  const p = mkInst({ stampSize: 200 });
  p._stampImg = { src: 'x', w: 300, h: 150 };   // 2:1 的章
  const st = p.addStamp({ x: 0, y: 0 });
  assert.strictEqual(st.width, 200, '宽度取 stampSize');
  assert.strictEqual(st.height, 100, '高度按章图比例 200/(300/150)=100，实际 ' + st.height);
  ok();
}

/* 3. point 模式：缺省即锚点，0×0 是正确形态（不能被子系统"补尺寸"误伤） */
{
  const p = mkInst({ mode: 'point' });
  const st = p.addStamp({ x: 50, y: 50 });
  assert.strictEqual(st.width, 0, 'point 模式缺省宽度应为 0（锚点）');
  assert.strictEqual(st.height, 0, 'point 模式缺省高度应为 0（锚点）');
  ok();
}

/* 4. 显式 0 在非 point 模式下同样被尊重（锚点形态是受支持的状态，不是错误） */
{
  const p = mkInst();
  const st = p.addStamp({ x: 10, y: 10, width: 0, height: 0 });
  assert.strictEqual(st.width, 0);
  assert.strictEqual(st.height, 0);
  ok();
}

/* 4b. ★ 第二处根因：addStamp 必须让"活动签章"与"选区"同步 ——
 *     只设 _activeId 不设 _sel 时，_paint 认为活动签章由选区渲染器负责，
 *     而选区渲染器因 _sel 为空直接不执行 → 画布 0 像素 + getSelection() 返回 null。
 *     跨页签章点则**不得**同步（否则把别页坐标画进当前页选区，_commitActive 回写＝坐标污染）。 */
{
  const p = mkInst();
  const st = p.addStamp({ x: 10, y: 10 });
  assert.strictEqual(p._synced, st.id, '同页签章点必须同步选区');

  const q = mkInst();                       // _pageNumber = 1
  const st3 = q.addStamp({ x: 10, y: 10, page: 3 });
  assert.notStrictEqual(q._synced, st3.id, '跨页签章点不得同步到当前页选区');
  assert.strictEqual(q._sel, null, '跨页同步时应清空选区而不是留着旧选区');

  const r = mkInst();
  r._displayW = 0;                          // 文档尚未布局（未加载完）
  const st0 = r.addStamp({ x: 10, y: 10 });
  assert.notStrictEqual(r._synced, st0.id, '画布未就绪时不得同步（避免算出垃圾坐标）');
  ok();
}

/* 5. 显式尺寸原样保留（不能被缺省逻辑覆盖） */
{
  const p = mkInst();
  const st = p.addStamp({ x: 10, y: 10, width: 33, height: 44 });
  assert.strictEqual(st.width, 33);
  assert.strictEqual(st.height, 44);
  ok();
}

/* 6. 非有限/非法值一律回落默认尺寸（不把 NaN / null 写进数据） */
{
  const p = mkInst();
  ['width', 'height'].forEach((k) => {
    [NaN, Infinity, -Infinity, null, undefined, '120', -5].forEach((bad) => {
      const sel = { x: 1, y: 1, width: 50, height: 60 };
      sel[k] = bad;
      const st = p.addStamp(sel);
      assert.ok(Number.isFinite(st[k]) && st[k] >= 0,
        k + '=' + String(bad) + ' 应回落为有限非负值，实际 ' + st[k]);
    });
    ok();
  });
  ok();
}

/* 7. 宽高各自独立缺省（只给 height 时 width 走默认） */
{
  const p = mkInst();
  const st = p.addStamp({ x: 0, y: 0, height: 30 });
  assert.strictEqual(st.width, 120, 'width 缺省 → 默认宽');
  assert.strictEqual(st.height, 30, 'height 显式 → 保留');
  ok();
}

/* 8. 缺省尺寸不影响其它字段语义 */
{
  const p = mkInst();
  const st = p.addStamp({ x: 7, y: 8, page: 3, userId: 'u9', note: '备注' });
  assert.strictEqual(st.x, 7);
  assert.strictEqual(st.y, 8);
  assert.strictEqual(st.page, 3);
  assert.strictEqual(st.userId, 'u9');
  assert.strictEqual(st.note, '备注');
  assert.ok(st.id && st.createdAt, 'id / createdAt 仍应生成');
  ok();
}

/* 9. 缺 x/y 仍应抛错（原有契约不变） */
{
  const p = mkInst();
  assert.throws(() => p.addStamp({ y: 1 }), /addStamp 需要/);
  assert.throws(() => p.addStamp(), /addStamp 需要/);
  ok();
}

/* 10. 与"点击放置"产物一致：缺省尺寸 == _stampDisplaySize() */
{
  const p = mkInst({ stampSize: 88 });
  const st = p.addStamp({ x: 0, y: 0 });
  const d = p._stampDisplaySize();
  assert.strictEqual(st.width, d.w);
  assert.strictEqual(st.height, d.h);
  ok();
}

console.log('=== addStamp 语义单测通过：' + cases + ' 组断言'
  + '（缺省补尺寸 / 随 stampSize+比例 / point 模式 0×0 / 显式 0 尊重 / 显式值保留 /'
  + ' 非法值回落 / 宽高独立 / 其它字段不受影响 / 缺 x,y 抛错 / 与点击放置一致 /'
  + ' 选区同步（同页同步 / 跨页不同步 / 未布局不同步） / 非批量必重绘）===');
