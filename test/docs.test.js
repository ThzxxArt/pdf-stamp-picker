#!/usr/bin/env node
/*!
 * 文档一致性检查（D7 根治）
 *
 * 为什么需要它：
 *   历史上反复出现"代码改了、文档没跟上"（README 写 19 个构造选项实际 29 个、
 *   写 14 个事件实际 15 个、d.ts 缺新增选项/方法）。手工核对必然再次漂移，
 *   因此把"文档 vs 实现"变成可自动执行的断言。
 *
 * 检查项（与代码里的 section() 一一对应，共 8 节）：
 *   1. 版本号一致：库内 VERSION / package.json / 模块导出 / 全部 demo 页缓存戳
 *      （库与 test-harness.js **两处**都必须带 ?v= 且等于当前版本）/ 页面上"显示给人看"的版本号
 *   2. 构造选项：源码 defaults 键 ∪ {pdfjs} == README 声明数 == README 表格项 == d.ts 声明项
 *   3. 事件：源码实际 emit 的名字 == README 声明数 == README 表格项
 *   4. 公开方法：源码 prototype 上的公开方法 ⊆ d.ts 声明
 *   5. README：实例方法表 / 静态成员表 == 源码实际公开成员（双向，含解析自检防假通过）
 *   6. INTEGRATION.md：第 12 章 API 参考 == 源码实际公开成员 ⨯ 事件（双向），
 *      且文内「当前版本」与 version 示例必须等于库版本
 *   7. README 测试段：表格页集合 == run-all 的 SUITE，各页条数 == 该页 __TEST.expect()，
 *      套件数/总条数 == 实际值（总条数含 run-all 的 AGGREGATE_ASSERTIONS）
 *   8. 测试页自身响应式：全部 demo 页都有 viewport meta；harness 的窄视口样式限定在媒体查询内
 *
 * ★ 两侧数据必须**来源不同**：一边读源码（grep prototype/emit），一边解析 Markdown 表格。
 *   若两边都从库内部读数（如断言 f() === f()）则永不可能失败 —— 等于没测。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'pdf-stamp-picker.js'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const DTS = fs.readFileSync(path.join(ROOT, 'pdf-stamp-picker.d.ts'), 'utf8');
const INTEGRATION = fs.readFileSync(path.join(ROOT, 'INTEGRATION.md'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ✅ ' + name + (detail ? ' — ' + detail : '')); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------- 1. 版本号 ---------- */
section('1. 版本号一致性');
const m = SRC.match(/var VERSION = ['"]([^'"]+)['"]/);
const srcVersion = m && m[1];
check('库内 VERSION 存在', !!srcVersion, srcVersion);
check('package.json 与库内 VERSION 一致', PKG.version === srcVersion, PKG.version + ' vs ' + srcVersion);
check('模块导出 version 与库内 VERSION 一致',
  SRC.includes('PdfStampPicker.version = VERSION'), 'PdfStampPicker.version = VERSION');

const stampRe = /pdf-stamp-picker\.js\?v=([\w.\-]+)/g;
const demoStamps = new Set();
let sm;
while ((sm = stampRe.exec(fs.readFileSync(path.join(ROOT, 'demo', 'index.html'), 'utf8'))) !== null) demoStamps.add(sm[1]);

/* 逐个 demo 页检查缓存戳：带 ?v= 的必须等于当前版本，否则浏览器会用旧库（历史上导致测试假失败） */
const demoFiles = fs.readdirSync(path.join(ROOT, 'demo')).filter(f => f.endsWith('.html'));
const staleStamps = [];
demoFiles.forEach(f => {
  const body = fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8');
  const re = /(?:src|href)="([^"]*pdf-stamp-picker\.js)\?v=([\w.\-]+)"/g;
  let mm;
  while ((mm = re.exec(body)) !== null) {
    if (mm[2] !== srcVersion) staleStamps.push(f + ' → ' + mm[2]);
  }
});
check('demo 页缓存戳全部等于当前版本', staleStamps.length === 0,
  staleStamps.length ? '过期：' + staleStamps.join(', ') : demoFiles.length + ' 个页面已检查');

