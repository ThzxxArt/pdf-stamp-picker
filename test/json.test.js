// v4 单元测试：JSON 按用户分组结构 / 多用户多签章归属 / 扁平版兼容 / 旋转归一化 / 本地候选探测
const assert = require('assert');
const PdfStampPickerModule = require('/var/minis/workspace/pdf-stamp-picker/pdf-stamp-picker.js');
const { _internals, version } = PdfStampPickerModule;

// 版本号不写字面量：以 package.json 为唯一真源（历史上硬编码导致每次发版都要手工同步多处）
assert.strictEqual(version, require('/var/minis/workspace/pdf-stamp-picker/package.json').version);

const { buildJSON, buildFlatJSON, genId, normalizeRotation } = _internals;

// --- normalizeRotation ---
assert.strictEqual(normalizeRotation(0), 0);
assert.strictEqual(normalizeRotation(90), 90);
assert.strictEqual(normalizeRotation(180), 180);
assert.strictEqual(normalizeRotation(270), 270);
assert.strictEqual(normalizeRotation(360), 0);
assert.strictEqual(normalizeRotation(-90), 270);
assert.strictEqual(normalizeRotation(45), 0);
assert.strictEqual(normalizeRotation(450), 90);

// --- genId 唯一性 ---
const ids = new Set();
for (let i = 0; i < 1000; i++) ids.add(genId());
assert.strictEqual(ids.size, 1000);

// --- 场景：三方合同，甲乙丙各有两个签章点 ---
const users = [
  { id: 'u1', name: '甲方', color: '#4285f4' },
  { id: 'u2', name: '乙方', color: '#ea4335' },
  { id: 'u3', name: '丙方', color: '#34a853' }
];
const stamps = [
  // 甲方：盖章区 + 骑缝
  { id: 's1', userId: 'u1', page: 1, x: 140.123, y: 540.456, width: 200, height: 90, rotation: 0, note: '公章', createdAt: 't1' },
  { id: 's2', userId: 'u1', page: 2, x: 300, y: 200, width: 60, height: 200, rotation: 90, note: '骑缝章', createdAt: 't2' },
  // 乙方：签字区
  { id: 's3', userId: 'u2', page: 1, x: 400, y: 300, width: 150, height: 70, rotation: 0, note: '', createdAt: 't3' },
  // 丙方：没签章点（应保留空组）
];
const doc = { docName: '三方采购合同.pdf', totalPages: 3, currentPage: 1, width: 595.28, height: 841.89, rotation: 0, offsetX: 0, offsetY: 0 };

const json = buildJSON(doc, stamps, users);

// 结构：users 数组 = 用户主维度
assert.strictEqual(json.users.length, 3, 'users 应包含全部签署方（含无签章点的丙方）');
assert.strictEqual(json.stamps, undefined, 'v4 不再有顶层 stamps 数组');

// 用户顺序与分组
assert.strictEqual(json.users[0].user.id, 'u1');
assert.strictEqual(json.users[0].user.name, '甲方');
assert.strictEqual(json.users[0].stamps.length, 2);
assert.strictEqual(json.users[1].user.id, 'u2');
assert.strictEqual(json.users[1].stamps.length, 1);
assert.strictEqual(json.users[2].user.id, 'u3');
assert.strictEqual(json.users[2].stamps.length, 0, '丙方无签章点也应出现在 users 中（stamps 空数组）');

// 甲方的签章点坐标正确（含四舍五入与旋转）
const u1s = json.users[0].stamps;
assert.strictEqual(u1s[0].x, 140.12);
assert.strictEqual(u1s[0].y, 540.46);
assert.strictEqual(u1s[0].width, 200);
assert.strictEqual(u1s[0].height, 90);
assert.strictEqual(u1s[0].note, '公章');
assert.strictEqual(u1s[1].page, 2);
assert.strictEqual(u1s[1].rotation, 90);
assert.strictEqual(u1s[1].note, '骑缝章');

