/**
 * destroy 之后"空操作"契约单测（M3 根治，v4.9.6）
 *
 * 背景：INTEGRATION.md 第 12 章承诺「destroy() 之后所有公开方法均为空操作」，但旧实现
 * 只在 8 处写了 `_destroyed` 检查 —— setPage / setZoom / fitWidth / exportImage /
 * setCurrentUser 在销毁后直接抛 TypeError（去读已被置 null 的 _pdf / _canvas / _root）。
 * 宿主最典型的形态是"组件卸载时 destroy()，但定时器/异步回调/第三方库仍可能再碰一次实例"，
 * 一次 TypeError 就足以让宿主页面白屏，且失败点不在库的调用栈里，极难定位。
 *
 * 本轮把归类收口到一张表（PdfStampPicker._destroySafe），本文件负责两件事：
 *   ① **双向对账**：原型上每个公开方法都必须有归类；表里每一项也都必须指向真实方法。
 *      —— 没有它，"46 个方法都登记了吗"只能靠人眼数（旧实现就是这么欠了 5 个）。
 *   ② 归类**语义**：'this' / 'promise-void' / 'promise-null' / 'keep' 四种返回值逐类实测。
 *
 * ★ 防"假通过"：任何"集合 ⊆ 集合"的断言都可能是空转的（两边都空也成立）。因此本文件带
 *   自检 + 正负控：
 *     · 临时往原型上挂一个方法 → 必须被"未登记"检查抓到（证明检查不是空转）
 *     · 未销毁实例调 setMode('bogus') → 必须仍抛库自己的错（证明包裹没吞掉 method body）
 *     · 已销毁实例调 setMode('bogus') → 必须返回实例（证明守卫**在 body 之前**短路）
 */
'use strict';
const assert = require('assert');
const path = require('path');

const Picker = require(path.join(__dirname, '..', 'pdf-stamp-picker.js'));

let cases = 0;

/** 公开方法名（约定：下划线开头为内部成员，不是对外契约） */
function publicMethods() {
  return Object.getOwnPropertyNames(Picker.prototype)
    .filter(n => n !== 'constructor' && n[0] !== '_');
}
const TABLE = Picker._destroySafe;
const KINDS = ['this', 'promise-void', 'promise-null', 'keep'];

/** 造一个"已销毁"的假实例：只继承真实原型 + 置 _destroyed（守卫只看这一个标志） */
function destroyedInst() {
  const inst = Object.create(Picker.prototype);
  inst._destroyed = true;
  inst._options = {};
  inst._stamps = [];
  inst._users = [];
  inst._history = [];
  inst._historyIdx = 0;
  inst._sel = null;
  inst._activeId = null;
  inst._docName = '';
  inst._totalPages = 0;
  inst._pageNumber = 1;
  inst._pdfW = 0; inst._pdfH = 0; inst._rotation = 0;
  inst._displayW = 0; inst._displayH = 0;
  inst._offsetX = 0; inst._offsetY = 0;
  inst._pdfHash = null; inst._pdfHashPromise = null; inst._pdfHashPending = null;
  inst._listeners = {};
  return inst;
}