/* test-harness.js 也要缓存戳 —— 这是同一类坑的第二处，此前**完全没人查**。
   为什么它同样致命：harness 决定"断言记没记上、finish 没 finish"，改了 harness 却让浏览器
   用旧文件，结果不是报错而是**回到旧行为**（例如新增的 frameworkSmoke/waitFor 不存在 →
   新接入的框架页静默失效，页面仍显示旧结论）。本次实测：10 页带 `?v=`、
   6 页（index + 4 框架页 + responsive）没带 —— 正是"加了套件忘同步"的具体形态。
   因此这里两头都查：①带戳的必须等于当前版本 ②引用了 harness 的页**必须带戳**。 */
const harnessStale = [], harnessNoStamp = [];
let harnessPages = 0;
demoFiles.forEach(f => {
  const body = fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8');
  const re = /<script\s+src="(test-harness\.js)(\?v=([\w.\-]+))?"/g;
  let mm;
  while ((mm = re.exec(body)) !== null) {
    harnessPages++;
    if (!mm[2]) harnessNoStamp.push(f);
    else if (mm[3] !== srcVersion) harnessStale.push(f + ' → ' + mm[3]);
  }
});
/* 自检：页面引用方式若被改动（改用变量拼 URL、或加 CDN 前缀），上面的正则会一处都匹配不到，
   "全部合格"就成了空集上的真命题 —— 必须先断言真的扫到了足够多的页面。 */
check('扫描到足够多的 test-harness.js 引用（解析自检 ≥15 处）', harnessPages >= 15,
  harnessPages + ' 处引用');
check('test-harness.js 缓存戳全部等于当前版本', harnessStale.length === 0,
  harnessStale.length ? '过期：' + harnessStale.join(', ') : harnessPages + ' 处已检查');
check('引用 harness 的页面都带 ?v= 缓存戳（不带 = 会吃到旧 harness）', harnessNoStamp.length === 0,
  harnessNoStamp.length ? '缺戳：' + harnessNoStamp.join(', ') : '无缺漏');

/* 缓存戳只管"浏览器会不会加载新库"，**管不到页面上直接写给人看的版本号**。
   实测踩到：demo/index.html 的 <title> 与页头 `#ver-tag` 一直写着 v4.9.4（且不是 JS 动态更新的），
   升到 4.9.5 后标签页仍对使用者显示旧版本 —— 只看 ?v= 的检查完全放它过去。
   这里扫描"显示位置"（<title> 内 / >vX.Y.Z< 文本节点）：注释里的历史版本号（如"v4.9.3 新增"）
   不在此列，不会被误报。 */
const shownVersions = [];
demoFiles.forEach(f => {
  const body = fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8');
  const t = /<title>([^<]*)<\/title>/.exec(body);
  if (t) {
    const m2 = /v(\d+\.\d+\.\d+)/.exec(t[1]);
    if (m2) shownVersions.push(f + ' <title> → v' + m2[1]);
  }
  const re2 = />v(\d+\.\d+\.\d+)</g;
  let m3;
  while ((m3 = re2.exec(body)) !== null) shownVersions.push(f + ' 页内文本 → v' + m3[1]);
});
const staleShown = shownVersions.filter(s => !s.endsWith('v' + srcVersion));
check('demo 页"显示给人看"的版本号也是当前版本', staleShown.length === 0,
  staleShown.length ? '过期：' + staleShown.join('；') : shownVersions.length + ' 处已检查（' + shownVersions.join('、') + '）');

/* ---------- 2. 构造选项 ---------- */
section('2. 构造选项');
const optStart = SRC.indexOf('this._options = Object.assign({');
const optEnd = SRC.indexOf('}, options || {});', optStart);
if (optStart < 0 || optEnd < 0) { check('能解析出构造选项块', false); }
const optBlock = SRC.slice(optStart, optEnd);
const defaultsKeys = [];
const keyRe = /^\s{6}([a-zA-Z][a-zA-Z0-9]*):/gm;
let km;
while ((km = keyRe.exec(optBlock))) defaultsKeys.push(km[1]);
const srcOptions = defaultsKeys.concat(['pdfjs']);   // pdfjs 单独赋值，也算构造选项

/* 只取"### 构造选项"到下一个 ### 之间的表格，避免把工具栏子选项表也算进来 */
function sliceSection(md, heading) {
  const s = md.indexOf(heading);
  if (s < 0) return '';
  const next = md.indexOf('\n### ', s + heading.length);
  return md.slice(s, next < 0 ? md.length : next);
}
/* 表格首列可能写多个选项（如 | `minStampSize` / `maxStampSize` |），需全部取出 */
function tableNames(sectionMd) {
  const names = [];
  sectionMd.split('\n').forEach(line => {
    if (!/^\|/.test(line)) return;
    const firstCell = line.split('|')[1] || '';
    const re = /`([a-zA-Z][a-zA-Z0-9]*)`/g;
    let mm;
    while ((mm = re.exec(firstCell)) !== null) names.push(mm[1]);
  });
  return names;
}