// 签章点内不再重复嵌套 user 对象（用户信息在分组外层）
assert.strictEqual(u1s[0].user, undefined, '签章点坐标项不应重复包含 user');
assert.strictEqual(u1s[0].userId, undefined, '签章点坐标项不应包含 userId');

// 乙方的
assert.strictEqual(json.users[1].stamps[0].x, 400);
assert.strictEqual(json.users[1].stamps[0].user, undefined);

// 序列化往返
const roundtrip = JSON.parse(JSON.stringify(json));
assert.deepStrictEqual(roundtrip, json);

// --- 扁平版兼容 ---
const flat = buildFlatJSON(doc, stamps, users);
assert.strictEqual(flat.stamps.length, 3);
assert.deepStrictEqual(flat.stamps[0].user, { id: 'u1', name: '甲方', color: '#4285f4' });
assert.strictEqual(flat.stamps[1].rotation, 90);
assert.strictEqual(flat.stamps[2].user.id, 'u2');

// 未知用户 → user null
const flat2 = buildFlatJSON(doc, [{ id: 'x', userId: 'ghost', page: 1, x: 1, y: 2, width: 0, height: 0, rotation: 0, note: '', createdAt: '' }], users);
assert.strictEqual(flat2.stamps[0].user, null);

// --- 默认用户兜底 ---
const jsonNoUsers = buildJSON(doc, [{ id: 'a', userId: 'default', page: 1, x: 10, y: 20, width: 0, height: 0, rotation: 0, note: '', createdAt: '' }], []);
assert.strictEqual(jsonNoUsers.users.length, 1);
assert.strictEqual(jsonNoUsers.users[0].user.id, 'default');
assert.strictEqual(jsonNoUsers.users[0].stamps.length, 1);

// --- 图片信息不进 JSON（坐标选择器定位） ---
const withImg = buildJSON(doc, [{ id: 'b', userId: 'u1', page: 1, x: 1, y: 2, width: 3, height: 4, rotation: 0, note: '', createdAt: '', image: { src: 'data:...' } }], users);
assert.strictEqual('image' in withImg.users[0].stamps[0], false);

// --- v4.2: 本地 pdf.js 候选路径探测 ---
const { _localCandidates } = PdfStampPickerModule;
// 布局A: 库文件在 /libs/, 页面在 /apps/contract/ → 优先库目录 vendor/
const c1 = _localCandidates('https://a.com/apps/contract/index.html', 'https://a.com/libs/pdf-stamp-picker.js');
assert.deepStrictEqual(c1, [
  'https://a.com/libs/vendor/pdf.min.js',
  'https://a.com/apps/contract/vendor/pdf.min.js',
  'https://a.com/apps/contract/../vendor/pdf.min.js',
  'https://a.com/apps/contract/libs/pdf.min.js'
]);
// 布局B: 页面目录 URL(以 / 结尾) 不应被截断
const c2 = _localCandidates('https://a.com/apps/contract/', null);
assert.deepStrictEqual(c2, [
  'https://a.com/apps/contract/vendor/pdf.min.js',
  'https://a.com/apps/contract/../vendor/pdf.min.js',
  'https://a.com/apps/contract/libs/pdf.min.js'
]);
// 布局C: 带 query/hash 的页面 URL
const c3 = _localCandidates('https://a.com/apps/index.html?lang=zh#top', null);
assert.strictEqual(c3[0], 'https://a.com/apps/vendor/pdf.min.js');
// 去重: 库与页面同目录时 vendor 只出现一次
const c4 = _localCandidates('https://a.com/apps/index.html', 'https://a.com/apps/pdf-stamp-picker.js');
assert.strictEqual(c4.filter(p => p === 'https://a.com/apps/vendor/pdf.min.js').length, 1);

// --- v4.6: parseImportJSON 结构解析 ---
const { parseImportJSON } = PdfStampPickerModule._internals;

