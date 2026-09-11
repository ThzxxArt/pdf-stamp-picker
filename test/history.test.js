/**
 * 历史栈【交互分组】单测（v4.9.2 起）
 *
 * 根治的问题：历史栈是"每次变更入一条快照"的模型，不认识「一次用户交互」。
 * 于是按住方向键微调时，浏览器按键重复 ≈ 30 次/秒 → historyLimit=50 时按住不到 2 秒，
 * 整个撤销栈就被一次微调挤干净（初始状态甚至会被 shift 出栈，撤到底也回不到原状）。
 *
 * 本测试用【真实原型方法】驱动（_pushHistory / beginHistoryGroup / endHistoryGroup /
 * undo / _resetHistory），不复制任何逻辑；把修复前后的差异做成量化断言：
 *   · 旧行为（不分组）在 60 次变更后栈被冲爆 —— 断言"确实会冲爆"，证明问题真实存在；
 *   · 新行为（分组）60 次变更只留 1 步 —— 断言"不会再冲爆"。
 * 这样即使将来有人把合并逻辑删掉，这里也会立刻变红。
 */
'use strict';
const assert = require('assert');
const path = require('path');

const Picker = require(path.join(__dirname, '..', 'pdf-stamp-picker.js'));

let cases = 0;

/** 构造一个"无 DOM 实例"：历史相关的真实原型方法 + 最小状态 */
function mkInst(limit) {
  const inst = {
    _stamps: [],
    _activeId: null,
    _sel: null,
    _options: { historyLimit: limit || 50 },
    _history: [[]],
    _historyIdx: 0,
    _histGroupKey: null,
    _histMergedKey: null,
    _pushHistory: Picker.prototype._pushHistory,
    beginHistoryGroup: Picker.prototype.beginHistoryGroup,
    endHistoryGroup: Picker.prototype.endHistoryGroup,
    _resetHistory: Picker.prototype._resetHistory,
    undo: Picker.prototype.undo,
    redo: Picker.prototype.redo,
    // 真实恢复逻辑依赖 DOM/画布，这里只保留"从快照取回"的语义
    _restoreFromHistory: function () {
      const snap = this._history[this._historyIdx] || [];
      this._stamps = snap.map(s => Object.assign({}, s));
    }
  };
  return inst;
}

/** 模拟一次"变更"：改状态 + 记录历史（参数即当前状态的可读标记） */
function change(inst, x, mergeKey) {
  inst._stamps = [{ id: 'a1', x: x, y: 0, page: 1, width: 100, height: 40 }];
  inst._pushHistory(mergeKey);
}

/* 1. 不分组：每次变更都是一步（保持旧语义，不能被合并逻辑误伤） */
{
  const inst = mkInst(50);
  change(inst, 1); change(inst, 2); change(inst, 3);
  assert.strictEqual(inst._history.length, 4, '不分组时 3 次变更应有 4 条历史（含初始）');
  assert.strictEqual(inst._historyIdx, 3);
  inst.undo(); inst.undo(); inst.undo();
  assert.strictEqual(inst._historyIdx, 0);
  assert.strictEqual(inst._stamps.length, 0, '不分组撤销到底应回到初始空状态');
  cases += 2;
}

/* 2. 分组内连续变更 → 只留一步（一次按住 = 一步撤销） */
{
  const inst = mkInst(50);
  inst.beginHistoryGroup('nudge:a1:1');
  for (let i = 1; i <= 30; i++) change(inst, i);   // 模拟 30 次按键重复
  inst.endHistoryGroup();
  assert.strictEqual(inst._history.length, 2, '一次按住按住 30 次重复应只产生 1 步历史');
  assert.strictEqual(inst._historyIdx, 1);
  inst.undo();
  assert.strictEqual(inst._historyIdx, 0);
  assert.strictEqual(inst._stamps.length, 0, '一次撤销应回到按住之前的状态');
  cases += 3;
}

/* 3. 两次"按住"= 两步（分组结束事件驱动，不需要计时器） */
{
  const inst = mkInst(50);
  inst.beginHistoryGroup('nudge:a1:1'); change(inst, 1); change(inst, 2); inst.endHistoryGroup();
  inst.beginHistoryGroup('nudge:a1:1'); change(inst, 10); change(inst, 20); inst.endHistoryGroup();
  assert.strictEqual(inst._history.length, 3, '两次独立交互应是 2 步历史');
  inst.undo();
  assert.strictEqual(inst._stamps[0].x, 2, '第一次撤销应回到第一次交互的终值');
  inst.undo();
  assert.strictEqual(inst._stamps.length, 0, '第二次撤销应回到初始状态');
  cases += 3;
}