const readmeOptSection = sliceSection(README, '### 构造选项');
const readmeOptCount = README.match(/###\s*构造选项（全部\s*(\d+)\s*项）/);
const uniqReadmeOpts = [...new Set(tableNames(readmeOptSection))];

/* d.ts：花括号配对取出 interface PdfStampPickerOptions 的整体 */
function braceBlock(text, startIdx) {
  let i = text.indexOf('{', startIdx), depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}') { depth--; if (depth === 0) return text.slice(i, j + 1); }
  }
  return '';
}
const dtsOptBlock = braceBlock(DTS, DTS.indexOf('interface PdfStampPickerOptions'));
const dtsOpts = [];
const dtsKeyRe = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/gm;
while ((km = dtsKeyRe.exec(dtsOptBlock))) dtsOpts.push(km[1]);

check('README 声明了选项总数', !!readmeOptCount, readmeOptCount && readmeOptCount[1] + ' 项');
check('源码选项数 == README 声明数',
  !!readmeOptCount && srcOptions.length === Number(readmeOptCount[1]),
  '源码 ' + srcOptions.length + ' 项');
check('README 表格项数 == 源码选项数',
  uniqReadmeOpts.length === srcOptions.length,
  '表格 ' + uniqReadmeOpts.length + ' 项');

const missInReadme = srcOptions.filter(o => !uniqReadmeOpts.includes(o));
const extraInReadme = uniqReadmeOpts.filter(o => !srcOptions.includes(o));
check('源码选项全部写进 README 表格', missInReadme.length === 0, missInReadme.join(', '));
check('README 表格没有多余选项', extraInReadme.length === 0, extraInReadme.join(', '));

const missInDts = srcOptions.filter(o => !dtsOpts.includes(o));
check('源码选项全部声明进 d.ts', missInDts.length === 0, missInDts.join(', '));

/* ---------- 3. 事件 ---------- */
section('3. 事件');
const events = new Set();
/* 引号两种都要认：只认单引号时，写成 `_emit("x")` 的新事件会被**静默漏检**
   —— README/文档少写一个事件而检查全绿。（变异测试实测踩到，见 test/README 记录） */
