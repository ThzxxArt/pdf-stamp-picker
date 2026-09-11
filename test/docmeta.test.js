/**
 * 文档元信息 getter 单测（v4.9.3 起）
 *
 * 背景（DX 缺口）：过去想拿"当前文档名 / 总页数"只能 `picker.toJSON().document`
 * —— 为了读两个字段构建整份 JSON（含全部签章、含 dataURL）。
 * 现在有 getDocName() / getTotalPages()（v4.9.3 新增）。
 *
 * 本测试要钉死的三件事：
 *   1. **同源**：getter 必须与 toJSON().document 读到同一个值（防止"两个出口各读一份、
 *      将来只改一处"的漂移 —— 这正是本项目 D7 类缺陷的形态）。
 *   2. **0 的语义**：未加载文档时 getTotalPages() === 0，而不是 1。
 *      "没有文档"与"有一份 1 页的文档"必须能区分，这是 getter 存在的意义之一。
 *   3. **唯一来源**：toJSON 与 toFlatJSON 的 document 块字段集合必须一致
 *      （重构前两处各抄了一份同样的 10 个字段字面量，加字段漏改一处即漂移）。
 *
 * 只驱动真实原型方法（_docMeta / _hashStatus / _resetDocState / _resetHistory /
 * toJSON / toFlatJSON / getDocName / getTotalPages），DOM 相关不参与。
 */
'use strict';
const assert = require('assert');
const path = require('path');

const P = require(path.join(__dirname, '..', 'pdf-stamp-picker.js'));

let cases = 0;
const ok = () => { cases++; };

/** 最小实例：真实的文档元信息逻辑 + 其余字段手动给值 */
function mkInst(seed) {
  return Object.assign({
    _docName: '', _totalPages: 0, _pageNumber: 1,
    _pdfW: 0, _pdfH: 0, _rotation: 0, _offsetX: 0, _offsetY: 0,
    _pdfHash: null, _pdfHashPromise: null, _pdfHashPending: null,
    _pdfBytes: null, _pdfBytesRef: null,
    _stamps: [], _activeId: null, _sel: null, _users: null,
    _history: [[]], _historyIdx: 0, _lastError: null, _loadStage: '',
    // 真实逻辑（不抄一份规则）
    _docMeta: P.prototype._docMeta,
    _hashStatus: P.prototype._hashStatus,
    _resetDocState: P.prototype._resetDocState,
    _resetHistory: P.prototype._resetHistory,
    getDocName: P.prototype.getDocName,
    getTotalPages: P.prototype.getTotalPages,
    toJSON: P.prototype.toJSON,
    toFlatJSON: P.prototype.toFlatJSON
  }, seed || {});
}

/* 1. 未加载文档：'' / 0（0 而不是 1） */
{
  const p = mkInst();
  assert.strictEqual(p.getDocName(), '');
  assert.strictEqual(p.getTotalPages(), 0);
  ok();
}

/* 2. 0 与 1 必须可区分（0 = 没有文档） */
{
  const none = mkInst();
  const onePage = mkInst({ _docName: '一页.pdf', _totalPages: 1 });
  assert.notStrictEqual(none.getTotalPages(), onePage.getTotalPages());
  assert.strictEqual(none.getTotalPages(), 0);
  assert.strictEqual(onePage.getTotalPages(), 1);
  ok();
}

/* 3. 加载后返回真实值，且不被夹取/取整（含大页数） */
{
  [1, 3, 8, 999, 100000].forEach(function (n) {
    const p = mkInst({ _docName: 'a.pdf', _totalPages: n });
    assert.strictEqual(p.getTotalPages(), n, 'pages=' + n);
  });
  const p = mkInst({ _docName: '三方采购合同.pdf', _totalPages: 12 });
  assert.strictEqual(p.getDocName(), '三方采购合同.pdf');
  ok();
}

/* 4. ★ 同源：getter === toJSON().document{name,pages} === toFlatJSON().document{...} */
{
  const p = mkInst({ _docName: '合同 A.pdf', _totalPages: 7, _pdfW: 595.28, _pdfH: 841.89 });
  const j = p.toJSON();
  const f = p.toFlatJSON();
  assert.strictEqual(p.getDocName(), j.document.name);
  assert.strictEqual(p.getTotalPages(), j.document.pages);
  assert.strictEqual(p.getDocName(), f.document.name);
  assert.strictEqual(p.getTotalPages(), f.document.pages);
  ok();
}

/* 5. 未加载时三个出口一致：都是 0 / ''（不能 getter 说 0、JSON 说 1） */
{
  const p = mkInst();
  const j = p.toJSON();
  assert.strictEqual(j.document.pages, 0);
  assert.strictEqual(j.document.name, '');
  assert.strictEqual(p.getTotalPages(), j.document.pages);
  assert.strictEqual(p.getDocName(), j.document.name);
  ok();
}

