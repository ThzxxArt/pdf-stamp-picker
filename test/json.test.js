// v4 单元测试：JSON 按用户分组结构 / 多用户多签章归属 / 扁平版兼容 / 旋转归一化 / 本地候选探测
const assert = require('assert');
const PdfStampPickerModule = require('/var/minis/workspace/pdf-stamp-picker/pdf-stamp-picker.js');
const { _internals, version } = PdfStampPickerModule;

assert.strictEqual(version, '4.2.3');

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

console.log('=== v4 单测全部通过（按用户分组/多用户多签章/扁平兼容/无图片/本地候选探测） ===');
