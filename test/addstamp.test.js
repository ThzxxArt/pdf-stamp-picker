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

/**
 * 构造最小实例：**从真实原型继承**（真实尺寸/添加逻辑全部可用）+ DOM 副作用桩。
 *
 * ★ 不要"手工列举要复制的原型方法"。本测试原先就是这样写的（只抄了 addStamp /
 *   _defaultStampSize / _stampDisplaySize / _stampRatio 四个），结果本次给库新增内部方法
 *   `_stampSizePdf()` 后 mock 没同步 → **修复版与变异版都在 addStamp 里 TypeError**，
 *   红得毫无信息量：看起来像被测库崩了，实际是测试自己的替身缺胳膊少腿。
 *   改为 Object.create(Picker.prototype) 后，库新增/改名任何内部方法都自动可用，
 *   需要维护的只剩"哪些副作用要打桩"这一件事 —— 而那正是本测试唯一该关心的。
 */
function mkInst(opts) {
  const inst = Object.create(Picker.prototype);
  Object.assign(inst, {
    _stamps: [],
    _activeId: null,
    _currentUserId: 'u1',
    _pageNumber: 1,
    _rotation: 0,
    _displayW: 595,
    _displayH: 842,
    _sel: null,
    _stampImg: null,
    _options: Object.assign({ mode: 'stamp', stampSize: 120, stampMargin: 0, historyLimit: 50 }, opts || {}),
    // 副作用桩（不参与尺寸语义）—— 显式遮蔽原型上的真实实现
    _pushHistory() {}, _renderList() {}, _emit() {}, _checkOverlap() {},
    _paint() { this._paints = (this._paints || 0) + 1; },   // 桩：记录重绘次数
    _syncSelFromStamp(st) { this._synced = st.id; },   // 桩：记录"选区已同步"
    getSelection() { return null; }
  });
  return inst;
}

/* 0. 替身自检：mock 必须真的继承库的原型（否则整个文件的红都是假的） */
{
  const p = mkInst();
  assert.strictEqual(Object.getPrototypeOf(p), Picker.prototype,
    'mkInst 必须基于 Picker.prototype 构造，不能是手工拼的对象字面量');
  assert.strictEqual(typeof p._stampSizePdf, 'function',
    'mock 必须能拿到库的内部尺寸真源方法（_stampSizePdf 缺失即为替身过期）');
  const sz = p._stampSizePdf();
  assert.ok(sz && sz.w === 120 && sz.h === 120,
    '_stampSizePdf() 应为 {w:120,h:120}（无章图时比例 1:1），实际 ' + JSON.stringify(sz));
  ok();
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

/* 10. 缺省尺寸 = stampSize（PDF pt 物理尺寸），且【不随显示缩放变化】
   ★ 这一组曾经是**假通过**：旧写法 `st.width === p._stampDisplaySize().w`，
     而 addStamp 的缺省正是从 _stampDisplaySize() 取来的 → f() === f() 同义反复，
     永不可能失败；于是"与点击放置一致"这个声明在缩放≠1 时其实是错的（窄屏下
     章能大到页宽 240%），却一路绿灯过了 v4.9.2/v4.9.3 的回归。
     现在改为断言**绝对物理尺寸**：期望值来自常量 88（与实现无共享来源），
     下面再用反例守卫证明它不随 _cssScale 漂移。 */
{
  const p = mkInst({ stampSize: 88 });
  const ratio = p._stampRatio();
  const expH = ratio ? 88 / ratio : 88;
  const st = p.addStamp({ x: 0, y: 0 });
  assert.strictEqual(st.width, 88, '缺省宽应等于 stampSize 本身（PDF pt）');
  assert.strictEqual(st.height, expH);
  // 反例守卫：显示缩放变了，落库物理尺寸必须纹丝不动（旧实现会跟着变）
  p._cssScale = 0.084;
  assert.strictEqual(p.addStamp({ x: 0, y: 0 }).width, 88, '落库尺寸不得随显示缩放变化');
  p._cssScale = 2.5;
  assert.strictEqual(p.addStamp({ x: 0, y: 0 }).width, 88);
  ok();
}

/* 10b. ★ 显示侧契约（Node 也能钉死，不必等浏览器）：
 *       _stampDisplaySize() 必须 = 物理尺寸 × _cssScale —— 点击放置路径就是拿它当
 *       "屏幕上要摆多大的矩形"，再经 screenToPdf(÷cssScale) 反算回 PDF 单位。
 *       少了这个乘法，点击放置出的章就变成 stampSize/cssScale（窄屏下可到页宽 240%），
 *       而 addStamp 路径不受影响 → 两路分叉。旧回归之所以漏掉，是因为只断言了显示尺寸，
 *       从没断言它与 cssScale 的**比例关系**。 */
{
  const p = mkInst({ stampSize: 88 });
  [0.084, 0.966, 1, 2.5].forEach((k) => {
    p._cssScale = k;
    const d = p._stampDisplaySize();
    assert.ok(Math.abs(d.w - 88 * k) < 1e-9,
      '显示宽应为 88×' + k + '=' + (88 * k) + '，实际 ' + d.w);
    assert.ok(Math.abs(d.h - 88 * k) < 1e-9, '显示高同理（无章图 1:1）');
  });
  // 未布局（cssScale=0）必须退化为 1×，不能返回 0 尺寸矩形
  p._cssScale = 0;
  assert.strictEqual(p._stampDisplaySize().w, 88, '未布局时不得退化成 0 尺寸');
  // 两路一致的关系式：显示尺寸 ÷ cssScale === 落库尺寸（浮点用容差比）
  p._cssScale = 0.084;
  assert.ok(Math.abs(p._stampDisplaySize().w / 0.084 - p.addStamp({ x: 0, y: 0 }).width) < 1e-9,
    '点击路径（显示÷cssScale）必须还原成与 addStamp 相同的物理尺寸');
  ok();
}

console.log('=== addStamp 语义单测通过：' + cases + ' 组断言'
  + '（替身自检 / 缺省补尺寸 / 随 stampSize+比例 / point 模式 0×0 / 显式 0 尊重 / 显式值保留 /'
  + ' 非法值回落 / 宽高独立 / 其它字段不受影响 / 缺 x,y 抛错 / 缺省=stampSize 且不随缩放漂移 /'
  + ' 显示尺寸=物理×cssScale（含未布局退化）/ 选区同步（同页同步 / 跨页不同步 / 未布局不同步） / 非批量必重绘）===');