/* 6. ★ 唯一来源：toJSON 与 toFlatJSON 的 document 块字段集合一致
      （generatedAt 每次不同，比字段名不比值） */
{
  const p = mkInst({ _docName: 'x.pdf', _totalPages: 2, _pdfHash: 'fa4f75211d968a4b5b6c232f32b604b2f915f83f732c5440c033f3b2a6f3f9ac' });
  const keysOf = (d) => Object.keys(d).sort().join(',');
  assert.strictEqual(keysOf(p.toJSON().document), keysOf(p.toFlatJSON().document));
  // 哈希信息三件套也不能只在一边出现（历史上扁平版完全没有 hash）
  const j = p.toJSON().document, f = p.toFlatJSON().document;
  assert.strictEqual(j.hash, f.hash);
  assert.strictEqual(j.hashAlgorithm, f.hashAlgorithm);
  assert.strictEqual(j.hashStatus, f.hashStatus);
  ok();
}

/* 7. _docMeta 是唯一来源：两者对同一 hashStatus 判定一致 */
{
  const pending = mkInst({ _pdfHashPending: Promise.resolve('x') });
  assert.strictEqual(pending.toJSON().document.hashStatus, 'pending');
  assert.strictEqual(pending.toFlatJSON().document.hashStatus, 'pending');
  const ready = mkInst({ _pdfHash: 'abc' });
  assert.strictEqual(ready.toJSON().document.hashStatus, 'ready');
  assert.strictEqual(ready.toJSON().document.hash, 'abc');
  ok();
}

/* 8. 重置（取消/失败/换文档）后回到"无文档"：0 / '' + JSON 同步归零 */
{
  const p = mkInst({ _docName: '旧文档.pdf', _totalPages: 9, _pdfHash: 'deadbeef' });
  p._resetDocState();
  assert.strictEqual(p.getTotalPages(), 0);
  assert.strictEqual(p.getDocName(), '');
  assert.strictEqual(p.toJSON().document.pages, 0);
  assert.strictEqual(p.toJSON().document.name, '');
  // 哈希三件套也应清空（否则新文档会串到旧哈希）
  assert.strictEqual(p.toJSON().document.hashStatus, 'unavailable');
  assert.strictEqual(p.toJSON().document.hash, undefined);
  ok();
}

/* 9. getter 是只读纯读取：不改状态、可重复调用 */
{
  const p = mkInst({ _docName: 'a.pdf', _totalPages: 4 });
  /* ★ generatedAt 是"构建时刻"（每次导出都刷新，设计如此）→ 整体比较 JSON 字符串
     必然跨毫秒假失败（实测：两次调用差 1ms 就红）。比较前剔除它，
     再单独断言它确实存在且可解析 —— 否则剔除会把"字段丢了"一起盖住。 */
  const stableDoc = function () {
    const d = JSON.parse(JSON.stringify(p.toJSON().document));
    delete d.generatedAt;
    return JSON.stringify(d);
  };
  const before = stableDoc();
  assert.strictEqual(p.getTotalPages(), 4);
  assert.strictEqual(p.getTotalPages(), 4);
  assert.strictEqual(p.getDocName(), 'a.pdf');
  assert.strictEqual(p.getDocName(), 'a.pdf');
  assert.strictEqual(p._docName, 'a.pdf');
  assert.strictEqual(p._totalPages, 4);
  assert.strictEqual(stableDoc(), before);
  const ga = p.toJSON().document.generatedAt;
  assert.ok(typeof ga === 'string' && !isNaN(Date.parse(ga)), 'generatedAt 应是可解析的时间戳，实际 ' + ga);
  ok();
}

/* 10. 无签章时也应有文档块（getter 是唯一的"文档存在性"读取途径，不依赖签章） */
{
  const p = mkInst({ _docName: 'empty.pdf', _totalPages: 5 });
  const j = p.toJSON();
  // toJSON 按用户分组（签章嵌在 users[].stamps），扁平版才有顶层 stamps
  assert.ok(Array.isArray(j.users) && j.users.length >= 1);
  assert.strictEqual(j.users.reduce((a, u) => a + u.stamps.length, 0), 0);
  assert.strictEqual(p.toFlatJSON().stamps.length, 0);
  assert.strictEqual(p.getTotalPages(), 5);
  assert.strictEqual(p.getDocName(), 'empty.pdf');
  ok();
}

console.log('=== 文档元信息单测通过：' + cases + ' 组断言'
  + '（未加载 空串/0 / 0≠1 可区分 / 真实值与边界 / getter↔toJSON↔toFlatJSON 同源 /'
  + ' 两导出文档块字段一致 / hashStatus 一致 / 重置归零 / 纯读取幂等 / 无签章可用）===');
