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
    },

    /**
     * 给全局对象上的方法安全打桩 —— 绕过 webpack 产物的【只读 getter】。
     *
     * 为什么必须有它（真实踩坑，代价很大）：
     *   pdf.min.js 这类 webpack 打包库用
     *       Object.defineProperty(exports, 'getDocument', {enumerable:true, get:fn})
     *   导出，描述符是 {enumerable:true, configurable:false} —— **没有 setter、也不可重定义**。
     *   于是测试页里最自然的写法 `lib.getDocument = myFn` 在**非严格模式下静默失败**：
     *   不抛错、控制台干净、`typeof` 看起来也对，但桩一次都不会被调用。
     *   后果不是"报错"，而是**依赖该桩的用例全部退化成"赌真实耗时"**——
     *   机器快一点/慢一点结论就翻转，失败信息还指向被测库，排查方向被彻底带偏。
     *   （本次 h1 的 ⑥ 前提自检正是因此亮红：`__gdLog=[]`，桩从未被调到。）
     *
     * 做法：描述符不可写就**克隆宿主**（原样搬运其它属性的描述符，
     * GlobalWorkerOptions / PDFWorker 等仍共享同一引用），在新对象上定义可写的桩，
     * 并写回 window[holderKey]；最后**自检**，没装上就当场抛错。
     *
     * @param {string} holderKey  全局对象名，如 'pdfjsLib'
     * @param {string} methodName 方法名，如 'getDocument'
     * @param {(real:Function, holder:object) => Function} make 生成包装函数
     * @returns {{real:Function, wrapper:Function, holder:object}}
     */
    swapGlobalMethod: function (holderKey, methodName, make) {
      var src = window[holderKey];
      if (!src) throw new Error('swapGlobalMethod: window.' + holderKey + ' 不存在');
      var real = src[methodName];
      if (typeof real !== 'function') throw new Error('swapGlobalMethod: ' + holderKey + '.' + methodName + ' 不是函数');
      var wrapper = make(real, src);
      var desc = Object.getOwnPropertyDescriptor(src, methodName);
      var holder;
      if (desc && !desc.get && !desc.set && desc.writable === true && desc.configurable === true) {
        src[methodName] = wrapper;                       // 普通可写属性：直接赋值
        holder = src;
      } else {
        var clone = Object.create(Object.getPrototypeOf(src));   // 只读 getter/不可写/不可配置 → 克隆宿主
        Object.getOwnPropertyNames(src).forEach(function (k) {
          if (k === methodName) return;
          Object.defineProperty(clone, k, Object.getOwnPropertyDescriptor(src, k));
        });
        Object.defineProperty(clone, methodName, { value: wrapper, writable: true, enumerable: true, configurable: true });
        window[holderKey] = clone;
        holder = clone;
      }
      // ★ 自检：宁可让用例炸在"桩根本没装上"，也不要它在假前提下"看起来通过"
      if (window[holderKey][methodName] !== wrapper) {
        throw new Error('swapGlobalMethod: 打桩失败（' + holderKey + '.' + methodName + ' 未被替换）');
      }
      return { real: real, wrapper: wrapper, holder: holder };
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