// users[] 分组结构
const p1 = parseImportJSON({
  users: [
    { user: { id: 'u1', name: '甲方' }, stamps: [{ id: 's1', x: 10, y: 20 }, { id: 's2', x: 30, y: 40 }] },
    { user: { id: 'u2', name: '乙方' }, stamps: [] }
  ]
});
assert.strictEqual(p1.users.length, 2);
assert.strictEqual(p1.stamps.length, 2);
assert.strictEqual(p1.stamps[0].userId, 'u1', '分组结构应注入 userId');
assert.strictEqual(p1.stamps[1].userId, 'u1');
assert.deepStrictEqual(p1.users[0], { id: 'u1', name: '甲方' });

// stamps[] 扁平结构（内嵌 user）
const p2 = parseImportJSON({
  stamps: [
    { id: 'f1', userId: 'x', x: 1, y: 2, user: { id: 'x', name: '丙方' } }
  ]
});
assert.strictEqual(p2.stamps.length, 1);
assert.strictEqual(p2.stamps[0].userId, 'x');
assert.deepStrictEqual(p2.users[0], { id: 'x', name: '丙方' });

// 异常结构
assert.throws(() => parseImportJSON({ foo: 1 }), /结构无法识别/);
assert.throws(() => parseImportJSON(null), /需要 JSON 对象/);

console.log('=== v4 单测全部通过（按用户分组/多用户多签章/扁平兼容/无图片/本地候选探测/导入解析） ===');

// --- v4.7.7: document.hash 输出 ---
const docWithHash = buildJSON({ docName: 'a.pdf', totalPages: 1, currentPage: 1, width: 100, height: 200, rotation: 0, offsetX: 0, offsetY: 0, hash: 'f597560249c4154c56cce201f40ad506dd8de378e723f89810c53d0306127b8b' }, [], []);
assert.strictEqual(docWithHash.document.hash, 'f597560249c4154c56cce201f40ad506dd8de378e723f89810c53d0306127b8b');
assert.strictEqual(docWithHash.document.hashAlgorithm, 'SHA-256');
// 无 hash 时不输出
const docNoHash = buildJSON({ docName: 'a.pdf', totalPages: 1, currentPage: 1, width: 100, height: 200, rotation: 0, offsetX: 0, offsetY: 0 }, [], []);
assert.strictEqual('hash' in docNoHash.document, false);

console.log('=== v4 单测全部通过（.../哈希输出） ===');

// --- v4.8.4: importJSON 无 image 时按签章点用户生成章图（不统一用当前用户章图） ---
// 纯逻辑验证: parseImportJSON 保持 userId 正确
const p3 = parseImportJSON({
  users: [
    { user: { id: 'u1', name: '甲方' }, stamps: [{ id: 'x1', x: 1, y: 2 }] },
    { user: { id: 'u2', name: '乙方' }, stamps: [{ id: 'x2', x: 3, y: 4 }] }
  ]
});
assert.strictEqual(p3.stamps[0].userId, 'u1');
assert.strictEqual(p3.stamps[1].userId, 'u2', '甲乙签章点 userId 应各自保持');

console.log('=== v4 单测全部通过（.../导入解析/哈希/按用户章图） ===');

// --- v4.8.5: toJSON includeImage 可选 ---
const withImgStamp = { id: 'i1', userId: 'u1', page: 1, x: 1, y: 2, width: 3, height: 4, rotation: 0, note: '', createdAt: '', image: { src: 'data:image/png;base64,AAA', name: '章.png', width: 100, height: 100 } };
const noImgOut = buildJSON({ docName: 'a', totalPages: 1, currentPage: 1, width: 1, height: 1, rotation: 0, offsetX: 0, offsetY: 0, includeImage: false }, [withImgStamp], users);
assert.strictEqual('image' in noImgOut.users[0].stamps[0], false, 'includeImage:false 不含图');
const withImgOut = buildJSON({ docName: 'a', totalPages: 1, currentPage: 1, width: 1, height: 1, rotation: 0, offsetX: 0, offsetY: 0, includeImage: true }, [withImgStamp], users);
assert.deepStrictEqual(withImgOut.users[0].stamps[0].image, { src: 'data:image/png;base64,AAA', name: '章.png', width: 100, height: 100 }, 'includeImage:true 含图');