const evRe = /\._emit\(\s*['"]([a-zA-Z]+)['"]/g;
while ((km = evRe.exec(SRC))) events.add(km[1]);

const readmeEvCount = README.match(/###\s*事件（全部\s*(\d+)\s*个）/);
const uniqReadmeEv = [...new Set(tableNames(sliceSection(README, '### 事件')))];

check('README 声明了事件总数', !!readmeEvCount, readmeEvCount && readmeEvCount[1] + ' 个');
check('源码事件数 == README 声明数',
  !!readmeEvCount && events.size === Number(readmeEvCount[1]),
  '源码 ' + events.size + ' 个：' + [...events].sort().join(', '));
const missEvInReadme = [...events].filter(e => !uniqReadmeEv.includes(e));
const extraEvInReadme = uniqReadmeEv.filter(e => !events.has(e));
check('源码事件全部写进 README 表格', missEvInReadme.length === 0, missEvInReadme.join(', '));
check('README 事件表格没有多余项', extraEvInReadme.length === 0, extraEvInReadme.join(', '));

/* ---------- 4. 公开方法 ---------- */
section('4. 公开方法 vs d.ts');
const protoMethods = new Set();
const pmRe = /PdfStampPicker\.prototype\.([a-zA-Z_$][\w$]*)\s*=/g;
while ((km = pmRe.exec(SRC))) protoMethods.add(km[1]);
const publicMethods = [...protoMethods].filter(x => x[0] !== '_');
const classBody = braceBlock(DTS, DTS.indexOf('class PdfStampPicker'));
const dtsMethods = new Set();
const dmRe = /^\s{2}(?:static\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm;
while ((km = dmRe.exec(classBody))) dtsMethods.add(km[1]);

const notDeclared = publicMethods.filter(x => !dtsMethods.has(x));
check('全部公开方法已在 d.ts 声明', notDeclared.length === 0,
  notDeclared.length ? '缺：' + notDeclared.join(', ') : publicMethods.length + ' 个公开方法');

/* ---------- 5. README 方法表 ---------- */
section('5. 公开方法与 README 方法表');
/* 按「未转义的 |」切分单元格：README 里写 `setMode('point'\|'rect')`，
   直接 split('|') 会把 \| 也当分隔符 → 取错单元格 → 解析出一堆空名 → 断言假通过。
   （实测踩到：初版探针因此漏报 setMode 并误报静态表全缺。） */
function cellsOf(line) {
  return line.replace(/\\\|/g, '\u0001').split('|').map(c => c.replace(/\u0001/g, '|'));
}
/* 从反引号里取「调用签名」的方法名：`f(x)` → f；支持一格多方法 `a()` / `b()` */
function calledNames(cell) {
  const out = [];
  const re = /`([^`]+)`/g;
  let mm;
  while ((mm = re.exec(cell)) !== null) {
    const g = /^([a-zA-Z_$][\w$]*)\s*\(/.exec(mm[1].trim());
    if (g) out.push(g[1]);
  }
  return out;
}
const readmeInstMethods = new Set();
sliceSection(README, '### 实例方法').split('\n').forEach(line => {
  if (!/^\|/.test(line)) return;
  calledNames(cellsOf(line)[2] || '').forEach(n => readmeInstMethods.add(n));
});
const staticNames = new Set();
const stRe = /PdfStampPicker\.([a-zA-Z_$][\w$]*)\s*=/g;
while ((km = stRe.exec(SRC))) if (km[1] !== 'prototype' && km[1][0] !== '_') staticNames.add(km[1]);
const readmeStaticMembers = new Set();
sliceSection(README, '### 静态成员').split('\n').forEach(line => {
  if (!/^\|/.test(line)) return;
  const re = /`PdfStampPicker\.([a-zA-Z_$][\w$]*)/g;
  let mm;
  while ((mm = re.exec(cellsOf(line)[1] || '')) !== null) readmeStaticMembers.add(mm[1]);
});

/* 解析自检：解析器一旦悄悄退化（返回空集），下面的「没有缺漏」就变成永远成立 —— 假通过。
   因此先断言"确实解析到了预期量级的东西"。（历史上正是断言写错掩盖了真 bug。） */
check('README 实例方法表可解析（≥40 项）', readmeInstMethods.size >= 40, readmeInstMethods.size + ' 项');
check('README 静态成员表可解析（≥4 项）', readmeStaticMembers.size >= 4, readmeStaticMembers.size + ' 项');

const missInReadmeMethods = publicMethods.filter(x => !readmeInstMethods.has(x));
const extraInReadmeMethods = [...readmeInstMethods].filter(x => !publicMethods.includes(x));
check('全部公开方法已写进 README 方法表', missInReadmeMethods.length === 0,
  missInReadmeMethods.length ? '缺：' + missInReadmeMethods.join(', ') : publicMethods.length + ' 个公开方法');
check('README 方法表没有多余/非公开方法', extraInReadmeMethods.length === 0, extraInReadmeMethods.join(', '));

const missInReadmeStatics = [...staticNames].filter(x => !readmeStaticMembers.has(x));
const extraInReadmeStatics = [...readmeStaticMembers].filter(x => !staticNames.has(x));
check('全部静态成员已写进 README 静态成员表', missInReadmeStatics.length === 0, missInReadmeStatics.join(', '));
check('README 静态成员表没有多余项', extraInReadmeStatics.length === 0, extraInReadmeStatics.join(', '));

/* ---------- 6. INTEGRATION.md ---------- */
section('6. INTEGRATION.md（随包发布的集成指南）');
/* 背景：INTEGRATION.md 会随 npm 包发布给集成方，历史上却严重滞后 ——
   558 行里只覆盖 load/destroy/on/toJSON/importJSON，而 getHash/getDocName/getTotalPages/
   beginHistoryGroup/abort 等一票对外 API 一个都没写，且当时的 docs.test.js 只查 README/d.ts
   → 集成方照文档写代码会漏掉一半能力。这里把第 12 章（API 参考）纳入机器校验。 */
const c12Start = INTEGRATION.indexOf('## 12. API 参考');
const c13Start = INTEGRATION.indexOf('## 13.');
const c12 = c12Start < 0 ? '' : INTEGRATION.slice(c12Start, c13Start < 0 ? INTEGRATION.length : c13Start);
check('存在「## 12. API 参考」章且位于第 13 章之前', c12Start >= 0 && c13Start > c12Start,
  c12Start < 0 ? '未找到' : c12.length + ' 字符');
check('第 12 章声明了由本测试自动校验', c12.includes('test/docs.test.js'), 'docs.test.js');

/* 三向分类解析：`PdfStampPicker.x` → 静态；`f(...)` → 实例方法；`event` → 事件 */
const docMethods = new Set(), docStatics = new Set(), docEvents = new Set();
c12.split('\n').forEach(line => {
  if (!/^\|/.test(line)) return;
  const first = cellsOf(line)[1] || '';
  let mm;
  const rs = /`PdfStampPicker\.([a-zA-Z_$][\w$]*)/g;
  while ((mm = rs.exec(first)) !== null) docStatics.add(mm[1]);
  const rb = /`([^`]+)`/g;
  while ((mm = rb.exec(first)) !== null) {
    const txt = mm[1].trim();
    const g = /^([a-zA-Z_$][\w$]*)\s*\(/.exec(txt);
    if (g) docMethods.add(g[1]);
    else if (/^[a-z][a-zA-Z0-9]*$/.test(txt)) docEvents.add(txt);
  }
});

/* 解析自检：解析器一旦退化（表格格式改了、返回空集），下面的「没有缺漏」就永远成立 —— 假通过。 */
check('第 12 章实例方法表可解析（≥40 项）', docMethods.size >= 40, docMethods.size + ' 项');
check('第 12 章静态成员表可解析（≥4 项）', docStatics.size >= 4, docStatics.size + ' 项');
check('第 12 章事件表可解析（≥12 项）', docEvents.size >= 12, docEvents.size + ' 项');

const missIntMethods = publicMethods.filter(x => !docMethods.has(x));
const extraIntMethods = [...docMethods].filter(x => !publicMethods.includes(x));
check('全部公开方法已写进第 12 章', missIntMethods.length === 0,
  missIntMethods.length ? '缺：' + missIntMethods.join(', ') : publicMethods.length + ' 个公开方法');
check('第 12 章没有多余/非公开方法', extraIntMethods.length === 0, extraIntMethods.sort().join(', '));

const missIntStatics = [...staticNames].filter(x => !docStatics.has(x));
const extraIntStatics = [...docStatics].filter(x => !staticNames.has(x));
check('全部静态成员已写进第 12 章', missIntStatics.length === 0, missIntStatics.join(', '));
check('第 12 章静态成员没有多余项', extraIntStatics.length === 0, extraIntStatics.sort().join(', '));

const missIntEvents = [...events].filter(e => !docEvents.has(e));
const extraIntEvents = [...docEvents].filter(e => !events.has(e));
check('全部事件已写进第 12 章', missIntEvents.length === 0, missIntEvents.join(', '));
check('第 12 章事件表没有多余项', extraIntEvents.length === 0, extraIntEvents.sort().join(', '));

/* 章节编号：插入新章后最容易出现重号/跳号（本文件的第 12 章正是新插入的） */
const chapters = [];
INTEGRATION.split('\n').forEach(line => {
  const mm = /^## (\d+)\./.exec(line);
  if (mm) chapters.push(Number(mm[1]));
});
const dupChapters = chapters.filter((n, i) => chapters.indexOf(n) !== i);
const seqOk = chapters.every((n, i) => n === i + 1);
check('章节号从 1 连续递增且无重号', seqOk && dupChapters.length === 0,
  chapters.length + ' 章：' + chapters.join(',') + (dupChapters.length ? ' 重号 ' + dupChapters.join(',') : ''));

const subNums = [];
c12.split('\n').forEach(line => {
  const mm = /^### 12\.(\d+)/.exec(line);
  if (mm) subNums.push(Number(mm[1]));
});
check('第 12 章子节编号从 12.1 连续递增',
  subNums.length > 0 && subNums.every((n, i) => n === i + 1),
  subNums.length + ' 节：12.1–12.' + subNums[subNums.length - 1]);

/* 文内版本声明必须跟库版本走 —— 集成方按文档判断"手上这份是什么版本" */
const curVer = /^- 当前版本 v([\d.]+)：/m.exec(INTEGRATION);
check('INTEGRATION.md「当前版本」== 库版本', !!curVer && curVer[1] === srcVersion,
  curVer ? curVer[1] + ' vs ' + srcVersion : '未找到「- 当前版本 vX.Y.Z：」行');
const verExample = /\|\s*`PdfStampPicker\.version`\s*\|([^|]*)/.exec(c12);
const exVer = verExample && /'([\d.]+)'/.exec(verExample[1]);
check('第 12 章 version 示例 == 库版本', !!exVer && exVer[1] === srcVersion,
  exVer ? exVer[1] + ' vs ' + srcVersion : '未找到示例');

/* ---------- 7. README 测试段 ↔ 回归套件 ---------- */
section('7. README「Demo 与测试」段与回归套件对账');
/* 背景：README 是随 npm 包发布的主文档，但它的"套件清单"长期滞后 ——
   实际 11 个套件时它还写着"7 个套件 · 109/109"、表格缺 4 个页、h1 页条数写 16（实为 17）。
   这类"加套件忘写文档 / 条数写错"必须由机器对账，而不是靠人记得改。 */
const runAll = fs.readFileSync(path.join(ROOT, 'demo', 'run-all.html'), 'utf8');
const suiteBlock = /var SUITE = \[([\s\S]*?)\n\];/.exec(runAll);
const suiteFiles = [];   // 含重复（edge90 跑默认 + ?strict=1 两遍）
if (suiteBlock) {
  const se = /\[\s*'([^']+\.html)'/g;
  let sm;
  while ((sm = se.exec(suiteBlock[1])) !== null) suiteFiles.push(sm[1]);
}
const uniqueSuite = [...new Set(suiteFiles)];
check('从 run-all.html 解析出套件清单（自检 ≥10 项）', suiteFiles.length >= 10,
  suiteFiles.length + ' 个条目 / ' + uniqueSuite.length + ' 个页面');

/* 页面内的「（run-all 套件 ⑫）」注释必须与它在 SUITE 里的实际次序一致。
   本次实测：新增 5 个套件后，index 写 ⑯（实为 ⑫）、vue2 写 ⑫、vue3 写 ⑬、react 写 ⑭、angularjs 写 ⑮
   —— 5 个里错了 4 个。原因是**插入新套件会让后面所有编号整体错位**，而注释没有任何机器约束。
   注意 edge90 在 SUITE 里占两个条目（③④），这种一页多套件的页不参与比对（取到的次序不唯一）。 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const suiteSeq = {};          // 页面 → 次序符号（一页多条目的记为 null，不参与比对）
if (suiteBlock) {
  const le = /\[\s*'([^']+\.html)'\s*,\s*'([^']*)'/g;
  let lm;
  while ((lm = le.exec(suiteBlock[1])) !== null) {
    const cm = new RegExp('[' + CIRCLED + ']').exec(lm[2]);
    if (!cm) continue;
    suiteSeq[lm[1]] = (lm[1] in suiteSeq) ? null : cm[0];
  }
}
const numPages = [], numMismatch = [];
demoFiles.forEach(f => {
  if (!(f in suiteSeq)) return;
  const body = fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8');
  const nm = /（(?:run-all )?套件 ([①-⑳])）/.exec(body);
  if (!nm) return;
  numPages.push(f);
  if (suiteSeq[f] === null) return;                       // 一页多套件：不比对
  if (suiteSeq[f] !== nm[1]) numMismatch.push(f + ' 注释 ' + nm[1] + ' vs 实际 ' + suiteSeq[f]);
});
check('页面内"套件 ⑫"注释与实际次序一致（自检 ≥5 页）',
  numPages.length >= 5 && numMismatch.length === 0,
  numMismatch.length ? numMismatch.join('；') : numPages.length + ' 页已核对');

/* 各页声明条数：优先字面量；少数页用 `CASES.length * 8` / `PAGES.length * 2 + 1` 这类表达式。
   ★ 解析不了就返回 null（调用方判失败），**绝不静默跳过** —— 否则"预期条数"这一侧
   一旦解析退化，"两边一致"就永远成立。数组元素用受限求值（只求值仓库内自己的数组字面量），
   这样字符串数组（如 PAGES）与对象数组（如 CASES）都能正确计数。 */
const demoPageExpect = {};
function pageExpect(file) {
  const body = fs.readFileSync(path.join(ROOT, 'demo', file), 'utf8');
  const m = /__TEST\.expect\(([^)]*)\)/.exec(body);
  if (!m) return null;
  const expr = m[1].replace(/\/\/.*$/, '').trim();
  if (/^\d+$/.test(expr)) return Number(expr);
  const am = /^([A-Za-z_$][\w$]*)\.length\s*\*\s*(\d+)(?:\s*\+\s*(\d+))?$/.exec(expr);
  if (!am) return null;
  const name = am[1], mul = Number(am[2]), add = am[3] ? Number(am[3]) : 0;
  const arrSrc = new RegExp('var\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];').exec(body);
  if (!arrSrc) return null;
  let arrLen = 0;
  try {
    /* ★ 这里必须是**真换行** '\n'，不能写成 '\\n' —— 后者在源码层面是"反斜杠 + n"两个字符，
       拼进函数体后 `return [ ... \n];` 里那个反斜杠会让整段成为语法错误，
       于是**所有表达式型条数解析一律返回 null**。本次就是这样：rot（`CASES.length * 8`）
       与 responsive（`PAGES.length * 2 + 1`）两页被判"解析不了"。
       教训：写"拼接出源码再求值"的代码，改完必须**真的跑一次**看它是否成功求值；
       在别处手敲一份"看起来一样"的版本复现通过，恰恰会掩盖这种转义级差异。 */
    arrLen = new Function('return [' + arrSrc[1] + '\n];')().length;
  } catch (e) { return null; }
  return arrLen > 0 ? arrLen * mul + add : null;
}
uniqueSuite.forEach(f => { demoPageExpect[f] = pageExpect(f); });
const unresolved = uniqueSuite.filter(f => demoPageExpect[f] == null);
check('每个套件页的期望条数都能解析（无静默跳过）', unresolved.length === 0, unresolved.join(', '));

/* README 测试段的表格行（框架集成页现已进表格、同样参与对账；
   行内条数取**第一个** `N 条`，所以描述里不要出现更早的"…条"字样） */
const readmeTest = sliceSection(README, '## Demo 与测试');
const readmeRows = readmeTest.split('\n')
  .map(l => /^\|\s*`([^`]+\.html)`\s*\|(.*)\|?\s*$/.exec(l))
  .filter(Boolean)
  .map(mm => ({ file: mm[1], rest: mm[2] }));
const docPages = readmeRows.map(r => r.file);
check('README 表格列出全部套件页', uniqueSuite.every(f => docPages.includes(f)),
  '缺：' + uniqueSuite.filter(f => !docPages.includes(f)).join(', '));
check('README 表格没有多余的套件页', docPages.every(f => uniqueSuite.includes(f)),
  '多：' + docPages.filter(f => !uniqueSuite.includes(f)).join(', '));

const countMismatch = [];
readmeRows.forEach(r => {
  const cm = /(\d+)\s*条/.exec(r.rest);
  const want = demoPageExpect[r.file];
  if (!cm) countMismatch.push(r.file + '（文档未写条数）');
  else if (Number(cm[1]) !== want) countMismatch.push(r.file + '（文档 ' + cm[1] + ' vs 实际 ' + want + '）');
});
check('README 每页条数 == 该页 __TEST.expect()', countMismatch.length === 0, countMismatch.join('；'));

/* run-all 在跑完所有套件后还会做跨套件对账（hash/页数一致），条数由常量声明 ——
   解析它才能算出"总条数"，否则 README 里的总数就成了只能靠人记得同步的魔法数字。 */
const aggConst = /var AGGREGATE_ASSERTIONS = (\d+);/.exec(runAll);
const aggAssertions = aggConst ? Number(aggConst[1]) : null;
check('从 run-all 解析出 AGGREGATE_ASSERTIONS（自检）',
  aggAssertions != null && aggAssertions >= 1, String(aggAssertions));

const totalExpect = suiteFiles.reduce((a, f) => a + (demoPageExpect[f] || 0), 0) + (aggAssertions || 0);
const suiteCountDoc = /共\s*(\d+)\s*个套件/.exec(readmeTest);
const sampleDoc = /输出\s*`(\d+)\s*个套件\s*·\s*(\d+)\/(\d+)\s*条断言/.exec(readmeTest);
check('README「共 N 个套件」== run-all 实际条目数',
  !!suiteCountDoc && Number(suiteCountDoc[1]) === suiteFiles.length,
  suiteCountDoc ? suiteCountDoc[1] + ' vs ' + suiteFiles.length : '未找到');
/* 不校验样例里的耗时（55.4s）——那是每次跑都变的，写进文档只为给个量级 */
check('README 样例输出「N 个套件 · M/M 条断言」== 实际值',
  !!sampleDoc && Number(sampleDoc[1]) === suiteFiles.length
    && Number(sampleDoc[2]) === totalExpect && Number(sampleDoc[3]) === totalExpect,
  sampleDoc ? sampleDoc[1] + ' 套件 · ' + sampleDoc[2] + '/' + sampleDoc[3] + ' 条 vs 实际 '
    + suiteFiles.length + ' 套件 · ' + totalExpect + ' 条' : '未找到');

/* ---------- 8. 测试页自身响应式 ---------- */
section('8. 测试页自身响应式（窄视口可用性）');
/* 背景：被测库做了窄容器自适应，装它的测试页却从没人管 —— 16 个页面都没有 viewport meta，
   手机上按 980px 虚拟宽度整体缩略，长 hash 再把日志撑出屏幕。
   这里做**静态**检查（真几何由 demo/responsive-pages-test.html 套件在 370px 下实测）。 */
const allDemoPages = fs.readdirSync(path.join(ROOT, 'demo')).filter(f => f.endsWith('.html')).sort();
const noVp = allDemoPages.filter(f => {
  const s = fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8');
  const m = /<meta\s+name=["']viewport["']\s+content=["']([^"']*)["']/i.exec(s);
  return !m || !/width=device-width/i.test(m[1]);
});
check('全部 demo 页都有 width=device-width 的 viewport meta', noVp.length === 0,
  noVp.length ? '缺：' + noVp.join(', ') : allDemoPages.length + ' 个页面已检查');

const harness = fs.readFileSync(path.join(ROOT, 'demo', 'test-harness.js'), 'utf8');
const mqIdx = harness.indexOf('@media (max-width:640px){');
const padIdx = harness.indexOf('body{padding:8px');
check('harness 提供窄视口基准样式（一处生效、全部测试页受益）',
  mqIdx >= 0 && /injectResponsiveBase/.test(harness), 'injectResponsiveBase()');
/* 反例保护：窄屏样式若被挪出媒体查询，窄屏是好了，但 run-all 用 1000px iframe 驱动各页时
   会连带改变被测页面的布局/尺寸 —— 那会让所有套件过往的结论都失去可比性。 */
check('窄视口样式被限制在媒体查询内（不污染 1000px 的回归环境）',
  mqIdx >= 0 && padIdx > mqIdx, 'body padding 覆盖出现在媒体查询之后');

const harnessUsers = allDemoPages.filter(f =>
  fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8').includes('test-harness.js'));
check('测试页通过 harness 继承窄视口样式（自检 ≥15 页）', harnessUsers.length >= 15,
  harnessUsers.length + ' 个页面引用了 harness');

const respPage = fs.readFileSync(path.join(ROOT, 'demo', 'responsive-pages-test.html'), 'utf8');
const respListed = (respPage.match(/'[a-z0-9-]+\.html'/g) || []).length;
check('响应式套件确实列出了代表页（自检 ≥5 页）', respListed >= 5, respListed + ' 页');

/* 派发**真实指针事件**的套件必须过 __TEST.waitForLayout() 门禁。
   原因：库的 `_onPointerDown` 第一句是 `if (!this._displayW || !this._displayH) return;` ——
   从"文档加载完"到"布局完成(rAF/ResizeObserver)"之间的点击会被**静默丢弃**（不抛错、不留痕）。
   代价实测过：index 套件只等 getTotalPages()>0，完整 run-all 里 **4 次挂 1 次**
   （⑫ 报"点击后签章未进 JSON"超时），而单独重复跑 8/8 全过 —— 典型的"负载相关偶发"。
   只等文档就绪不足以防住它，靠 sleep 猜时间也不可靠（⑨ 原先就是 sleep(140)）。
   所以把它固化成机器约束：**新页面只要派发了指针事件，就必须带门禁**。 */
const pointerPages = allDemoPages.filter(f =>
  fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8').includes('new PointerEvent'));
const noGate = pointerPages.filter(f =>
  !fs.readFileSync(path.join(ROOT, 'demo', f), 'utf8').includes('waitForLayout'));
check('派发指针事件的套件都过了布局就绪门禁（自检 ≥4 页）',
  pointerPages.length >= 4 && noGate.length === 0,
  noGate.length ? '缺门禁：' + noGate.join(', ') : pointerPages.length + ' 页已检查');
check('harness 导出 waitForLayout 门禁原语', /waitForLayout:\s*function/.test(harness));

/* ---------- 汇总 ---------- */
console.log('\n=== 文档一致性：' + passed + '/' + (passed + failed) + ' 通过 ===');
if (failed) { console.log('（' + failed + ' 项不一致，请修正文档或代码）'); process.exit(1); }
