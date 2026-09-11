#!/usr/bin/env node
/*!
 * 文档一致性检查（D7 根治）
 *
 * 为什么需要它：
 *   历史上反复出现"代码改了、文档没跟上"（README 写 19 个构造选项实际 29 个、
 *   写 14 个事件实际 15 个、d.ts 缺新增选项/方法）。手工核对必然再次漂移，
 *   因此把"文档 vs 实现"变成可自动执行的断言。
 *
 * 检查项（与代码里的 section() 一一对应，共 7 节）：
 *   1. 版本号一致：库内 VERSION / package.json / 模块导出 / 全部 demo 页缓存戳 / 页面上"显示给人看"的版本号
 *   2. 构造选项：源码 defaults 键 ∪ {pdfjs} == README 声明数 == README 表格项 == d.ts 声明项
 *   3. 事件：源码实际 emit 的名字 == README 声明数 == README 表格项
 *   4. 公开方法：源码 prototype 上的公开方法 ⊆ d.ts 声明
 *   5. README：实例方法表 / 静态成员表 == 源码实际公开成员（双向，含解析自检防假通过）
 *   6. INTEGRATION.md：第 12 章 API 参考 == 源码实际公开成员 ⨯ 事件（双向），
 *      且文内「当前版本」与 version 示例必须等于库版本
 *   7. README 测试段：表格页集合 == run-all 的 SUITE，各页条数 == 该页 __TEST.expect()，
 *      套件数/总条数 == 实际值
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

/* 各页声明条数：优先字面量；少数页用 `CASES.length * 8` 表达式（解析不了就判失败，不静默跳过） */
const demoPageExpect = {};
function pageExpect(file) {
  const body = fs.readFileSync(path.join(ROOT, 'demo', file), 'utf8');
  const m = /__TEST\.expect\(([^)]*)\)/.exec(body);
  if (!m) return null;
  const expr = m[1].replace(/\/\/.*$/, '').trim();
  if (/^\d+$/.test(expr)) return Number(expr);
  const am = /^([A-Za-z_$][\w$]*)\.length\s*\*\s*(\d+)$/.exec(expr);
  if (am) {
    const arr = new RegExp('var\\s+' + am[1] + '\\s*=\\s*\\[([\\s\\S]*?)\\n\\s*\\];').exec(body);
    if (!arr) return null;
    const n = (arr[1].match(/\{\s*\w+\s*:/g) || []).length;
    return n > 0 ? n * Number(am[2]) : null;
  }
  return null;
}
uniqueSuite.forEach(f => { demoPageExpect[f] = pageExpect(f); });
const unresolved = uniqueSuite.filter(f => demoPageExpect[f] == null);
check('每个套件页的期望条数都能解析（无静默跳过）', unresolved.length === 0, unresolved.join(', '));

/* README 测试段的表格行（框架集成页写在不带 `|` 的正文里，不参与对账） */
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

const totalExpect = suiteFiles.reduce((a, f) => a + (demoPageExpect[f] || 0), 0);
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

/* ---------- 汇总 ---------- */
console.log('\n=== 文档一致性：' + passed + '/' + (passed + failed) + ' 通过 ===');
if (failed) { console.log('（' + failed + ' 项不一致，请修正文档或代码）'); process.exit(1); }
