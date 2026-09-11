/*!
 * PdfStampPicker v4.9.3
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

  var VERSION = '4.9.3';

  // ★ 库文件加载时（同步 IIFE 执行期）记录自身位置——之后任何异步探测都能定位同目录 vendor/
  // 注意：document.currentScript 只在脚本同步执行期间有效，必须此时捕获
  (function () {
    try {
      var cur = document.currentScript;
      if (cur && cur.src) window.__pspLibSrc = cur.src;
    } catch (e) { /* ignore */ }
  })();

  /* ====================== 常量 ====================== */

  var DEFAULT_DPI = 96;
  var CDN_PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var CDN_PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var DEFAULT_USERS = [{ id: 'default', name: '默认', color: '#4285f4' }];
  var STAMP_COLORS = ['#4285f4', '#ea4335', '#34a853', '#f9ab00', '#a142f4', '#12b5cb', '#e8710a', '#5f6368'];

  // ★ worker blob URL 全局缓存（跨实例共享）：worker 源码固定，fetch+Blob 只需做一次；
  //   blob URL 挂全局而非实例，避免实例 destroy 时 revoke 导致其他/后续实例的 workerSrc 悬空
  var _sharedWorkerBlob = { srcUrl: null, blobUrl: null };
  /* cMaps 探测结果（库级静态资源，与实例无关 → 全页面只探一次）
   * 历史问题：只存在实例上 → 每个新实例（含弹框每次打开）都重跑整条候选链的 HEAD 探测。 */
  var _sharedCMap = { done: false, url: null };
  var _sharedCMapPromise = null;

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
    '.psp-toolbar .psp-pageinfo{opacity:.9;font-variant-numeric:tabular-nums;background:rgba(0,0,0,.28);border-radius:14px;padding:3px 12px;font-size:11.5px;color:#b8bcc4;border:1px solid rgba(255,255,255,.08)}',
    '.psp-toolbar .psp-zoomval{min-width:50px;text-align:center;font-variant-numeric:tabular-nums;color:#b8bcc4;font-size:11.5px}',
    '.psp-toolbar .psp-thumb{width:30px;height:30px;border-radius:8px;object-fit:contain;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);padding:3px;cursor:default;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s ease}',
    '.psp-toolbar .psp-thumb:hover{transform:scale(1.08)}',
    '.psp-toolbar .psp-thumb-zone{display:inline-flex;align-items:center;gap:5px;margin-left:2px}',
    '.psp-toolbar .psp-thumb-label{font-size:10px;color:#9aa0a6;line-height:1.2;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    /* ===== URL 条 ===== */
    '.psp-urlbar{display:none;align-items:center;gap:8px;padding:8px 14px;background:linear-gradient(180deg,#2b2f36,#23262c);border-bottom:1px solid rgba(0,0,0,.35);flex:none;box-shadow:0 2px 8px rgba(0,0,0,.18)}',
    '.psp-urlbar.open{display:flex;animation:pspSlideDown .22s ease}',
    '.psp-urlbar .psp-url-field{flex:1;display:flex;align-items:center;gap:8px;background:#1c1e22;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:0 10px;transition:border-color .18s ease,box-shadow .18s ease}',
    '.psp-urlbar .psp-url-field:focus-within{border-color:#4285f4;box-shadow:0 0 0 3px rgba(66,133,244,.22)}',
    '.psp-urlbar .psp-url-icon{color:#9aa0a6;font-size:13px;flex:none;line-height:1}',
    '.psp-urlbar input{flex:1;background:transparent;color:#e8eaed;border:none;padding:8px 0;font-size:12.5px;min-width:0;outline:none;font-family:inherit}',
    '.psp-urlbar input::placeholder{color:#80868b}',
    '.psp-urlbar .psp-url-go{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(180deg,#5a95f5,#4285f4);color:#fff;border:none;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:600;cursor:pointer;transition:box-shadow .18s ease,transform .12s ease;font-family:inherit}',
    '.psp-urlbar .psp-url-go:hover{box-shadow:0 3px 10px rgba(66,133,244,.45)}',
    '.psp-urlbar .psp-url-go:active{transform:translateY(1px)}',
    '.psp-urlbar .psp-url-cancel{display:inline-flex;align-items:center;gap:5px;background:transparent;color:#b8bcc4;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:7px 12px;font-size:12px;cursor:pointer;transition:background .15s ease,color .15s ease;font-family:inherit}',
    '.psp-urlbar .psp-url-cancel:hover{background:rgba(255,255,255,.1);color:#fff}',
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
    '.psp-note{margin-top:2px;color:#80868b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.psp-del{background:none;border:none;color:#9aa0a6;font-size:15px;cursor:pointer;padding:2px 5px;border-radius:6px;flex:none;line-height:1;opacity:.5;transition:opacity .15s ease,background .15s ease,color .15s ease}',
    '.psp-item:hover .psp-del{opacity:1}',
    '.psp-del:hover{background:rgba(234,67,53,.12);color:#ea4335}',
    /* ===== 主题 ===== */
    '.psp-root{--psp-bg:#e8eaed;--psp-tb:#2b2f36;--psp-tb-fg:#e8eaed;--psp-list-bg:#f4f5f7;--psp-list-fg:#202124}',
    '.psp-root.psp-dark{--psp-bg:#525659;--psp-tb:#2b2f36;--psp-tb-fg:#e8eaed;--psp-list-bg:#2b2f36;--psp-list-fg:#e8eaed}',
    '.psp-root.psp-light{--psp-bg:#e8eaed;--psp-tb:#ffffff;--psp-tb-fg:#3c4043;--psp-list-bg:#f4f5f7;--psp-list-fg:#202124}',
    '.psp-scroll{background:var(--psp-bg)}',
    '.psp-toolbar{background:var(--psp-tb);color:var(--psp-tb-fg);border-bottom:1px solid rgba(0,0,0,.12)}',
    '.psp-toolbar button{color:var(--psp-tb-fg);border-color:rgba(128,134,139,.35);background:rgba(128,134,139,.08)}',
    '.psp-toolbar button:hover{background:rgba(128,134,139,.18)}',
    '.psp-toolbar select{background:var(--psp-tb);color:var(--psp-tb-fg);border-color:rgba(128,134,139,.35)}',
    '.psp-toolbar .psp-sep{background:rgba(128,134,139,.3)}',
    '.psp-toolbar .psp-pageinfo{color:var(--psp-tb-fg);opacity:.85;background:rgba(128,134,139,.15);border-color:rgba(128,134,139,.2)}',
    '.psp-toolbar .psp-zoomval{color:var(--psp-tb-fg);opacity:.85}',
    '.psp-toolbar .psp-thumb{background:rgba(128,134,139,.12);border-color:rgba(128,134,139,.25)}',
    '.psp-toolbar .psp-thumb-label{color:var(--psp-tb-fg);opacity:.65}',
    '.psp-light .psp-toolbar button.active{background:linear-gradient(180deg,#5a95f5,#4285f4);color:#fff;border-color:transparent}',
    '.psp-list{background:var(--psp-list-bg);color:var(--psp-list-fg);border-left:1px solid rgba(128,134,139,.2)}',
    '.psp-list h3{color:var(--psp-list-fg);opacity:.7}',
    '.psp-group-head{color:var(--psp-list-fg);opacity:.8}',
    '.psp-item{background:rgba(255,255,255,.06)}',
    '.psp-root.psp-light .psp-item{background:#fff;box-shadow:0 1px 2px rgba(60,64,67,.08)}',
    '.psp-root.psp-dark .psp-item{background:rgba(255,255,255,.07)}',
    '.psp-root.psp-dark .psp-item-sub{color:#9aa0a6}',
    '.psp-root.psp-dark .psp-list-empty{color:#9aa0a6}',
    '.psp-root.psp-dark .psp-del{color:#9aa0a6}',
    '.psp-urlbar{background:var(--psp-tb);border-bottom:1px solid rgba(128,134,139,.15)}',
    '.psp-urlbar input{background:rgba(128,134,139,.15);color:var(--psp-tb-fg);border-color:rgba(128,134,139,.3)}',
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
    '@keyframes pspToastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}',
    /* ===== 加载遮罩 ===== */
    '.psp-loading{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(248,249,250,.75);z-index:6;gap:10px;backdrop-filter:blur(2px)}',
    '.psp-spinner{width:34px;height:34px;border-radius:50%;border:3px solid rgba(66,133,244,.2);border-top-color:#4285f4;animation:pspSpin .8s linear infinite}',
    '.psp-loading-txt{font-size:12px;color:#5f6368}',
    '@keyframes pspSpin{to{transform:rotate(360deg)}}'
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

  /* ---------------- 坐标换算：纯函数（单一真源） ----------------
   * 这些函数不依赖实例/DOM，库内部与单元测试共用同一份实现。
   * 历史教训：换算公式曾在库和 test/coords.test.js 各存一份，库改坏而测试仍绿（测的是副本）。
   */

  /** 由 PDF 尺寸 + 旋转 + 显示尺寸推导换算几何。返回 { width,height,rotation,sx,sy,offsetX,offsetY } */
  function makeGeom(pdfW, pdfH, rotation, displayW, displayH, offsetX, offsetY) {
    var r = rotation || 0;
    var spanW = (r === 90 || r === 270) ? pdfH : pdfW;
    var spanH = (r === 90 || r === 270) ? pdfW : pdfH;
    return {
      width: pdfW, height: pdfH, rotation: r,
      sx: spanW ? displayW / spanW : 1,
      sy: spanH ? displayH / spanH : 1,
      offsetX: offsetX || 0, offsetY: offsetY || 0
    };
  }

  /** 屏幕(容器)坐标 → PDF 坐标 */
  function pdfCoordFromScreen(cx, cy, g) {
    var sx = g.sx, sy = g.sy, W = g.width, H = g.height, r = g.rotation;
    var x, y;
    switch (r) {
      case 90:  x = cy / sy;     y = cx / sx;     break;
      case 180: x = W - cx / sx; y = cy / sy;     break;   // 注意：y 不镜像（与 pdf.js viewport 对齐）
      case 270: x = W - cy / sy; y = H - cx / sx; break;
      default:  x = cx / sx;     y = H - cy / sy; break;
    }
    return { x: x + g.offsetX, y: y + g.offsetY };
  }

  /** PDF 坐标 → 屏幕(容器)坐标 */
  function screenCoordFromPdf(px, py, g) {
    var sx = g.sx, sy = g.sy, W = g.width, H = g.height, r = g.rotation;
    var x = px - g.offsetX, y = py - g.offsetY;
    var cx, cy;
    switch (r) {
      case 90:  cx = y * sy;       cy = x * sx;       break;
      case 180: cx = (W - x) * sx; cy = y * sy;       break;   // 与 pdfCoordFromScreen 严格互逆
      case 270: cx = (H - y) * sy; cy = (W - x) * sx; break;
      default:  cx = x * sx;       cy = (H - y) * sy; break;
    }
    return { x: cx, y: cy };
  }

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
   * @param {string} [options.pdfjsUrl] pdf.js 自动加载地址（默认 null：本地探测 vendor/ 优先，失败才 CDN）
   * @param {object} [options.pdfjs] 已有 pdfjsLib 实例
   */
  function PdfStampPicker(container, options) {
    if (typeof document === 'undefined') throw new Error('[PdfStampPicker] 仅支持浏览器环境');
    if (typeof container === 'string') {
      container = document.querySelector(container);
    }
    if (!container) throw new Error('[PdfStampPicker] 需要传入容器元素或选择器');

    this._options = Object.assign({
      mode: 'stamp',
      zoom: 'fit-width',
      aspectRatio: null,
      minSize: 4,
      showGrid: false,
      controls: true,
      toolbar: null,   // 工具栏按钮显隐配置（null=全部显示）
      showList: true,
      theme: 'dark',
      dpi: DEFAULT_DPI,
      users: null,
      currentUser: null,
      allowMulti: true,
      keepSelectionOnPageChange: false, // 翻页时是否保留当前选区/选中态（默认 false = 清空，保持历史行为）
      stampImage: null,
      stampSize: 120,
      stampMargin: 12,   // 签章距页面边界的最小间距(px)，0=紧贴边界不可超出
      minStampSize: 24,   // 废弃（v4.4.3 起章固定大小，保留字段兼容）
      maxStampSize: 480,  // 废弃
      pdfjsUrl: null,   // 默认 null：本地探测 vendor/ 优先（内网离线可用），全部失败才 CDN 兜底
      cMapUrl: undefined,  // 中文 PDF 的 CMap 目录（显式指定 > 自动探测本地 cMaps/ > pdf.js 默认 CDN）
      compatCheck: false,  // 旧浏览器检测：true=检测到原生缺失就提示升级+拒绝加载；默认 false=自动兼容(polyfill 兜底,不提示)
      hashUrl: false,      // 纯 URL 流式加载时是否额外取一次字节来算 document.hash（默认 false 不额外下载；需要内网 URL 也出哈希时置 true）
      loadTimeout: 0,      // 加载超时(ms)：0=不限（默认）。>0 时超时 reject 并派发 stage='timeout' 的 error
      keepBytes: false,    // 是否保留 PDF 字节（默认 false：pdf.js 会 transfer 走 buffer，故不保留以省内存）。true 时额外拷贝一份供复用
      clearStampsOnSetPage: true, // 画布模式 setPage() 是否清空签章（默认 true = 保持历史行为；false = 按页保留）。v5.0 将改为 false
      historyLimit: 50,    // 撤销历史最大条数
      credentials: 'same-origin', // fetch 凭据模式：'omit'|'same-origin'|'include'（跨域带 Cookie 的文件流接口需 'include'）
      cache: undefined,    // fetch cache 模式（透传，如 'no-store'）
      referrerPolicy: undefined // fetch referrerPolicy（透传）
    }, options || {});
    if (options && options.pdfjs) this._options.pdfjs = options.pdfjs;

    // ★ 记录库脚本自身位置（优先用库加载时捕获的全局；构造时 currentScript 可能指向宿主脚本）
    this._libSrc = (typeof window !== 'undefined' && window.__pspLibSrc) ||
      (document.currentScript && document.currentScript.src) || null;

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
    // ★ 未加载文档时总页数为 0（不是 1）："没有文档"与"1 页文档"必须能区分，
    //   否则 getTotalPages() 在空实例上会谎报 1 页。加载成功后才写入真实页数。
    this._totalPages = 0;
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
    this._history = [[]];      // 撤销栈（快照数组；仅浅拷贝标量，image 按引用共享）
    this._historyIdx = 0;   // 当前历史位置
    this._histGroupKey = null;   // 当前交互分组键（beginHistoryGroup 设置；结束事件清空）
    this._histMergedKey = null;  // 栈顶条目所属的合并键（用于判断能否覆盖栈顶）
    this._listeners = {};
    this._raf = 0;
    this._destroyed = false;
    this._stampImg = null;   // {src, name, w, h, el(Image)}

    // ★ H1 加载生命周期（根治并发/时序类缺陷）
    //   每次 load()/setPage() 自增 _loadToken，其整条异步链（解析→哈希→渲染）在每个
    //   await 之后都必须校验令牌；不匹配即视为已被后续调用取代，丢弃结果。
    //   这样"状态残留/串档/混合状态"在结构上不可能发生，而不是靠逐个补状态。
    this._loadToken = 0;      // 文档会话令牌
    this._pageToken = 0;      // 页渲染令牌
    this._loadTimer = 0;      // loadTimeout 定时器句柄
    this._loadStage = '';     // 当前加载阶段（诊断用）
    this._abortCtrl = null;
    this._abortSignal = undefined;
    this._pdfHash = null;        // 已就绪的 SHA-256（小写 hex）
    this._pdfHashPromise = null; // 与加载并行的哈希 Promise（源自带字节时）
    this._pdfHashPending = null; // 纯 URL 场景的后台补算 Promise
    this._pdfBytes = null;       // ★ 注意：交给 pdf.js 后会被 transfer 成 detached，
                                 //   请勿复用（需保留请开 keepBytes:true，届时另存副本）
    this._pdfBytesRef = null;    // keepBytes:true 时的独立字节副本
    this._sourceKind = null;     // 'file'|'arraybuffer'|'url'|'url-stream'|'proxy'|'canvas'
    this._lastError = null;      // 最近一次失败（诊断用）
    this._pdfjsSource = null;    // pdf.js 来源（'local'|'cdn'|'inline'|'blob'）
    this._workerMode = null;     // worker 模式（'direct'|'blob'|'disabled'）
    this._polyfillsUsed = [];    // 本次实际注入的 polyfill（诊断用）
    this._imgCache = null;       // Image 元素缓存（dataURL → Image）

    // ★ 记录浏览器【原生】兼容性（必须在 polyfill 注入之前——否则 polyfill 会"骗过"检测）
    this._nativeCompat = {
      at: typeof Array.prototype.at === 'function' && [1].at(0) === 1,
      typedArrayAt: typeof Uint8Array !== 'undefined' && typeof Uint8Array.prototype.at === 'function',
      structuredClone: typeof structuredClone === 'function'
    };
    // 兼容旧浏览器：pdf.js 3.11 依赖 Array.prototype.at() / structuredClone，先注入 polyfill
    ensureAtPolyfill();
    ensureTypedArrayAtPolyfill();
    ensureStructuredClonePolyfill();
    ensureReplaceAllPolyfill();
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

    // URL 输入条（精致样式：图标字段 + 渐变加载 + 幽灵取消）
    var urlbar = document.createElement('div');
    urlbar.className = 'psp-urlbar';
    var urlField = document.createElement('div');
    urlField.className = 'psp-url-field';
    var urlIcon = document.createElement('span');
    urlIcon.className = 'psp-url-icon';
    urlIcon.textContent = '🔗';
    var urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = '输入 PDF 地址或文件流接口 URL，回车加载…';
    urlField.appendChild(urlIcon);
    urlField.appendChild(urlInput);
    var urlBtn = document.createElement('button');
    urlBtn.className = 'psp-url-go';
    urlBtn.textContent = '加载';
    var urlCancel = document.createElement('button');
    urlCancel.className = 'psp-url-cancel';
    urlCancel.textContent = '取消';
    var self = this;
    urlBtn.addEventListener('click', function () { self._loadUrl(urlInput.value); });
    urlInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') self._loadUrl(urlInput.value); });
    urlCancel.addEventListener('click', function () { urlbar.classList.remove('open'); });
    urlbar.appendChild(urlField);
    urlbar.appendChild(urlBtn);
    urlbar.appendChild(urlCancel);
    root.appendChild(urlbar);
    this._urlbar = urlbar;
    this._urlInput = urlInput;

    // 隐藏文件输入
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    // accept 兼容：部分 Android WebView 只认 MIME 不认 .pdf 扩展名，放宽可选项（load 时校验类型）
    fileInput.accept = 'application/pdf,application/x-pdf,application/octet-stream,.pdf,*.pdf';
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      self.load(f).catch(function (err) {
        // 加载失败给反馈（修复静默无反应）：toast + error 事件
        var msg = (err && err.message) || String(err);
        self._toast('❌ 文件加载失败：' + msg);
        self._emit('error', { message: msg });
        if (typeof console !== 'undefined') console.error(err);
      });
      fileInput.value = '';
    });
    root.appendChild(fileInput);
    this._fileInput = fileInput;

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

    // 加载进度遮罩
    var loading = document.createElement('div');
    loading.className = 'psp-loading';
    loading.style.display = 'none';
    loading.innerHTML = '<div class="psp-spinner"></div><div class="psp-loading-txt">加载中…</div>';
    scroll.appendChild(loading);
    this._loadingEl = loading;

    if (this._options.showList) this._buildList(main);
    root.appendChild(main);
    c.appendChild(root);
  };

  /** 工具栏显隐配置（合并默认；toolbar 传 false 可整体隐藏） */
  PdfStampPicker.prototype._toolbarConfig = function () {
    var t = this._options.toolbar;
    var defaults = {
      modes: true, open: true, url: true, users: true, copyJson: true,
      zoom: true, pageNav: true, grid: true, undoRedo: true,
      panel: true, clear: true, stampThumb: true
    };
    if (t === false) { var off = {}; Object.keys(defaults).forEach(function (k) { off[k] = false; }); return off; }
    if (!t) return defaults;
    var out = {};
    Object.keys(defaults).forEach(function (k) { out[k] = t[k] !== undefined ? t[k] : defaults[k]; });
    return out;
  };

  PdfStampPicker.prototype._buildToolbar = function (root) {    var self = this;
    var tb = document.createElement('div');
    tb.className = 'psp-toolbar';
    // 工具栏按钮显隐配置（缺省全部显示；可单独关闭）
    var T = this._toolbarConfig();
    var show = function (key) { return T[key] !== false; };
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
      undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10a6 6 0 0 1 0 12h-3" stroke-linecap="round"/></svg>',
      redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14l5-5-5-5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 9H10a6 6 0 0 0 0 12h3" stroke-linecap="round"/></svg>',
      panel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16" stroke-linecap="round"/><path d="M17 8h2M17 12h2M17 16h2" opacity=".6"/></svg>',
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

    if (show('modes')) {
      this._btnPoint = btn('point', '定位', '点选模式', function () { self.setMode('point'); });
      this._btnRect = btn('rect', '框选', '框选模式', function () { self.setMode('rect'); });
      this._btnStamp = btn('stamp', '签章', '签章模式：点击放置公章（章固定大小）', function () { self.setMode('stamp'); });
      sep();
    }

    // 当前签章图缩略图（内置公章按用户名生成，只读展示）
    if (show('stampThumb')) {
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
    }

    if (show('open')) btn('open', '打开', '选择本地 PDF 文件', function () { self._fileInput.click(); });
    if (show('url')) btn('url', 'URL', '从地址加载 PDF / 文件流接口', function () { self._urlbar.classList.toggle('open'); });
    if (show('users')) {
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
    if (show('copyJson')) btn('copy', '复制JSON', '复制全部签章 JSON 到剪贴板', function () { self.copyJSON(); });
    sep();

    if (show('zoom')) {
      btn('zoomout', '', '缩小', function () { self.setZoom(self._cssScale / 1.25); });
      this._zoomLabel = document.createElement('span');
      this._zoomLabel.className = 'psp-zoomval';
      this._zoomLabel.textContent = '100%';
      tb.appendChild(this._zoomLabel);
      btn('zoomin', '', '放大', function () { self.setZoom(self._cssScale * 1.25); });
      btn('fitw', '适宽', '适应宽度', function () { self.setZoom('fit-width'); });
      btn('fitp', '适页', '适应页面', function () { self.setZoom('fit-page'); });
      sep();
    }
    if (show('pageNav')) {
      btn('prev', '', '上一页', function () { self.gotoPage(self._pageNumber - 1); });
      this._pageLabel = document.createElement('span');
      this._pageLabel.className = 'psp-pageinfo';
      this._pageLabel.textContent = '1 / 1';
      tb.appendChild(this._pageLabel);
      btn('next', '', '下一页', function () { self.gotoPage(self._pageNumber + 1); });
      sep();
    }
    if (show('grid')) {
      btn('grid', '网格', '网格辅助线', function (s) {
        var on = !s._options.showGrid;
        s.setShowGrid(on);
        var b = s._gridBtn;
        if (b) b.classList.toggle('active', on);
      });
      this._gridBtn = tb.lastChild;
    }
    if (show('undoRedo')) {
      btn('undo', '撤销', '撤销上一步操作 (Ctrl+Z)', function () { self.undo(); });
      btn('redo', '重做', '重做 (Ctrl+Shift+Z)', function () { self.redo(); });
    }
    if (show('panel')) btn('panel', '面板', '显示/隐藏签章列表面板', function () { self.toggleList(); });
    if (show('clear')) btn('trash', '清除', '删除全部签章点', function () { self.clear(); });
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
   * @param {Object} [opts] { pageNumber, mode }
   * @param {number} [opts.pageNumber] 加载后跳转的页码
   * @param {'point'|'rect'|'stamp'} [opts.mode] 加载后切换的坐标选择模式（可选性加载）
   */
  PdfStampPicker.prototype.load = function (source, opts) {
    var self = this;
    opts = opts || {};

    // 浏览器兼容检测：pdf.js 3.11 需要多项现代 API（Array.at/TypedArray.at/structuredClone 等）
    // 默认自动兼容（polyfill 兜底）；仅 compatCheck:true 时，原生缺失才提示升级+拒绝加载
    // ★ 用构造时记录的【原生】兼容标志（polyfill 注入后会污染 Array.at 检测，必须用原生判断）
    if (this._options.compatCheck === true && this._nativeCompat) {
      var missing = [];
      if (!this._nativeCompat.at) missing.push('Array.at');
      if (!this._nativeCompat.typedArrayAt) missing.push('TypedArray.at');
      if (!this._nativeCompat.structuredClone) missing.push('structuredClone');
      if (missing.length) {
        this._showCompatWarning(missing);
        return Promise.reject(this._fail(new Error('当前浏览器版本过旧，无法加载 PDF。缺少：' + missing.join('、') +
          '。请升级到 Chrome/Edge 98+、Firefox 94+ 或 Safari 15.4+。'), 'compat'));
      }
    }

    /* ★★ H1「加载会话令牌」—— 根治一切并发/时序类缺陷
     *   D2 跨文档哈希串档、D3 并发 load 混合状态、D4 陈旧哈希回写、D5 失败被吞，根因都是
     *   "旧加载的异步结果落到了新文档上"。与其逐个补状态，不如给每次加载发一张令牌：
     *   自增后，本次加载的整条异步链（取字节 → 算哈希 → pdf.js 解析 → 渲染 → 事件）
     *   在每个 await 之后都必须校验 _isCurrentLoad(token)；一旦不匹配，立即释放已建资源并中止。
     *   于是"跨文档污染"在结构上不可能发生。 */
    var token = ++this._loadToken;
    this._lastError = null;

    // 中止上一次在途网络请求
    if (this._abortCtrl) { try { this._abortCtrl.abort(); } catch (e) { /* ignore */ } }
    this._abortCtrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    this._abortSignal = opts.signal || (this._abortCtrl ? this._abortCtrl.signal : undefined);

    // 释放旧文档（防内存累积）
    this._discardDoc(this._pdf);
    this._pdf = null;

    // ★ 统一重置全部文档级状态（新增文档级字段请登记到 _resetDocState，不要在此散写 —— 那正是 D2 的成因）
    //   注意顺序：_resetDocState 会把 _loadStage 归零，故 'prepare' 必须在它之后设置
    this._resetDocState();
    this._loadStage = 'prepare';

    var p;
    var urlForHash = null, headersForHash = null;

    if (isPdfjsProxy(source)) {
      this._sourceKind = 'proxy';
      p = Promise.resolve(source);
    } else if (typeof source === 'string') {
      this._sourceKind = 'url-stream';
      urlForHash = source;
      p = this._loadRemote({ url: source, signal: this._abortSignal, token: token });
    } else if (source && typeof source === 'object' && typeof source.url === 'string' && !(source instanceof ArrayBuffer)) {
      this._sourceKind = 'url';
      urlForHash = source.url;
      headersForHash = source.headers || null;
      p = this._loadRemote(Object.assign({}, source, { signal: this._abortSignal, token: token }));
    } else if (typeof File !== 'undefined' && source instanceof File) {
      this._sourceKind = 'file';
      this._docName = source.name || '本地文件.pdf';
      // 类型校验：明显非 PDF 的文件提前报错（避免 pdf.js 解析后报晦涩错误）
      var ftype = (source.type || '').toLowerCase();
      var fname = (source.name || '').toLowerCase();
      if (ftype && ftype.indexOf('pdf') < 0 && ftype.indexOf('octet-stream') < 0 && !/\.pdf$/.test(fname)) {
        return Promise.reject(this._fail(new Error('不是有效的 PDF 文件：' + (source.name || '')), 'type'));
      }
      this._loadStage = 'read';
      p = source.arrayBuffer().then(function (buf) {
        if (!self._isCurrentLoad(token)) throw supersededError();
        self._pdfBytes = buf;
        if (self._options.keepBytes === true) self._pdfBytesRef = buf.slice(0); // 显式保留独立副本
        self._loadStage = 'hash';
        self._pdfHashPromise = sha256(buf);
        // ★ 必须先等哈希算完再交给 pdf.js：pdf.js 会以 transfer 方式把 ArrayBuffer 交给 worker，
        //   主线程侧该 buffer 随即 detached（byteLength → 0）。纯 JS SHA-256 兜底是分块异步读的，
        //   若 buffer 在读完前被 transfer，后续分块会读到全 0 → 静默产出错误哈希（v4.8.28 已修此链）。
        return self._pdfHashPromise.then(function (h) {
          self._pdfHash = h || null;
          if (!self._isCurrentLoad(token)) throw supersededError();
          self._loadStage = 'parse';
          return self._getDoc({ data: buf }, token);
        });
      });
    } else if (source instanceof ArrayBuffer || (typeof Uint8Array !== 'undefined' && source instanceof Uint8Array)) {
      this._sourceKind = 'arraybuffer';
      var bytes = (source instanceof Uint8Array) ? source.slice().buffer : source;
      this._pdfBytes = bytes;
      if (this._options.keepBytes === true) this._pdfBytesRef = bytes.slice(0);
      this._loadStage = 'hash';
      this._pdfHashPromise = sha256(bytes);
      p = this._pdfHashPromise.then(function (h) {
        self._pdfHash = h || null;
        if (!self._isCurrentLoad(token)) throw supersededError();
        self._loadStage = 'parse';
        return self._getDoc({ data: bytes }, token);
      });
    } else {
      return Promise.reject(this._fail(new Error('[PdfStampPicker] 无法识别的 PDF 来源'), 'source'));
    }

    // 可选：加载超时（H1 —— 长挂起的加载在 destroy/并发时更难收敛，超时统一走 _fail(stage='timeout')）
    p = this._withTimeout(p, token);

    return p.then(function (doc) {
      // ★ 令牌校验：已被取代 → 释放刚建好的文档，绝不写入状态
      if (!self._isCurrentLoad(token)) { self._discardDoc(doc); throw supersededError(); }
      self._loadStage = 'ready';
      self._setLoading(true, 'PDF 解析中…');
      self._pdf = doc;
      self._totalPages = doc.numPages;
      self._pdfMode = 'pdfjs';
      // ★ 换文档后必须重置页面状态：否则 gotoPage(1) 短路（_pageNumber===1 且 _page 存在）
      // 导致新 PDF 第一页不渲染、页码不刷新（显示旧 PDF 内容/旧总页数）
      self._page = null;
      self._pageNumber = 0;
      self._stamps = [];
      self._activeId = null;
      self._sel = null;
      self._resetHistory();
      // 哈希落地：等待 Promise 写入（已写入则同步可见）
      if (self._pdfHashPromise) {
        self._pdfHashPromise.then(function (h) { if (self._isCurrentLoad(token)) self._pdfHash = h || null; })
                            .catch(function () { if (self._isCurrentLoad(token)) self._pdfHash = null; });
      } else if (self._options.hashUrl === true && urlForHash) {
        // 纯 URL 流式加载（pdf.js 原生流式 → 无字节缓存）：hashUrl:true 时后台补算哈希
        self._computeHashFromUrl(urlForHash, headersForHash, token);
      }
      self._renderList();
      return self.gotoPage(opts.pageNumber || 1, token);
    }).then(function () {
      if (!self._isCurrentLoad(token)) throw supersededError();
      // 加载完成后按需切换选择模式（可选性加载）
      if (opts.mode && self._options.mode !== opts.mode) self.setMode(opts.mode);
      self._setLoading(false);
      self._loadStage = 'done';
    }).catch(function (err) {
      // 已被后续 load()/destroy() 取代：以 AbortError 结束，且【不触碰任何状态】（新会话才是唯一真相）
      if (!self._isCurrentLoad(token)) throw (isAbortError(err) ? err : supersededError());
      // 主动中止 / 超时：预期内，静默交给调用方（超时已带 stage，仍会走下面 _fail 上报）
      if (isAbortError(err)) { self._setLoading(false); self._discardHalfLoaded(); throw err; }
      self._setLoading(false);
      // ★ 统一失败出口：派发 error 事件（含 stage），再抛出 —— 根治 D5（程序化加载失败无任何通知）
      var failStage = err && err.stage ? err.stage : (self._loadStage || 'load');
      self._discardHalfLoaded();   // 失败前未就绪 → 不留半套文档状态（名字/页数/画布互相矛盾）
      throw self._fail(err, failStage);
    });
  };

  /** 远程加载：静态 URL 或文件流接口 */
  PdfStampPicker.prototype._loadRemote = function (cfg) {
    var self = this;
    var token = cfg.token;
    var url = cfg.url;
    var name = '';
    try { name = decodeURIComponent(url.split('?')[0].split('/').pop()) || ''; } catch (e) { /* ignore */ }
    this._docName = name;
    var headers = cfg.headers || {};
    var hasCustom = cfg.method && cfg.method.toUpperCase() !== 'GET';
    var hasHeaders = Object.keys(headers).length > 0;
    if (!hasCustom && !hasHeaders) {
      // 纯静态地址 → pdf.js 原生流式加载（支持大文件、Range 请求、onProgress）
      this._sourceKind = 'url-stream';
      this._loadStage = 'parse';   // 诊断用：失败时 stage 不会停留在 'prepare'
      return this._getDoc({ url: url }, token);
    }
    // 文件流接口 / 自定义头 → fetch 流式取字节（带进度 + 可中止）
    var signal = cfg.signal || this._abortSignal;
    // ★ H5：网络语义可配置（跨域带 Cookie 的文件流接口需 credentials:'include'；内网可配 cache:'no-store' 避免缓存旧 PDF）
    var fetchOpts = {
      method: cfg.method || 'GET',
      headers: headers,
      body: cfg.body || undefined,
      signal: signal,
      credentials: (cfg.credentials !== undefined) ? cfg.credentials : this._options.credentials
    };
    if (cfg.cache !== undefined) fetchOpts.cache = cfg.cache;
    else if (this._options.cache !== undefined) fetchOpts.cache = this._options.cache;
    if (cfg.referrerPolicy !== undefined) fetchOpts.referrerPolicy = cfg.referrerPolicy;
    else if (this._options.referrerPolicy !== undefined) fetchOpts.referrerPolicy = this._options.referrerPolicy;

    this._loadStage = 'fetch';
    return fetch(url, fetchOpts).then(function (res) {
      if (!res.ok) throw new Error('[PdfStampPicker] 加载 PDF 失败 HTTP ' + res.status + ' ' + res.statusText);
      var total = parseInt(res.headers.get('Content-Length') || '0', 10) || 0;
      var reader = res.body && res.body.getReader ? res.body.getReader() : null;
      // 旧浏览器（不支持 Array.at，如 Edge 90）的 fetch 流式读取有已知 bug，可能读成空 body → 直接一次性 arrayBuffer
      if (!reader || !isCompatSupported().ok) return res.arrayBuffer();

      /* ★ H2-1 内存根治：优先按 Content-Length 预分配单块 Uint8Array，边读边写入。
       *   旧实现 chunks[] + new Blob(chunks).arrayBuffer() 的峰值内存 ≈ 2× 文件大小
       *   （chunks 全部片段 + Blob 复制 + 最终 arrayBuffer），200MB 扫描件在移动端直接 OOM。
       *   预分配后峰值 ≈ 1× 文件大小。 */
      var buf = total > 0 ? new Uint8Array(total) : null;
      var chunks = buf ? null : [];
      var received = 0;
      var pump = function () {
        return reader.read().then(function (r) {
          if (r.done) return;
          var v = r.value;
          if (buf && received + v.length <= total) {
            buf.set(v, received);
          } else if (buf) {
            // Content-Length 与实际不符（gzip/分块传输等）→ 退化为片段收集
            chunks = [buf.subarray(0, received)];
            buf = null;
            chunks.push(v);
          } else {
            chunks.push(v);
          }
          received += v.length;
          self._onLoadProgress(received, total);
          return pump();
        });
      };
      return pump().then(function () {
        if (buf) return received === total ? buf.buffer : buf.buffer.slice(0, received);
        return new Blob(chunks).arrayBuffer();
      });
    }).then(function (buf) {
      // ★ 令牌校验（网络返回时可能已被取代）
      if (token != null && !self._isCurrentLoad(token)) throw supersededError();
      // 缓存字节并计算哈希（静态 URL 走 pdf.js 流式时无字节缓存，哈希为 null）
      self._pdfBytes = buf;
      if (self._options.keepBytes === true) self._pdfBytesRef = buf.slice(0);
      self._loadStage = 'hash';
      self._pdfHashPromise = sha256(buf);
      // ★ 必须先等哈希算完再交给 pdf.js（pdf.js 会 transfer/neuter 该 buffer，见 load() 内注释）
      return self._pdfHashPromise.then(function (h) {
        self._pdfHash = h || null;
        if (token != null && !self._isCurrentLoad(token)) throw supersededError();
        self._loadStage = 'parse';
        return self._getDoc({ data: buf }, token);
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') throw err;
      if (isAbortError(err)) throw err;
      if (err && err.name === 'TypeError' && /fetch|network/i.test(String(err.message || ''))) {
        throw new Error('[PdfStampPicker] 网络请求失败，请检查 CORS 与地址可达性: ' + url);
      }
      throw err;
    });
  };

  /**
   * 纯 URL 流式加载时的哈希补算（options.hashUrl === true 时启用）
   * 背景：纯静态地址走 pdf.js 原生流式（Range/大文件友好），库拿不到字节 → 无法算哈希。
   * 开启后额外请求一次同一地址的字节用于计算 SHA-256，不阻塞 PDF 展示；
   * 完成后写入 _pdfHash 并触发 hashready 事件（可用 on('hashready', fn) 或 getHash() 等待）。
   * ★ D4 根治：补算结果必须校验加载令牌 —— 否则切换文档后，旧地址的哈希会回写到新文档上。
   */
  PdfStampPicker.prototype._computeHashFromUrl = function (url, headers, token) {
    var self = this;
    if (!url || typeof fetch === 'undefined') return;
    var opts = { credentials: this._options.credentials };
    if (headers && Object.keys(headers).length) opts.headers = headers;
    if (this._options.cache !== undefined) opts.cache = this._options.cache;
    if (this._options.referrerPolicy !== undefined) opts.referrerPolicy = this._options.referrerPolicy;
    if (this._abortSignal) opts.signal = this._abortSignal;
    this._pdfHashPending = fetch(url, opts)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buf) {
        if (token != null && !self._isCurrentLoad(token)) throw supersededError();
        return sha256(buf);
      })
      .then(function (h) {
        // ★ 陈旧性校验：已被取代/已销毁则【丢弃】，绝不回写旧哈希
        if (token != null && !self._isCurrentLoad(token)) return null;
        if (h) {
          self._pdfHash = h;
          self._emit('hashready', { hash: h, hashAlgorithm: 'SHA-256' });
        }
        return h;
      })
      .catch(function () { return null; });
  };

  /**
   * 等待并获取当前 PDF 的 SHA-256 哈希（Promise<string|null>）
   * 适用：纯 URL + hashUrl:true 时哈希是加载完成后异步补算的，调用方需等待就绪。
   * @returns {Promise<string|null>} 小写 hex；不可用时为 null
   */
  PdfStampPicker.prototype.getHash = function () {
    var self = this;
    if (this._pdfHash) return Promise.resolve(this._pdfHash);
    var p = this._pdfHashPending || this._pdfHashPromise;
    if (!p) return Promise.resolve(null);
    return Promise.resolve(p).then(function () {
      return self._pdfHash || null;
    }, function () {
      return self._pdfHash || null;
    });
  };

  /**
   * 当前文档名（未加载任何文档时为 ''）。
   * 与 toJSON().document.docName 同源（同一字段），只是省掉构建整份 JSON 的开销。
   * @returns {string}
   */
  PdfStampPicker.prototype.getDocName = function () {
    return this._docName;
  };

  /**
   * 当前文档总页数（**未加载任何文档时为 0**，而不是 1）。
   * 0 是"没有文档"，1 是"有一份 1 页的文档" —— 调用方靠这个区分，
   * 因此不要用 `> 0` 之外的花招判断文档是否存在。
   * @returns {number}
   */
  PdfStampPicker.prototype.getTotalPages = function () {
    return this._totalPages;
  };

  /**
   * 文档元信息（唯一来源）。
   * toJSON() / toFlatJSON() 的 document 块都从这里取：
   * 历史上两个导出各抄了一份同样的 10 个字段，加字段时漏改一处就会出现
   * "两种 JSON 出口字段不一致"（本项目的 D7 类文档/实现漂移）。
   * ★ 新增文档级字段时只改这里 + _resetDocState。
   */
  PdfStampPicker.prototype._docMeta = function (includeImage) {
    return {
      docName: this._docName,
      totalPages: this._totalPages,
      currentPage: this._pageNumber,
      width: this._pdfW,
      height: this._pdfH,
      rotation: this._rotation,
      offsetX: this._offsetX,
      offsetY: this._offsetY,
      hash: this._pdfHash || null,
      hashStatus: this._hashStatus(),
      includeImage: !!includeImage
    };
  };

  /**
   * 当前哈希状态：'ready' | 'pending' | 'unavailable'
   * 会随 toJSON()/toFlatJSON() 一起输出（document.hashStatus），
   * 用于区分"已算好 / 还在算 / 本场景算不了"，避免只看到 hash 字段消失而无法判断原因。
   */
  PdfStampPicker.prototype._hashStatus = function () {
    if (this._pdfHash) return 'ready';
    if (this._pdfHashPromise || this._pdfHashPending) return 'pending';
    return 'unavailable';
  };

  /**
   * 当前加载会话是否仍然有效（令牌匹配且未销毁）。
   * ★ H1 的唯一判定入口：所有加载链上的 await 之后都必须调用它。
   */
  PdfStampPicker.prototype._isCurrentLoad = function (token) {
    return !this._destroyed && token === this._loadToken;
  };

  /** 释放一个不再需要的 pdf.js 文档（worker 侧资源），失败不影响主流程 */
  PdfStampPicker.prototype._discardDoc = function (doc) {
    if (!doc || typeof doc.destroy !== 'function') return;
    try { doc.destroy(); } catch (e) { /* ignore */ }
  };

  /**
   * 统一的失败出口：登记诊断信息 + 派发 error 事件，返回可抛出的 Error。
   * 所有失败都必须流经此处，杜绝"静默失败"。
   */
  PdfStampPicker.prototype._fail = function (err, stage) {
    var e = (err instanceof Error) ? err : new Error(String(err));
    if (!e.stage) e.stage = stage || 'unknown';
    this._lastError = { message: e.message, stage: e.stage, at: Date.now() };
    this._emit('error', { error: e, message: e.message, stage: e.stage });
    return e;
  };

  /**
   * 主动中止当前加载（在途网络请求 + 后续渲染）。
   * 语义与 AbortController 一致：进行中的 load() 会以 AbortError 结束。
   */
  PdfStampPicker.prototype.abort = function () {
    // 是否真的有一次"未就绪"的加载在途（决定要不要清残留状态）
    var wasLoading = !!this._loadStage && this._loadStage !== 'ready' && this._loadStage !== 'done';
    this._loadToken++;   // 令所有在途异步链失效
    if (this._abortCtrl) { try { this._abortCtrl.abort(); } catch (e) { /* ignore */ } }
    if (this._loadTimer) { clearTimeout(this._loadTimer); this._loadTimer = 0; }
    this._setLoading(false);
    // ★ 必须在此显式清理：token 自增后，在途 load() 走的是"被取代"分支（不清理），
    //   否则中止后会残留"文件名已显示、文档却是空的"状态。
    //   已完成（ready/done）时不动状态 —— abort() 对已加载好的文档是空操作。
    if (wasLoading) this._discardHalfLoaded();
    return this;
  };

  /**
   * 加载超时包装（options.loadTimeout > 0 时生效）。
   * 超时会中止在途请求并以 stage='timeout' 的错误结束，避免永久挂起。
   */
  PdfStampPicker.prototype._withTimeout = function (p, token) {
    var self = this;
    var ms = this._options.loadTimeout;
    if (!ms || ms <= 0) return p;
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        if (self._loadTimer === timer) self._loadTimer = 0;
        if (self._isCurrentLoad(token) && self._abortCtrl) {
          try { self._abortCtrl.abort(); } catch (e) { /* ignore */ }
        }
        var e = new Error('[PdfStampPicker] 加载超时（' + ms + 'ms）');
        e.stage = 'timeout';
        reject(e);
      }, ms);
      self._loadTimer = timer;
      var settle = function (fn) {
        return function (v) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (self._loadTimer === timer) self._loadTimer = 0;
          fn(v);
        };
      };
      p.then(settle(resolve), settle(reject));
    });
  };

  /**
   * 统一重置全部【文档级】状态。
   * ★ 这是防止"跨文档状态残留"的唯一入口：新增文档级字段时请登记在此，
   *   不要在 load()/setPage()/destroy() 里各写一遍（散写正是 D2 哈希串档的成因）。
   */
  PdfStampPicker.prototype._resetDocState = function () {
    this._page = null;
    this._pageNumber = 1;
    this._pdfW = 0;
    this._pdfH = 0;
    this._offsetX = 0;
    this._offsetY = 0;
    this._rotation = 0;
    // 哈希（三件套必须一起清：只清 _pdfHash 会让旧的 _pdfHashPromise 在下次 load 时被误判为"本次已有哈希"）
    this._pdfHash = null;
    this._pdfHashPromise = null;
    this._pdfHashPending = null;
    // 字节缓存（交给 pdf.js 后即 detached，_pdfBytesRef 才是 keepBytes 的独立副本）
    this._pdfBytes = null;
    this._pdfBytesRef = null;
    // 签章与历史
    this._stamps = [];
    this._activeId = null;
    this._sel = null;
    this._resetHistory();
    this._lastError = null;
    // ★ 文档标识也要清：只清画布不清名字，会出现"文件名显示了、页数却是空的"自相矛盾状态
    //   （实测：加载中 abort() 后 toJSON().document.name 仍是未加载完的名字）
    this._docName = '';
    this._totalPages = 0;   // 0 = 无文档（与构造时一致，见构造器注释）
    this._loadStage = '';
  };

  /**
   * 半成品文档清理：加载在 ready 之前失败 / 被中止时调用（H1 收口的一部分）。
   * 已就绪（ready/done）后的失败【不清理】—— 那属于"文档已加载成功、后续步骤出错"，文档本身仍可用。
   */
  PdfStampPicker.prototype._discardHalfLoaded = function () {
    var st = this._loadStage;
    if (st === 'ready' || st === 'done') return;
    this._resetDocState();
  };

  PdfStampPicker.prototype._getDoc = function (pdfjsCfg, token) {
    var self = this;
    var cfg = Object.assign({}, pdfjsCfg);
    // 加载进度（pdf.js onProgress）
    cfg.onProgress = function (p) {
      self._onLoadProgress(p.loaded || 0, p.total || 0);
    };
    // 中止信号：外部 signal 或内部（destroy/换文档时 abort）
    cfg.signal = pdfjsCfg.signal || this._abortSignal;
    // CMap 本地化：中文 PDF 离线不乱码（显式配置 > 自动探测本地 cMaps/ > pdf.js 默认 CDN）
    var cMapUrl = this._options.cMapUrl;
    if (cMapUrl === undefined && this._detectedCMapUrl === undefined) {
      // 首次加载：先取 cMaps 探测结果（模块级缓存，全页面只探一次）再解析
      return this._probeCMap().then(function () {
        var u = self._options.cMapUrl || self._detectedCMapUrl || null;
        if (u) { cfg.cMapUrl = u; cfg.cMapPacked = true; }
        return self._resolveDoc(cfg, token);
      });
    }
    if (cMapUrl || this._detectedCMapUrl) {
      cfg.cMapUrl = cMapUrl || this._detectedCMapUrl;
      cfg.cMapPacked = true; // .bcmap 压缩格式
    }
    return this._resolveDoc(cfg, token);
  };

  /**
   * 探测本地 cMaps/（中文 PDF 离线不乱码）。
   * ★ 结果提升到【模块级缓存】：cMaps 是随库部署的静态资源，与实例无关。
   *   历史问题：`_detectedCMapUrl` 只存在实例上 → 【每个新实例】都要把整条候选链重新 HEAD 一遍
   *   （每个候选一次网络往返，候选全 404 时更慢）才能开始请求 PDF 本身。弹框模式每次打开都会
   *   new 一个实例，于是每次打开都白付一轮探测开销，并且让"load() 到真正发起请求"之间的
   *   延迟不可预测（对外部时序控制不友好）。
   *   探测只做一次，候选去重，并发实例共享同一个 Promise。
   */
  PdfStampPicker.prototype._probeCMap = function () {
    var self = this;
    var apply = function (url) { self._detectedCMapUrl = url; };
    if (_sharedCMap.done) { apply(_sharedCMap.url); return Promise.resolve(_sharedCMap.url); }
    if (_sharedCMapPromise) {
      return _sharedCMapPromise.then(function (url) { apply(url); return url; });
    }
    // ★ 用库位置（_libSrc）作探测基址，与 pdf.min.js 探测一致（异步时 currentScript 失效）
    var scriptSrc = this._libSrc || (document.currentScript && document.currentScript.src) || null;
    var cands = PdfStampPicker._localCandidates(window.location.href, scriptSrc);
    var raw = [];
    cands.forEach(function (c) {
      raw.push(c.replace(/vendor\/pdf\.min\.js$/, 'cMaps/'));
      raw.push(c.replace(/vendor\/pdf\.min\.js$/, 'vendor/cMaps/'));
    });
    // 候选去重（历史链里存在重复项，重复 HEAD 纯属浪费）
    var seen = {}, uniq = [];
    raw.forEach(function (u) { if (!seen[u]) { seen[u] = 1; uniq.push(u); } });
    var idx = 0;
    var probe = function () {
      if (idx >= uniq.length) return Promise.resolve(null);
      var src = uniq[idx++];
      return fetch(src + '78-EUC-H.bcmap', { method: 'HEAD' }).then(function (res) {
        if (res.ok) return src;
        return probe();
      }).catch(function () { return probe(); });
    };
    _sharedCMapPromise = probe().then(function (url) {
      _sharedCMap.done = true;
      _sharedCMap.url = url || null;
      return _sharedCMap.url;
    });
    return _sharedCMapPromise.then(function (url) { apply(url); return url; });
  };

  /**
   * 由 pdf.js 配置解析文档，并做【加载会话令牌】校验（H1 根治点）。
   * 若解析期间本次加载已被后续 load()/destroy() 取代，则销毁刚建好的文档
   * （释放 worker 侧资源）并抛 AbortError —— 绝不把过期结果写进实例状态。
   */
  PdfStampPicker.prototype._resolveDoc = function (cfg, token) {
    var self = this;
    return this._ensurePdfjs().then(function (pdfjs) {
      if (token != null && !self._isCurrentLoad(token)) throw supersededError();
      return pdfjs.getDocument(cfg).promise;
    }).then(function (doc) {
      if (token != null && !self._isCurrentLoad(token)) {
        self._discardDoc(doc);
        throw supersededError();
      }
      return doc;
    });
  };

  /** 加载进度回调（显示百分比） */
  PdfStampPicker.prototype._onLoadProgress = function (loaded, total) {
    if (!total) { this._setLoading(true, 'PDF 加载中…'); return; }
    var pct = Math.min(100, Math.round(loaded / total * 100));
    this._setLoading(true, 'PDF 加载中… ' + pct + '%');
  };

  /** 确保 pdfjsLib 可用（优先级：传入实例 > 全局 > 配置URL > 本地探测 > CDN） */
  PdfStampPicker.prototype._ensurePdfjs = function () {
    var self = this;
    var pdfjs = this._options.pdfjs || (typeof window !== 'undefined' && window.pdfjsLib) || null;
    if (pdfjs) {
      if (typeof window !== 'undefined' && !window.pdfjsLib) window.pdfjsLib = pdfjs;
      // worker 统一 fetch+Blob 加载（绕开内网 MIME 严格检查 + 注入 polyfill）
      return this._ensureWorker(pdfjs).then(function () { return pdfjs; });
    }
    if (this._pdfjsPromise) return this._pdfjsPromise;
    this._pdfjsPromise = (this._options.pdfjsUrl
      ? PdfStampPicker.loadPdfJs(this._options.pdfjsUrl)   // 用户显式指定
      : PdfStampPicker.loadPdfJsAuto(self._libSrc)          // 本地探测 → CDN 兜底（传库位置，异步时 currentScript 失效）
    ).then(function (lib) {
      self._options.pdfjs = lib;
      return self._ensureWorker(lib).then(function () { return lib; });
    });
    return this._pdfjsPromise;
  };

  /** 解析 worker 文件 URL（从 pdfjsUrl 或探测候选推断） */
  PdfStampPicker.prototype._resolveWorkerUrl = function () {
    var base = this._options.pdfjsUrl || null;
    if (!base) {
      // 从探测链拿（用构造时记录的库位置，异步时 currentScript 失效）
      var cands = PdfStampPicker._localCandidates(window.location.href, this._libSrc || null);
      if (cands.length) base = cands[0];
    }
    if (!base) return null;
    var clean = String(base).split('?')[0].split('#')[0];
    return clean.replace(/pdf(\.min)?\.js$/, 'pdf.worker$1.js');
  };

  /** 确保 worker 可用：统一 fetch+Blob 加载 worker（绕内网 MIME 严格检查 + 注入 polyfill） */
  PdfStampPicker.prototype._ensureWorker = function (pdfjs) {
    // ★ 始终解析【原始 worker 文件 URL】（不读 pdfjs.GlobalWorkerOptions.workerSrc）——
    //   因为 workerSrc 可能已被上一次的实例设成 blob URL，且该 blob 可能已被 revoke（悬空）；
    //   fetch+Blob 包装的目标必须是原始文件 URL，且 _setupCompatWorker 内部有全局缓存兜底
    var workerUrl = this._resolveWorkerUrl();
    if (!workerUrl) {
      this._forceFakeWorker(pdfjs);
      return Promise.resolve();
    }
    return this._setupCompatWorker(pdfjs, workerUrl);
  };

  /** 强制 pdf.js 使用 fake worker（主线程模拟）——旧浏览器 worker 内无法注入 polyfill 时用 */
  PdfStampPicker.prototype._forceFakeWorker = function (pdfjs) {
    try {
      // pdf.js 3.x：workerSrc 为空时自动回退 fake worker（主线程加载 worker 逻辑）
      pdfjs.GlobalWorkerOptions.workerSrc = '';
      // 若已创建 worker 则销毁，下次 getDocument 用 fake worker
      if (pdfjs.PDFWorker && pdfjs.PDFWorker._workerPorts) {
        pdfjs.PDFWorker._workerPorts.clear && pdfjs.PDFWorker._workerPorts.clear();
      }
    } catch (e) { /* ignore */ }
  };

  /**
   * 旧浏览器（Edge90 等）的 worker 兼容方案：
   * fetch worker 源码 → 头部注入 polyfill（Array.at/structuredClone）→ Blob URL 创建改造后的 worker。
   * worker 线程内 polyfill 生效，Edge 90 真能跑 pdf.js（无需 fake worker）。
   */
  PdfStampPicker.prototype._setupCompatWorker = function (pdfjs, workerFileUrl) {
    var self = this;
    try {
      if (!workerFileUrl) return Promise.resolve();
      // 主线程 polyfill 再确保（构造时已注入，此处保险）
      ensureAtPolyfill();
      ensureTypedArrayAtPolyfill();
      ensureStructuredClonePolyfill();
      ensureReplaceAllPolyfill();
      var absUrl = new URL(workerFileUrl, window.location.href).href;
      // ★ 复用全局缓存的 blob（同一 worker 源 URL 只 fetch+Blob 一次），
      //   避免每次打开弹窗重复 fetch，且避免依赖可能已被 revoke 的旧 workerSrc
      if (_sharedWorkerBlob.srcUrl === absUrl && _sharedWorkerBlob.blobUrl) {
        pdfjs.GlobalWorkerOptions.workerSrc = _sharedWorkerBlob.blobUrl;
        if (pdfjs.PDFWorker && pdfjs.PDFWorker._workerPorts) {
          pdfjs.PDFWorker._workerPorts.clear && pdfjs.PDFWorker._workerPorts.clear();
        }
        return Promise.resolve();
      }
      // ★ fetch worker 源码 → Blob URL：
      //   ① 绕开内网服务器 nosniff/错误 MIME 的 strict MIME checking（new Worker 会被拒）
      //   ② 头部注入 polyfill（Edge90 等旧内核需要，现代浏览器无害）
      return fetch(absUrl).then(function (res) {
        if (!res.ok) throw new Error('worker fetch fail');
        return res.text();
      }).then(function (src) {
        var polyfillCode =
          'if(!Array.prototype.at){Object.defineProperty(Array.prototype,"at",{value:function(n){n=Number(n);var l=this.length;if(n<0)n=Math.max(l+n,0);return n>=0&&n<l?this[n]:void 0;},writable:true,configurable:true,enumerable:false});}' +
          'if(!Uint8Array.prototype.at){var __ta=[Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array];if(typeof BigInt64Array!=="undefined"){__ta.push(BigInt64Array,BigUint64Array)}for(var __i=0;__i<__ta.length;__i++){Object.defineProperty(__ta[__i].prototype,"at",{value:function(n){n=Number(n);var l=this.length;if(n<0)n=Math.max(l+n,0);return n>=0&&n<l?this[n]:void 0;},writable:true,configurable:true,enumerable:false});}}' +
          'if(typeof structuredClone==="undefined"){self.structuredClone=function(o){return o;};};' +
          'if(typeof String.prototype.replaceAll==="undefined"){Object.defineProperty(String.prototype,"replaceAll",{value:function(search,replace){var self=this;if(search instanceof RegExp){if(!search.global)throw new TypeError("replaceAll must be called with a global RegExp");return self.replace(search,replace);}return self.split(search).join(replace);},writable:true,configurable:true,enumerable:false});};';
        // 头部注释保留（license），polyfill 插在首个可执行代码前
        var injected = src;
        var commentEnd = injected.indexOf('!function');
        if (commentEnd > 0) {
          injected = injected.slice(0, commentEnd) + polyfillCode + injected.slice(commentEnd);
        } else {
          injected = polyfillCode + injected;
        }
        var blob = new Blob([injected], { type: 'application/javascript' });
        var workerUrl = URL.createObjectURL(blob);
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        self._compatWorkerUrl = workerUrl;
        // ★ 写入全局缓存（跨实例复用；不再随实例 destroy 而 revoke）
        _sharedWorkerBlob.srcUrl = absUrl;
        _sharedWorkerBlob.blobUrl = workerUrl;
        // 清掉已创建的 worker 缓存，下次用新 worker
        if (pdfjs.PDFWorker && pdfjs.PDFWorker._workerPorts) {
          pdfjs.PDFWorker._workerPorts.clear && pdfjs.PDFWorker._workerPorts.clear();
        }
      }).catch(function () {
        // fetch 失败（CORS/404）：回退 fake worker
        self._forceFakeWorker(pdfjs);
      });
    } catch (e) {
      this._forceFakeWorker(pdfjs);
      return Promise.resolve();
    }
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
          // 推断 worker：先去掉 query/hash 再替换（修复带 ?v= 时推断失败）
          var cleanUrl = String(url || '').split('?')[0].split('#')[0];
          var workerSrc = (url ? cleanUrl.replace(/pdf(\.min)?\.js$/, 'pdf.worker$1.js') : CDN_PDFJS_WORKER);
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
  PdfStampPicker.loadPdfJsAuto = function (scriptSrc) {
    if (typeof window === 'undefined') return Promise.reject(new Error('[PdfStampPicker] 仅支持浏览器环境'));
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    // scriptSrc 由调用方传入（实例构造时记录的库位置）；异步调用时 currentScript 已失效
    if (!scriptSrc) scriptSrc = (document.currentScript && document.currentScript.src) || null;
    var candidates = PdfStampPicker._localCandidates(window.location.href, scriptSrc);

    // 加载方式一：script 标签（跨域无需 CORS，但受浏览器 MIME 严格检查 / script-src CSP 限制）
    var loadViaScript = function (src) {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error('script fail: ' + src)); };
        document.head.appendChild(s);
      });
    };

    // 加载方式二：fetch 源码 → Blob 执行（绕开 MIME 严格检查；内网 cmaps 已证明 fetch 通路可用）
    var loadViaFetchBlob = function (src) {
      return fetch(src).then(function (res) {
        if (!res.ok) throw new Error('fetch fail: ' + src + ' status=' + res.status);
        return res.text();
      }).then(function (code) {
        return new Promise(function (resolve, reject) {
          var blob = new Blob([code], { type: 'application/javascript' });
          var url = URL.createObjectURL(blob);
          var s = document.createElement('script');
          s.src = url;
          s.onload = function () { URL.revokeObjectURL(url); resolve(); };
          s.onerror = function () { URL.revokeObjectURL(url); reject(new Error('blob script fail: ' + src)); };
          document.head.appendChild(s);
        });
      });
    };

    // 单个候选加载成功后的统一收尾（推断 worker 路径）
    var onLoaded = function (src) {
      if (!window.pdfjsLib) throw new Error('no pdfjsLib: ' + src);
      var cleanSrc = String(src).split('?')[0].split('#')[0];
      var workerSrc = cleanSrc.replace(/pdf(\.min)?\.js$/, 'pdf.worker$1.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = window.pdfjsLib.GlobalWorkerOptions.workerSrc || workerSrc;
      return window.pdfjsLib;
    };

    var idx = 0;
    var tryNext = function () {
      if (idx >= candidates.length) {
        return PdfStampPicker.loadPdfJs(); // CDN 兜底
      }
      var src = candidates[idx++];
      // script 标签失败（MIME/CSP）→ 同 URL fetch + Blob 兜底 → 再失败才换候选
      return loadViaScript(src)
        .then(function () { return onLoaded(src); })
        .catch(function () {
          return loadViaFetchBlob(src).then(function () { return onLoaded(src); });
        })
        .catch(tryNext);
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
    // ★ H1：画布模式换页同样开启"新文档会话" —— 自增令牌并使在途的 PDF 加载/渲染/哈希补算
    //   全部失效，避免它们在画布模式之后回写状态（跨模式残留）。
    this._loadToken++;
    if (this._abortCtrl) { try { this._abortCtrl.abort(); } catch (e) { /* ignore */ } }
    if (this._loadTimer) { clearTimeout(this._loadTimer); this._loadTimer = 0; }
    this._discardDoc(this._pdf);
    this._pdfMode = 'canvas';
    this._sourceKind = 'canvas';
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
    // ★ D9 根治：是否清空签章改为可配置（clearStampsOnSetPage）
    //   默认 true = 保持历史行为（不破坏既有宿主）；置 false 可让签章按页保留。
    //   v5.0 计划把默认值改为 false（画布模式语义上应"按页保留"）。
    if (this._options.clearStampsOnSetPage !== false) {
      this._stamps = [];
      this._activeId = null;
      this._sel = null;
      this._resetHistory();
    }
    // 纯画布模式无 PDF 字节 → 清哈希缓存（防 toJSON 输出旧 load 的哈希）
    this._pdfBytes = null;
    this._pdfBytesRef = null;
    this._pdfHash = null;
    this._pdfHashPromise = null;
    this._pdfHashPending = null;
    this._lastError = null;

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

  PdfStampPicker.prototype.gotoPage = function (n, loadToken) {
    var self = this;
    // 下界兜底用 Math.max(1, _totalPages)：_totalPages=0 表示"无文档"，
    // 若直接 clamp(n,1,0) 会得到 0（越界页码）。无文档时紧随其后的分支即返回，不影响行为。
    n = clamp(Math.round(n || 1), 1, Math.max(1, this._totalPages));
    if (this._pdfMode !== 'pdfjs' || !this._pdf) return Promise.resolve();
    if (n === this._pageNumber && this._page) return Promise.resolve();
    // ★ H1：双重令牌校验
    //   · 文档会话令牌(loadToken/_loadToken)：一旦发生新的 load()/abort()/destroy()，
    //     本次渲染链条立即作废 —— 防止旧文档的页面/尺寸/总页数覆盖到新文档上。
    //   · 页渲染令牌(_pageToken)：快速翻页时旧的页渲染作废，防止时序错乱。
    var docToken = (loadToken != null) ? loadToken : this._loadToken;
    var token = (this._pageToken = (this._pageToken || 0) + 1);
    function stale() {
      return self._destroyed || token !== self._pageToken || docToken !== self._loadToken;
    }
    this._pageNumber = n;
    this._setLoading(true, '第 ' + n + ' 页渲染中…');
    return this._pdf.getPage(n).then(function (page) {
      if (stale()) return;
      self._page = page;
      var view = page.view;
      self._pdfW = view[2] - view[0];
      self._pdfH = view[3] - view[1];
      self._offsetX = view[0];
      self._offsetY = view[1];
      self._rotation = normalizeRotation(page.rotate || 0);
      if (!self._options.keepSelectionOnPageChange) {
        self._sel = null;
        self._activeId = null;
      }
      self._layoutPage();
      return self._renderPage().then(function () {
        if (stale()) return;
        self._updateToolbar();
        self._paint();
        self._setLoading(false);
        self._emit('pagechange', self._pageInfo());
      });
    }).catch(function (err) {
      // ★ 用 self 而非 this：严格模式下普通函数回调 this 为 undefined，导致
      //   'Cannot read property _pageToken of undefined'，且覆盖真正的加载失败原因
      if (stale()) return;       // 已作废：静默退出，绝不改动 loading（可能属于新加载）
      self._setLoading(false);
      throw err;
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
    // 取消未完成的旧渲染任务（翻页/缩放时防资源浪费与旧画面残留）
    if (this._renderTask) {
      try { this._renderTask.cancel(); } catch (e) { /* ignore */ }
      this._renderTask = null;
    }
    // 保存旧画面到离屏 canvas（渲染失败时恢复，防页面空白）
    var oldCanvas = null;
    if (this._canvas.width > 0 && this._canvas.height > 0) {
      oldCanvas = document.createElement('canvas');
      oldCanvas.width = this._canvas.width;
      oldCanvas.height = this._canvas.height;
      try { oldCanvas.getContext('2d').drawImage(this._canvas, 0, 0); } catch (e) { oldCanvas = null; }
    }
    var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    var renderScale = this._cssScale * Math.max(1, dpr);
    var viewport = this._page.getViewport({ scale: renderScale });
    this._canvas.width = Math.round(viewport.width);
    this._canvas.height = Math.round(viewport.height);
    var task = this._page.render({ canvasContext: this._canvas.getContext('2d'), viewport: viewport });
    this._renderTask = task;
    return task.promise.then(function () {
      if (self._renderTask === task) self._renderTask = null;
    }).catch(function (err) {
      // 渲染被取消是预期行为（翻页/缩放/销毁），不视为错误
      if (self._renderTask === task) self._renderTask = null;
      if (err && err.name === 'RenderingCancelledException') return;
      // 渲染失败（非取消）：恢复旧画面防空白
      if (oldCanvas) {
        try {
          var ctx = self._canvas.getContext('2d');
          ctx.clearRect(0, 0, self._canvas.width, self._canvas.height);
          ctx.drawImage(oldCanvas, 0, 0);
        } catch (e) { /* ignore */ }
      }
      throw err;
    });
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
      var token = (this._userToken = (this._userToken || 0) + 1); // 与用户切换共用 token：防异步章图竞争
      this._ensureStampImage().then(function () {
        if (self._destroyed || token !== self._userToken) return;
        self._paint();
      });
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
    // token 防护：快速切换时旧用户的异步章图返回后不覆盖当前用户
    var token = (this._userToken = (this._userToken || 0) + 1);
    var self = this;
    this._ensureStampImage().then(function () {
      if (self._destroyed || token !== self._userToken) return;
      self._paint();
    });
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

  /** 折叠/展开签章列表面板 */
  PdfStampPicker.prototype.toggleList = function () {
    if (!this._listEl) return this;
    var collapsed = this._listEl.style.display === 'none';
    this._listEl.style.display = collapsed ? '' : 'none';
    var self = this;
    // rAF 去重：连续 toggle（如快速点击）只触发一次重排重渲染，避免多次 _renderPage 互相 cancel 导致空白
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    this._resizeRaf = requestAnimationFrame(function () {
      self._resizeRaf = 0;
      self._applyResize(); // 布局随面板显隐自适应（直接走执行层，避免双重 rAF）
    });
    return this;
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

  /** 签章可活动范围（带 stampMargin 间距，不出边界） */
  PdfStampPicker.prototype._stampBounds = function () {
    var m = this._options.stampMargin || 0;
    return {
      minX: m, minY: m,
      maxX: Math.max(m, this._displayW - m),
      maxY: Math.max(m, this._displayH - m)
    };
  };

  /** 计算中心对准 (x,y) 且 clamp 在【带间距边界】内的矩形 */
  PdfStampPicker.prototype._stampRectAt = function (x, y) {
    var size = this._stampDisplaySize();
    var b = this._stampBounds();
    return {
      x: clamp(x - size.w / 2, b.minX, Math.max(b.minX, b.maxX - size.w)),
      y: clamp(y - size.h / 2, b.minY, Math.max(b.minY, b.maxY - size.h)),
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

  /** 当前换算几何（内部使用；纯计算，见 makeGeom） */
  PdfStampPicker.prototype._geom = function () {
    return makeGeom(this._pdfW, this._pdfH, this._rotation,
                    this._displayW, this._displayH, this._offsetX, this._offsetY);
  };

  PdfStampPicker.prototype.screenToPdf = function (cx, cy) {
    return pdfCoordFromScreen(cx, cy, this._geom());
  };

  PdfStampPicker.prototype.pdfToScreen = function (px, py) {
    return screenCoordFromPdf(px, py, this._geom());
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
  /**
   * 导出 JSON（按用户分组）。
   * @param {Object} [opts] { includeImage: true } 包含签章图(dataURL)——数据自包含，后端可直接盖章渲染；默认不含（轻量）
   */
  PdfStampPicker.prototype.toJSON = function (opts) {
    opts = opts || {};
    return buildJSON(this._docMeta(opts.includeImage), this._stamps, this._users);
  };

  /** 扁平版 JSON（旧结构）：stamps 数组每项内嵌 user，按签章点遍历用 */
  PdfStampPicker.prototype.toFlatJSON = function (opts) {
    opts = opts || {};
    return buildFlatJSON(this._docMeta(opts.includeImage), this._stamps, this._users);
  };

  /** 获取某用户的全部签章点（PDF 坐标） */
  PdfStampPicker.prototype.getStampsByUser = function (userId) {
    return this.getStamps().filter(function (s) { return s.user && s.user.id === userId; });
  };

  /**
   * 从 JSON 恢复签章点（反显）：toJSON() / toFlatJSON() 输出均可导入。
   * - 恢复签署方列表（id/name/color）
   * - 恢复每个签章点坐标/尺寸/页码/备注
   * - 签章点带 image（{src,name,width,height}）→ 反显该章图；无 image → 内置公章按用户生成
   * - 恢复后自动跳转到第一个有签章点的页面
   * @param {Object} json toJSON()/toFlatJSON() 输出
   * @param {Object} [opts] { replace=true 替换现有签章 }
   */
  PdfStampPicker.prototype.importJSON = async function (json, opts) {
    opts = opts || {};
    var self = this;
    var parsed = parseImportJSON(json);   // 纯函数：结构解析（含类型检查，可单测）
    var stamps = parsed.stamps;
    var users = parsed.users;

    // 1) 同步签署方（更新已有 / 添加缺失）
    users.forEach(function (u) {
      if (!u || !u.id) return;
      var ex = self._userById(u.id);
      if (ex) {
        if (u.name) ex.name = u.name;
        if (u.color) ex.color = u.color;
      } else {
        self.addUser({ id: u.id, name: u.name, color: u.color });
      }
    });

    // 2) 记录历史起点，恢复后合并为一步撤销
    var baseIdx = this._historyIdx;
    if (opts.replace !== false) this._stamps = [];

    var firstPage = 0;
    var batchCount = 0;
    var skipped = parsed.ignored || 0;        // H4：坏条目计数（不再静默丢弃）
    var failure = null;
    var savedUserId = this._currentUserId;    // 记录导入前用户，结束后还原
    // ★ D8 根治：用 try/finally 保证临时切换的 _currentUserId 一定还原 ——
    //   旧实现若循环中途抛错（如章图加载失败），还原语句被跳过，外部签署方状态被污染。
    try {
    for (var i = 0; i < stamps.length; i++) {
      var st = stamps[i];
      if (!st || typeof st.x !== 'number' || typeof st.y !== 'number' ||
          !isFinite(st.x) || !isFinite(st.y)) { skipped++; continue; }
      var targetUserId = st.userId || self._currentUserId;
      // ★ 无 image 的签章点：按签章点所属用户生成章图（避免全部用当前用户章图导致公章文字错误）
      if (!st.image && targetUserId) {
        if (self._currentUserId !== targetUserId) self._currentUserId = targetUserId;  // 临时切换（仅内部）
        await self._ensureStampImage();
      }
      self.addStamp({
        x: st.x, y: st.y,
        width: st.width, height: st.height,
        page: st.page || self._pageNumber,
        userId: targetUserId,
        note: st.note || '',
        image: st.image || null,
        _batch: true   // 批量模式：跳过中间渲染/历史/事件
      });
      batchCount++;
      if (st.page && (!firstPage || st.page < firstPage)) firstPage = st.page;
    }
    } catch (e) {
      failure = e;                          // 记录失败，但仍落地已完成部分
    } finally {
      this._currentUserId = savedUserId;    // ★ 无论如何都还原（不改变外部状态）
    }

    // 批量收尾：一次历史 + 一次渲染 + 批量事件（性能优化）
    if (batchCount) {
      this._pushHistory();
      this._renderList();
      this._emit('stampadd', { batch: batchCount });
    }

    // 合并历史：整体导入作为一步撤销
    if (this._historyIdx > baseIdx) {
      this._history = this._history.slice(0, baseIdx + 1);
      this._history.push(snapshotStamps(this._stamps));
      this._historyIdx = this._history.length - 1;
    }

    // 3) 跳转到第一个有签章点的页面；恢复最后一个签章点为选中（否则活动章无选区不绘制）
    this._renderList();
    var lastStamp = this._stamps.length ? this._stamps[this._stamps.length - 1] : null;
    if (lastStamp) {
      this._activeId = lastStamp.id;
      this._syncSelFromStamp(lastStamp);
    }
    var go = function () {
      self._paint();
      self._emit('import', { count: self._stamps.length, users: self._users.length, skipped: skipped });
      self._emit('change', self.getSelection());
    };
    if (firstPage && firstPage !== this._pageNumber && this._pdfMode === 'pdfjs' && this._pdf) {
      await this.gotoPage(firstPage);
    }
    go();
    if (failure) throw self._fail(failure, 'import'); // 部分失败：已完成部分保留，同时上报
    return;
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

  /** 轻提示（内置，单例复用防 DOM 堆积） */
  /** 旧浏览器升级提示（内联样式，零依赖） */
  PdfStampPicker.prototype._showCompatWarning = function (missing) {
    if (typeof document === 'undefined') return;
    if (document.querySelector('.psp-compat-warn')) return;
    var el = document.createElement('div');
    el.className = 'psp-compat-warn';
    el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;color:#202124;border-radius:14px;padding:28px 32px;max-width:440px;box-shadow:0 12px 48px rgba(0,0,0,.35);z-index:100001;text-align:center;font-family:system-ui,sans-serif';
    var missingHtml = (missing && missing.length)
      ? '<div style="font-size:11.5px;color:#9aa0a6;margin-bottom:12px">缺少能力：' + missing.join('、') + '</div>'
      : '';
    el.innerHTML =
      '<div style="font-size:38px;margin-bottom:12px">⚠️</div>' +
      '<div style="font-size:16px;font-weight:600;margin-bottom:8px">浏览器版本过旧，无法加载 PDF</div>' +
      '<div style="font-size:12.5px;color:#5f6368;line-height:1.7;margin-bottom:16px">当前浏览器不支持 PDF 签章所需的现代特性。<br>请升级到：<br><b>Chrome / Edge 98+</b> 或 <b>Firefox 94+</b> 或 <b>Safari 15.4+</b></div>' + missingHtml +
      '<a href="https://www.google.com/chrome/" target="_blank" rel="noopener" style="display:inline-block;background:#1a73e8;color:#fff;border-radius:8px;padding:9px 24px;font-size:13px;font-weight:600;text-decoration:none">前往升级浏览器</a>';
    document.body.appendChild(el);
  };

  /**
   * 轻提示（屏幕顶部 toast）。
   * @param {string} msg 文案
   * @param {number} [ms] 展示时长
   * @param {string} [dedupeKey] 去重键：与上一条【相同键且仍在展示窗口内】时直接忽略。
   *        用途：按住方向键微调时 _checkOverlap 每帧都会判定重叠 → 同一句警告每秒弹 30 次，
   *        既闪烁又打断操作。key 相同即视为"同一件事的重复播报"，不刷新计时器、不重启动画。
   *        传 null/省略 = 不去重（保持旧行为）。
   */
  PdfStampPicker.prototype._toast = function (msg, ms, dedupeKey) {
    if (typeof document === 'undefined') return;
    var self = this;
    var el = document.body.querySelector('.psp-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'psp-toast';
      document.body.appendChild(el);
    }
    // 最小展示时长：新消息不早于 600ms 消失（防快速连续 toast 闪烁）
    var now = Date.now();
    var shownAt = el._shownAt || 0;
    var remain = ms || 1600;
    // 去重：同键且在展示窗口内 → 忽略（不重置计时器，避免"永远不消失"）
    if (dedupeKey && el._dedupeKey === dedupeKey && shownAt && now - shownAt < (el._dedupeUntil || 0)) {
      return;
    }
    if (dedupeKey) el._dedupeKey = dedupeKey;
    if (shownAt && now - shownAt < 600) {
      remain = Math.max(remain, 600 - (now - shownAt) + (ms || 1600));
    }
    el._dedupeUntil = remain;
    el._shownAt = now;
    el.textContent = msg;
    el.classList.remove('psp-toast-hide');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () {
      el.classList.add('psp-toast-hide');
    }, remain);
  };

  /**
   * 缺省尺寸（width/height 未给时用）。
   *
   * ★ 为什么必须有这个函数（"0×0 空章"根治点）：
   *   历史实现缺省一律落 0×0。但 0×0 只在 `mode:'point'` 下是**正确形态**（签章点 = 坐标锚点）；
   *   在 `rect` / `stamp` 模式下它是个"退化矩形"：Canvas 对零尺寸 drawImage 是 no-op
   *   （章图一个字都没画）、九宫格手柄全部叠在同一个像素上、尺寸标签因 width<=0 被跳过、
   *   命中测试也退化成 12px 半径的点选 —— 用户看到"点旁边孤零零一个序号角标"，
   *   既不像章也拖不出框，**却照样进 JSON / 进列表 / 进撤销栈，且全程无异常**。
   *   这正是最难排查的一类缺陷：内部自洽（往返 JSON 合法、往返坐标正确），
   *   只是"没有可用的产物"。所以缺省值必须与"在画布上点一下"的产物一致，而不是 0。
   *
   * 选择依据（为什么不是抛错）：两种默认都可能误判调用者意图，
   *   于是取**失败可见**的那个 —— 补成章尺寸 → 用户立刻看到一个章，位置不对能马上发现；
   *   落 0×0 → 用户什么都看不到，且没有任何信号。
   */
  PdfStampPicker.prototype._defaultStampSize = function () {
    if (this._options.mode === 'point') return { w: 0, h: 0 };   // 锚点形态：0×0 即正确
    return this._stampDisplaySize();                             // 与点击放置完全一致
  };

  /**
   * 程序化添加签章点（PDF 坐标）。
   *
   * 尺寸语义：`width`/`height` 只接受**有限且 ≥0 的数字**；
   *   · 显式 `0` 合法 → 坐标锚点形态（点选模式的数据原样保留）；
   *   · 缺省 / `undefined` / `null` / `NaN` / 负数 / 非数字 → 回落到 `_defaultStampSize()`
   *     （point 模式 0×0；其余模式 = 当前章图按 `stampSize` 的显示尺寸，
   *      与"在画布上点一下"得到的结果完全一致）。
   *   `x`,`y` 始终是矩形**左上角**（与 `getSelection()` / JSON 输出一致），不随缺省尺寸而改变含义。
   *
   * @param {{x:number,y:number,width?:number,height?:number,page?:number,userId?:string,note?:string,image?:object}} sel
   * @returns {object} 新签章点
   */
  PdfStampPicker.prototype.addStamp = function (sel) {
    if (!sel || typeof sel.x !== 'number' || typeof sel.y !== 'number') {
      throw new Error('[PdfStampPicker] addStamp 需要 {x, y[, width, height]}');
    }
    var def = this._defaultStampSize();
    var w = (typeof sel.width === 'number' && isFinite(sel.width) && sel.width >= 0) ? sel.width : def.w;
    var h = (typeof sel.height === 'number' && isFinite(sel.height) && sel.height >= 0) ? sel.height : def.h;
    var page = sel.page || this._pageNumber;
    // 快照公章图（内部绘制用；JSON 输出不含 image）：
    // 优先外部传入（importJSON 反显），否则快照当前用户章
    var img = sel.image || null;
    if (!img && this._stampImg && this._stampImg.el) {
      img = { src: this._stampImg.src, name: this._stampImg.name, width: this._stampImg.w, height: this._stampImg.h };
    }
    var stamp = {
      id: genId(),
      userId: sel.userId || this._currentUserId,
      page: page,
      rotation: this._rotation,
      x: sel.x, y: sel.y,
      width: w,
      height: h,
      image: img,
      note: sel.note || '',
      createdAt: new Date().toISOString()
    };
    this._stamps.push(stamp);
    this._activeId = stamp.id;
    /* ★ 与 _activeId 同步选区（根治"加了签章却在画布上看不见"）：
     *   _paint 的渲染约定是【活动签章由 _drawRectSel 画、_drawStamps 跳过它】。
     *   旧实现只设 _activeId 不设 _sel → 两条路径都不画：_drawStamps 认为"它是活动的，不归我画"，
     *   而 _drawRectSel 又因 this._sel 为空而根本不执行 → **画布上一个像素都不出**，
     *   同时 getSelection() 返回 null（"没有选区"），于是既看不见、也拿不到数据、还没有任何报错。
     *   这是与"0×0 空章"并列的第二个根因：前者是尺子不对，后者是压根没人画。
     *   跨页签章点不在此处同步（否则会把别页坐标画到当前页的选区内，_commitActive 回写即坐标污染），
     *   交给 selectStamp() 的"先 gotoPage 再同步"路径处理。 */
    var onCurPage = stamp.page === this._pageNumber && this._displayW > 0;
    if (!sel._batch) {
      if (onCurPage) this._syncSelFromStamp(stamp);
      else this._sel = null;
    }
    // 批量模式（importJSON）：跳过中间渲染/历史/事件，由批量收尾统一处理（性能优化）
    if (!sel._batch) {
      this._paint();                 // 立即重绘：新签章点必须立刻可见
      this._pushHistory();
      this._renderList();
      this._emit('stampadd', stamp);
      this._checkOverlap(stamp);
      this._emit('change', this.getSelection());
    }
    return stamp;
  };

  /** 重叠检测：新签章点与同页其他签章点矩形相交 → 警告（不阻止） */
  PdfStampPicker.prototype._checkOverlap = function (stamp) {
    var self = this;
    if (!stamp || !(stamp.width > 0) || !(stamp.height > 0)) return;
    var overlaps = [];
    this._stamps.forEach(function (other) {
      if (other.id === stamp.id || other.page !== stamp.page) return;
      if (!(other.width > 0) || !(other.height > 0)) return;
      var ox = Math.max(0, Math.min(stamp.x + stamp.width, other.x + other.width) - Math.max(stamp.x, other.x));
      var oy = Math.max(0, Math.min(stamp.y + stamp.height, other.y + other.height) - Math.max(stamp.y, other.y));
      if (ox > 0 && oy > 0) {
        var u = self._userById(other.userId);
        overlaps.push({ id: other.id, userId: other.userId, name: u ? u.name : '未知' });
      }
    });
    if (overlaps.length) {
      var names = overlaps.map(function (o) { return o.name; }).join('、');
      // dedupeKey：同一章与同一批对象的重叠在展示窗口内只播报一次（微调时会每帧命中）
      var key = 'overlap:' + stamp.id + ':' + overlaps.map(function (o) { return o.id; }).sort().join(',');
      this._toast('⚠️ 与「' + names + '」的签章点重叠', 1600, key);
      this._emit('overlap', { stamp: stamp, overlaps: overlaps });
    }
  };

  /** 删除指定签章点 */
  PdfStampPicker.prototype.removeStamp = function (id) {
    for (var i = 0; i < this._stamps.length; i++) {
      if (this._stamps[i].id === id) {
        var removed = this._stamps.splice(i, 1)[0];
        if (this._activeId === id) { this._activeId = null; this._sel = null; }
        this._pushHistory();
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
    if (!this._stamps.length) return this;
    this._stamps = [];
    this._activeId = null;
    this._sel = null;
    this._pushHistory();
    this._renderList();
    this._paint();
    this._emit('clear', {});
    return this;
  };

  PdfStampPicker.prototype.clearAll = function () { return this.clear(); };

  /* ---------------- 撤销/重做 ---------------- */

  /** 记录当前签章状态到历史栈（**变更后**调用，push 新状态） */
  /* ================= 历史：交互级合并（根治"高频变更淹没历史栈"） =================
   * 问题类别（不只是键盘）：历史栈是"每次变更入一条快照"的模型，但它不认识「一次用户交互」。
   * 于是任何高频变更源都会把栈冲爆：
   *   · 按住方向键微调：浏览器按键重复 ≈ 每秒 30 次 → historyLimit=50 时按住不到 2 秒，
   *     整个撤销栈就被一次微调挤干净，用户再也撤不回之前任何操作；
   *   · 拖拽/缩放若将来改为实时提交，同样会一条一帧；
   *   · 程序化批量变更（导入、批量删除）同理。
   * 只给键盘加防抖是"打补丁"：治不了拖拽/批量，也治不了将来新增的高频源。
   *
   * 根治：给历史层引入【交互分组】协议 —— 变更方显式声明"我属于哪一次交互"，
   * 历史层负责把同一次交互内的所有变更【压成一条】：
   *     beginHistoryGroup(key)  →  该 key 生效期间，_pushHistory(mergeKey) 覆盖栈顶而非新增
   *     endHistoryGroup()       →  结束交互，下一次变更是新的历史条目
   * 由交互的**结束事件**（keyup / pointerup / blur / destroy）驱动，不用计时器 ——
   * 行为完全确定、可重复测试，也不受机器快慢影响。
   */
  PdfStampPicker.prototype.beginHistoryGroup = function (key) {
    if (key == null) return this;
    this._histGroupKey = String(key);
    return this;
  };

  /**
   * 结束当前历史分组（幂等，可重复调用）。
   * ★ 必须【同时】清掉栈顶合并键：只清分组键的话，下一次交互若用了同一个 key
   *   （例如同一个签章再按一次方向键），仍会和上一次交互的栈顶合并 → 少一步撤销。
   *   这一步是"一次交互 = 一步历史"的关键，单测 test/history.test.js 第 3 节专门盯它。
   */
  PdfStampPicker.prototype.endHistoryGroup = function () {
    this._histGroupKey = null;
    this._histMergedKey = null;
    return this;
  };

  /**
   * 清空撤销栈（换文档 / 换页 / 重建时调用）。
   * ★ 集中成一个入口：历史上这段"清栈"代码在 3 处各抄了一份，加了分组键之后
   *   任何一处漏改都会留下"分组键指向已废弃历史"的悬空状态 —— 统一入口是根治。
   */
  PdfStampPicker.prototype._resetHistory = function () {
    this._history = [[]];
    this._historyIdx = 0;
    this._histGroupKey = null;
    this._histMergedKey = null;
    return this;
  };

  /**
   * 记录一步历史。
   * @param {string} [mergeKey] 合并键：与上一次入栈的键相同、且仍连续处于栈顶时，
   *        本次【覆盖栈顶快照】而不是新增一条（即"同一次交互只留最终结果"）。
   *        省略时取当前分组键（beginHistoryGroup 设置的）。
   */
  PdfStampPicker.prototype._pushHistory = function (mergeKey) {
    // ★ 用 snapshotStamps 而非 JSON.stringify：后者会把每个签章点的 base64 章图
    //   完整复制进每一条历史（上限 50 条），带图签章多时内存成倍放大。
    //   快照只浅拷贝标量，image 对象按引用共享（库内 image 只读，安全）。
    var snapshot = snapshotStamps(this._stamps);
    var key = mergeKey || this._histGroupKey || null;
    // 若当前不在栈顶（已 undo 过），丢弃 redo 分支
    if (this._historyIdx < this._history.length - 1) {
      this._history = this._history.slice(0, this._historyIdx + 1);
      this._histMergedKey = null;   // 历史分支被截断 → 之前的合并上下文失效
    }
    // 同一次交互的后续变更：覆盖栈顶（把整段连续操作压成一步）。
    // length > 1 保证永远不会覆盖索引 0 的初始状态。
    if (key && key === this._histMergedKey && this._history.length > 1) {
      this._history[this._history.length - 1] = snapshot;
      this._historyIdx = this._history.length - 1;
      return;
    }
    this._history.push(snapshot);
    this._histMergedKey = key;
    var limit = clamp(this._options.historyLimit || 50, 1, 500);
    if (this._history.length > limit + 1) this._history.shift(); // 上限 N 步 + 初始
    this._historyIdx = this._history.length - 1;
  };

  /** 撤销：回到上一步签章状态 */
  PdfStampPicker.prototype.undo = function () {
    if (this._historyIdx <= 0) return this;
    this._historyIdx--;
    // 撤销后合并上下文失效：否则下一次变更会把"刚撤回来的那一步"原地覆盖掉
    this._histMergedKey = null;
    this._restoreFromHistory();
    return this;
  };

  /** 重做：前进到下一步签章状态 */
  PdfStampPicker.prototype.redo = function () {
    if (this._historyIdx >= this._history.length - 1) return this;
    this._historyIdx++;
    this._histMergedKey = null;
    this._restoreFromHistory();
    return this;
  };

  PdfStampPicker.prototype._restoreFromHistory = function () {
    try {
      // ★ 从快照再复制一层：历史里的对象必须保持只读，不能被 _stamps 后续修改污染
      var snap = this._history[this._historyIdx];
      this._stamps = snap ? snapshotStamps(snap) : [];
    } catch (e) { return; }
    // 恢复后：活动签章若不存在则清空；存在则同步屏幕选区（防止活动章绘制位置错乱）
    if (this._activeId && !this._stamps.some(function (st) { return st.id === this._activeId; }, this)) {
      this._activeId = null;
      this._sel = null;
    } else if (this._activeId) {
      var active = null;
      for (var i = 0; i < this._stamps.length; i++) {
        if (this._stamps[i].id === this._activeId) { active = this._stamps[i]; break; }
      }
      if (active) this._syncSelFromStamp(active);
    }
    this._renderList();
    this._paint();
    this._emit('change', this.getSelection());
    this._emit('stampchange', null);
  };

  /** 轻量同步列表选中态（不重建 DOM，避免破坏双击编辑备注） */
  PdfStampPicker.prototype._syncListActive = function () {
    if (!this._listBody) return;
    var items = this._listBody.querySelectorAll('.psp-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].dataset.id === this._activeId);
    }
  };

  /** 选中列表中的签章点并跳转页面 */
  PdfStampPicker.prototype.selectStamp = function (id, light) {
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
      if (light) {
        self._syncListActive();   // 轻量：不重建列表 DOM
      } else {
        self._renderList();
      }
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
    // 坐标有变化才记历史（避免重复 move 时堆快照）
    var changed = Math.abs(stamp.x - sel.x) > 1e-9 || Math.abs(stamp.y - sel.y) > 1e-9 ||
        Math.abs((stamp.width || 0) - (sel.width || 0)) > 1e-9 ||
        Math.abs((stamp.height || 0) - (sel.height || 0)) > 1e-9;
    stamp.x = sel.x; stamp.y = sel.y;
    stamp.width = sel.width || 0;
    stamp.height = sel.height || 0;
    stamp.rotation = sel.rotation;
    if (changed) this._pushHistory();
    this._renderList();
    this._checkOverlap(stamp);
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
    // ★ 放置后立即重绘：显示活动选区/锚点（否则用户看不到刚才点击/框选的位置）
    this._paint();
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
        var noteTxt = st.note ? '<div class="psp-item-sub psp-note">📝 ' + escapeHtml(st.note) + '</div>' : '';
        main.innerHTML = '<div><span class="psp-page-badge">P' + st.page + '</span> ' + sizeTxt + '</div>' +
                         '<div class="psp-item-sub">(' + fmt(st.x) + ', ' + fmt(st.y) + ')</div>' + noteTxt;
        var del = document.createElement('button');
        del.className = 'psp-del';
        del.title = '删除';
        del.textContent = '×';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          self.removeStamp(st.id);
        });
        item.addEventListener('click', function () { self.selectStamp(st.id, true); });
        // 双击：内联编辑备注
        item.addEventListener('dblclick', function () {
          self._editStampNote(st, main);
        });
        item.appendChild(idot);
        item.appendChild(main);
        item.appendChild(del);
        self._listBody.appendChild(item);
      });
    });
  };

  /** 双击列表项：内联编辑签章点备注 */
  PdfStampPicker.prototype._editStampNote = function (st, mainEl) {
    var self = this;
    var input = document.createElement('input');
    input.type = 'text';
    input.value = st.note || '';
    input.placeholder = '备注（如：公章/骑缝章）…';
    input.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid #4285f4;border-radius:5px;padding:3px 6px;font-size:11px;outline:none;background:#fff;color:#202124';
    mainEl.innerHTML = '';
    mainEl.appendChild(input);
    input.focus();
    input.select();
    var done = function (save) {
      if (input._closed) return;   // 防 Esc 取消后 blur 再保存
      input._closed = true;
      if (save) {
        st.note = input.value.trim();
        self._renderList();
        self._emit('stampchange', self.getStamps().filter(function (s) { return s.id === st.id; })[0] || null);
      } else {
        self._renderList();
      }
    };
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.stopPropagation(); done(true); }
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
    });
    input.addEventListener('blur', function () { done(true); });
    input.addEventListener('click', function (e) { e.stopPropagation(); });
  };

  /* ---------------- 交互 ---------------- */

  PdfStampPicker.prototype._bindEvents = function () {
    var self = this;
    this._handlers = {
      down: function (e) { self._onPointerDown(e); },
      move: function (e) { self._onPointerMove(e); },
      up: function (e) { self._onPointerUp(e); },
      key: function (e) { self._onKeyDown(e); },
      keyup: function (e) { self._onKeyUp(e); },
      blur: function () { self.endHistoryGroup(); },
      wheel: function (e) { self._onWheel(e); },
      resize: function () { self._onResize(); }
    };
    this._overlay.addEventListener('pointerdown', this._handlers.down);
    this._overlay.addEventListener('pointermove', this._handlers.move);
    this._overlay.addEventListener('pointerup', this._handlers.up);
    this._overlay.addEventListener('pointercancel', this._handlers.up);
    this._overlay.addEventListener('wheel', this._handlers.wheel, { passive: true });
    this._root.addEventListener('keydown', this._handlers.key);
    this._root.addEventListener('keyup', this._handlers.keyup);
    /* 失焦兜底：按住方向键时切走窗口可能收不到 keyup，
     * 若不收尾，下一次按键会错误地并入上一次的分组（少一步撤销）。 */
    this._root.addEventListener('blur', this._handlers.blur, true);
    this._pinch = null; // 双指缩放状态 {dist, zoom}
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(function () { self._onResize(); });
      this._ro.observe(this._container);
    } else {
      window.addEventListener('resize', this._handlers.resize);
    }
  };

  PdfStampPicker.prototype._onResize = function () {
    var self = this;
    // rAF 防抖：ResizeObserver/window.resize 高频触发时合并到一帧（避免连续重渲染）
    if (this._resizeRaf) return;
    this._resizeRaf = requestAnimationFrame(function () {
      self._resizeRaf = 0;
      self._applyResize();
    });
  };

  PdfStampPicker.prototype._applyResize = function () {
    if (this._destroyed) return;
    var z = this._options.zoom;
    if (z === 'fit-width' || z === 'fit-page') {
      this._layoutPage();
      var self = this;
      if (this._pdfMode === 'pdfjs') {
        this._renderPage().then(function () { self._paint(); });
      } else this._paint();
    } else if (z !== null && typeof z === 'number' && this._displayW) {
      // 数字 zoom：页面尺寸不变，但容器 resize 后页面位置可能变化 → 重绘 overlay 保证选中框/章图贴合
      this._paint();
    }
  };

  /** 滚轮：stamp 模式下不劫持（公章固定大小，不可缩放），页面正常滚动 */
  PdfStampPicker.prototype._onWheel = function (e) {
    return; // 公章固定大小：滚轮（含 Ctrl+滚轮）均不缩放，页面滚动照常
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
    // 未加载页面时忽略点击（_displayW=0 会产生无效坐标）
    if (!this._displayW || !this._displayH) return;
    /* 一次按下→抬起视为【一次交互】：期间任何变更都并入同一条历史。
     * 目前拖拽只在抬起时提交一次，这里先建好分组是为了让"将来改成实时提交"
     * 或"按下即产生的变更"自动获得正确的历史粒度（协议先于需求存在）。 */
    this.beginHistoryGroup('gesture:' + (e.pointerId != null ? e.pointerId : 'default'));
    // 双指缩放：第二个指针按下时记录起始距离
    if (!this._ptrs) this._ptrs = {};
    this._ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(this._ptrs);
    if (ids.length === 2) {
      var p1 = this._ptrs[ids[0]], p2 = this._ptrs[ids[1]];
      var dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      this._pinch = {
        dist: dist,
        zoom: this._cssScale
      };
      // 双指缩放开始：取消单指残留拖拽（避免松手时意外提交/移动）
      this._drag = null;
      return; // 双指模式不再走单指逻辑
    }
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
        this._syncListActive();   // 轻量：不重建列表 DOM
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
        this._syncListActive();   // 轻量：不重建列表 DOM
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
        this._syncListActive();   // 轻量：不重建列表 DOM
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
    // 双指缩放
    if (this._ptrs) {
      this._ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (this._pinch) {
        var ids = Object.keys(this._ptrs);
        if (ids.length >= 2) {
          var p1 = this._ptrs[ids[0]], p2 = this._ptrs[ids[1]];
          var dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          if (dist > 0 && this._pinch.dist > 0) {
            var ratio = dist / this._pinch.dist;
            // 公章固定大小：双指统一缩放页面（章在 PDF 坐标上大小不变）
            // rAF 节流：pointermove 高频触发，合并到一帧只重排一次（防触屏卡顿）
            var self2 = this;
            if (!this._pinchRaf) {
              this._pinchRaf = requestAnimationFrame(function () {
                self2._pinchRaf = 0;
                self2.setZoom(self2._pinch.zoom * self2._pinch.ratio);
              });
            }
            this._pinch.ratio = ratio;
          }
        }
        return;
      }
    }
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
      if (this._options.mode === 'stamp') {
        // 签章拖动：带间距边界（stampMargin）
        var b = this._stampBounds();
        this._sel = {
          x: clamp(d.sel.x + dx, b.minX, Math.max(b.minX, b.maxX - d.sel.w)),
          y: clamp(d.sel.y + dy, b.minY, Math.max(b.minY, b.maxY - d.sel.h)),
          w: d.sel.w, h: d.sel.h
        };
      } else {
        this._sel = {
          x: clamp(d.sel.x + dx, 0, this._displayW - d.sel.w),
          y: clamp(d.sel.y + dy, 0, this._displayH - d.sel.h),
          w: d.sel.w, h: d.sel.h
        };
      }
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
    // 双指抬起：清理
    if (this._ptrs) {
      delete this._ptrs[e.pointerId];
      if (Object.keys(this._ptrs).length < 2) this._pinch = null;
    }
    // 手势结束 → 关闭历史分组（多指场景下等最后一指抬起）
    if (!this._ptrs || Object.keys(this._ptrs).length === 0) this.endHistoryGroup();
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
    // 撤销/重做快捷键
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) this.redo(); else this.undo();
        return;
      }
      if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault();
        this.redo();
        return;
      }
    }
    if (!this._sel && !this._activeId) return;
    var step = e.shiftKey ? 10 : 1;
    var handled = true;
    // ★ 方向键微调属于【同一次按住交互】：浏览器按键重复每秒约 30 次，
    //   不加分组会把整个撤销栈冲干净（详见 _pushHistory 上方说明）。
    //   分组由 keyup / blur 关闭 —— 一次按住 = 一步撤销，两次轻点 = 两步。
    var isNudge = (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown');
    if (isNudge) this.beginHistoryGroup('nudge:' + (this._activeId || 'sel') + ':' + step);
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

  /* 按键抬起 → 结束本次"按住微调"交互分组（下一次按键会是新的历史条目）。
   * 用真实结束事件而非计时器：行为确定，不受机器快慢与按键重复速率影响。 */
  PdfStampPicker.prototype._onKeyUp = function (e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      this.endHistoryGroup();
    }
  };

  PdfStampPicker.prototype._moveSel = function (dx, dy) {
    var s = this._sel;
    if (!s) return;
    if (this._options.mode === 'stamp') {
      // 签章键盘移动：带间距边界（stampMargin）
      var b = this._stampBounds();
      s.x = clamp(s.x + dx, b.minX, Math.max(b.minX, b.maxX - s.w));
      s.y = clamp(s.y + dy, b.minY, Math.max(b.minY, b.maxY - s.h));
    } else {
      s.x = clamp(s.x + dx, 0, Math.max(0, this._displayW - s.w));
      s.y = clamp(s.y + dy, 0, Math.max(0, this._displayH - s.h));
    }
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

  /** 签章图片缓存（按 src），上限 60 张防内存膨胀，超出清理最旧 */
  PdfStampPicker.prototype._imgFor = function (src) {
    if (!this._imgCache) this._imgCache = {};
    if (this._imgCache[src]) return this._imgCache[src];
    var keys = Object.keys(this._imgCache);
    if (keys.length >= 60) {
      // 清理最旧的一半（dataURL 章图通常小，60 张足够）
      for (var i = 0; i < Math.floor(keys.length / 2); i++) {
        delete this._imgCache[keys[i]];
      }
    }
    var img = new Image();
    var self = this;
    img.onload = function () { if (!self._destroyed) self._schedulePaint(); };
    img.src = src;
    this._imgCache[src] = img;
    return img;
  };

  /** 绘制全部签章点（非活动：显示该签章点自己的公章图/占位 + 序号角标） */
  PdfStampPicker.prototype._drawStamps = function (ctx) {
    for (var i = 0; i < this._stamps.length; i++) {
      var st = this._stamps[i];
      if (st.page !== this._pageNumber) continue;
      // stamp 模式的活动签章由 _drawRectSel 绘制（带选中框/手柄）
      if (st.id === this._activeId && this._options.mode === 'stamp') continue;
      var isActive = st.id === this._activeId;
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
          if (isActive) {
            // 活动态（非 stamp 模式）：外发光选中框
            ctx.strokeStyle = hexToRgba(color, 0.35);
            ctx.lineWidth = 5;
            ctx.strokeRect(l - 1, t - 1, w + 2, h + 2);
            ctx.lineWidth = 2;
            ctx.strokeStyle = color;
            ctx.strokeRect(l, t, w, h);
          }
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

    // stamp 模式/有章图的签章点：画签章点自己的公章图（不随当前用户变化）
    var activeSt = isActive ? this.getActiveStamp() : null;
    var activeImg = null;
    if (isActive && activeSt && activeSt.image) {
      activeImg = this._imgFor(activeSt.image.src);
      if (activeImg && !(activeImg.complete && activeImg.naturalWidth)) activeImg = null;
    }
    if (isActive && activeSt && this._options.mode === 'stamp' && activeImg) {
      // 拖动中半透明（跟手感），放置后立即完整显示；章固定大小，无缩放手柄
      var isDragging = !!(this._drag && (this._drag.type === 'move'));
      ctx.save();
      ctx.globalAlpha = isDragging ? 0.6 : 1;
      ctx.drawImage(activeImg, x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      // 选中外发光（替代手柄，提示可拖动不可缩放）
      ctx.strokeStyle = hexToRgba(color, 0.3);
      ctx.lineWidth = 5;
      ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
      var seqIdx = this._stamps.indexOf(activeSt);
      if (seqIdx >= 0) drawSeqBadge(ctx, seqIdx + 1, x, y, color);
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

  /** 显示/隐藏加载遮罩 */
  PdfStampPicker.prototype._setLoading = function (show, txt) {
    if (!this._loadingEl) return;
    this._loadingEl.style.display = show ? 'flex' : 'none';
    if (txt) {
      var t = this._loadingEl.querySelector('.psp-loading-txt');
      if (t) t.textContent = txt;
    }
  };

  PdfStampPicker.prototype._loadUrl = function (url) {
    var self = this;
    url = (url || '').trim();
    if (!url) return;
    this._urlbar.classList.remove('open');
    this._setLoading(true, 'PDF 加载中…');
    this.load(url).then(function () {
      self._toast('✅ PDF 加载成功');
    }).catch(function (err) {
      self._setLoading(false);
      self._toast('❌ 加载失败：' + (err.message || err));
      self._emit('error', { message: err.message });
      if (typeof console !== 'undefined') console.error(err);
    });
  };

  /**
   * 导出当前页 + 签章点布局图为 PNG（审批留档/预览）。
   * @param {Object} [opts]
   * @param {number} [opts.scale=2] 输出倍率（1=页面显示尺寸，2=2倍高清）
   * @param {boolean} [opts.includePdf=true] 是否包含 PDF 内容（false=仅签章点透明图）
   * @param {boolean} [opts.includeUi=false] 是否包含选区框/手柄/序号等 UI 标记
   * @returns {Promise<string>} dataURL（PNG）
   */
  PdfStampPicker.prototype.exportImage = function (opts) {
    opts = opts || {};
    var self = this;
    if (!this._displayW || !this._displayH) {
      return Promise.reject(new Error('[PdfStampPicker] 无页面可导出'));
    }
    var scale = opts.scale || 2;
    var canvas = document.createElement('canvas');
    canvas.width = Math.round(this._displayW * scale);
    canvas.height = Math.round(this._displayH * scale);
    var ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    var draw = function () {
      // 1) PDF 内容（底层 canvas）
      if (opts.includePdf !== false && this._canvas.width) {
        ctx.drawImage(this._canvas, 0, 0, this._displayW, this._displayH);
      }
      // 2) 签章点（画到导出 canvas 上）
      if (opts.includeUi) {
        // 复用 overlay 全部（含选区框/手柄/序号/网格）
        ctx.drawImage(this._overlay, 0, 0, this._displayW, this._displayH);
      } else {
        // 仅签章图/占位，不带 UI 标记：临时清空选区避免 UI 混入
        var savedSel = this._sel, savedActive = this._activeId, savedDrag = this._drag;
        this._sel = null; this._activeId = null; this._drag = null;
        this._drawStamps(ctx);   // 直接画章图（无 UI 标记）
        this._sel = savedSel; this._activeId = savedActive; this._drag = savedDrag;
      }
    }.bind(this);

    // 章图异步加载完成后再导出（否则图缺失）
    var imgs = [];
    this._stamps.forEach(function (st) {
      if (st.image && st.image.src) {
        var im = self._imgFor(st.image.src);
        if (im && !(im.complete && im.naturalWidth)) imgs.push(im);
      }
    });
    if (!imgs.length) {
      draw();
      return Promise.resolve(canvas.toDataURL('image/png'));
    }
    return Promise.all(imgs.map(function (im) {
      return new Promise(function (res) {
        if (im.complete && im.naturalWidth) return res();
        // 追加回调而非覆盖：保留 _imgFor 设置的 _schedulePaint 重绘回调
        var origOnload = im.onload;
        im.onload = function () {
          if (typeof origOnload === 'function') { try { origOnload(); } catch (e) { /* ignore */ } }
          res();
        };
        im.onerror = res;
      });
    })).then(function () {
      draw();
      return canvas.toDataURL('image/png');
    });
  };

  /* ---------------- 销毁 ---------------- */

  PdfStampPicker.prototype.destroy = function () {
    if (this._destroyed) return;             // 幂等：重复调用安全
    this._destroyed = true;
    // ★ H1：令牌自增 → 所有在途的加载/渲染/哈希补算链立即失效
    this._loadToken++;
    if (this._loadTimer) { clearTimeout(this._loadTimer); this._loadTimer = 0; }
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._resizeRaf) cancelAnimationFrame(this._resizeRaf);
    if (this._pinchRaf) cancelAnimationFrame(this._pinchRaf);
    this._raf = 0; this._resizeRaf = 0; this._pinchRaf = 0;
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this._handlers && window.removeEventListener) window.removeEventListener('resize', this._handlers.resize);
    // 显式解绑事件监听（防 destroy 后仍持有实例引用时泄漏）
    if (this._overlay && this._handlers) {
      this._overlay.removeEventListener('pointerdown', this._handlers.down);
      this._overlay.removeEventListener('pointermove', this._handlers.move);
      this._overlay.removeEventListener('pointerup', this._handlers.up);
      this._overlay.removeEventListener('pointercancel', this._handlers.up);
      this._overlay.removeEventListener('wheel', this._handlers.wheel);
    }
    if (this._root && this._handlers) {
      this._root.removeEventListener('keydown', this._handlers.key);
      this._root.removeEventListener('keyup', this._handlers.keyup);
      this._root.removeEventListener('blur', this._handlers.blur, true);
    }
    // 取消未完成的渲染任务
    if (this._renderTask) { try { this._renderTask.cancel(); } catch (e) { /* ignore */ } this._renderTask = null; }
    // 中止未完成的加载
    if (this._abortCtrl) { try { this._abortCtrl.abort(); } catch (e) { /* ignore */ } this._abortCtrl = null; }
    // 释放 pdf.js 文档资源
    this._discardDoc(this._pdf);
    this._pdf = null;
    this._ptrs = null;
    this._pinch = null;
    this._drag = null;
    // 释放兼容 worker 的 blob URL —— 不再 revoke：worker blob 已全局共享（_sharedWorkerBlob），
    // 跨实例复用，若随实例 destroy 而 revoke 会导致 pdfjs.GlobalWorkerOptions.workerSrc 悬空、后续实例加载失败
    this._compatWorkerUrl = null;
    // ★ H2-3：统一释放全部大对象/状态引用（实例被外部持有时也能尽快被 GC 回收）
    this._imgCache = null;
    this._pdfBytes = null;
    this._pdfBytesRef = null;
    this._pdfHash = null;
    this._pdfHashPromise = null;
    this._pdfHashPending = null;
    this._stamps = [];
    this._history = [];
    this._historyIdx = 0;
    this._users = [];
    this._currentUserId = null;
    this._stampImg = null;
    this._listeners = {};
    // 解绑并释放 DOM 引用
    if (this._root && this._root.parentNode) this._root.parentNode.removeChild(this._root);
    this._root = null;
    this._overlay = null;
    this._pageEl = null;
    this._canvas = null;
    this._pdfCanvas = null;
    this._listEl = null;
  };

  /* ====================== 弹窗模式 ====================== */

  /**
   * 一键弹窗选择签章位置。
   * @param {Object} config
   * @param {*} config.source 统一 PDF 来源（File/URL/流接口配置/proxy）
   * @param {Object} [config.json] 已有签章 JSON（toJSON()/toFlatJSON() 输出），打开后自动回显签章点与公章图
   * @param {string} [config.title='选择签章位置']
   * @param {string} [config.confirmText='确认']
   * @param {string} [config.cancelText='取消']
   * @param {number|string} [config.width] 弹窗宽度（数字=px 或 CSS 值如 '90%'），默认 min(94vw,1180px)
   * @param {number|string} [config.height] 弹窗高度（数字=px 或 CSS 值），默认 min(90vh,820px)
   * @param {'point'|'rect'|'stamp'} [config.mode] 弹窗坐标选择模式（等价于 pickerOptions.mode，更直观）
   * @param {Array} [config.users] 用户列表
   * @param {string} [config.currentUser]
   * @param {boolean} [config.closeOnBackdrop=true] 点遮罩关闭
   * @param {boolean} [config.requireStamp=false] 无签章点不允许确认
   * @param {boolean} [config.requireAllUsers=false] 每个签署方至少一个签章点才允许确认（优先于 requireStamp）
   * @param {boolean} [config.includeImage=false] 确认返回的 JSON 是否包含签章图 dataURL（数据自包含，后端直接盖章；默认不含轻量）
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
      // 弹窗宽高可配置（数字=px，字符串=任意 CSS 值如 '90%'/'640px'）
      if (config.width != null) modal.style.width = (typeof config.width === 'number') ? config.width + 'px' : config.width;
      if (config.height != null) modal.style.height = (typeof config.height === 'number') ? config.height + 'px' : config.height;
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
      var pickerOpts = Object.assign({}, config.pickerOptions, {
        users: config.users,
        currentUser: config.currentUser
      });
      // 传了 json 但没传 users → 用 json 里的签署方初始化（避免多余默认用户）
      if ((!config.users || !config.users.length) && config.json && Array.isArray(config.json.users)) {
        pickerOpts.users = config.json.users.map(function (g) { return g.user; });
      }
      // 顶层 mode 优先，其次 pickerOptions.mode，都不传则用构造默认（stamp）
      if (config.mode !== undefined) pickerOpts.mode = config.mode;
      else if (config.pickerOptions && config.pickerOptions.mode !== undefined) pickerOpts.mode = config.pickerOptions.mode;
      var picker = new PdfStampPicker(body, pickerOpts);
      // PDF 加载 → （可选）回显已有签章点 JSON → 完成
      var loadPromise = config.source
        ? picker.load(config.source)
        : Promise.resolve();
      if (config.json) {
        loadPromise = loadPromise.then(function () {
          return picker.importJSON(config.json).catch(function (err) {
            picker._emit('error', { message: 'JSON 回显失败：' + (err && err.message || err) });
            if (typeof console !== 'undefined') console.error(err);
          });
        });
      }
      loadPromise.catch(function (err) {
        picker._emit('error', { message: err.message });
        if (typeof console !== 'undefined') console.error(err);
      });

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
        if (settled) return;
        var json = picker.toJSON({ includeImage: config.includeImage });   // 可选含章图（自包含）
        var stampTotal = (json.users || []).reduce(function (n, g) {
          return n + (g.stamps ? g.stamps.length : 0);
        }, 0);
        if (config.requireStamp && stampTotal === 0) {
          picker._toast('请先至少放置一个签章点');
          return;
        }
        // 校验每个签署方至少一个签章点（requireAllUsers，优先于 requireStamp）
        if (config.requireAllUsers) {
          var missing = [];
          (json.users || []).forEach(function (g) {
            if (!(g.stamps && g.stamps.length)) missing.push(g.user.name);
          });
          if (missing.length) {
            picker._toast('以下签署方还未设置签章点：' + missing.join('、'));
            return;
          }
        }
        if (config.onConfirm) {
          try {
            var r = config.onConfirm(json);
            if (r && typeof r.then === 'function') {
              // async 确认期间禁用按钮防重复点击
              okBtn.disabled = true;
              cancelBtn.disabled = true;
              okBtn.style.opacity = '.6';
              r.then(function () { finish(json); }, function () {
                okBtn.disabled = false;
                cancelBtn.disabled = false;
                okBtn.style.opacity = '';
              });
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

  /**
   * 历史快照工具：签章数组 → 可安全存放的快照。
   *
   * 只逐字段浅拷贝【标量】，`image` 对象按【引用】共享 —— 因为库内 `stamp.image`
   * 是只读的（从不原地修改，只会整体替换），所以 50 条历史不会各存一份 base64 图。
   *
   * 旧实现用 `JSON.stringify(this._stamps)` 做快照：每个签章点若含 base64 章图
   * （dataURL 动辄数十~数百 KB），50 条历史 = 50 份完整副本，内存成倍放大。
   * 现在历史内存只与"签章数 × 标量大小"相关，与图片大小无关。
   */
  function snapshotStamps(stamps) {
    var out = [];
    for (var i = 0; i < stamps.length; i++) {
      var s = stamps[i];
      if (!s || typeof s !== 'object') { out.push(s); continue; }
      var c = {};
      for (var k in s) {
        if (Object.prototype.hasOwnProperty.call(s, k)) c[k] = s[k];
      }
      out.push(c);
    }
    return out;
  }

  /**
   * 构造"加载已被取代"的中止错误。
   * 语义与 fetch 的 AbortController 一致：并发 load() 时，旧调用会以 AbortError 结束，
   * 调用方应忽略 name === 'AbortError' 的失败（这是预期行为，不是故障）。
   */
  function supersededError() {
    var e = new Error('[PdfStampPicker] 加载已被后续调用取代');
    e.name = 'AbortError';
    e.superseded = true;
    return e;
  }

  /** 判断是否中止/取代类错误（预期内，不应派发 error 事件、不应视为失败） */
  function isAbortError(err) {
    return !!(err && (err.name === 'AbortError' || err.superseded || /已中止|已取代/.test(err.message || '')));
  }

  /* ---------------------------------------------------------------------
   * 纯 JS SHA-256 兜底（零依赖，库内自带）
   * 背景：crypto.subtle 只在【安全上下文】（HTTPS / localhost）可用；
   *       内网 HTTP（http://192.168.x.x）、file:// 等场景下不存在，
   *       导致 document.hash 恒为 null。此实现保证内网环境同样能出哈希。
   * 实现：直接处理原始字节（不整体复制，省内存），分块计算并让出主线程，
   *       超大 PDF 也不会长时间卡住 UI。输出与小写 hex 的 Web Crypto 结果一致。
   * ------------------------------------------------------------------- */
  var _SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  /**
   * 纯 JS SHA-256：bytes(Uint8Array) → Promise<hex 小写>
   * 万一过程中抛错，reject（调用方降级为 null）
   */
  function sha256Fallback(bytes) {
    return new Promise(function (resolve, reject) {
      try {
        var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        var w = new Int32Array(64);
        var len = bytes.length;
        var fullBlocksBytes = len - (len % 64);

        // 尾部不足 64 字节的部分：补 0x80 + 零填充 + 64 位大端长度
        var tailLen = len - fullBlocksBytes;
        var withPad = tailLen + 9;
        var tailTotal = withPad + ((64 - (withPad % 64)) % 64);
        var tail = new Uint8Array(tailTotal);
        tail.set(bytes.subarray(fullBlocksBytes, len));
        tail[tailLen] = 0x80;
        var bitLen = len * 8;
        var hi = Math.floor(bitLen / 4294967296);
        var lo = bitLen % 4294967296;
        tail[tailTotal - 8] = (hi >>> 24) & 255;
        tail[tailTotal - 7] = (hi >>> 16) & 255;
        tail[tailTotal - 6] = (hi >>> 8) & 255;
        tail[tailTotal - 5] = hi & 255;
        tail[tailTotal - 4] = (lo >>> 24) & 255;
        tail[tailTotal - 3] = (lo >>> 16) & 255;
        tail[tailTotal - 2] = (lo >>> 8) & 255;
        tail[tailTotal - 1] = lo & 255;

        function block(src, o) {
          var i;
          for (i = 0; i < 16; i++) {
            w[i] = (src[o + i * 4] << 24) | (src[o + i * 4 + 1] << 16) |
                   (src[o + i * 4 + 2] << 8) | src[o + i * 4 + 3];
          }
          for (i = 16; i < 64; i++) {
            var x = w[i - 15], y = w[i - 2];
            var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
            var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
          }
          var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
          for (i = 0; i < 64; i++) {
            var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            var ch = (e & f) ^ (~e & g);
            var t1 = (h + S1 + ch + _SHA256_K[i] + w[i]) | 0;
            var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            var maj = (a & b) ^ (a & c) ^ (b & c);
            var t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
          }
          H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
          H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
        }

        var CHUNK = 512 * 1024; // 每轮最多处理 512KB 后让出主线程（必须是 64 的倍数）
        function processRange(src, start, end, next) {
          var o = start;
          function step() {
            var stop = Math.min(end, o + CHUNK);
            while (o < stop) { block(src, o); o += 64; }
            if (o < end) { setTimeout(step, 0); return; }
            next();
          }
          step();
        }

        processRange(bytes, 0, fullBlocksBytes, function () {
          processRange(tail, 0, tailTotal, function () {
            var hex = '';
            for (var j = 0; j < 8; j++) {
              hex += ('00000000' + (H[j] >>> 0).toString(16)).slice(-8);
            }
            resolve(hex);
          });
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 计算 ArrayBuffer / Uint8Array 的 SHA-256（小写 hex）
   * 优先 Web Crypto（安全上下文快）；不可用则用库内纯 JS 兜底（内网 HTTP/file:// 也能出哈希）
   * 两者都失败才返回 null
   */
  function sha256(buf) {
    var bytes;
    try {
      bytes = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    } catch (e) {
      return Promise.resolve(null);
    }
    var subtle = (typeof crypto !== 'undefined' && crypto && crypto.subtle) ? crypto.subtle : null;
    if (subtle && typeof subtle.digest === 'function') {
      return subtle.digest('SHA-256', bytes).then(function (hash) {
        var hb = new Uint8Array(hash);
        var hex = '';
        for (var i = 0; i < hb.length; i++) {
          hex += (hb[i] < 16 ? '0' : '') + hb[i].toString(16);
        }
        return hex;
      }).catch(function () {
        // Web Crypto 失败（如超大文件内存不足）→ 再用纯 JS 兜底
        return sha256Fallback(bytes).catch(function () { return null; });
      });
    }
    // ★ 非安全上下文（内网 HTTP 等）：crypto.subtle 不存在 → 纯 JS 兜底
    return sha256Fallback(bytes).catch(function () { return null; });
  }

  /** 兼容旧浏览器：pdf.js 3.11 依赖 Array.prototype.at()，旧内核(Chrome<92/Edge<92/Safari<15.4)不支持 */
  function ensureAtPolyfill() {
    if (typeof Array !== 'undefined' && !Array.prototype.at) {
      // 必须用 defineProperty 定义成【不可枚举】——pdf.js 会检测 Array.prototype 上多余的可枚举属性
      // （可枚举会破坏 for...in 迭代，pdf.js 直接报错拒绝加载）
      Object.defineProperty(Array.prototype, 'at', {
        value: function (index) {
          var n = Number(index);
          var len = this.length;
          if (n < 0) n = Math.max(len + n, 0);
          return n >= 0 && n < len ? this[n] : undefined;
        },
        writable: true,
        configurable: true,
        enumerable: false   // ★ 关键：不可枚举
      });
    }
  }

  /** 兼容旧浏览器：TypedArray.prototype.at()（Chrome<92 同样缺失），pdf.js 对 Uint8Array 等也会用 .at(-1) */
  function ensureTypedArrayAtPolyfill() {
    var g = (typeof globalThis !== 'undefined') ? globalThis : (typeof self !== 'undefined' ? self : window);
    if (!g) return;
    var types = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array',
      'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array'];
    if (typeof BigInt64Array !== 'undefined') { types.push('BigInt64Array', 'BigUint64Array'); }
    for (var i = 0; i < types.length; i++) {
      var Ctor = g[types[i]];
      if (Ctor && !Ctor.prototype.at) {
        Object.defineProperty(Ctor.prototype, 'at', {
          value: function (index) {
            var n = Number(index);
            var len = this.length;
            if (n < 0) n = Math.max(len + n, 0);
            return n >= 0 && n < len ? this[n] : undefined;
          },
          writable: true, configurable: true, enumerable: false
        });
      }
    }
  }

  /**
   * 全面浏览器兼容检测（pdf.js 3.11 + 库所需全部现代 API）。
   * 返回 { ok, missing[] } —— missing 列出缺的能力，便于提示。
   */
  function isCompatSupported() {
    var missing = [];
    try {
      if (typeof Array.prototype.at !== 'function' || [1].at(0) !== 1) missing.push('Array.at');
      if (typeof structuredClone !== 'function') missing.push('structuredClone');
      // 可选链 ?. / 空值合并 ??（pdf.js 3.11 语法级依赖，低版本浏览器直接 SyntaxError）
      try { eval('var __t = {}?.a ?? 1;'); } catch (e) { missing.push('optional chaining/??'); }
      if (typeof Promise.any !== 'function') missing.push('Promise.any');
      if (typeof String.prototype.replaceAll !== 'function') missing.push('String.replaceAll');
      if (typeof Array.prototype.flat !== 'function') missing.push('Array.flat');
      if (typeof globalThis === 'undefined') missing.push('globalThis');
    } catch (e) {
      missing.push('compat-check-error');
    }
    return { ok: missing.length === 0, missing: missing };
  }

  /** 兼容旧写法：只查 Array.at（历史方法保留） */
  function isAtSupported() {
    try { return typeof Array.prototype.at === 'function' && [1].at(0) === 1; }
    catch (e) { return false; }
  }

  /** 兼容旧浏览器：structuredClone（Chrome98+/FF94+/Safari15.4+），pdf.js 导出图片/消息传递等用到 */
  function ensureStructuredClonePolyfill() {
    if (typeof structuredClone === 'undefined' && typeof self !== 'undefined') {
      // ★ 不能 JSON 降级：pdf.js 用 structuredClone 做 postMessage 前的显式 clone，数据常含 TypedArray/循环引用，
      //   JSON 序列化会丢二进制、循环引用直接报错。同步返回原对象是安全降级——
      //   因为紧接着的 postMessage() 会用浏览器【原生】structured clone 算法再克隆一次，数据完整性由原生保证；
      //   仅 transfer 列表被忽略（退化为复制而非所有权转移，功能不受影响）。
      self.structuredClone = function (obj) { return obj; };
    }
  }

  /** 主线程 replaceAll polyfill（Edge 90 缺，pdf.js 字符串处理用） */
  function ensureReplaceAllPolyfill() {
    if (typeof String !== 'undefined' && typeof String.prototype.replaceAll === 'undefined') {
      Object.defineProperty(String.prototype, 'replaceAll', {
        value: function (search, replace) {
          if (search instanceof RegExp) {
            if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
            return this.replace(search, replace);
          }
          return this.split(search).join(replace);
        },
        writable: true, configurable: true, enumerable: false
      });
    }
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
  function buildJSON(doc, stamps, users) {
    var userList = (users && users.length) ? users : [{ id: 'default', name: '默认', color: '#4285f4' }];
    var stampList = stamps || [];
    var docOut = {
      name: doc.docName || '',
      pages: doc.totalPages,
      currentPage: doc.currentPage,
      pageSize: { width: round2(doc.width), height: round2(doc.height), unit: 'pt' },
      rotation: doc.rotation || 0,
      generatedAt: new Date().toISOString()
    };
    // PDF 文件哈希（防篡改/文件指纹；SHA-256）
    // hashStatus 明确标注状态，避免"hash 字段凭空消失、不知是漏算还是不支持"：
    //   ready=已就绪 · pending=计算中（纯 URL 补算场景，可用 getHash()/hashready 取）
    //   unavailable=本场景无法计算（纯 URL 未开 hashUrl，无字节可用）
    if (doc.hash) {
      docOut.hash = doc.hash;
      docOut.hashAlgorithm = 'SHA-256';
    }
    docOut.hashStatus = doc.hashStatus || (doc.hash ? 'ready' : 'unavailable');
    return {
      document: docOut,
      users: userList.map(function (u) {
        var userStamps = stampList
          .filter(function (st) { return st.userId === u.id; })
          .map(function (st) {
            var out = {
              id: st.id,
              page: st.page,
              x: round2(st.x), y: round2(st.y),
              width: round2(st.width), height: round2(st.height),
              unit: 'pt',
              rotation: st.rotation || 0,
              note: st.note || '',
              createdAt: st.createdAt
            };
            // 可选：包含签章图（dataURL）——数据自包含，后端可直接盖章渲染
            if (doc.includeImage && st.image && st.image.src) {
              out.image = { src: st.image.src, name: st.image.name || '', width: st.image.width || 0, height: st.image.height || 0 };
            }
            return out;
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
    // ★ 与 toJSON 保持一致：扁平版同样输出完整哈希信息（hash / hashAlgorithm / hashStatus），
    //   避免两条导出路径数据不一致（旧实现扁平版完全没有 hash 字段）
    var flatDoc = {
      name: doc.docName || '',
      pages: doc.totalPages,
      currentPage: doc.currentPage,
      pageSize: { width: round2(doc.width), height: round2(doc.height), unit: 'pt' },
      rotation: doc.rotation || 0,
      generatedAt: new Date().toISOString(),
      hashStatus: doc.hashStatus || (doc.hash ? 'ready' : 'unavailable')
    };
    if (doc.hash) {
      flatDoc.hash = doc.hash;
      flatDoc.hashAlgorithm = 'SHA-256';
    }
    return {
      document: flatDoc,
      stamps: (stamps || []).map(function (st) {
        var u = userMap[st.userId] || null;
        var out = {
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
        // 可选：包含签章图（dataURL）——数据自包含，后端可直接盖章渲染
        if (doc.includeImage && st.image && st.image.src) {
          out.image = { src: st.image.src, name: st.image.name || '', width: st.image.width || 0, height: st.image.height || 0 };
        }
        return out;
      })
    };
  }

  PdfStampPicker.version = VERSION;
  /**
   * 解析导入 JSON 结构（纯函数，可单测）：users[] 分组 或 stamps[] 扁平 → {stamps, users}
   * @returns {{stamps:Array, users:Array}}
   */
  function parseImportJSON(json) {
    var stamps = [];
    var users = [];
    var ignored = 0;                                  // 结构上被丢弃的条目数（不再无声）
    if (!json || typeof json !== 'object') {
      throw new Error('[PdfStampPicker] importJSON 需要 JSON 对象');
    }
    var hasGrouped = Array.isArray(json.users);
    if (hasGrouped) {
      /* users[] 两种写法都接受：
       *   · 分组 {user:{id,name}, stamps:[...]}（toJSON 输出，签章点继承该用户）
       *   · 仅声明签署方 {id,name}（"我要甲乙丙三个签署方"的常见手写配置）            ← 新增
       * 旧实现 `if (!g.user) return;` 把第二种整条丢弃：users 里声明了 3 个签署方，
       * 导入后一个都没有，且没有任何提示。 */
      json.users.forEach(function (g) {
        var u = (g && g.user) ? g.user : ((g && g.id) ? g : null);
        if (!u) { ignored++; return; }
        users.push(u);
        (g.stamps || []).forEach(function (st) {
          stamps.push(Object.assign({ userId: u.id }, st));
        });
      });
    }
    if (Array.isArray(json.stamps)) {
      /* ★ 修复：旧实现是 `if (users) {...} else if (stamps) {...}` —— 两种键**同时出现**时
       * 走上面那个分支，顶层 stamps[] 被**整段静默忽略**：importJSON 正常 resolve、
       * import 事件 count=0、skipped=0、无异常，用户只看到"什么都没导入进来"。
       * 手写配置 `{users:[...], stamps:[...]}`（声明签署方 + 平铺签章点）正中此坑。
       * 现改为两者都收：users[] 声明签署方，顶层 stamps[] 逐条并入。 */
      json.stamps.forEach(function (st) {
        if (!st) { ignored++; return; }
        if (st.user) users.push(st.user);             // 平铺结构内嵌的用户信息
        stamps.push(Object.assign({}, st));
      });
    } else if (!hasGrouped) {
      throw new Error('[PdfStampPicker] importJSON 结构无法识别（需 users[] 或 stamps[]）');
    }
    return { stamps: stamps, users: users, ignored: ignored };
  }

  PdfStampPicker._internals = { buildJSON: buildJSON, buildFlatJSON: buildFlatJSON, parseImportJSON: parseImportJSON, genId: genId, normalizeRotation: normalizeRotation,
    // 坐标换算纯函数（单一真源）：库内部与单元测试共用同一份实现
    makeGeom: makeGeom, pdfCoordFromScreen: pdfCoordFromScreen, screenCoordFromPdf: screenCoordFromPdf };
  PdfStampPicker._localCandidates = PdfStampPicker._localCandidates || null; // 由下方赋值（保持单测可访问）

  return PdfStampPicker;
});