/* 4. ★ 核心回归：60 次变更 vs historyLimit=50 —— 旧行为会冲爆栈，新行为不会 */
{
  // 4a. 旧行为（不分组）：确实会冲爆 —— 证明问题真实存在（这条断言是"问题的证据"）
  const bad = mkInst(50);
  for (let i = 1; i <= 60; i++) change(bad, i);
  assert.strictEqual(bad._history.length, 51, '不分组时应被 shift 到上限 51 条');
  for (let i = 0; i < 50; i++) bad.undo();
  assert.strictEqual(bad._historyIdx, 0);
  assert.ok(bad._stamps.length > 0,
    '旧行为：撤到最底也回不到初始（初始状态已被挤出栈）—— 这正是 D11 的危害');
  cases += 1;

  // 4b. 新行为（分组）：60 次变更压成 1 步，且初始状态仍在栈底
  const good = mkInst(50);
  good.beginHistoryGroup('nudge:a1:1');
  for (let i = 1; i <= 60; i++) change(good, i);
  good.endHistoryGroup();
  assert.strictEqual(good._history.length, 2, '分组后 60 次变更只应占 1 步历史');
  good.undo();
  assert.strictEqual(good._historyIdx, 0);
  assert.strictEqual(good._stamps.length, 0, '一次撤销即回到初始状态（栈底未被挤出）');
  cases += 3;
}

/* 5. 不同分组键不互相合并（换了一个签章/换了一步长 = 新的一步） */
{
  const inst = mkInst(50);
  inst.beginHistoryGroup('nudge:a1:1'); change(inst, 1); inst.endHistoryGroup();
  inst.beginHistoryGroup('nudge:a2:1'); change(inst, 2); inst.endHistoryGroup();
  assert.strictEqual(inst._history.length, 3, '不同 key 的两次交互不应合并');
  cases += 1;
}

/* 6. ★ undo 必须让"合并上下文"失效，否则会吃掉一条合法历史
 *    场景：在 B 状态撤销后，同 key 的新变更会（若上下文未清）覆盖 A 而不是新增，
 *    表现为"撤一步直接回到起点"，用户丢了一步。 */
{
  const inst = mkInst(50);
  change(inst, 1);                                  // [init, S1]
  inst.beginHistoryGroup('k'); change(inst, 2);     // [init, S1, S2]（merged='k'）
  inst.endHistoryGroup();
  inst.undo();                                      // idx 回到 S1
  inst.beginHistoryGroup('k'); change(inst, 3);     // 同 key
  assert.strictEqual(inst._history.length, 3,
    'undo 后同 key 的新变更必须新增一条，不能覆盖栈顶（否则丢失 S1 这一步）');
  inst.undo();
  assert.ok(inst._stamps.length && inst._stamps[0].x === 1,
    '撤销一次应回到 S1（x=1），而不是直接回到初始');
  cases += 2;
}

/* 7. redo 分支被截断后，合并上下文同样失效 */
{
  const inst = mkInst(50);
  inst.beginHistoryGroup('k'); change(inst, 1); inst.endHistoryGroup();
  change(inst, 2);
  inst.undo();                                      // 不在栈顶，存在 redo 分支
  inst.beginHistoryGroup('k'); change(inst, 3);     // 截断 redo 分支 + 同 key
  assert.strictEqual(inst._history.length, 3, '截断 redo 分支后应正常新增');
  assert.strictEqual(inst._histMergedKey, 'k');
  cases += 2;
}

/* 8. _resetHistory（换文档/换页）必须同时清掉分组与合并上下文 */
{
  const inst = mkInst(50);
  inst.beginHistoryGroup('k'); change(inst, 1); change(inst, 2);
  assert.strictEqual(inst._histGroupKey, 'k');
  inst._resetHistory();
  assert.strictEqual(inst._history.length, 1, '重置后只剩初始状态');
  assert.strictEqual(inst._historyIdx, 0, '重置后索引归零');
  assert.strictEqual(inst._histGroupKey, null, '重置必须清掉进行中的分组键');
  assert.strictEqual(inst._histMergedKey, null, '重置必须清掉栈顶合并键');
  cases += 4;
}

/* 9. 分组不改变"每次变更都发出通知"的语义：历史合并 ≠ 状态不更新 */
{
  const inst = mkInst(50);
  inst.beginHistoryGroup('k');
  change(inst, 7);
  assert.strictEqual(inst._stamps[0].x, 7, '分组期间状态照常实时更新（只是历史被合并）');
  assert.strictEqual(inst._history.length, 2);
  change(inst, 9);
  assert.strictEqual(inst._stamps[0].x, 9, '分组期间第二次变更同样实时生效');
  assert.strictEqual(inst._history.length, 2, '但历史仍只有一步');
  cases += 3;
}

/* 10. 快照是浅拷贝：历史条目不应被后续状态修改污染 */
{
  const inst = mkInst(50);
  change(inst, 1);
  inst._stamps[0].x = 999;                          // 直接改当前状态
  assert.strictEqual(inst._history[1][0].x, 1, '历史快照必须与后续修改隔离');
  cases += 1;
}

console.log('=== 历史分组单测通过：' + cases + ' 项断言'
  + '（不分组语义 / 一次按住=一步 / 两次按住=两步 / 60 次变更不冲爆 / 跨 key 不合并 /'
  + ' undo 与 redo 分支失效 / 重置清理 / 分组不影响实时状态 / 快照隔离）===');