(async function main() {
  /* ============ 1. 守卫表 ↔ 原型：双向对账 ============ */
  {
    const names = publicMethods();
    assert.ok(names.length >= 40, '公开方法数量异常（解析自检）：' + names.length);
    assert.ok(TABLE && typeof TABLE === 'object', '库必须导出 _destroySafe 归类表');

    const missing = names.filter(n => !(n in TABLE));
    assert.deepStrictEqual(missing, [],
      '这些公开方法没有在 destroy 守卫表里归类（销毁后会抛错）：' + missing.join(', '));

    const extra = Object.keys(TABLE).filter(n => names.indexOf(n) < 0);
    assert.deepStrictEqual(extra, [],
      '守卫表登记了不存在的公开方法（改名/删除后忘了同步）：' + extra.join(', '));

    assert.strictEqual(Object.keys(TABLE).length, names.length, '归类表必须与公开方法一一对应');
    cases += 4;
  }

  /* ============ 2. 归类值合法性 + 检查本身不是空转 ============ */
  {
    Object.keys(TABLE).forEach(n => {
      assert.ok(KINDS.indexOf(TABLE[n]) >= 0, n + ' 的归类值非法：' + TABLE[n]);
    });
    cases += 1;

    // ★ 自检：临时挂一个"忘了登记"的公开方法 → 未登记检查必须抓到它
    Picker.prototype.zzForgotToRegister = function () { return 1; };
    try {
      const missing = publicMethods().filter(n => !(n in TABLE));
      assert.deepStrictEqual(missing, ['zzForgotToRegister'],
        '"未登记"检查必须能抓到漏登记的新方法（否则它是空转的）');
    } finally {
      delete Picker.prototype.zzForgotToRegister;
    }
    assert.ok(publicMethods().indexOf('zzForgotToRegister') < 0, '自检用的临时方法必须已清理');
    cases += 2;
  }

  /* ============ 3. 空操作语义：四类返回值逐类实测 ============ */
  {
    const p = destroyedInst();
    const guarded = Object.keys(TABLE).filter(n => TABLE[n] !== 'keep');

    // 3.1 守卫方法一律不抛错；返回值符合归类
    guarded.forEach(n => {
      let ret;
      assert.doesNotThrow(() => { ret = p[n]({ x: 1, y: 2 }, 0.5, 'x'); },
        'destroy 后 ' + n + '() 不能抛错');
      const kind = TABLE[n];
      if (kind === 'this') {
        assert.strictEqual(ret, p, n + ' 归类为 this，必须返回实例本身（链式调用不炸）');
      } else if (kind.indexOf('promise-') === 0) {
        assert.ok(ret && typeof ret.then === 'function', n + ' 归类为 ' + kind + '，必须返回 Promise');
      }
    });
    cases += 1;

    // 3.2 链式：销毁后连续调用不炸，且返回的仍是同一个实例
    assert.strictEqual(p.setZoom(2).fitWidth().setShowGrid(true).undo().redo(), p,
      '销毁后链式调用必须仍然返回实例');
    cases += 1;

    // 3.3 豁免方法：不是"空操作"，而是"本来就不会抛错、返回值语义依然成立"
    assert.deepStrictEqual(p.getStamps(), [], 'getStamps 销毁后必须是 []（不能是 undefined）');
    assert.strictEqual(p.getDocName(), '', 'getDocName 销毁后为 ""');
    assert.strictEqual(p.getTotalPages(), 0, 'getTotalPages 销毁后为 0');
    assert.strictEqual(p.getSelection(), null);
    assert.strictEqual(p.getActiveStamp(), null);
    assert.deepStrictEqual(p.getStampsByUser('u1'), []);
    const json = p.toJSON();
    assert.strictEqual(json.document.pages, 0, 'toJSON 销毁后仍是合法空文档结构（pages=0）');
    assert.ok(Array.isArray(json.users), 'toJSON 销毁后 users 仍是数组');
    assert.strictEqual(typeof p.screenToPdf(1, 2).x, 'number', 'screenToPdf 销毁后仍返回数值（不触碰 DOM）');
    assert.strictEqual(typeof p.pdfToScreen(1, 2).y, 'number');
    cases += 9;
  }

  /* ============ 4. Promise 类：绝不 reject（卸载流程里不该出现未处理拒绝） ============ */
  {
    const p = destroyedInst();
    const got = [];
    await p.importJSON({ users: [{ id: 'u1', name: 'A' }] }).then(v => got.push(['importJSON', v]));
    await p.exportImage().then(v => got.push(['exportImage', v]));
    await p.getHash().then(v => got.push(['getHash', v]));
    assert.deepStrictEqual(got, [['importJSON', undefined], ['exportImage', null], ['getHash', null]]);
    cases += 3;
  }

  /* ============ 5. destroy 自身幂等（豁免项） ============ */
  {
    const q = destroyedInst();
    assert.doesNotThrow(() => { q.destroy(); q.destroy(); }, 'destroy 必须可重复调用');
    cases += 1;
  }

  /* ============ 6. 正负控：包裹没有吞掉 method body，也没有提前短路 ============ */
  {
    // 负控：未销毁实例 → setMode('bogus') 仍必须抛【库自己的】错（参数透传 + body 照跑）
    const live = destroyedInst();
    live._destroyed = false;
    assert.throws(() => live.setMode('bogus'), /mode 仅支持 point \| rect \| stamp/,
      '未销毁实例的方法行为不能被包裹改变（参数必须透传、body 必须照跑）');
    // 正控：同一非法入参，销毁后必须**不抛**且返回 this（证明守卫在 body 之前短路）
    const dead = destroyedInst();
    let ret;
    assert.doesNotThrow(() => { ret = dead.setMode('bogus'); },
      '销毁后守卫必须在 body 之前短路（连非法入参也不该再抛错）');
    assert.strictEqual(ret, dead, '短路返回实例本身');
    cases += 3;
  }

  console.log('=== destroy 空操作契约单测通过：' + cases + ' 组断言'
    + '（归类表双向对账 / 未登记自检 / 四类返回值 / 链式不断 / 豁免语义 /'
    + ' Promise 不 reject / destroy 幂等 / 正负控：包裹不吞 body、守卫前置短路）===');
})().catch(function (err) {
  console.error(err && err.stack || err);
  process.exit(1);
});
