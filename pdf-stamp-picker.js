/*!
 * PdfStampPicker v2.0.0
 * 纯 JavaScript PDF 电子签章坐标选择器 —— 单文件、零依赖、UMD 通用模块
 *
 * v2.0 新增：
 *   - 多签章点：跨页多选区，列表面板管理，每点独立 id/用户/颜色
 *   - 多用户：users 配置 + 当前用户切换，签章点按用户着色与归属
 *   - 一键弹窗：PdfStampPicker.openModal(config) → Promise<JSON>
 *   - 统一加载：load(source) 支持 本地上传 File / ArrayBuffer / 远程静态 URL /
 *     PDF 文件流接口({url, method, headers, body}) / pdfjs proxy
 *   - 自动加载 pdf.js（可配 pdfjsUrl，宿主无需手动引 script）
 *   - JSON 导出：toJSON() / copyJSON()
 *   - 全部 UI（HTML/CSS/工具栏/列表面板）内置，宿主只需一个容器
 *
 * 用法：
 *   // 容器模式
 *   const picker = new PdfStampPicker('#stage', { users: [...] });
 *   await picker.load('https://api.example.com/pdf/123', { headers: { Authorization: 'Bearer x' } });
 *   const json = picker.toJSON();
 *
 *   // 弹窗模式
 *   const json = await PdfStampPicker.openModal({
 *     source: 'https://example.com/contract.pdf',
 *     users: [{ id: 'a', name: '甲方', color: '#4285f4' }]
 *   });
 *
 * 坐标约定：
 *   - 屏幕坐标：CSS 像素，原点在页面显示区域左上角，Y 向下
 *   - PDF 坐标：point（1/72 inch），原点在页面左下角，Y 向上（含 CropBox 偏移）
 *   - 旋转补偿公式（r 为页面顺时针旋转角度）：
 *       r=0:   x = cx/sx,          y = H - cy/sy
 *       r=90:  x = cy/sy,          y = cx/sx
 *       r=180: x = W - cx/sx,      y = H - cy/sy
 *       r=270: x = W - cy/sy,      y = H - cx/sx
 */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? (module.exports = factory())
    : typeof define === 'function' && define.amd
      ? define(factory)
      : ((global = typeof globalThis !== 'undefined' ? globalThis : global || self),
        (global.PdfStampPicker = factory()));
})(this, function () {
  'use strict';

  var VERSION = '4.3.0';

  /* ====================== 常量 ====================== */

  var PT_PER_MM = 72 / 25.4;
  var DEFAULT_DPI = 96;
  var CDN_PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var CDN_PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var DEFAULT_USERS = [{ id: 'default', name: '默认', color: '#4285f4' }];
  var STAMP_COLORS = ['#4285f4', '#ea4335', '#34a853', '#f9ab00', '#a142f4', '#12b5cb', '#e8710a', '#5f6368'];

  var CSS = [
    /* ===== 基础 ===== */
    '.psp-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:var(--psp-bg,#e8eaed);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;color:var(--psp-fg,#1f2328);outline:none;user-select:none;-webkit-user-select:none;touch-action:manipulation}',
    '.psp-main{flex:1;display:flex;min-height:0}',
    '.psp-scroll{flex:1;overflow:auto;position:relative;overscroll-behavior:contain;background:var(--psp-bg,#e8eaed)}',
    '.psp-stage{display:flex;align-items:flex-start;justify-content:center;min-width:100%;min-height:100%;padding:32px 28px;box-sizing:border-box}',
    '.psp-page{position:relative;box-shadow:0 1px 3px rgba(60,64,67,.18),0 8px 28px rgba(60,64,67,.22),0 24px 64px rgba(60,64,67,.16);background:#fff;flex:none;border-radius:2px;transition:box-shadow .3s ease}',
    '.psp-page:hover{box-shadow:0 1px 3px rgba(60,64,67,.2),0 12px 40px rgba(60,64,67,.28),0 32px 80px rgba(60,64,67,.2)}',
    '.psp-canvas{position:absolute;left:0;top:0;display:block;pointer-events:none}',
    '.psp-overlay{position:absolute;left:0;top:0;display:block;touch-action:none;cursor:crosshair;z-index:2}',
    '.psp-overlay.psp-stamp-cursor{cursor:copy}',
    /* ===== 工具栏 ===== */
    '.psp-toolbar{display:flex;align-items:center;gap:4px;padding:8px 12px;background:linear-gradient(180deg,#2b2f36 0%,#23262c 100%);color:#e8eaed;flex-wrap:wrap;z-index:5;font-size:12.5px;flex:none;border-bottom:1px solid rgba(0,0,0,.35);box-shadow:0 1px 4px rgba(0,0,0,.25)}',
    '.psp-toolbar button{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.055);color:#d7dae0;border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer;line-height:1.35;transition:background .18s ease,border-color .18s ease,color .18s ease,box-shadow .18s ease;font-family:inherit}',
    '.psp-toolbar button svg{width:14px;height:14px;flex:none;opacity:.85}',
    '.psp-toolbar button:hover{background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.22);color:#fff}',
    '.psp-toolbar button:active{transform:translateY(1px)}',
    '.psp-toolbar button.active{background:linear-gradient(180deg,#5a95f5,#4285f4);border-color:rgba(255,255,255,.28);color:#fff;box-shadow:0 2px 8px rgba(66,133,244,.45),inset 0 1px 0 rgba(255,255,255,.25)}',
    '.psp-toolbar select{background:#3a3f47;color:#e8eaed;border:1px solid rgba(255,255,255,.14);border-radius:7px;padding:5px 8px;font-size:12px;cursor:pointer;max-width:130px;font-family:inherit;transition:border-color .18s ease}',
    '.psp-toolbar select:hover{border-color:rgba(255,255,255,.3)}',
    '.psp-toolbar .psp-sep{width:1px;height:20px;background:rgba(255,255,255,.14);margin:0 5px;flex:none}',
    '.psp-toolbar .psp-pageinfo{margin-left:auto;opacity:.9;font-variant-numeric:tabular-nums;background:rgba(0,0,0,.28);border-radius:14px;padding:3px 12px;font-size:11.5px;color:#b8bcc4;border:1px solid rgba(255,255,255,.08)}',
    '.psp-toolbar .psp-zoomval{min-width:50px;text-align:center;font-variant-numeric:tabular-nums;color:#b8bcc4;font-size:11.5px}',
    '.psp-toolbar .psp-thumb{width:30px;height:30px;border-radius:8px;object-fit:contain;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);padding:3px;cursor:default;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s ease}',
    '.psp-toolbar .psp-thumb:hover{transform:scale(1.08)}',
    '.psp-toolbar .psp-thumb-zone{display:inline-flex;align-items:center;gap:5px;margin-left:2px}',
    '.psp-toolbar .psp-thumb-label{font-size:10px;color:#9aa0a6;line-height:1.2;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    /* ===== URL 条 ===== */
    '.psp-urlbar{display:none;align-items:center;gap:6px;padding:6px 12px;background:#1c1e22;border-bottom:1px solid rgba(255,255,255,.08);flex:none}',
    '.psp-urlbar.open{display:flex;animation:pspSlideDown .22s ease}',
    '.psp-urlbar input{flex:1;background:#2a2d33;color:#e8eaed;border:1px solid rgba(255,255,255,.14);border-radius:7px;padding:6px 10px;font-size:12px;min-width:0;outline:none;transition:border-color .18s ease,box-shadow .18s ease}',
    '.psp-urlbar input:focus{border-color:#4285f4;box-shadow:0 0 0 3px rgba(66,133,244,.25)}',
    '.psp-urlbar button{flex:none}',
    /* ===== 列表 ===== */
    '.psp-list{width:248px;border-left:1px solid rgba(0,0,0,.1);background:linear-gradient(180deg,#f4f5f7 0%,#eef0f3 100%);color:#202124;display:flex;flex-direction:column;flex:none;min-height:0;box-shadow:-2px 0 8px rgba(60,64,67,.06)}',
    '.psp-list h3{font-size:11px;font-weight:700;padding:14px 14px 8px;color:#5f6368;margin:0;display:flex;justify-content:space-between;align-items:center;letter-spacing:.4px;text-transform:uppercase}',
    '.psp-list h3 .psp-count{background:linear-gradient(135deg,#4285f4,#6aa9ff);color:#fff;border-radius:12px;padding:1px 9px;font-size:10px;box-shadow:0 1px 3px rgba(66,133,244,.4)}',
    '.psp-list-body{flex:1;overflow:auto;padding:2px 10px 12px}',
    '.psp-list-body::-webkit-scrollbar{width:6px}',
    '.psp-list-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.18);border-radius:3px}',
    '.psp-list-empty{font-size:11.5px;color:#9aa0a6;padding:26px 8px;text-align:center;line-height:1.7}',
    '.psp-empty-icon{font-size:22px;margin-bottom:6px;opacity:.7}',
    '.psp-empty-tip{font-size:10.5px;color:#b0b4ba;margin-top:2px}',
    '.psp-group-head{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;color:#5f6368;padding:12px 6px 5px;letter-spacing:.2px}',
    '.psp-group-head .psp-gname{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.psp-group-head .psp-gcount{background:rgba(0,0,0,.07);color:#5f6368;border-radius:9px;padding:0 7px;font-size:10px;font-variant-numeric:tabular-nums}',
    '.psp-item{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:10px;cursor:pointer;border:1px solid transparent;margin-bottom:4px;background:#fff;box-shadow:0 1px 2px rgba(60,64,67,.08);transition:box-shadow .18s ease,transform .18s ease,border-color .18s ease}',
    '.psp-item:hover{box-shadow:0 3px 10px rgba(60,64,67,.14);transform:translateY(-1px)}',
    '.psp-item.active{border-color:#4285f4;box-shadow:0 0 0 3px rgba(66,133,244,.16),0 3px 10px rgba(66,133,244,.18)}',
    '.psp-dot{width:11px;height:11px;border-radius:50%;flex:none;border:2px solid rgba(255,255,255,.9);box-shadow:0 0 0 1.5px rgba(0,0,0,.14)}',
    '.psp-item-main{flex:1;min-width:0;font-size:11.5px;line-height:1.5}',
    '.psp-item-main .psp-item-sub{color:#80868b;font-size:10.5px;font-variant-numeric:tabular-nums}',
    '.psp-page-badge{display:inline-block;background:rgba(66,133,244,.12);color:#4285f4;border-radius:5px;padding:0 5px;font-size:10px;font-weight:600;margin-right:4px;font-variant-numeric:tabular-nums}',
    '.psp-del{background:none;border:none;color:#9aa0a6;font-size:15px;cursor:pointer;padding:2px 5px;border-radius:6px;flex:none;line-height:1;opacity:.5;transition:opacity .15s ease,background .15s ease,color .15s ease}',
    '.psp-item:hover .psp-del{opacity:1}',
    '.psp-del:hover{background:rgba(234,67,53,.12);color:#ea4335}',
    /* ===== 主题 ===== */
    '.psp-root.psp-dark{--psp-bg:#e8eaed}',
    '.psp-root.psp-light{--psp-bg:#e8eaed}',
    /* ===== 弹窗 ===== */
    '.psp-modal-mask{position:fixed;inset:0;background:rgba(32,33,36,.6);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:99990;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",Roboto,sans-serif;animation:pspFadeIn .22s ease}',
    '.psp-modal{display:flex;flex-direction:column;width:min(94vw,1180px);height:min(90vh,820px);background:#f4f5f7;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.24),0 24px 80px rgba(0,0,0,.4);animation:pspModalIn .28s cubic-bezier(.2,.9,.3,1.2)}',
    '.psp-modal-head{display:flex;align-items:center;gap:12px;padding:14px 20px;background:linear-gradient(180deg,#2b2f36,#23262c);color:#e8eaed;flex:none}',
    '.psp-modal-head h2{font-size:14.5px;font-weight:600;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.2px}',
    '.psp-modal-close{background:none;border:none;color:#9aa0a6;font-size:18px;cursor:pointer;padding:4px 10px;border-radius:8px;line-height:1;transition:background .15s ease,color .15s ease}',
    '.psp-modal-close:hover{background:rgba(255,255,255,.12);color:#fff}',
    '.psp-modal-body{flex:1;min-height:0;position:relative}',
    '.psp-modal-foot{display:flex;justify-content:flex-end;gap:10px;padding:12px 20px;background:#eef0f3;border-top:1px solid rgba(0,0,0,.08);flex:none}',
    '.psp-modal-foot button{border-radius:9px;padding:8px 26px;font-size:13px;cursor:pointer;border:1px solid transparent;font-family:inherit;transition:transform .12s ease,box-shadow .18s ease,background .18s ease}',
    '.psp-modal-foot button:active{transform:scale(.97)}',
    '.psp-btn-primary{background:linear-gradient(180deg,#5a95f5,#4285f4);color:#fff;box-shadow:0 2px 8px rgba(66,133,244,.4)}',
    '.psp-btn-primary:hover{box-shadow:0 4px 14px rgba(66,133,244,.5)}',
    '.psp-btn-ghost{background:transparent;color:#3c4043;border-color:rgba(0,0,0,.2)!important}',
    '.psp-btn-ghost:hover{background:rgba(0,0,0,.05)}',
    '@keyframes pspFadeIn{from{opacity:0}to{opacity:1}}',
    '@keyframes pspModalIn{from{opacity:0;transform:scale(.92) translateY(14px)}to{opacity:1;transform:scale(1) translateY(0)}}',
    '@keyframes pspSlideDown{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}',
    '.psp-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:rgba(32,33,36,.92);color:#fff;padding:9px 18px;border-radius:10px;font-size:12.5px;font-family:system-ui,sans-serif;z-index:100000;box-shadow:0 6px 24px rgba(0,0,0,.3);animation:pspToastIn .22s ease;pointer-events:none;white-space:nowrap}',
    '.psp-toast.psp-toast-hide{opacity:0;transform:translateX(-50%) translateY(8px);transition:opacity .25s ease,transform .25s ease}',
    '@keyframes pspToastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}'
  ].join('');

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function fmt(v) { return (Math.round(v * 10) / 10).toString(); }
  function genId() {
    return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('psp-styles')) return;
    var el = document.createElement('style');
    el.id = 'psp-styles';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function normalizeRotation(r) {
    r = ((r % 360) + 360) % 360;
    if (r === 90 || r === 180 || r === 270) return r;
    return 0;
  }

  function cloneSel(s) { return s ? { x: s.x, y: s.y, w: s.w, h: s.h } : null; }

  function handleCursor(h) {
    var map = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
                n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    return map[h] || 'crosshair';
  }

  /** 从锚点拖出矩形（屏幕坐标），支持宽高比锁定与最小尺寸 */
  function buildRect(ax, ay, bx, by, ratio, maxW, maxH, minSize) {
    if (ratio) {
      var dx = bx - ax, dy = by - ay;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      var sgnX = dx >= 0 ? 1 : -1, sgnY = dy >= 0 ? 1 : -1;
      if (adx / ratio >= ady) dy = (adx / ratio) * sgnY; else dx = ady * ratio * sgnX;
      bx = ax + dx; by = ay + dy;
    }
    var x = Math.min(ax, bx), y = Math.min(ay, by);
    var w = Math.abs(bx - ax), h = Math.abs(by - ay);
    if (w < minSize) w = minSize;
    if (h < minSize) h = minSize;
    if (bx < ax) x = ax - w;
    if (by < ay) y = ay - h;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > maxW) w = maxW - x;
    if (y + h > maxH) h = maxH - y;
    return { x: x, y: y, w: Math.max(0, w), h: Math.max(0, h) };
  }

  /** 手柄拖拽缩放 */
  function resizeRect(sel, handle, mx, my, ratio, maxW, maxH, minSize) {
    var l = sel.x, t = sel.y, r = sel.x + sel.w, b = sel.y + sel.h;
    if (handle.indexOf('n') >= 0) t = my;
    if (handle.indexOf('s') >= 0) b = my;
    if (handle.indexOf('w') >= 0) l = mx;
    if (handle.indexOf('e') >= 0) r = mx;
    if (ratio && handle !== 'n' && handle !== 's') {
      var anchorX = handle.indexOf('e') >= 0 ? l : r;
      var anchorY = handle.indexOf('s') >= 0 ? t : b;
      var dx = mx - anchorX, dy = my - anchorY;
      var adx = Math.abs(dx), ady = Math.abs(dy);
      var sgnX = dx >= 0 ? 1 : -1, sgnY = dy >= 0 ? 1 : -1;
      if (adx / ratio >= ady) dy = (adx / ratio) * sgnY; else dx = ady * ratio * sgnX;
      var nw = anchorX + dx, nh = anchorY + dy;
      l = Math.min(anchorX, nw); r = Math.max(anchorX, nw);
      t = Math.min(anchorY, nh); b = Math.max(anchorY, nh);
    } else {
      if (l > r) { var tmp = l; l = r; r = tmp; }
      if (t > b) { var tmp2 = t; t = b; b = tmp2; }
    }
    if (r - l < minSize) r = l + minSize;
    if (b - t < minSize) b = t + minSize;
    l = clamp(l, 0, maxW); r = clamp(r, 0, maxW);
    t = clamp(t, 0, maxH); b = clamp(b, 0, maxH);
    return { x: l, y: t, w: r - l, h: b - t };
  }

  /* ====================== 主类 ====================== */

  /**
   * @param {HTMLElement|string} container 容器元素或选择器
   * @param {Object} [options]
   * @param {'point'|'rect'} [options.mode='rect']
   * @param {number|string} [options.zoom='fit-width']
   * @param {number|null} [options.aspectRatio=null]
   * @param {number} [options.minSize=4]
   * @param {boolean} [options.showGrid=false]
   * @param {boolean} [options.controls=true] 显示工具栏/列表（默认开启）
   * @param {boolean} [options.showList=true] 显示签章列表面板
   * @param {'light'|'dark'} [options.theme='dark']
   * @param {number} [options.dpi=96]
   * @param {Array<{id:string,name:string,color?:string}>} [options.users] 用户列表
   * @param {string} [options.currentUser] 当前用户 id
   * @param {boolean} [options.allowMulti=true] 允许多签章
   * @param {string} [options.pdfjsUrl] pdf.js 自动加载地址（默认 CDN）
   * @param {object} [options.pdfjs] 已有 pdfjsLib 实例
   */
  function PdfStampPicker(container, options) {
    if (typeof document === 'undefined') throw new Error('[PdfStampPicker] 仅支持浏览器环境');
    if (typeof container === 'string') {
      container = document.querySelector(container);
    }
    if (!container) throw new Error('[PdfStampPicker] 需要传入容器元素或选择器');

    this._options = Object.assign({
      mode: 'rect',
      zoom: 'fit-width',
      aspectRatio: null,
      minSize: 4,
      showGrid: false,
      controls: true,
      showList: true,
      theme: 'dark',
      dpi: DEFAULT_DPI,
      users: null,
      currentUser: null,
      allowMulti: true,
      stampImage: null,
      stampSize: 120,
      minStampSize: 24,
      maxStampSize: 480,
      pdfjsUrl: CDN_PDFJS
    }, options || {});
    if (options && options.pdfjs) this._options.pdfjs = options.pdfjs;

    // 用户与颜色
    this._users = (this._options.users && this._options.users.length)
      ? this._options.users.map(function (u, i) {
          return { id: u.id, name: u.name, color: u.color || STAMP_COLORS[i % STAMP_COLORS.length] };
        })
      : DEFAULT_USERS.slice();
    this._currentUserId = this._options.currentUser || this._users[0].id;
    if (!this._userById(this._currentUserId)) this._currentUserId = this._users[0].id;

    this._container = container;
    this._pdf = null;
    this._page = null;
    this._pageNumber = 1;
    this._totalPages = 1;
    this._pdfW = 0; this._pdfH = 0;
    this._offsetX = 0; this._offsetY = 0;
    this._rotation = 0;
    this._pdfMode = null;   // 'pdfjs' | 'canvas'
    this._docName = '';
    this._cssScale = 1;
    this._displayW = 0; this._displayH = 0;
    this._sel = null;       // 活动选区（屏幕坐标）
    this._drag = null;
    this._stamps = [];      // 全部签章点（PDF 坐标）
    this._activeId = null;  // 活动签章 id
    this._listeners = {};
    this._raf = 0;
    this._destroyed = false;
    this._stampImg = null;   // {src, name, w, h, el(Image)}
    this._hover = null;      // stamp 模式跟随鼠标的预览 {x,y,w,h}

    injectStyles();
    this._buildDOM();
    this._bindEvents();
    // 同步初始模式（修复 options.mode 未生效：按钮 active 状态 + stamp 模式预生成签章图）
    try { this.setMode(this._options.mode); } catch (e) { /* ignore */ }
    this._emit('ready', {});
  }

  /* ---------------- DOM 构建 ---------------- */

  PdfStampPicker.prototype._buildDOM = function () {
    var c = this._container;
    c.style.position = ((c.style.position || getComputedStyle(c).position) === 'static') ? 'relative' : c.style.position;

    var root = document.createElement('div');
    root.className = 'psp-root' + (this._options.theme === 'light' ? ' psp-light' : ' psp-dark');
    root.tabIndex = 0;
    this._root = root;

    if (this._options.controls) this._buildToolbar(root);

    // URL 输入条
    var urlbar = document.createElement('div');
    urlbar.className = 'psp-urlbar';
    var urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = '输入 PDF 地址或文件流接口 URL，回车加载…';
    var urlBtn = document.createElement('button');
    urlBtn.textContent = '加载';
    var urlCancel = document.createElement('button');
    urlCancel.textContent = '取消';
    var self = this;
    urlBtn.addEventListener('click', function () { self._loadUrl(urlInput.value); });
    urlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') self._loadUrl(urlInput.value); });
    urlCancel.addEventListener('click', function () { urlbar.classList.remove('open'); });
    urlbar.appendChild(urlInput);
    urlbar.appendChild(urlBtn);
    urlbar.appendChild(urlCancel);
    root.appendChild(urlbar);
    this._urlbar = urlbar;
    this._urlInput = urlInput;

    // 隐藏文件输入
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/pdf,.pdf';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files[0]) self.load(fileInput.files[0]);
      fileInput.value = '';
    });
    root.appendChild(fileInput);
    this._fileInput = fileInput;

    // 签章图片文件输入
    var imgInput = document.createElement('input');
    imgInput.type = 'file';
    imgInput.accept = 'image/*';
    imgInput.style.display = 'none';
    imgInput.addEventListener('change', function () {
      if (imgInput.files && imgInput.files[0]) self.setStampImage(imgInput.files[0]);
      imgInput.value = '';
    });
    root.appendChild(imgInput);
    this._imgInput = imgInput;

    var main = document.createElement('div');
    main.className = 'psp-main';
    var scroll = document.createElement('div');
    scroll.className = 'psp-scroll';
    var stage = document.createElement('div');
    stage.className = 'psp-stage';
    var page = document.createElement('div');
    page.className = 'psp-page';
    var canvas = document.createElement('canvas');
    canvas.className = 'psp-canvas';
    var overlay = document.createElement('canvas');
    overlay.className = 'psp-overlay';
    page.appendChild(canvas);
    page.appendChild(overlay);
    stage.appendChild(page);
    scroll.appendChild(stage);
    main.appendChild(scroll);
    this._scrollEl = scroll;
    this._stageEl = stage;
    this._pageEl = page;
    this._canvas = canvas;
    this._overlay = overlay;

    if (this._options.showList) this._buildList(main);
    root.appendChild(main);
    c.appendChild(root);
  };

  PdfStampPicker.prototype._buildToolbar = function (root) {
    var self = this;
    var tb = document.createElement('div');
    tb.className = 'psp-toolbar';
    var ICONS = {
      point: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
      rect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18" opacity=".4"/></svg>',
      stamp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke-linecap="round"/></svg>',
      open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>',
      url: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>',
      copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
      zoomout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
      zoomin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>',
      fitw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 9v6M20 9v6M2 12h4M18 12h4" stroke-linecap="round"/><path d="M6 7l-4 5 4 5M18 7l4 5-4 5" opacity=".5"/></svg>',
      fitp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16" opacity=".5"/></svg>',
      prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18" opacity=".6"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>'
    };
    var btn = function (icon, label, title, fn, cls) {
      var b = document.createElement('button');
      if (icon && ICONS[icon]) b.innerHTML = ICONS[icon] + (label ? '<span>' + label + '</span>' : '');
      else b.textContent = label || '';
      b.title = title || '';
      if (cls) b.className = cls;
      b.addEventListener('click', function () { fn(self); });
      tb.appendChild(b);
      return b;
    };
    var sep = function () { var s = document.createElement('span'); s.className = 'psp-sep'; tb.appendChild(s); };

    this._btnPoint = btn('point', '定位', '点选模式', function () { self.setMode('point'); });
    this._btnRect = btn('rect', '框选', '框选模式', function () { self.setMode('rect'); });
    this._btnStamp = btn('stamp', '签章', '拖动签章图片放置（滚轮缩放）', function () { self.setMode('stamp'); });
    sep();

    // 当前签章图缩略图（内置公章按用户名生成，只读展示）
    var thumbZone = document.createElement('span');
    thumbZone.className = 'psp-thumb-zone';
    var thumb = document.createElement('img');
    thumb.className = 'psp-thumb';
    thumb.title = '当前签章图（内置公章，名字=当前用户）';
    thumb.alt = '签章图';
    thumbZone.appendChild(thumb);
    var thumbLabel = document.createElement('span');
    thumbLabel.className = 'psp-thumb-label';
    thumbLabel.textContent = '当前章';
    thumbZone.appendChild(thumbLabel);
    tb.appendChild(thumbZone);
    this._thumb = thumb;
    this._thumbLabel = thumbLabel;
    sep();

    btn('open', '打开', '选择本地 PDF 文件', function () { self._fileInput.click(); });
    btn('url', 'URL', '从地址加载 PDF / 文件流接口', function () { self._urlbar.classList.toggle('open'); });
    {
      var usel = document.createElement('select');
      this._users.forEach(function (u) {
        var o = document.createElement('option');
        o.value = u.id; o.textContent = u.name;
        if (u.id === self._currentUserId) o.selected = true;
        usel.appendChild(o);
      });
      usel.title = '当前签章用户';
      usel.addEventListener('change', function () { self.setCurrentUser(usel.value); });
      tb.appendChild(usel);
      this._userSelect = usel;
      sep();
    }
    btn('copy', '复制JSON', '复制全部签章 JSON 到剪贴板', function () { self.copyJSON(); });
    sep();

    btn('zoomout', '', '缩小', function () { self.setZoom(self._cssScale / 1.25); });
    this._zoomLabel = document.createElement('span');
    this._zoomLabel.className = 'psp-zoomval';
    this._zoomLabel.textContent = '100%';
    tb.appendChild(this._zoomLabel);
    btn('zoomin', '', '放大', function () { self.setZoom(self._cssScale * 1.25); });
    btn('fitw', '适宽', '适应宽度', function () { self.setZoom('fit-width'); });
    btn('fitp', '适页', '适应页面', function () { self.setZoom('fit-page'); });
    sep();
    btn('prev', '', '上一页', function () { self.gotoPage(self._pageNumber - 1); });
    this._pageLabel = document.createElement('span');
    this._pageLabel.className = 'psp-pageinfo';
    this._pageLabel.textContent = '1 / 1';
    tb.appendChild(this._pageLabel);
    btn('next', '', '下一页', function () { self.gotoPage(self._pageNumber + 1); });
    sep();
    btn('grid', '网格', '网格辅助线', function (s) {
      var on = !s._options.showGrid;
      s.setShowGrid(on);
      var b = s._gridBtn;
      if (b) b.classList.toggle('active', on);
    });
    this._gridBtn = tb.lastChild;
    btn('trash', '清除', '删除全部签章点', function () { self.clear(); });
    root.appendChild(tb);
  };

  PdfStampPicker.prototype._buildList = function (main) {
    var list = document.createElement('div');
    list.className = 'psp-list';
    var head = document.createElement('h3');
    head.innerHTML = '签章点';
    var count = document.createElement('span');
    count.className = 'psp-count';
    count.textContent = '0';
    head.appendChild(count);
    var body = document.createElement('div');
    body.className = 'psp-list-body';
    list.appendChild(head);
    list.appendChild(body);
    main.appendChild(list);
    this._listEl = list;
    this._listBody = body;
    this._listCount = count;
  };

  /* ---------------- 事件系统 ---------------- */

  PdfStampPicker.prototype.on = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
    return this;
  };
  PdfStampPicker.prototype.off = function (type, fn) {
    var a = this._listeners[type];
    if (!a) return this;
    var i = a.indexOf(fn);
    if (i >= 0) a.splice(i, 1);
    return this;
  };
  PdfStampPicker.prototype._emit = function (type, payload) {
    var a = this._listeners[type];
    if (!a) return;
    for (var i = 0; i < a.length; i++) {
      try { a[i](payload); } catch (e) { /* ignore */ }
    }
  };

  /* ---------------- 加载（统一入口） ---------------- */

  /**
   * 统一加载入口。source 支持：
   *   File | ArrayBuffer | Uint8Array | string(远程静态 URL) |
   *   { url, method?, headers?, body? }(PDF 文件流接口) | pdfjs document proxy
   * @param {*} source
   * @param {Object} [opts] { pageNumber }
   */
  PdfStampPicker.prototype.load = function (source, opts) {
    var self = this;
    opts = opts || {};
    var p;

    if (isPdfjsProxy(source)) {
      p = Promise.resolve(source);
    } else if (typeof source === 'string') {
      p = this._loadRemote({ url: source });
    } else if (source && typeof source === 'object' && typeof source.url === 'string' && !(source instanceof ArrayBuffer)) {
      p = this._loadRemote(source);
    } else if (typeof File !== 'undefined' && source instanceof File) {
      this._docName = source.name || '本地文件.pdf';
      p = source.arrayBuffer().then(function (buf) { return self._getDoc({ data: buf }); });
    } else if (source instanceof ArrayBuffer || (typeof Uint8Array !== 'undefined' && source instanceof Uint8Array)) {
      p = this._getDoc({ data: source });
    } else {
      return Promise.reject(new Error('[PdfStampPicker] 无法识别的 PDF 来源'));
    }

    return p.then(function (doc) {
      self._pdf = doc;
      self._totalPages = doc.numPages;
      self._pdfMode = 'pdfjs';
      self._stamps = [];
      self._activeId = null;
      self._sel = null;
      self._renderList();
      return self.gotoPage(opts.pageNumber || 1);
    });
  };

  /** 远程加载：静态 URL 或文件流接口 */
  PdfStampPicker.prototype._loadRemote = function (cfg) {
    var self = this;
    var url = cfg.url;
    var name = '';
    try { name = decodeURIComponent(url.split('?')[0].split('/').pop()) || ''; } catch (e) { /* ignore */ }
    this._docName = name;
    var headers = cfg.headers || {};
    var hasCustom = cfg.method && cfg.method.toUpperCase() !== 'GET';
    var hasHeaders = Object.keys(headers).length > 0;
    if (!hasCustom && !hasHeaders) {
      // 纯静态地址 → pdf.js 原生流式加载（支持大文件、Range 请求）
      return this._getDoc({ url: url });
    }
    // 文件流接口 / 自定义头 → fetch 获取字节
    return fetch(url, {
      method: cfg.method || 'GET',
      headers: headers,
      body: cfg.body || undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('[PdfStampPicker] 加载 PDF 失败 HTTP ' + res.status + ' ' + res.statusText);
      return res.arrayBuffer();
    }).then(function (buf) {
      return self._getDoc({ data: buf });
    }).catch(function (err) {
      if (err && err.name === 'TypeError' && /fetch|network/i.test(String(err.message || ''))) {
        throw new Error('[PdfStampPicker] 网络请求失败，请检查 CORS 与地址可达性: ' + url);
      }
      throw err;
    });
  };

  PdfStampPicker.prototype._getDoc = function (pdfjsCfg) {
    var self = this;
    return this._ensurePdfjs().then(function (pdfjs) {
      return pdfjs.getDocument(pdfjsCfg).promise;
    });
  };

  /** 确保 pdfjsLib 可用（优先级：传入实例 > 全局 > 配置URL > 本地探测 > CDN） */
  PdfStampPicker.prototype._ensurePdfjs = function () {
    var self = this;
    var pdfjs = this._options.pdfjs || (typeof window !== 'undefined' && window.pdfjsLib) || null;
    if (pdfjs) {
      if (typeof window !== 'undefined' && !window.pdfjsLib) window.pdfjsLib = pdfjs;
      return Promise.resolve(pdfjs);
    }
    if (this._pdfjsPromise) return this._pdfjsPromise;
    this._pdfjsPromise = (this._options.pdfjsUrl
      ? PdfStampPicker.loadPdfJs(this._options.pdfjsUrl)   // 用户显式指定
      : PdfStampPicker.loadPdfJsAuto()                      // 本地探测 → CDN 兜底
    ).then(function (lib) {
      self._options.pdfjs = lib;
      return lib;
    });
    return this._pdfjsPromise;
  };

  /**
   * 预加载 pdf.js（静态方法）。
   * @param {string} [url] 覆盖 CDN 地址
   */
  PdfStampPicker.loadPdfJs = function (url) {
    if (typeof window === 'undefined') return Promise.reject(new Error('[PdfStampPicker] 仅支持浏览器环境'));
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    var src = url || CDN_PDFJS;
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () {
        if (window.pdfjsLib) {
          var workerSrc = (url ? url.replace(/pdf(\.min)?\.js$/, 'pdf.worker$1.js') : CDN_PDFJS_WORKER);
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfjsLib.GlobalWorkerOptions.workerSrc || workerSrc;
          resolve(window.pdfjsLib);
        } else {
          reject(new Error('[PdfStampPicker] pdf.js 加载失败：未找到全局 pdfjsLib'));
        }
      };
      s.onerror = function () { reject(new Error('[PdfStampPicker] pdf.js 脚本加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  };

  /**
   * 本地 pdf.js 候选路径（纯函数，可单测）。
   * 优先库文件所在目录 vendor/，再页面同目录 vendor/、../vendor/、libs/。
   * @param {string} pageHref 页面完整 URL
   * @param {string|null} scriptSrc 库脚本自身 src（document.currentScript）
   * @returns {string[]}
   */
  PdfStampPicker._localCandidates = function (pageHref, scriptSrc) {
    function dirOf(url) {
      if (!url) return null;
      var base = String(url).split('#')[0].split('?')[0];
      if (base.slice(-1) === '/') return base;
      var m = base.match(/^(.*\/)[^/]*$/);
      return m ? m[1] : null;
    }
    var out = [];
    if (scriptSrc) {
      var d = dirOf(scriptSrc);
      if (d) out.push(d + 'vendor/pdf.min.js');
    }
    if (pageHref) {
      var pd = dirOf(pageHref);
      if (pd) {
        out.push(pd + 'vendor/pdf.min.js');
        out.push(pd + '../vendor/pdf.min.js');
        out.push(pd + 'libs/pdf.min.js');
      }
    }
    var seen = {}, uniq = [];
    out.forEach(function (p) { if (!seen[p]) { seen[p] = 1; uniq.push(p); } });
    return uniq;
  };

  /**
   * 自动探测加载 pdf.js：依次尝试本地候选路径，全部失败回退 CDN。
   */
  PdfStampPicker.loadPdfJsAuto = function () {
    if (typeof window === 'undefined') return Promise.reject(new Error('[PdfStampPicker] 仅支持浏览器环境'));
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    var scriptSrc = (document.currentScript && document.currentScript.src) || null;
    var candidates = PdfStampPicker._localCandidates(window.location.href, scriptSrc);
    var idx = 0;
    var tryNext = function () {
      if (idx >= candidates.length) {
        return PdfStampPicker.loadPdfJs(); // CDN 兜底
      }
      var src = candidates[idx++];
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () {
          if (window.pdfjsLib) {
            var workerSrc = src.replace(/pdf(\.min)?\.js$/, 'pdf.worker$1.js');
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfjsLib.GlobalWorkerOptions.workerSrc || workerSrc;
            resolve(window.pdfjsLib);
          } else {
            reject(new Error('no pdfjsLib: ' + src));
          }
        };
        s.onerror = function () { reject(new Error('load fail: ' + src)); };
        document.head.appendChild(s);
      }).catch(tryNext);
    };
    return tryNext();
  };

  /** 兼容 v1：直接传入 pdfjs proxy */
  PdfStampPicker.prototype.loadPDF = function (source, opts) {
    return this.load(source, opts);
  };

  /**
   * 纯画布模式（兼容 v1）：宿主渲染 canvas，库只做坐标选择。
   */
  PdfStampPicker.prototype.setPage = function (meta) {
    if (!meta || !meta.canvas) throw new Error('[PdfStampPicker] setPage 需要 canvas');
    this._pdfMode = 'canvas';
    this._pdf = null;
    this._page = null;
    this._pdfW = meta.width;
    this._pdfH = meta.height;
    this._rotation = normalizeRotation(meta.rotation || 0);
    this._offsetX = meta.offsetX || 0;
    this._offsetY = meta.offsetY || 0;
    this._pageNumber = meta.pageNumber || 1;
    this._totalPages = meta.totalPages || 1;
    this._docName = meta.name || this._docName;
    this._stamps = [];
    this._activeId = null;
    this._sel = null;

    var old = this._canvas;
    var cv = meta.canvas;
    cv.className = 'psp-canvas';
    this._pageEl.insertBefore(cv, this._overlay);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    this._canvas = cv;

    this._layoutPage();
    this._renderList();
    this._updateToolbar();
    this._paint();
    this._emit('pagechange', this._pageInfo());
    return this;
  };

  PdfStampPicker.prototype.gotoPage = function (n) {
    var self = this;
    n = clamp(Math.round(n || 1), 1, this._totalPages);
    if (this._pdfMode !== 'pdfjs' || !this._pdf) return Promise.resolve();
    if (n === this._pageNumber && this._page) return Promise.resolve();
    this._pageNumber = n;
    return this._pdf.getPage(n).then(function (page) {
      if (self._destroyed) return;
      self._page = page;
      var view = page.view;
      self._pdfW = view[2] - view[0];
      self._pdfH = view[3] - view[1];
      self._offsetX = view[0];
      self._offsetY = view[1];
      self._rotation = normalizeRotation(page.rotate || 0);
      self._sel = null;
      self._activeId = null;
      self._layoutPage();
      return self._renderPage().then(function () {
        self._updateToolbar();
        self._paint();
        self._emit('pagechange', self._pageInfo());
      });
    });
  };

  /* ---------------- 渲染与布局（同 v1） ---------------- */

  PdfStampPicker.prototype._resolveCssScale = function () {
    var z = this._options.zoom;
    if (typeof z === 'number' && isFinite(z) && z > 0) return z;
    // 以滚动区可视尺寸为基准（container 含右侧列表面板，不能用）
    var view = this._scrollEl;
    // 预留 CSS stage padding + 滚动条宽度，确保 fit 模式不出现横向滚动条
    var PAD_X = 76;  // 28*2(CSS) + 15(scrollbar) + 余量
    var PAD_Y = 88;  // 32*2(CSS) + 15(scrollbar) + 余量
    var cw = Math.max(50, view.clientWidth - PAD_X);
    var ch = Math.max(50, view.clientHeight - PAD_Y);
    var spanW = this._spanW(), spanH = this._spanH();
    if (!spanW || !spanH) return 1;
    if (z === 'fit-page') return Math.min(cw / spanW, ch / spanH);
    return cw / spanW;
  };

  PdfStampPicker.prototype._layoutPage = function () {
    this._cssScale = this._resolveCssScale();
    this._displayW = this._spanW() * this._cssScale;
    this._displayH = this._spanH() * this._cssScale;
    // 保险：fit 模式页面宽不超过可视区（防滚动条/舍入导致横向溢出）
    if (this._options.zoom === 'fit-width' || this._options.zoom === 'fit-page') {
      var maxW = Math.max(50, this._scrollEl.clientWidth - 12);
      if (this._displayW > maxW) {
        this._displayW = maxW;
        this._cssScale = this._spanW() ? this._displayW / this._spanW() : 1;
        this._displayH = this._spanH() * this._cssScale;
      }
    }
    var p = this._pageEl;
    p.style.width = this._displayW + 'px';
    p.style.height = this._displayH + 'px';
    this._canvas.style.width = this._displayW + 'px';
    this._canvas.style.height = this._displayH + 'px';
    this._sizeOverlay();
    this._emit('zoomchange', { zoom: this._cssScale });
  };

  PdfStampPicker.prototype._sizeOverlay = function () {
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this._overlay.width = Math.max(1, Math.round(this._displayW * dpr));
    this._overlay.height = Math.max(1, Math.round(this._displayH * dpr));
    this._overlay.style.width = this._displayW + 'px';
    this._overlay.style.height = this._displayH + 'px';
  };

  PdfStampPicker.prototype._renderPage = function () {
    var self = this;
    if (this._pdfMode !== 'pdfjs' || !this._page) return Promise.resolve();
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    var renderScale = this._cssScale * Math.max(1, dpr);
    var viewport = this._page.getViewport({ scale: renderScale });
    this._canvas.width = Math.round(viewport.width);
    this._canvas.height = Math.round(viewport.height);
    return this._page.render({ canvasContext: this._canvas.getContext('2d'), viewport: viewport }).promise;
  };

  PdfStampPicker.prototype.setZoom = function (z) {
    if (typeof z === 'number') z = Math.max(0.05, z);
    this._options.zoom = z;
    if (!this._pdfW) return this;
    this._layoutPage();
    var self = this;
    if (this._pdfMode === 'pdfjs') {
      this._renderPage().then(function () { self._paint(); self._updateToolbar(); });
    } else { this._paint(); this._updateToolbar(); }
    return this;
  };

  PdfStampPicker.prototype.getZoom = function () { return this._cssScale; };
  PdfStampPicker.prototype.fitWidth = function () { return this.setZoom('fit-width'); };
  PdfStampPicker.prototype.fitPage = function () { return this.setZoom('fit-page'); };

  /* ---------------- 模式与用户 ---------------- */

  PdfStampPicker.prototype.setMode = function (mode) {
    if (mode !== 'point' && mode !== 'rect' && mode !== 'stamp') {
      throw new Error('[PdfStampPicker] mode 仅支持 point | rect | stamp');
    }
    this._options.mode = mode;
    if (this._btnPoint) this._btnPoint.classList.toggle('active', mode === 'point');
    if (this._btnRect) this._btnRect.classList.toggle('active', mode === 'rect');
    if (this._btnStamp) this._btnStamp.classList.toggle('active', mode === 'stamp');
    if (this._overlay) this._overlay.classList.toggle('psp-stamp-cursor', mode === 'stamp');
    if (mode === 'stamp') {
      var self = this;
      this._ensureStampImage().then(function () { self._paint(); });
    }
    return this;
  };

  PdfStampPicker.prototype.setAspectRatio = function (ratio) {
    this._options.aspectRatio = (typeof ratio === 'number' && ratio > 0) ? ratio : null;
    return this;
  };

  PdfStampPicker.prototype.setShowGrid = function (show) {
    this._options.showGrid = !!show;
    this._paint();
    return this;
  };

  PdfStampPicker.prototype.setCurrentUser = function (userId) {
    var u = this._userById(userId);
    if (!u) throw new Error('[PdfStampPicker] 未知用户: ' + userId);
    this._currentUserId = u.id;
    if (this._userSelect) this._userSelect.value = u.id;
    // 内置公章按用户名生成 → 切换用户自动更新公章文字
    var self = this;
    this._ensureStampImage().then(function () { self._paint(); });
    return this;
  };
  PdfStampPicker.prototype.getCurrentUser = function () {
    return this._userById(this._currentUserId);
  };
  PdfStampPicker.prototype.addUser = function (user) {
    if (!user || !user.id) throw new Error('[PdfStampPicker] addUser 需要 {id, name}');
    if (this._userById(user.id)) return this;
    var u = { id: user.id, name: user.name, color: user.color || STAMP_COLORS[this._users.length % STAMP_COLORS.length] };
    this._users.push(u);
    this._rebuildUserSelect();
    return this;
  };

  /** 移除签署方（其签章点一并删除）；不可移除当前用户 */
  PdfStampPicker.prototype.removeUser = function (userId) {
    var idx = -1;
    for (var i = 0; i < this._users.length; i++) {
      if (this._users[i].id === userId) { idx = i; break; }
    }
    if (idx < 0) return this;
    if (this._users[idx].id === this._currentUserId) {
      throw new Error('[PdfStampPicker] 不能移除当前签章用户');
    }
    this._users.splice(idx, 1);
    this._stamps = this._stamps.filter(function (st) { return st.userId !== userId; });
    if (this._activeId && !this._stamps.some(function (st) { return st.id === this._activeId; }, this)) {
      this._activeId = null;
      this._sel = null;
    }
    this._rebuildUserSelect();
    this._renderList();
    this._paint();
    return this;
  };

  /** 重建工具栏用户下拉（动态增删后同步） */
  PdfStampPicker.prototype._rebuildUserSelect = function () {
    if (!this._userSelect || !this._userSelect.parentNode) return;
    var self = this;
    var parent = this._userSelect.parentNode;
    var old = this._userSelect;
    var usel = document.createElement('select');
    this._users.forEach(function (u) {
      var o = document.createElement('option');
      o.value = u.id; o.textContent = u.name;
      if (u.id === self._currentUserId) o.selected = true;
      usel.appendChild(o);
    });
    usel.title = '当前签章用户';
    usel.className = old.className;
    usel.addEventListener('change', function () { self.setCurrentUser(usel.value); });
    parent.replaceChild(usel, old);
    this._userSelect = usel;
  };

  PdfStampPicker.prototype._userById = function (id) {
    for (var i = 0; i < this._users.length; i++) {
      if (this._users[i].id === id) return this._users[i];
    }
    return null;
  };

  /* ---------------- 签章图片 ---------------- */

  /**
   * 设置签章图片。支持：URL/dataURL 字符串、File（本地图片）、HTMLCanvasElement。
   * @returns {Promise<{src:string,name:string,w:number,h:number}>}
   */
  PdfStampPicker.prototype.setStampImage = function (src) {
    var self = this;
    if (typeof File !== 'undefined' && src instanceof File) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          self._loadImg(reader.result, src.name).then(resolve, reject);
        };
        reader.onerror = function () { reject(new Error('[PdfStampPicker] 读取图片失败')); };
        reader.readAsDataURL(src);
      });
    }
    if (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement) {
      return this._loadImg(src.toDataURL('image/png'), '签章.png');
    }
    return this._loadImg(src, typeof src === 'string' ? (src.split('/').pop() || '签章.png') : '签章.png');
  };

  PdfStampPicker.prototype._loadImg = function (src, name) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        self._stampImg = { src: src, name: name || '签章.png', w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, el: img };
        if (self._thumb) self._thumb.src = src;
        if (self._thumbLabel) self._thumbLabel.textContent = (self._stampImg.name || '签章').replace(/公章\.png$/, '').slice(0, 6);
        self._paint();
        self._emit('stampimage', { src: src, name: self._stampImg.name, width: self._stampImg.w, height: self._stampImg.h });
        resolve(self._stampImg);
      };
      img.onerror = function () { reject(new Error('[PdfStampPicker] 签章图片加载失败: ' + String(src).slice(0, 80))); };
      img.src = src;
    });
  };

  /** 确保有签章图（默认按当前用户生成内置公章，也可用 options.stampImage 自定义） */
  PdfStampPicker.prototype._ensureStampImage = function () {
    var self = this;
    var cur = this.getCurrentUser();
    var uid = cur ? cur.id : null;
    // 已有自定义图 → 直接用
    if (this._stampImg && !this._stampImg.generated) return Promise.resolve(this._stampImg);
    // 已有按当前用户生成的图 → 直接用
    if (this._stampImg && this._stampImg.generated && this._stampImg.userId === uid) {
      return Promise.resolve(this._stampImg);
    }
    var configured = this._options.stampImage;
    if (configured) return this.setStampImage(configured);
    // 生成按用户名的内置公章
    var user = cur || { id: 'default', name: '签章' };
    var dataUrl = this._genSeal(user);
    return this.setStampImage(dataUrl).then(function (img) {
      img.name = (user.name || '签章') + '公章.png';
      img.generated = true;
      img.userId = uid;
      if (self._thumbLabel) self._thumbLabel.textContent = (user.name || '签章').slice(0, 6);
      return img;
    });
  };

  PdfStampPicker.prototype.getStampImage = function () {
    return this._stampImg ? { src: this._stampImg.src, name: this._stampImg.name, width: this._stampImg.w, height: this._stampImg.h } : null;
  };

  /** 签章图源宽高比 (w/h) */
  PdfStampPicker.prototype._stampRatio = function () {
    return (this._stampImg && this._stampImg.h) ? this._stampImg.w / this._stampImg.h : 1;
  };

  /** 预览/新放置的显示尺寸（按 stampSize 基准宽） */
  PdfStampPicker.prototype._stampDisplaySize = function () {
    var ratio = this._stampRatio();
    var w = this._options.stampSize;
    return { w: w, h: ratio ? w / ratio : w };
  };

  /** 计算中心对准 (x,y) 且 clamp 不出边界的矩形 */
  PdfStampPicker.prototype._stampRectAt = function (x, y) {
    var size = this._stampDisplaySize();
    return {
      x: clamp(x - size.w / 2, 0, Math.max(0, this._displayW - size.w)),
      y: clamp(y - size.h / 2, 0, Math.max(0, this._displayH - size.h)),
      w: size.w, h: size.h
    };
  };

  /** 生成内置红色公章（名字取自用户，canvas 绘制，零外部资源） */
  PdfStampPicker.prototype._genSeal = function (user) {
    var S = 300, cx = S / 2, cy = S / 2;
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var ctx = c.getContext('2d');
    var RED = '#d93025';
    var name = (user && user.name) || '签章';
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = RED;
    ctx.fillStyle = RED;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, 140, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 126, 0, Math.PI * 2); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (name.length >= 3) {
      // 名字沿上弧排布（字多自动缩小）
      var n = name.length;
      var r = 112;
      var fs = Math.max(14, Math.min(34, Math.floor(250 / n)));
      ctx.font = 'bold ' + fs + 'px sans-serif';
      for (var i = 0; i < n; i++) {
        var a = Math.PI - (Math.PI * i / (n - 1));
        ctx.save();
        ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.rotate(a - Math.PI / 2);
        ctx.fillText(name[i], 0, 0);
        ctx.restore();
      }
    } else {
      // 短名字（1-2字）横排大号居中
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText(name, cx, cy - 22);
    }
    // 五角星
    starPath(ctx, cx, cy, 34);
    ctx.fill();
    // 下方横排文字
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('合同专用章', cx, cy + 76);
    return c.toDataURL('image/png');
  };

  /* ---------------- 坐标转换（同 v1） ---------------- */

  PdfStampPicker.prototype._spanW = function () {
    return (this._rotation === 90 || this._rotation === 270) ? this._pdfH : this._pdfW;
  };
  PdfStampPicker.prototype._spanH = function () {
    return (this._rotation === 90 || this._rotation === 270) ? this._pdfW : this._pdfH;
  };
  PdfStampPicker.prototype._sx = function () {
    return this._spanW() ? this._displayW / this._spanW() : 1;
  };
  PdfStampPicker.prototype._sy = function () {
    return this._spanH() ? this._displayH / this._spanH() : 1;
  };

  PdfStampPicker.prototype.screenToPdf = function (cx, cy) {
    var sx = this._sx(), sy = this._sy();
    var W = this._pdfW, H = this._pdfH, r = this._rotation;
    var x, y;
    switch (r) {
      case 90:  x = cy / sy;       y = cx / sx;       break;
      case 180: x = W - cx / sx;   y = H - cy / sy;   break;
      case 270: x = W - cy / sy;   y = H - cx / sx;   break;
      default:  x = cx / sx;       y = H - cy / sy;   break;
    }
    return { x: x + this._offsetX, y: y + this._offsetY };
  };

  PdfStampPicker.prototype.pdfToScreen = function (px, py) {
    var sx = this._sx(), sy = this._sy();
    var W = this._pdfW, H = this._pdfH, r = this._rotation;
    var x = px - this._offsetX, y = py - this._offsetY;
    var cx, cy;
    switch (r) {
      case 90:  cx = y * sy;       cy = x * sx;       break;
      case 180: cx = (W - x) * sx; cy = (H - y) * sy; break;
      case 270: cx = (H - y) * sy; cy = (W - x) * sx; break;
      default:  cx = x * sx;       cy = (H - y) * sy; break;
    }
    return { x: cx, y: cy };
  };

  PdfStampPicker.prototype._units = function (ptObj) {
    var dpi = this._options.dpi || DEFAULT_DPI;
    var out = {};
    ['x', 'y', 'width', 'height'].forEach(function (k) {
      if (!(k in ptObj)) return;
      var v = ptObj[k];
      out[k] = round2(v);
      out.mm = out.mm || {}; out.inch = out.inch || {}; out.px = out.px || {};
      out.mm[k] = round2(v * 25.4 / 72);
      out.inch[k] = round2(v / 72);
      out.px[k] = round2(v * dpi / 72);
    });
    return out;
  };

  /* ---------------- 签章点管理 ---------------- */

  PdfStampPicker.prototype._pageInfo = function () {
    return {
      page: this._pageNumber,
      totalPages: this._totalPages,
      width: this._pdfW,
      height: this._pdfH,
      rotation: this._rotation,
      offsetX: this._offsetX,
      offsetY: this._offsetY
    };
  };

  /** 当前活动选区（PDF 坐标）。rect: {x,y,width,height} point: {x,y} */
  PdfStampPicker.prototype.getSelection = function () {
    if (!this._sel) return null;
    var isPoint = this._options.mode === 'point';
    if (!isPoint && (this._sel.w <= 0 || this._sel.h <= 0)) return null;
    var p1 = this.screenToPdf(this._sel.x, this._sel.y);
    var p2 = this.screenToPdf(this._sel.x + this._sel.w, this._sel.y + this._sel.h);
    var minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
    var minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
    if (isPoint) {
      return { page: this._pageNumber, x: round2(p1.x), y: round2(p1.y), unit: 'pt', rotation: this._rotation };
    }
    return {
      page: this._pageNumber,
      x: round2(minX), y: round2(maxY),
      width: round2(maxX - minX), height: round2(maxY - minY),
      unit: 'pt', rotation: this._rotation
    };
  };

  /** 全部签章点（PDF 坐标数组） */
  PdfStampPicker.prototype.getStamps = function () {
    return this._stamps.map(function (st) {
      var u = this._userById(st.userId);
      return {
        id: st.id,
        user: u ? { id: u.id, name: u.name, color: u.color } : null,
        page: st.page,
        x: st.x, y: st.y,
        width: st.width, height: st.height,
        unit: 'pt',
        rotation: st.rotation,
        createdAt: st.createdAt
      };
    }, this);
  };

  PdfStampPicker.prototype.getActiveStamp = function () {
    for (var i = 0; i < this._stamps.length; i++) {
      if (this._stamps[i].id === this._activeId) return this._stamps[i];
    }
    return null;
  };

    /**
   * 导出完整 JSON：**以用户（签署方）为主维度分组**。
   * {
   *   document: {...},
   *   users: [ { user: {id,name,color}, stamps: [{page,x,y,width,height,rotation,...}] } ]
   * }
   * 直接对应第三方签章接口的 signers[].signAreas[] 模型。
   */
  PdfStampPicker.prototype.toJSON = function () {
    return buildJSON({
      docName: this._docName,
      totalPages: this._totalPages,
      currentPage: this._pageNumber,
      width: this._pdfW,
      height: this._pdfH,
      rotation: this._rotation,
      offsetX: this._offsetX,
      offsetY: this._offsetY
    }, this._stamps, this._users);
  };

  /** 扁平版 JSON（旧结构）：stamps 数组每项内嵌 user，按签章点遍历用 */
  PdfStampPicker.prototype.toFlatJSON = function () {
    return buildFlatJSON({
      docName: this._docName,
      totalPages: this._totalPages,
      currentPage: this._pageNumber,
      width: this._pdfW,
      height: this._pdfH,
      rotation: this._rotation,
      offsetX: this._offsetX,
      offsetY: this._offsetY
    }, this._stamps, this._users);
  };

  /** 获取某用户的全部签章点（PDF 坐标） */
  PdfStampPicker.prototype.getStampsByUser = function (userId) {
    return this.getStamps().filter(function (s) { return s.user && s.user.id === userId; });
  };

  PdfStampPicker.prototype.copyJSON = function () {
    var self = this;
    var json = this.toJSON();
    var text = JSON.stringify(json, null, 2);
    var done = function () { self._toast('✅ JSON 已复制到剪贴板'); return json; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(done, done);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    done();
    return Promise.resolve(json);
  };

  /** 轻提示（内置，无依赖） */
  PdfStampPicker.prototype._toast = function (msg, ms) {
    if (typeof document === 'undefined') return;
    var self = this;
    var el = document.createElement('div');
    el.className = 'psp-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () {
      el.classList.add('psp-toast-hide');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, ms || 1600);
  };

  /**
   * 程序化添加/更新签章点（PDF 坐标）。
   * @param {{x:number,y:number,width?:number,height?:number,page?:number,userId?:string,note?:string}} sel
   * @returns {object} 新签章点
   */
  PdfStampPicker.prototype.addStamp = function (sel) {
    if (!sel || typeof sel.x !== 'number' || typeof sel.y !== 'number') {
      throw new Error('[PdfStampPicker] addStamp 需要 {x, y[, width, height]}');
    }
    var page = sel.page || this._pageNumber;
    // 快照当前用户的公章图（内部绘制用；JSON 输出不含 image）
    var img = null;
    if (this._stampImg && this._stampImg.el) {
      img = { src: this._stampImg.src, name: this._stampImg.name, width: this._stampImg.w, height: this._stampImg.h };
    }
    var stamp = {
      id: genId(),
      userId: sel.userId || this._currentUserId,
      page: page,
      rotation: this._rotation,
      x: sel.x, y: sel.y,
      width: (sel.width !== undefined) ? sel.width : 0,
      height: (sel.height !== undefined) ? sel.height : 0,
      image: img,
      note: sel.note || '',
      createdAt: new Date().toISOString()
    };
    this._stamps.push(stamp);
    this._activeId = stamp.id;
    this._renderList();
    this._emit('stampadd', stamp);
    this._emit('change', this.getSelection());
    return stamp;
  };

  /** 删除指定签章点 */
  PdfStampPicker.prototype.removeStamp = function (id) {
    for (var i = 0; i < this._stamps.length; i++) {
      if (this._stamps[i].id === id) {
        var removed = this._stamps.splice(i, 1)[0];
        if (this._activeId === id) { this._activeId = null; this._sel = null; }
        this._renderList();
        this._paint();
        this._emit('stampremove', removed);
        return removed;
      }
    }
    return null;
  };

  PdfStampPicker.prototype.removeSelection = function () {
    if (this._activeId) { this.removeStamp(this._activeId); return this; }
    this._sel = null;
    this._paint();
    return this;
  };

  PdfStampPicker.prototype.clear = function () {
    this._stamps = [];
    this._activeId = null;
    this._sel = null;
    this._renderList();
    this._paint();
    this._emit('clear', {});
    return this;
  };

  PdfStampPicker.prototype.clearAll = function () { return this.clear(); };

  /** 选中列表中的签章点并跳转页面 */
  PdfStampPicker.prototype.selectStamp = function (id) {
    var stamp = null;
    for (var i = 0; i < this._stamps.length; i++) {
      if (this._stamps[i].id === id) { stamp = this._stamps[i]; break; }
    }
    if (!stamp) return this;
    var self = this;
    var go = function () {
      self._activeId = stamp.id;
      self._syncSelFromStamp(stamp);
      self._paint();
      self._renderList();
      self._emit('stampselect', self.getStamps().filter(function (s) { return s.id === id; })[0] || null);
    };
    if (stamp.page !== this._pageNumber) {
      this.gotoPage(stamp.page).then(go);
    } else go();
    return this;
  };

  /** 从签章点恢复屏幕选区 */
  PdfStampPicker.prototype._syncSelFromStamp = function (stamp) {
    var p = this.pdfToScreen(stamp.x, stamp.y);
    if (stamp.width > 0 && stamp.height > 0) {
      var p2 = this.pdfToScreen(stamp.x + stamp.width, stamp.y - stamp.height);
      var x = Math.min(p.x, p2.x), y = Math.min(p.y, p2.y);
      this._sel = { x: x, y: y, w: Math.abs(p2.x - p.x), h: Math.abs(p2.y - p.y) };
    } else {
      this._sel = { x: p.x, y: p.y, w: 0, h: 0 };
    }
  };

  /** 编辑完成后将活动选区写回签章点 */
  PdfStampPicker.prototype._commitActive = function () {
    var stamp = this.getActiveStamp();
    if (!stamp || !this._sel) return;
    var sel = this.getSelection();
    if (!sel) return;
    stamp.x = sel.x; stamp.y = sel.y;
    stamp.width = sel.width || 0;
    stamp.height = sel.height || 0;
    stamp.rotation = sel.rotation;
    this._renderList();
    this._emit('stampchange', this.getStamps().filter(function (s) { return s.id === stamp.id; })[0] || null);
  };

  /** 绘制完成 → 新增签章点 */
  PdfStampPicker.prototype._addStampFromSel = function () {
    var sel = this.getSelection();
    if (!sel) return;
    if (!this._options.allowMulti && this._stamps.length > 0) {
      this._stamps = [];
    }
    var stamp = this.addStamp({
      x: sel.x, y: sel.y,
      width: sel.width || 0, height: sel.height || 0
    });
    this._emit('select', this.getStamps().filter(function (s) { return s.id === stamp.id; })[0] || null);
  };

  /* ---------------- 列表渲染（按用户分组） ---------------- */

  PdfStampPicker.prototype._renderList = function () {
    if (!this._listBody) return;
    var self = this;
    this._listBody.innerHTML = '';
    if (this._listCount) this._listCount.textContent = String(this._stamps.length);
    if (!this._stamps.length) {
      var empty = document.createElement('div');
      empty.className = 'psp-list-empty';
      empty.innerHTML = '<div class="psp-empty-icon">🖊</div><div>暂无签章点</div><div class="psp-empty-tip">在页面上框选 / 点选 / 拖放公章即可添加</div>';
      this._listBody.appendChild(empty);
      return;
    }
    // 按用户分组：每个用户一个分组标题 + 自己的签章点
    this._users.forEach(function (u) {
      var group = self._stamps.filter(function (st) { return st.userId === u.id; });
      if (!group.length) return;
      var head = document.createElement('div');
      head.className = 'psp-group-head';
      var dot = document.createElement('span');
      dot.className = 'psp-dot';
      dot.style.background = u.color;
      var name = document.createElement('span');
      name.className = 'psp-gname';
      name.textContent = u.name;
      var gcount = document.createElement('span');
      gcount.className = 'psp-gcount';
      gcount.textContent = String(group.length);
      head.appendChild(dot);
      head.appendChild(name);
      head.appendChild(gcount);
      self._listBody.appendChild(head);

      group.forEach(function (st) {
        var item = document.createElement('div');
        item.className = 'psp-item' + (st.id === self._activeId ? ' active' : '');
        item.dataset.id = st.id;
        var idot = document.createElement('span');
        idot.className = 'psp-dot';
        idot.style.background = u.color;
        var main = document.createElement('div');
        main.className = 'psp-item-main';
        var sizeTxt = (st.width > 0 && st.height > 0)
          ? fmt(st.width) + '×' + fmt(st.height) + 'pt'
          : '点选位置';
        main.innerHTML = '<div><span class="psp-page-badge">P' + st.page + '</span> ' + sizeTxt + '</div>' +
                         '<div class="psp-item-sub">(' + fmt(st.x) + ', ' + fmt(st.y) + ')</div>';
        var del = document.createElement('button');
        del.className = 'psp-del';
        del.title = '删除';
        del.textContent = '×';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          self.removeStamp(st.id);
        });
        item.addEventListener('click', function () { self.selectStamp(st.id); });
        item.appendChild(idot);
        item.appendChild(main);
        item.appendChild(del);
        self._listBody.appendChild(item);
      });
    });
  };

  /* ---------------- 交互 ---------------- */

  PdfStampPicker.prototype._bindEvents = function () {
    var self = this;
    this._handlers = {
      down: function (e) { self._onPointerDown(e); },
      move: function (e) { self._onPointerMove(e); },
      up: function (e) { self._onPointerUp(e); },
      key: function (e) { self._onKeyDown(e); },
      wheel: function (e) { self._onWheel(e); },
      resize: function () { self._onResize(); }
    };
    this._overlay.addEventListener('pointerdown', this._handlers.down);
    this._overlay.addEventListener('pointermove', this._handlers.move);
    this._overlay.addEventListener('pointerup', this._handlers.up);
    this._overlay.addEventListener('pointercancel', this._handlers.up);
    this._overlay.addEventListener('wheel', this._handlers.wheel, { passive: false });
    this._root.addEventListener('keydown', this._handlers.key);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(function () { self._onResize(); });
      this._ro.observe(this._container);
    } else {
      window.addEventListener('resize', this._handlers.resize);
    }
  };

  PdfStampPicker.prototype._onResize = function () {
    if (this._destroyed) return;
    var z = this._options.zoom;
    if (z === 'fit-width' || z === 'fit-page') {
      this._layoutPage();
      var self = this;
      if (this._pdfMode === 'pdfjs') {
        this._renderPage().then(function () { self._paint(); });
      } else this._paint();
    }
  };

  /** 滚轮：stamp 模式下缩放签章图（中心锚定，clamp 尺寸与位置） */
  PdfStampPicker.prototype._onWheel = function (e) {
    if (this._options.mode !== 'stamp' || !this._stampImg) return;
    // 普通滚轮 = 页面滚动（不劫持）；Ctrl+滚轮 = 缩放签章
    if (!e.ctrlKey) return;
    e.preventDefault();
    var ratio = this._stampRatio();
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    var target = null;
    if (this._activeId && this._sel) target = this._sel;
    if (!target) return;
    var nw = clamp(target.w * factor, this._options.minStampSize, this._options.maxStampSize);
    var nh = nw / ratio;
    var cx = target.x + target.w / 2, cy = target.y + target.h / 2;
    var x = clamp(cx - nw / 2, 0, Math.max(0, this._displayW - nw));
    var y = clamp(cy - nh / 2, 0, Math.max(0, this._displayH - nh));
    this._sel = { x: x, y: y, w: nw, h: nh };
    this._commitActive();
    this._paint();
  };

  PdfStampPicker.prototype._hitHandle = function (x, y) {
    var s = this._sel;
    if (!s) return null;
    var R = 8;
    var cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    var edges = {
      nw: [s.x, s.y], n: [cx, s.y], ne: [s.x + s.w, s.y],
      e: [s.x + s.w, cy], se: [s.x + s.w, s.y + s.h], s: [cx, s.y + s.h],
      sw: [s.x, s.y + s.h], w: [s.x, cy]
    };
    for (var i = 0; i < HANDLES.length; i++) {
      var h = HANDLES[i], p = edges[h];
      if (Math.abs(x - p[0]) <= R && Math.abs(y - p[1]) <= R) return h;
    }
    return null;
  };

  /** 命中检测：点击某个已有签章点（rect 区域 / point 距离） */
  PdfStampPicker.prototype._hitStamp = function (x, y) {
    var pad = 6;
    for (var i = this._stamps.length - 1; i >= 0; i--) {
      var st = this._stamps[i];
      if (st.page !== this._pageNumber) continue;
      var p = this.pdfToScreen(st.x, st.y);
      if (st.width > 0 && st.height > 0) {
        var p2 = this.pdfToScreen(st.x + st.width, st.y - st.height);
        var l = Math.min(p.x, p2.x) - pad, t = Math.min(p.y, p2.y) - pad;
        var r = Math.max(p.x, p2.x) + pad, b = Math.max(p.y, p2.y) + pad;
        if (x >= l && x <= r && y >= t && y <= b) return st;
      } else {
        var d = Math.hypot(x - p.x, y - p.y);
        if (d <= 12) return st;
      }
    }
    return null;
  };

  PdfStampPicker.prototype._onPointerDown = function (e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    var rect = this._overlay.getBoundingClientRect();
    var x = clamp(e.clientX - rect.left, 0, this._displayW);
    var y = clamp(e.clientY - rect.top, 0, this._displayH);

    var isPointMode = this._options.mode === 'point';
    var isStampMode = this._options.mode === 'stamp';
    var handle = (!isPointMode && !isStampMode && this._sel) ? this._hitHandle(x, y) : null;

    // stamp 模式：点击已有签章图 → 选中并移动；点击空白 → 放置新签章（可立即拖动）
    if (isStampMode) {
      try { this._overlay.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      var hitSt = this._hitStamp(x, y);
      if (hitSt) {
        this._activeId = hitSt.id;
        this._syncSelFromStamp(hitSt);
        this._drag = { type: 'move', startX: x, startY: y, sel: cloneSel(this._sel) };
        this._paint();
        this._renderList();
        this._emit('stampselect', hitSt);
        return;
      }
      if (this._stampImg) {
        // 图片就绪：立即放置 + 进入拖动（按下-拖动-松手一气呵成）
        var r0 = this._stampRectAt(x, y);
        this._sel = { x: r0.x, y: r0.y, w: r0.w, h: r0.h };
        this._paint();
        var sel0 = this.getSelection();
        if (sel0) {
          this.addStamp({ x: sel0.x, y: sel0.y, width: sel0.width, height: sel0.height });
          this._drag = { type: 'move', startX: x, startY: y, sel: cloneSel(this._sel) };
        }
      } else {
        var self = this;
        this._ensureStampImage().then(function () {
          if (self._destroyed) return;
          var r = self._stampRectAt(x, y);
          self._sel = { x: r.x, y: r.y, w: r.w, h: r.h };
          self._paint();
          var s = self.getSelection();
          if (s) {
            self.addStamp({ x: s.x, y: s.y, width: s.width, height: s.height });
            self._paint();
            self._renderList();
          }
        });
      }
      return;
    }

    if (!handle && !isPointMode && this._sel) {
      // 检查是否点击了其他签章点（切换选中）
      var hit = this._hitStamp(x, y);
      if (hit && hit.id !== this._activeId) {
        this._activeId = hit.id;
        this._syncSelFromStamp(hit);
        this._paint();
        this._renderList();
        this._emit('stampselect', hit);
      }
    }

    var inside = (!isPointMode && this._sel && !handle &&
                 x >= this._sel.x && x <= this._sel.x + this._sel.w &&
                 y >= this._sel.y && y <= this._sel.y + this._sel.h);

    try { this._overlay.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    if (handle) {
      this._drag = { type: 'resize', handle: handle, startX: x, startY: y, sel: cloneSel(this._sel) };
    } else if (inside) {
      this._drag = { type: 'move', startX: x, startY: y, sel: cloneSel(this._sel) };
    } else {
      var hitStamp = this._hitStamp(x, y);
      if (hitStamp && this._options.allowMulti) {
        // 点击非活动签章点 → 选中并拖动
        this._activeId = hitStamp.id;
        this._syncSelFromStamp(hitStamp);
        this._drag = { type: 'move', startX: x, startY: y, sel: cloneSel(this._sel) };
        this._paint();
        this._renderList();
        this._emit('stampselect', hitStamp);
      } else {
        this._drag = {
          type: 'draw', startX: x, startY: y,
          mode: this._options.mode,
          ratio: e.shiftKey ? 1 : this._options.aspectRatio,
          moved: false
        };
        if (isPointMode) {
          this._sel = { x: x, y: y, w: 0, h: 0 };
          this._activeId = null;
          this._paint();
          this._emit('change', this.getSelection());
        } else {
          this._sel = { x: x, y: y, w: 0, h: 0 };
        }
      }
    }
  };

  PdfStampPicker.prototype._onPointerMove = function (e) {
    var d = this._drag;
    if (!d) {
      var rect = this._overlay.getBoundingClientRect();
      var hx = e.clientX - rect.left, hy = e.clientY - rect.top;
      // 无 hover 预览：鼠标移入不显示图片，点击/拖动才放置
      var h = (this._options.mode === 'rect' && this._sel) ? this._hitHandle(hx, hy) : null;
      this._overlay.style.cursor = h ? handleCursor(h) : (this._options.mode === 'stamp' ? 'copy' : 'crosshair');
      return;
    }
    var rect = this._overlay.getBoundingClientRect();
    var x = clamp(e.clientX - rect.left, 0, this._displayW);
    var y = clamp(e.clientY - rect.top, 0, this._displayH);
    d.moved = true;

    if (d.type === 'move') {
      var dx = x - d.startX, dy = y - d.startY;
      this._sel = {
        x: clamp(d.sel.x + dx, 0, this._displayW - d.sel.w),
        y: clamp(d.sel.y + dy, 0, this._displayH - d.sel.h),
        w: d.sel.w, h: d.sel.h
      };
    } else if (d.type === 'draw') {
      if (this._options.mode === 'point') {
        this._sel = { x: x, y: y, w: 0, h: 0 };
      } else {
        this._sel = buildRect(d.startX, d.startY, x, y, d.ratio, this._displayW, this._displayH, this._options.minSize);
      }
    } else if (d.type === 'resize') {
      var ratio = d.ratio || this._options.aspectRatio;
      if (this._options.mode === 'stamp') ratio = this._stampRatio();
      this._sel = resizeRect(d.sel, d.handle, x, y, ratio, this._displayW, this._displayH, this._options.minSize);
    }

    this._schedulePaint();
    this._emit('change', this.getSelection());
  };

  PdfStampPicker.prototype._onPointerUp = function (e) {
    var d = this._drag;
    if (!d) return;
    this._drag = null;

    if (d.type === 'draw') {
      var s = this._sel;
      var isPoint = d.mode === 'point';
      if (!isPoint && (!s || s.w < this._options.minSize || s.h < this._options.minSize)) {
        this._sel = null;
        this._paint();
        return;
      }
      if (isPoint && this._activeId) {
        // 点选模式下拖动已有锚点 = 移动
        this._commitActive();
        this._paint();
        this._emit('select', this.getSelection());
        return;
      }
      this._paint();
      this._addStampFromSel();
      return;
    }
    // move / resize
    this._commitActive();
    this._paint();
    this._emit('select', this.getSelection());
  };

  PdfStampPicker.prototype._onKeyDown = function (e) {
    if (!this._sel && !this._activeId) return;
    var step = e.shiftKey ? 10 : 1;
    var handled = true;
    switch (e.key) {
      case 'ArrowLeft': this._moveSel(-step, 0); break;
      case 'ArrowRight': this._moveSel(step, 0); break;
      case 'ArrowUp': this._moveSel(0, -step); break;
      case 'ArrowDown': this._moveSel(0, step); break;
      case 'Delete': case 'Backspace': this.removeSelection(); break;
      case 'Escape': if (this._drag) { this._drag = null; this._paint(); } break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  };

  PdfStampPicker.prototype._moveSel = function (dx, dy) {
    var s = this._sel;
    if (!s) return;
    s.x = clamp(s.x + dx, 0, Math.max(0, this._displayW - s.w));
    s.y = clamp(s.y + dy, 0, Math.max(0, this._displayH - s.h));
    this._paint();
    this._commitActive();
    this._emit('change', this.getSelection());
  };

  PdfStampPicker.prototype._schedulePaint = function () {
    var self = this;
    if (this._raf) return;
    this._raf = requestAnimationFrame(function () {
      self._raf = 0;
      self._paint();
    });
  };

  /* ---------------- 绘制 ---------------- */

  PdfStampPicker.prototype._paint = function () {
    var ov = this._overlay;
    if (!ov || !ov.width) return;
    var ctx = ov.getContext('2d');
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this._displayW, this._displayH);
    if (this._options.showGrid) this._drawGrid(ctx);
    this._drawStamps(ctx);
    if (this._sel && this._activeId === null && this._drag) {
      // 新绘制的临时选区（尚未提交）
      this._drawRectSel(ctx, this._sel, this._userColor(), false);
    }
    if (this._sel && this._activeId !== null) {
      // 活动签章点（含手柄/标注）
      this._drawRectSel(ctx, this._sel, this._activeUserColor(), true);
    }
  };

  PdfStampPicker.prototype._userColor = function () {
    var u = this._userById(this._currentUserId);
    return u ? u.color : '#4285f4';
  };
  PdfStampPicker.prototype._activeUserColor = function () {
    var st = this.getActiveStamp();
    var u = st ? this._userById(st.userId) : this._userById(this._currentUserId);
    return u ? u.color : '#4285f4';
  };

  PdfStampPicker.prototype._drawGrid = function (ctx) {
    var step = 25;
    var target = 40;
    var candidates = [5, 10, 20, 25, 50, 100, 200, 500];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] * this._cssScale >= target) { step = candidates[i]; break; }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = step; gx < this._spanW(); gx += step) {
      var sx = gx * this._cssScale;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, this._displayH);
    }
    for (var gy = step; gy < this._spanH(); gy += step) {
      var sy = this._displayH - gy * this._cssScale;
      ctx.moveTo(0, sy); ctx.lineTo(this._displayW, sy);
    }
    ctx.stroke();
  };

  /** 签章图片缓存（按 src），加载完成后自动重绘 */
  PdfStampPicker.prototype._imgFor = function (src) {
    if (!this._imgCache) this._imgCache = {};
    if (this._imgCache[src]) return this._imgCache[src];
    var img = new Image();
    var self = this;
    img.onload = function () { if (!self._destroyed) self._schedulePaint(); };
    img.src = src;
    this._imgCache[src] = img;
    return img;
  };

  /** 绘制签章图片到矩形（保持比例铺满，矩形已按源图比例锁定） */
  PdfStampPicker.prototype._drawStampImage = function (ctx, rect, color, alpha) {
    var img = this._stampImg;
    if (!img || !img.el) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img.el, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]);
  };

  /** 绘制全部签章点（非活动：显示该签章点自己的公章图/占位 + 序号角标） */
  PdfStampPicker.prototype._drawStamps = function (ctx) {
    for (var i = 0; i < this._stamps.length; i++) {
      var st = this._stamps[i];
      if (st.page !== this._pageNumber) continue;
      if (st.id === this._activeId) continue; // 活动由 _paint 详细绘制
      var u = this._userById(st.userId) || this._users[0];
      var color = u.color;
      var p = this.pdfToScreen(st.x, st.y);
      ctx.strokeStyle = color;
      ctx.fillStyle = hexToRgba(color, 0.13);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      if (st.width > 0 && st.height > 0) {
        var p2 = this.pdfToScreen(st.x + st.width, st.y - st.height);
        var l = Math.min(p.x, p2.x), t = Math.min(p.y, p2.y);
        var w = Math.abs(p2.x - p.x), h = Math.abs(p2.y - p.y);
        // 签章点有自己的章图 → 画该用户自己的章（不随当前用户变化）
        var im = st.image ? this._imgFor(st.image.src) : null;
        if (im && im.complete && im.naturalWidth) {
          ctx.setLineDash([]);
          ctx.drawImage(im, l, t, w, h);
          ctx.strokeStyle = hexToRgba(color, 0.55);
          ctx.lineWidth = 1;
          ctx.strokeRect(l, t, w, h);
          drawSeqBadge(ctx, i + 1, l, t, color);
          ctx.setLineDash([]);
          continue;
        }
        ctx.fillRect(l, t, w, h);
        ctx.strokeRect(l, t, w, h);
        ctx.setLineDash([]);
        // 用户名小标签（坐标占位标识）
        ctx.font = '10px system-ui, sans-serif';
        var uname = (u.name || '').slice(0, 8);
        var tw = ctx.measureText(uname).width;
        var lx = clamp(l, 2, Math.max(2, this._displayW - tw - 10));
        var ly = (t - 16 >= 0) ? t - 16 : t + 2;
        ctx.fillStyle = color;
        ctx.fillRect(lx, ly, tw + 8, 14);
        ctx.fillStyle = '#fff';
        ctx.fillText(uname, lx + 4, ly + 10);
        drawSeqBadge(ctx, i + 1, l, t, color);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x + 9, p.y);
        ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x, p.y + 9);
        ctx.stroke();
        drawSeqBadge(ctx, i + 1, p.x, p.y, color);
      }
      ctx.setLineDash([]);
    }
  };

  /** 绘制活动选区（rect 或 point） */
  PdfStampPicker.prototype._drawRectSel = function (ctx, s, color, isActive) {
    var x = s.x, y = s.y, w = s.w, h = s.h;
    if (this._options.mode === 'point' && w === 0 && h === 0) {
      // 精致锚点：外环 + 内点 + 准星光晕
      ctx.save();
      ctx.shadowColor = hexToRgba(color, 0.6);
      ctx.shadowBlur = 8;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = hexToRgba(color, 0.45);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
      ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.stroke();
      return;
    }

    // stamp 模式活动签章：用签章点自己的公章图（半透明+手柄），不随当前用户变化
    var activeSt = isActive ? this.getActiveStamp() : null;
    var activeImg = null;
    if (isActive && activeSt && activeSt.image) {
      activeImg = this._imgFor(activeSt.image.src);
      if (activeImg && !(activeImg.complete && activeImg.naturalWidth)) activeImg = null;
    }
    if (isActive && activeSt && this._options.mode === 'stamp' && activeImg) {
      // 拖动中半透明（跟手感），放置后立即完整显示（= 已真正落定）
      var isDragging = !!(this._drag && (this._drag.type === 'move' || this._drag.type === 'resize'));
      ctx.save();
      ctx.globalAlpha = isDragging ? 0.6 : 1;
      ctx.drawImage(activeImg, x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      var seqIdx = this._stamps.indexOf(activeSt);
      if (seqIdx >= 0) drawSeqBadge(ctx, seqIdx + 1, x, y, color);
      drawHandles(ctx, x, y, w, h, color);
      drawSizeLabel(this, ctx, x, y, w, h);
      return;
    }

    ctx.fillStyle = hexToRgba(color, isActive ? 0.18 : 0.1);
    ctx.fillRect(x, y, w, h);
    if (isActive) {
      // 外发光层
      ctx.strokeStyle = hexToRgba(color, 0.35);
      ctx.lineWidth = 5;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = isActive ? 2 : 1.5;
    ctx.strokeRect(x, y, w, h);

    if (isActive) {
      // 九宫格
      ctx.strokeStyle = hexToRgba(color, 0.4);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (var i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + w * i / 3, y); ctx.lineTo(x + w * i / 3, y + h);
        ctx.moveTo(x, y + h * i / 3); ctx.lineTo(x + w, y + h * i / 3);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      if (activeSt) {
        var seqIdx2 = this._stamps.indexOf(activeSt);
        if (seqIdx2 >= 0) drawSeqBadge(ctx, seqIdx2 + 1, x, y, color);
      }
      drawHandles(ctx, x, y, w, h, color);
      drawSizeLabel(this, ctx, x, y, w, h);
    }
  };

  /* ---------------- 工具栏刷新 ---------------- */

  PdfStampPicker.prototype._updateToolbar = function () {
    if (this._zoomLabel) this._zoomLabel.textContent = Math.round(this._cssScale * 100) + '%';
    if (this._pageLabel) this._pageLabel.textContent = this._pageNumber + ' / ' + this._totalPages;
  };

  PdfStampPicker.prototype._loadUrl = function (url) {
    var self = this;
    url = (url || '').trim();
    if (!url) return;
    this._urlbar.classList.remove('open');
    this.load(url).catch(function (err) {
      self._emit('error', { message: err.message });
      if (typeof console !== 'undefined') console.error(err);
    });
  };

  /* ---------------- 销毁 ---------------- */

  PdfStampPicker.prototype.destroy = function () {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (!this._ro) window.removeEventListener('resize', this._handlers.resize);
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._listeners = {};
  };

  /* ====================== 弹窗模式 ====================== */

  /**
   * 一键弹窗选择签章位置。
   * @param {Object} config
   * @param {*} config.source 统一 PDF 来源（File/URL/流接口配置/proxy）
   * @param {string} [config.title='选择签章位置']
   * @param {string} [config.confirmText='确认']
   * @param {string} [config.cancelText='取消']
   * @param {Array} [config.users] 用户列表
   * @param {string} [config.currentUser]
   * @param {boolean} [config.closeOnBackdrop=true] 点遮罩关闭
   * @param {boolean} [config.requireStamp=false] 无签章点不允许确认
   * @param {Function} [config.onConfirm] 确认回调（可返回 Promise 阻止关闭）
   * @param {Function} [config.onCancel]
   * @param {Object} [config.pickerOptions] 透传给选择器的其他选项
   * @returns {Promise<Object|null>} 确认返回 toJSON()，取消返回 null
   */
  PdfStampPicker.openModal = function (config) {
    config = config || {};
    return new Promise(function (resolve) {
      if (typeof document === 'undefined') { resolve(null); return; }
      var mask = document.createElement('div');
      mask.className = 'psp-modal-mask';
      var modal = document.createElement('div');
      modal.className = 'psp-modal';
      var head = document.createElement('div');
      head.className = 'psp-modal-head';
      var title = document.createElement('h2');
      title.textContent = config.title || '选择签章位置';
      var closeBtn = document.createElement('button');
      closeBtn.className = 'psp-modal-close';
      closeBtn.textContent = '✕';
      head.appendChild(title);
      head.appendChild(closeBtn);
      var body = document.createElement('div');
      body.className = 'psp-modal-body';
      var foot = document.createElement('div');
      foot.className = 'psp-modal-foot';
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'psp-btn-ghost';
      cancelBtn.textContent = config.cancelText || '取消';
      var okBtn = document.createElement('button');
      okBtn.className = 'psp-btn-primary';
      okBtn.textContent = config.confirmText || '确认';
      foot.appendChild(cancelBtn);
      foot.appendChild(okBtn);
      modal.appendChild(head);
      modal.appendChild(body);
      modal.appendChild(foot);
      mask.appendChild(modal);
      document.body.appendChild(mask);

      var settled = false;
      var picker = new PdfStampPicker(body, Object.assign({}, config.pickerOptions, {
        users: config.users,
        currentUser: config.currentUser
      }));
      if (config.source) {
        picker.load(config.source).catch(function (err) {
          picker._emit('error', { message: err.message });
          if (typeof console !== 'undefined') console.error(err);
        });
      }

      function finish(result) {
        if (settled) return;
        settled = true;
        try { picker.destroy(); } catch (e) { /* ignore */ }
        document.body.removeChild(mask);
        resolve(result);
      }
      function doCancel() {
        if (config.onCancel) {
          try { config.onCancel(); } catch (e) { /* ignore */ }
        }
        finish(null);
      }
      function doConfirm() {
        var json = picker.toJSON();
        var stampTotal = (json.users || []).reduce(function (n, g) {
          return n + (g.stamps ? g.stamps.length : 0);
        }, 0);
        if (config.requireStamp && stampTotal === 0) return;
        if (config.onConfirm) {
          try {
            var r = config.onConfirm(json);
            if (r && typeof r.then === 'function') {
              r.then(function () { finish(json); }, function () { /* 用户取消 */ });
              return;
            }
          } catch (e) { /* ignore */ }
        }
        finish(json);
      }

      okBtn.addEventListener('click', doConfirm);
      cancelBtn.addEventListener('click', doCancel);
      closeBtn.addEventListener('click', doCancel);
      if (config.closeOnBackdrop !== false) {
        mask.addEventListener('click', function (e) { if (e.target === mask) doCancel(); });
      }
    });
  };

  /* ====================== 工具 ====================== */

  function isPdfjsProxy(src) {
    return src && typeof src.getPage === 'function' && typeof src.numPages === 'number';
  }

  function hexToRgba(hex, alpha) {
    var h = String(hex || '#4285f4').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) n = 0x4285f4;
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 五角星 path（canvas 2d，当前 context） */
  function starPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var radius = (i % 2 === 0) ? r : r * 0.382;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var px = cx + Math.cos(a) * radius;
      var py = cy + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  /** 绘制 8 向手柄（圆角方块，带外发光） */
  function drawHandles(ctx, x, y, w, h, color) {
    var hs = 4.5;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.28)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    var pts = [
      [x, y], [x + w / 2, y], [x + w, y],
      [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h],
      [x, y + h], [x, y + h / 2]
    ];
    for (var j = 0; j < pts.length; j++) {
      roundRect(ctx, pts[j][0] - hs, pts[j][1] - hs, hs * 2, hs * 2, 2.5);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 圆角矩形 path */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 绘制尺寸标注气泡 */
  function drawSizeLabel(picker, ctx, x, y, w, h) {
    var sel = picker.getSelection();
    if (sel && (sel.width || 0) > 0) {
      var label = fmt(sel.width) + ' × ' + fmt(sel.height) + ' pt';
      ctx.font = '11px system-ui, sans-serif';
      var tw = ctx.measureText(label).width;
      var bx = clamp(x + w / 2 - tw / 2 - 6, 2, Math.max(2, picker._displayW - tw - 14));
      var by = y - 22 < 0 ? y + h + 6 : y - 22;
      ctx.fillStyle = hexToRgba('#202124', 0.85);
      ctx.fillRect(bx, by, tw + 12, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, bx + 6, by + 13);
    }
  }

  /** 绘制序号角标（用户色圆底 + 白色序号） */
  function drawSeqBadge(ctx, n, x, y, color) {
    var r = 8;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.3)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + 0.5);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  /** 构建完整 JSON（纯函数，可单测） */
    /**
   * 构建 JSON：以用户（签署方）为主维度分组。
   * 每个用户下挂自己的签章点坐标 —— 直接对接第三方签章接口的 signers[].signAreas[] 模型。
   * @returns {{document:Object, users:Array<{user:Object, stamps:Array}>}}
   */
  function buildJSON(doc, stamps, users) {
    var userList = (users && users.length) ? users : [{ id: 'default', name: '默认', color: '#4285f4' }];
    var stampList = stamps || [];
    return {
      document: {
        name: doc.docName || '',
        pages: doc.totalPages,
        currentPage: doc.currentPage,
        pageSize: { width: round2(doc.width), height: round2(doc.height), unit: 'pt' },
        rotation: doc.rotation || 0,
        generatedAt: new Date().toISOString()
      },
      users: userList.map(function (u) {
        var userStamps = stampList
          .filter(function (st) { return st.userId === u.id; })
          .map(function (st) {
            return {
              id: st.id,
              page: st.page,
              x: round2(st.x), y: round2(st.y),
              width: round2(st.width), height: round2(st.height),
              unit: 'pt',
              rotation: st.rotation || 0,
              note: st.note || '',
              createdAt: st.createdAt
            };
          });
        return {
          user: { id: u.id, name: u.name, color: u.color || '#4285f4' },
          stamps: userStamps
        };
      })
    };
  }

  /**
   * 构建扁平版 JSON（旧结构兼容）：stamps 数组，每项内嵌 user。
   * 供需要"按签章点遍历"的场景使用。
   */
  function buildFlatJSON(doc, stamps, users) {
    var userMap = {};
    (users || []).forEach(function (u) { userMap[u.id] = { id: u.id, name: u.name, color: u.color }; });
    return {
      document: {
        name: doc.docName || '',
        pages: doc.totalPages,
        currentPage: doc.currentPage,
        pageSize: { width: round2(doc.width), height: round2(doc.height), unit: 'pt' },
        rotation: doc.rotation || 0,
        generatedAt: new Date().toISOString()
      },
      stamps: (stamps || []).map(function (st) {
        var u = userMap[st.userId] || null;
        return {
          id: st.id,
          user: u,
          page: st.page,
          x: round2(st.x), y: round2(st.y),
          width: round2(st.width), height: round2(st.height),
          unit: 'pt',
          rotation: st.rotation || 0,
          note: st.note || '',
          createdAt: st.createdAt
        };
      })
    };
  }

  PdfStampPicker.version = VERSION;
  PdfStampPicker._internals = { buildJSON: buildJSON, buildFlatJSON: buildFlatJSON, genId: genId, normalizeRotation: normalizeRotation };
  PdfStampPicker._localCandidates = PdfStampPicker._localCandidates || null; // 由下方赋值（保持单测可访问）

  return PdfStampPicker;
});
