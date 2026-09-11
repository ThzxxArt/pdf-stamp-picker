/*!
 * PdfStampPicker 浏览器回归测试 —— 统一结果协议（test-harness.js）
 *
 * 为什么需要它：
 *   过去回归靠"手工打开 demo 页、肉眼看日志"，踩过两个坑：
 *     ① 断言写错（坏用例放错层级被忽略）→ 页面显示全绿，实际没测到 → 假通过
 *     ② 用例挂起（promise 永不 resolve）→ 日志停在中间，看起来"还没跑完"，被人忽略
 *   本 harness 把结果收敛成机器可读的 window.__RESULT__，并由 run-all.html 聚合，
 *   使"没有断言 / 断言漏跑 / 挂起"三种情况都会显式变成失败。
 *
 * 约定（每个测试页必须遵守）：
 *   - 引入本文件后调用 __TEST.start(标题)
 *   - 每个断言用 __TEST.record(name, pass, detail)
 *   - 全部跑完调用 __TEST.finish()（未调用 = 挂起，聚合器判 FAIL）
 *   - 期望的断言条数用 __TEST.expect(n) 声明（未达数 = 有漏跑，判 FAIL）
 */
(function () {
  var startedAt = Date.now();
  var state = {
    page: (location.pathname.split('/').pop() || '').replace(/\.html$/, ''),
    title: document.title,
    status: 'running',      // running | done | error
    expected: null,         // 声明的断言条数（null = 不校验）
    total: 0,
    passed: 0,
    failed: 0,
    cases: [],
    error: null,
    durationMs: 0,
    startedAt: startedAt,
    done: false
  };
  window.__RESULT__ = state;

  function sync() {
    state.total = state.cases.length;
    state.passed = state.cases.filter(function (c) { return c.pass; }).length;
    state.failed = state.total - state.passed;
  }

  function updateTitle() {
    if (state.status === 'running') { document.title = (state.title || '') + ' …running'; return; }
    var bad = state.failed;
    // 漏跑检测：声明了条数却对不上，同样算失败（防止"少测了"被当作全绿）
    if (state.expected !== null && state.total !== state.expected) bad += 1;
    document.title = (bad === 0 ? 'PASS ' : 'FAIL ') + state.passed + '/' + state.total +
      (state.expected !== null ? ' (expect ' + state.expected + ')' : '') +
      ' — ' + state.page;
  }

  window.__TEST = {
    start: function (title) {
      if (title) { state.title = title; document.title = title; }
      updateTitle();
      return state;
    },
    /** 声明本页应有的断言条数：跑完了条数对不上 → 判失败 */
    expect: function (n) { state.expected = n; return state; },
    record: function (name, pass, detail) {
      state.cases.push({ name: name, pass: !!pass, detail: detail == null ? '' : String(detail) });
      sync();
      return state;
    },
    finish: function () {
      sync();
      state.status = state.error ? 'error' : 'done';
      state.done = true;
      state.durationMs = Date.now() - startedAt;
      updateTitle();
      return state;
    },
    /** 当前结果快照（页面想自己打印汇总时用；**不要**写成 __TEST.state，那是未定义）
     *  历史坑：某页写 `__TEST.state.cases` → TypeError 未处理拒绝 → 被下面的兜底监听记成
     *  「未处理的 Promise 拒绝」，页面上看不到日志行，只表现为 total 比 expect 多 1 → 假失败。 */
    summary: function () {
      sync();
      return { title: state.title, page: state.page, status: state.status, total: state.total,
               passed: state.passed, failed: state.failed, expected: state.expected,
               cases: state.cases.slice() };
    },
    fail: function (err) {
      state.error = (err && err.message) || String(err);
      state.status = 'error';
      state.done = true;
      state.durationMs = Date.now() - startedAt;
      updateTitle();
      return state;
    }
  };

  // 兜底：未捕获异常 → 记为失败（否则页面静默停在 running，聚合器只能靠超时发现）
  window.addEventListener('error', function (e) {
    if (state.done) return;
    state.cases.push({ name: '未捕获异常', pass: false, detail: (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || '') });
    sync();
    __TEST.fail(e.error || new Error(e.message));
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (state.done) return;
    var r = e.reason || {};
    state.cases.push({ name: '未处理的 Promise 拒绝', pass: false, detail: r.message || String(r) });
    sync();
    __TEST.fail(r);
  });
})();