console.log('=== v4 单测全部通过（.../按用户章图/含图导出） ===');

/* ==================== v4.9.6: cMaps 目录候选推导（D7 根治） ====================
 * 旧实现 `c.replace(/vendor\/pdf\.min\.js$/, 'cMaps/')` 只对以 vendor/pdf.min.js 结尾的候选生效；
 * _localCandidates 还会产出 libs/pdf.min.js、../vendor/pdf.min.js 等 → replace 匹配不上就**原样返回**，
 * 于是探测真的去 HEAD `libs/pdf.min.js78-EUC-H.bcmap`（必然 404）。
 * 这里把"每个候选都必须是一个**有意义的目录**"钉死成断言。
 */
const { _cmapCandidates } = PdfStampPickerModule;

// 布局A：库在 /libs/、页面在 /apps/contract/
const cm1 = _cmapCandidates(_localCandidates('https://a.com/apps/contract/index.html', 'https://a.com/libs/pdf-stamp-picker.js'));
assert.deepStrictEqual(cm1, [
  'https://a.com/libs/vendor/cMaps/',
  'https://a.com/apps/contract/vendor/cMaps/',
  'https://a.com/apps/contract/../vendor/cMaps/',
  'https://a.com/apps/contract/libs/cMaps/'
]);
// ★ 正确的那个必须排第一（探测是"首个 200 即停"，排在后面=白付前面的往返）
assert.strictEqual(cm1[0], 'https://a.com/libs/vendor/cMaps/', '库自己 vendor/ 下的 cMaps 必须最先探');

// ★ 核心断言（旧实现的病灶）：绝不能产出 "xxx.pdf.min.js78-EUC-H.bcmap" 这种拼接垃圾
assert.ok(cm1.every(u => /\/cMaps\/$/.test(u)), '每个候选都必须以 /cMaps/ 结尾：' + cm1.join(', '));
assert.ok(cm1.every(u => u.indexOf('.js') < 0), '候选里不允许残留 *.js（旧实现会把它当目录前缀）');

// 纯函数：不依赖网络/DOM，含去重；候选与 _localCandidates 一一对应（同目录项合并）
const cm2 = _cmapCandidates(_localCandidates('https://a.com/apps/index.html', 'https://a.com/apps/pdf-stamp-picker.js'));
assert.deepStrictEqual(cm2, [
  'https://a.com/apps/vendor/cMaps/',
  'https://a.com/apps/../vendor/cMaps/',
  'https://a.com/apps/libs/cMaps/'
]);
assert.strictEqual(cm2.length, _localCandidates('https://a.com/apps/index.html', 'https://a.com/apps/pdf-stamp-picker.js').length,
  '每个 pdf.min.js 候选恰好对应一个 cMaps 目录候选（不多不少）');

// query/hash 必须被剥掉（否则 HEAD 的 URL 带着 ?lang=zh）
assert.strictEqual(_cmapCandidates(['https://a.com/x/vendor/pdf.min.js?v=4.9.6#a'])[0], 'https://a.com/x/vendor/cMaps/');

// 边界：空输入 / 无斜杠 / 空项 → 返回空数组而不是抛错或产出垃圾
assert.deepStrictEqual(_cmapCandidates([]), []);
assert.deepStrictEqual(_cmapCandidates(null), []);
assert.deepStrictEqual(_cmapCandidates(['pdf.min.js', '', null]), []);

console.log('=== v4 单测全部通过（.../含图导出/cMaps 候选推导 D7） ===');
