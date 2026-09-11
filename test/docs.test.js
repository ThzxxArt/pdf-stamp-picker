#!/usr/bin/env node
/*!
 * 文档一致性检查（D7 根治）
 *
 * 为什么需要它：
 *   历史上反复出现"代码改了、文档没跟上"（README 写 19 个构造选项实际 29 个、
 *   写 14 个事件实际 15 个、d.ts 缺新增选项/方法）。手工核对必然再次漂移，
 *   因此把"文档 vs 实现"变成可自动执行的断言。
 *
 * 检查项：
 *   1. 版本号四处一致：库内 VERSION / package.json / 模块导出 / demo 缓存戳
 *   2. 构造选项：源码 defaults 键 ∪ {pdfjs} == README 声明数 == README 表格项 == d.ts 声明项
 *   3. 事件：源码实际 emit 的名字 == README 声明数 == README 表格项
 *   4. 公开方法：源码 prototype 上的公开方法 ⊆ d.ts 声明
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'pdf-stamp-picker.js'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const DTS = fs.readFileSync(path.join(ROOT, 'pdf-stamp-picker.d.ts'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  ✅ ' + name + (detail ? ' — ' + detail : '')); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------- 1. 版本号 ---------- */
section('1. 版本号一致性');
const m = SRC.match(/var VERSION = '([^']+)'/);
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
const evRe = /\._emit\('([a-zA-Z]+)'/g;
while ((km = evRe.exec(SRC))) events.add(km[1]);
const evFallback = /this\._emit\(\s*'([a-zA-Z]+)'/g;
while ((km = evFallback.exec(SRC))) events.add(km[1]);

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

/* ---------- 汇总 ---------- */
console.log('\n=== 文档一致性：' + passed + '/' + (passed + failed) + ' 通过 ===');
if (failed) { console.log('（' + failed + ' 项不一致，请修正文档或代码）'); process.exit(1); }
