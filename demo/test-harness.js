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
  /* 需要"长串不断行"保护的容器 —— 样式规则与响应式套件的探针共用这一份名单，
     避免"要包哪些容器"出现两份各自维护的副本（历史上正是这么漂移的）。 */
  var LONG_TEXT_SEL = '#log,#log div,#detail,#output,#rlog,.log,.result,pre';

  var state = {
    page: (location.pathname.split('/').pop() || '').replace(/\.html$/, ''),
    title: document.title,
    keepPageTitle: false,   // true = 不覆盖 <title>，结果画进页内角标（见 __TEST.start 的 opts）
    status: 'running',      // running | done | error
    expected: null,         // 声明的断言条数（null = 不校验）
    total: 0,
    passed: 0,
    failed: 0,
    cases: [],
    error: null,
    durationMs: 0,
    startedAt: startedAt,
    done: false,
    /* 套件附加数据：供 run-all 做**跨套件**对账（如各框架页算出的 document.hash 必须一致）。
       没有它时跨页一致性只能靠"人肉看过 5 个页面"——正是回归可信度最薄弱的一环。 */
    extras: {}
  };
  window.__RESULT__ = state;

  function sync() {
    state.total = state.cases.length;
    state.passed = state.cases.filter(function (c) { return c.pass; }).length;
    state.failed = state.total - state.passed;
  }

  /** 把当前结果渲染成一行文本；ok 只在跑完时有意义（null = 运行中） */
  function resultInfo() {
    if (state.status === 'running') return { ok: null, text: (state.title || '') + ' …running' };
    var bad = state.failed;
    // 漏跑检测：声明了条数却对不上，同样算失败（防止"少测了"被当作全绿）
    if (state.expected !== null && state.total !== state.expected) bad += 1;
    return {
      ok: bad === 0,
      text: (bad === 0 ? 'PASS ' : 'FAIL ') + state.passed + '/' + state.total +
        (state.expected !== null ? ' (expect ' + state.expected + ')' : '') +
        ' — ' + state.page
    };
  }

  /** 结果输出的**唯一出口**：正常走 <title>，展示页走页内角标（见 start 的 opts.keepTitle） */
  function updateTitle() {
    var r = resultInfo();
    if (state.keepPageTitle) { renderBadge(r); return; }
    document.title = r.text;
  }

  /** 页内右下角固定角标：展示页保住自己的 <title> 后，跑分仍要让人看得见 */
  function renderBadge(r) {
    var el = document.getElementById('__harness-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = '__harness-badge';
      /* 两个关键约束：
         ① position:fixed —— 固定定位的盒子不参与文档的可滚动溢出区，
            否则会污染响应式套件（⑰）的"窄视口下页面不该横向溢出"判定
         ② pointer-events:none —— 点击穿透，不会挡住画布上的指针事件套件（⑫ 等） */
      el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;' +
        'pointer-events:none;font:600 12px/1.4 ui-monospace,Menlo,Consolas,monospace;' +
        'padding:4px 8px;border-radius:6px;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.35);' +
        'max-width:calc(100vw - 16px);overflow-wrap:anywhere;white-space:normal;text-align:right';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = r.text;
    el.style.background = r.ok === null ? 'rgba(17,17,17,.86)'
      : (r.ok ? 'rgba(11,110,60,.92)' : 'rgba(160,25,25,.92)');
  }

  window.__TEST = {
    /** 长文本容器名单（与注入的样式规则同源）—— 响应式套件的探针据此选宿主 */
    LONG_TEXT_SEL: LONG_TEXT_SEL,
    /** 启动套件。
     *  opts.keepTitle = true → **不覆盖 document.title**，改把结果画进页内右下角标。
     *  给"既是展示页、又是回归套件"的页面用（目前 index.html）：该页的 <title> 是要给人认
     *  产品的（也承担版本号展示位，docs.test.js 会对账），不该被跑分长期占用。
     *  纯测试页保持默认 false —— 直接开一堆标签时扫一眼标题就知道谁挂了。
     *  注意 run-all 聚合器读的是 window.__RESULT__，**不依赖 <title>**，所以这里怎么选都不影响回归。 */
    start: function (title, opts) {
      state.keepPageTitle = !!(opts && opts.keepTitle);
      if (title) { state.title = title; if (!state.keepPageTitle) document.title = title; }
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
     * 记录套件级附加数据（run-all 会读它做跨套件对账）。
     * 例：__TEST.tag('docHash', p.getHash()) —— 所有对同一 PDF 的套件必须得到同一个值。
     */
    tag: function (key, value) { state.extras[key] = value; return state; },

    /**
     * 框架集成冒烟（Vue2 / Vue3 / React / AngularJS 共用同一份断言契约）。
     *
     * 为什么收口到 harness：
     *   这 4 个页面过去**完全不在自动回归内**，只能人肉打开看日志 —— 于是"某个框架下
     *   PDF 没加载出来 / hash 算出 null / 确认按钮根本没接上"这类问题，
     *   只要没人手工点开那一个页面就永远发现不了。断言收在一处，4 个页面共享同一契约，
     *   将来新增框架页也只是多一行调用。
     *
     * 前提：页面需把实例暴露为 window.__picker（一行），并把"确认"按钮与日志元素留在页面上。
     * 断言（9 条）+ 两个 tag（docHash / totalPages）供 run-all 跨套件对账。
     */
    frameworkSmoke: function (opts) {
      var self = this;
      var N = opts.name || '框架';
      var t = opts.timeout || 40000;
      function rec(n, pass, detail) { __TEST.record(N + '：' + n, pass, detail); }
      function readHash(p) {
        // ★ 注意：getHash() 返回的是 **Promise**；同步取值只有 toJSON().document.hash
        var j = p.toJSON();
        return (j.document && j.document.hash) || '';
      }
      function findConfirmButton() {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          var txt = btns[i].textContent || '';
          if (txt.indexOf('确认') >= 0 && txt.indexOf('弹窗') < 0) return btns[i];
        }
        return null;
      }
      var hash1 = '';
      return this.waitFor(function () { return window.__picker || null; }, t, 'picker 实例未创建')
        .then(function (p) {
          rec('库已加载且版本可读',
            typeof window.PdfStampPicker === 'function' && !!window.PdfStampPicker.version,
            'v' + ((window.PdfStampPicker && window.PdfStampPicker.version) || '?'));
          rec(opts.framework + ' 框架已就绪', !opts.vendorOk || !!opts.vendorOk(), opts.framework + ' 全局对象存在');
          rec('实例是 PdfStampPicker', !!(p && typeof p.toJSON === 'function' && typeof p.destroy === 'function'),
            p && p.constructor && p.constructor.name);
          return self.waitFor(function () { return p.getTotalPages() > 0 ? p : null; }, t, 'PDF 未加载完成');
        })
        .then(function (p) {
          rec('PDF 加载完成且页数正确', p.getTotalPages() === opts.expectedPages,
            '页数 ' + p.getTotalPages() + '（期望 ' + opts.expectedPages + '）');
          hash1 = readHash(p);
          rec('document.hash 是 SHA-256', /^[0-9a-f]{64}$/.test(hash1),
            hash1 ? hash1.slice(0, 16) + '…' : '空');
          rec('hash 幂等（重复取同一文档不变）', readHash(p) === hash1,
            hash1.slice(0, 12) + ' vs ' + readHash(p).slice(0, 12));
          /* API 一致性：getHash() 是 Promise 接口，其 resolve 值必须与 toJSON().document.hash 相同。
             两个出口对同一文档给出不同指纹 = 集成方按文档写代码会拿到不一致的值。 */
          return Promise.resolve(p.getHash()).then(function (h) {
            rec('getHash() Promise 值与 toJSON().document.hash 一致', h === hash1,
              String(h).slice(0, 12) + ' vs ' + hash1.slice(0, 12));
            self.tag('docHash', hash1);
            self.tag('totalPages', p.getTotalPages());
            /* 真实交互：点**页面自己的**按钮（走框架的事件绑定 → 页面自己的 toJSON 路径），
               而不是直接调库 —— 只有这样才能覆盖"框架 ↔ 库"的桥接真的接上了。 */
            var logEl = document.querySelector(opts.logSelector);
            var btn = findConfirmButton();
            if (!btn) throw new Error('未找到"确认"按钮（页面结构变了？）');
            btn.click();
            return self.waitFor(function () {
              var txt = (logEl && logEl.textContent) || '';
              return txt.indexOf(String(opts.expectedUsers)) >= 0 ? txt : null;
            }, 15000, '点击"确认"后日志未更新（' + opts.logSelector + '）');
          });
        })
        .then(function (txt) {
          rec('点"确认"→ 框架侧回写成功（users=' + opts.expectedUsers + '）',
            (txt || '').indexOf(String(opts.expectedUsers)) >= 0, (txt || '').slice(0, 80));
          rec('框架侧读到的 hash 与 picker 一致',
            (txt || '').indexOf(hash1.slice(0, 12)) >= 0, '前 12 位 ' + hash1.slice(0, 12));
          __TEST.finish();
        })
        .catch(function (err) {
          rec('套件未抛错 —— ' + ((err && err.message) || String(err)), false, (err && err.stack) || '');
          __TEST.fail(err);
        });
    },

    /**
     * 轮询等待条件成立（返回 Promise）。用例挂起是本项目历史上最难发现的失败模式
     * （页面停在 running，看起来只是"还没跑完"），所以这里强制要超时，
     * 且超时后 reject 由调用方转成一条**失败断言**，而不是让 promise 永远悬着。
     */
    /* 等"画布布局就绪" —— **派发真实指针事件前必须过这一关**。
       库的 `_onPointerDown` 第一句就是 `if (!this._displayW || !this._displayH) return;`：
       从"文档加载完"到"布局完成（经 rAF / ResizeObserver）"之间存在一个时间窗，此时点击会被
       **静默丢弃** —— 不抛错、不留痕，只表现为"点了没反应"。机器越忙窗口越长。
       实测代价：index 套件**单独**重复跑 8/8 全过（322~414ms），但在完整 run-all 里 4 次挂 1 次
       （⑫ 报"点击后签章未进 JSON"，8s 超时）—— 只等 `getTotalPages() > 0` 是不够的。
       为什么不用 `sleep(140)` 之类"猜时间"：负载高时猜不准，正是偶发的来源。 */
    waitForLayout: function (p, timeoutMs) {
      return this.waitFor(function () {
        if (!p) return null;
        var w = p._displayW | 0, h = p._displayH | 0;
        var ov = p._overlay, r = (ov && ov.getBoundingClientRect) ? ov.getBoundingClientRect() : null;
        return (w > 0 && h > 0 && r && r.width > 0 && r.height > 0)
          ? { w: w, h: h, rectW: Math.round(r.width) } : null;
      }, timeoutMs || 10000, '画布布局就绪（未布局时库会静默丢弃点击）');
    },
    waitFor: function (cond, timeoutMs, label) {
      var t = timeoutMs || 10000;
      return new Promise(function (resolve, reject) {
        var t0 = Date.now();
        (function tick() {
          var v;
          try { v = cond(); } catch (e) { return reject(e); }
          if (v) return resolve(v);
          if (Date.now() - t0 > t) return reject(new Error('waitFor 超时（' + t + 'ms）：' + (label || '条件未成立')));
          setTimeout(tick, 50);
        })();
      });
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

  /**
   * 窄视口基准样式（所有测试页共用）。
   *
   * 为什么放在 harness 而不是各页 CSS：16 个测试页各自维护样式，逐个加媒体查询
   * 既容易漏、又会随新页继续欠账；而"用手机打开 run-all/某个测试页时表格横向溢出、
   * 日志被 nowrap 撑出屏幕"是同一个共性缺陷 —— 收口到一处才不会再漂移。
   *
   * 刻意只包在 max-width:640px 里：
   *   - run-all 用 1000px 宽的同源 iframe 驱动各页 → 媒体查询不触发 → **回归结果零影响**
   *   - 一旦有页面的像素/尺寸断言依赖 body 内边距，也不会被这个样式悄悄改变结论
   * 同理不加 iframe 规则：run-all 的 iframe 宽度是被刻意设定的（1000px），压窄会改变被测行为。
   */
  function injectResponsiveBase() {
    if (document.getElementById('__harness-responsive')) return;
    var st = document.createElement('style');
    st.id = '__harness-responsive';
    st.textContent =
      'html{-webkit-text-size-adjust:100%}' +
      '@media (max-width:640px){' +
        'body{padding:8px !important}' +
        'pre{white-space:pre-wrap !important;word-break:break-word;overflow-wrap:anywhere}' +
        /* 64 位 hash / 长路径这类**无空格长串**默认不断行，是窄屏横向溢出的主因。
           ★ 这个名单是"要保护哪些长文本容器"的唯一真源：它同时被
             ①本样式规则 ②响应式套件的长串探针 消费（__TEST.LONG_TEXT_SEL）。
           曾经的问题：名单里没有主展示页的 #output（它只靠自己的 word-break 侥幸不溢出），
           而探针又另抄一份宿主名单 —— 两边一旦不一致，"探针所在容器被保护了没有"就说不清。 */
        LONG_TEXT_SEL + '{overflow-wrap:anywhere}' +
        'table{display:block;overflow-x:auto;max-width:100%}' +
        'th,td{word-break:break-word}' +
        'h1{font-size:17px}h2{font-size:15px}' +
      '}';
    document.head.appendChild(st);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectResponsiveBase);
  else injectResponsiveBase();

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
