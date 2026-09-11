# PdfStampPicker

纯 JavaScript **PDF 电子签章坐标选择器** —— 单文件、零依赖、UMD 通用模块。

> 📌 **定位**：这是**签章点坐标选择器**，不是盖章渲染器。输出签章位置的坐标 + 归属用户，**默认不输出图片**。页面上的公章图只是拖放定位的视觉载体，放置后显示为带用户颜色的占位框。
>
> 📦 **真实项目集成**（AngularJS / Vue2 / Vue3 / React / 原生）请直接看 [INTEGRATION.md](INTEGRATION.md)，含完整组件代码、CORS 排查、移动端与样式隔离。
>
> 🛡️ **项目铁律（长期维护约束）**：① **永远保持单文件**——库本体始终是 1 个 `pdf-stamp-picker.js`（UMD），不拆分、不引入构建产物；② **除 pdf.js 外零依赖**——唯一外部依赖是 pdf.js（纯画布模式连它都不需要），不引入任何框架/图标库/字体/图片资源/外部 URL，CSS/图标/公章全部内联（离线可用）。

---

## 目录

- [特性亮点](#特性亮点)
- [安装](#安装)
- [快速开始](#快速开始)
- [三种使用方式](#三种使用方式)
- [加载 PDF](#加载-pdf)
- [坐标选择模式](#坐标选择模式)
- [签署方管理](#签署方管理)
- [JSON 输出与导入](#json-输出与导入)
- [对接第三方签章接口](#对接第三方签章接口)
- [配置](#配置)
- [API 参考](#api-参考)
- [坐标约定](#坐标约定)
- [浏览器兼容](#浏览器兼容)
- [项目结构](#项目结构)
- [Demo 与测试](#demo-与测试)

---

## 特性亮点

**核心能力**
- 🖊️ **默认签章模式**：点击即放章，章固定大小 + 边界间距可配，定位/框选立即直观反馈
- 📄 **统一加载**：File / ArrayBuffer / 静态 URL / 文件流接口 / pdfjs proxy，支持进度、中止、文件哈希
- 👥 **多签署方**：按用户分组、动态增删、签章点按用户着色归属

**数据输出**
- 📦 **JSON 按用户分组**（`users[].stamps[]`），天然对应第三方签章接口模型
- 🔐 **document.hash**：PDF SHA-256 文件指纹（Web Crypto 优先 + 库内纯 JS 兜底，零依赖，内网 HTTP 同样可用，防篡改/验签）
- 🔄 **导入反显**（`importJSON`）+ 可选含图导出（`toJSON({ includeImage })`）

**体验**
- ⚡ **一键弹窗**：`openModal()` 免写容器/样式，宽高/模式/校验/含图全可配
- 🧰 **工具栏可配置**：按钮按需隐藏，容器与弹窗行为一致
- ↩️ **撤销/重做**（50 步）+ 序号角标 + 重叠警告 + 备注编辑 + 方向键微调

**环境友好**
- 📶 **内网/离线可用**：自动探测本地 `vendor/`，严格 MIME 环境自动 fetch+Blob 兜底
- 🌏 **中文 PDF 不乱码**：自动探测本地 cMaps
- 🕰️ **旧浏览器自动兼容**：polyfill + worker 源码注入，Edge 90 可用
- 🧩 **零框架零依赖**：纯原生 JS + Canvas + 注入 CSS，除 pdf.js 外无任何外部资源

---

## 安装

**方式一：浏览器 `<script>` 直接引入**

```html
<script src="pdf-stamp-picker.js"></script>
<script>
  // 全局 window.PdfStampPicker 可用
</script>
```

**方式二：npm**

```bash
npm install pdf-stamp-picker
```

```js
// ESM
import PdfStampPicker from 'pdf-stamp-picker';

// CommonJS
const PdfStampPicker = require('pdf-stamp-picker');
```

> 库是 UMD 模块，同时支持 script 全局、ESM `import`、CommonJS `require`、AMD。

---

## 快速开始

宿主只需**一个容器元素**，库自动注入全部 HTML/CSS、自动加载 pdf.js、自动生成内置红色公章（公章上的名字 = 当前用户名）。

```html
<div id="stage" style="width:100%;height:600px"></div>
<script src="pdf-stamp-picker.js"></script>
<script>
  const picker = new PdfStampPicker('#stage', {
    users: [
      { id: 'a', name: '甲方', color: '#4285f4' },
      { id: 'b', name: '乙方', color: '#ea4335' }
    ]
    // 不传 mode → 默认签章模式（点击即放章）
  });

  // 统一加载：本地 File / URL / 文件流接口 都行
  await picker.load('https://example.com/contract.pdf');

  picker.on('stampadd', () => {
    console.log(picker.toJSON());   // 分组 JSON（默认不含图）
  });
</script>
```

---

## 三种使用方式

### 1. 容器模式（嵌入式，最灵活）

把选择器嵌入宿主页面的某个容器，宿主控制布局：

```js
const picker = new PdfStampPicker('#stage', {
  users: [{ id: 'a', name: '甲方' }, { id: 'b', name: '乙方' }],
  mode: 'stamp',
  zoom: 'fit-width'
});
await picker.load('contract.pdf');
```

### 2. 弹窗模式（一键，最省事）

页面上放一个"去签章"按钮，点击弹出选择器，确认后拿 JSON——宿主不写任何容器/样式：

```js
const json = await PdfStampPicker.openModal({
  source: 'https://api.example.com/pdf/contract/123',  // 或 File / ArrayBuffer / {url,headers}
  title: '设置各公司签章位置',
  users: [{ id: 'a', name: '甲方' }, { id: 'b', name: '乙方' }],
  width: 900,             // 数字=px，或 '90%' 字符串；默认 min(94vw,1180px)
  height: 700,            // 数字=px，或 '70%'；默认 min(90vh,820px)
  mode: 'stamp',          // 弹窗坐标选择模式（默认 stamp / point / rect）
  requireStamp: true      // 必须有签章点才能确认
});

if (json) {
  await submitToEsign(json);   // json.users[].stamps[]
} else {
  // 用户取消
}
```

**回显已有签章**：打开弹窗时传入之前导出的 JSON，自动回显签章点与公章图，可继续编辑后确认：

```js
const json = await PdfStampPicker.openModal({
  source: 'https://api.example.com/pdf/123',
  json: savedJson,        // toJSON() / toFlatJSON() 的输出
  requireAllUsers: true   // 校验每个签署方至少一个签章点
});
// 确认返回：savedJson 的签章 + 弹窗内新加的，全部合并
```

**弹窗完整参数**：

| 参数 | 说明 |
|---|---|
| `source` | PDF 来源（同 `load()`，见下） |
| `json` | 已有签章 JSON，打开后回显（未传 `users` 时自动用 json 里的签署方） |
| `title` / `confirmText` / `cancelText` | 标题 / 确认按钮文案 / 取消按钮文案 |
| `users` / `currentUser` | 签署方列表 / 当前用户 |
| `width` / `height` | 弹窗尺寸（数字=px 或 CSS 字符串） |
| `mode` | 坐标选择模式（优先级高于 `pickerOptions.mode`） |
| `requireStamp` | 至少 1 个签章点才能确认 |
| `requireAllUsers` | **每个签署方**至少 1 个签章点（优先于 `requireStamp`，缺哪个提示哪个） |
| `includeImage` | 确认返回的 JSON 含章图 dataURL（自包含） |
| `closeOnBackdrop` | 点击遮罩是否关闭 |
| `onConfirm(json)` | 确认回调，可返回 Promise 阻止关闭（如先提交后端） |
| `onCancel()` | 取消回调 |
| `pickerOptions` | **透传给内部选择器**的所有构造选项（`stampMargin`/`toolbar`/`theme` 等） |

### 3. 纯画布模式（宿主渲染，零 PDF 依赖）

PDF 由宿主自行渲染（图片转 canvas、服务端渲染图、在线合同模板等），库只负责签章坐标——**不需要 pdf.js**：

```js
const canvas = await renderMyPage();   // 宿主任意方式渲染
picker.setPage({
  canvas,              // 已渲染的 canvas（内部分辨率不限）
  width: 595.28,       // PDF 页面宽 (pt)
  height: 841.89,      // PDF 页面高 (pt)
  rotation: 0,         // 页面旋转（可选，自动补偿）
  pageNumber: 1,       // 页码（可选）
  totalPages: 3,       // 总页数（可选）
  name: '合同.pdf'     // 文档名（可选，进 JSON）
});
```

---

## 加载 PDF

### source 支持 5 种

| 来源 | 写法 | 内部实现 |
|---|---|---|
| 本地上传 | `picker.load(file)`（File 对象） | `file.arrayBuffer()` |
| 字节流 | `picker.load(arrayBuffer \| uint8Array)` | pdf.js `{data}` |
| 远程静态地址 | `picker.load('https://x.com/a.pdf')` | pdf.js 原生流式（支持大文件 Range） |
| 文件流接口 | `picker.load({ url, method:'POST', headers:{Authorization}, body })` | fetch 取字节（支持鉴权头/流接口） |
| pdfjs proxy | `picker.load(pdfDoc)` | 直接使用 |

### pdf.js 加载策略

加载优先级：**传入 `pdfjs` 实例 > 全局 `window.pdfjsLib` > 配置 `pdfjsUrl` > 自动探测本地 > CDN 兜底**。

> ⚠️ **v4.8.24 起默认 `pdfjsUrl` 为 `null`**（不再是 CDN 地址）——保证自动探测本地 `vendor/` 优先，全部失败才回退 CDN。这是内网/离线可用的关键前提。

零配置时自动探测本地路径（按顺序）：
1. 库文件同目录 `vendor/pdf.min.js`
2. 宿主页面同目录 `vendor/pdf.min.js` / `../vendor/pdf.min.js` / `libs/pdf.min.js`

worker 自动按 `pdf.min.js → pdf.worker.min.js` 规则推断。

### 内网 / 离线部署

把 `pdf-stamp-picker.js` 和 `vendor/`（`pdf.min.js` + `pdf.worker.min.js` + `cMaps/`）放一起，**离线/内网环境零配置可用**。

**严格 MIME 环境自动兜底（v4.8.23/4.8.24）**：内网服务器若对 `.js` 返回非标准 MIME（`text/html`）或加 `X-Content-Type-Options: nosniff`，浏览器 strict MIME checking 会拒绝执行 `<script>` 加载的 pdf.min.js、拒绝 `new Worker()` 加载的 worker。库对此**自动 fetch 源码 → Blob 执行**：

- `pdf.min.js`：script 标签失败 → 同 URL fetch 源码 → `Blob(type=application/javascript)` 执行
- `pdf.worker.min.js`：统一 fetch 源码 → 注入 polyfill → Blob URL 创建 worker（**对所有浏览器生效**）

> 因此内网只需保证 `vendor/` 三件套 **HTTP 200 可达**，无需纠结服务器 MIME 配置。
>
> **worker Blob 全局复用（v4.8.26 起）**：worker 源码固定，fetch+Blob 包装结果**跨实例全局缓存**（`_sharedWorkerBlob`）。多次打开/关闭弹窗（`openModal` → 取消/确认 → 再打开）不会重复 fetch，也不会因实例 `destroy()` 吊销 blob URL 导致后续实例的 `workerSrc` 悬空。**连续打开多个弹窗/反复开关弹窗均能正常加载 PDF**。

### 中文 PDF 离线不乱码（CMap）

中文合同 PDF 常用 GBK/UniGB 字体映射，pdf.js 默认从 CDN 拉取。库会**自动探测本地 `cMaps/` 目录**（库同目录或页面目录，放 pdf.js 官方 `cmaps/` 解压内容），找到即本地加载；也可显式配置：

```js
new PdfStampPicker('#stage', {
  cMapUrl: '/static/pdf/cMaps/'   // 显式指定（优先级高于自动探测）
});
```

### 进度与中止

- 加载时显示真实百分比进度（`PDF 加载中… 45%`），流接口/静态 URL 均支持
- `load(source, { signal })` 支持外部 AbortSignal 中止；切换文档/`destroy()` 自动中止旧加载
- 翻页/缩放自动 cancel 未完成的渲染任务；`destroy()` 释放 pdf.js 文档资源（防内存累积）

---

## 坐标选择模式

三种模式通过 `setMode()` 切换，或初始化/加载时指定：

```js
new PdfStampPicker('#stage', { mode: 'stamp' });        // ① 构造时指定
await picker.load('a.pdf', { mode: 'rect', pageNumber: 2 });  // ② 加载时指定（完成后自动切换）
PdfStampPicker.openModal({ source: '...', mode: 'point' });   // ③ 弹窗顶层指定
picker.setMode('stamp');                                 // ④ 运行时切换
```

### 🖊️ 签章模式（默认，`stamp`）

1. **点击 PDF 任意位置 → 章立即放置**（完整落定，数据即时提交）
2. 按住已放置的章可**拖动调整位置**（拖动中半透明跟手，松手落定）
3. 🛡️ **章大小固定**（`stampSize` 决定，默认 120px）——**不可缩放**：无缩放手柄、Ctrl+滚轮/双指均不缩放
4. 点击空白处可**连续放置**；所有签章点显示**序号角标**（①②③）
5. 🛡️ **全程不能拖出页面边界**，默认距边界留 `stampMargin`（默认 12px）间距
6. **滚轮 = 页面滚动**（不劫持），与浏览器习惯一致

> **公章名字跟随用户**：切到"乙方"再放置，公章自动变成"乙方"（内置 canvas 动态生成，零外部资源）。放置后每个签章点**快照自己的章图**，切换用户不影响已放置的章。

### ▭ 框选模式（`rect`）

拖动绘制矩形（`Shift` 锁正方形，`aspectRatio` 锁宽高比），完成后自动加入签章列表，**放置后立即显示选区框 + 手柄**。

### ◉ 点选模式（`point`）

单击放置锚点（双环 + 准星样式），可拖动移动，**点击后立即显示锚点**。

### 通用交互

- **选中/拖动**：点击已有签章点切换选中（选中外发光边框），拖拽移动；框选/点选选区带 8 向手柄缩放
- **撤销/重做**：工具栏按钮或 Ctrl+Z / Ctrl+Shift+Z（含删除、清空、移动、缩放）
- **备注编辑**：双击列表项内联编辑（`note` 字段）
- **重叠警告**：签章点与同页其他点重叠时 toast 警告 + `overlap` 事件（不阻止）
- **微调**：方向键移动（`Shift` 加速 10px），`Delete` 删除，`Esc` 取消拖动
- **列表面板**：按签署方分组显示（色点 + 数量），点击跳转选中，悬停删除；跨页保留各页签章

---

## 签署方管理

```js
const picker = new PdfStampPicker('#stage', {
  users: [
    { id: 'a', name: '甲方公司', color: '#4285f4' },
    { id: 'b', name: '乙方公司', color: '#ea4335' }
  ]
});

picker.addUser({ id: 'c', name: '丙方公司', color: '#34a853' });  // 动态添加
picker.removeUser('b');               // 移除乙方及其签章点（当前用户不可移除）
picker.setCurrentUser('c');           // 后续新增的签章归属丙方
```

- 每个签章点在页面上以**用户颜色**边框标识，列表按用户分组着色
- 切换用户后新放置的签章自动归属当前用户，公章名字随之更新
- `removeUser(id)` 移除签署方及其全部签章点

---

## JSON 输出与导入

### 输出结构（按用户分组）

```jsonc
{
  "document": {
    "name": "三方采购合同.pdf",
    "pages": 3,
    "currentPage": 1,
    "pageSize": { "width": 595.28, "height": 841.89, "unit": "pt" },
    "rotation": 0,
    "hash": "fa4f75211d968a4b5b6c232f32b604b2f915f83f732c5440c033f3b2a6f3f9ac",
    "hashAlgorithm": "SHA-256",
    "generatedAt": "2026-08-21T09:00:00.000Z"
  },
  "users": [
    {
      "user": { "id": "u1", "name": "甲方", "color": "#4285f4" },
      "stamps": [
        { "id": "s1", "page": 1, "x": 79.22, "y": 564.62, "width": 67.9, "height": 67.9, "unit": "pt", "rotation": 0, "note": "", "createdAt": "..." }
      ]
    },
    {
      "user": { "id": "u2", "name": "乙方", "color": "#ea4335" },
      "stamps": []   // 未设置签章点的签署方也保留（stamps 空数组）
    }
  ]
}
```

**要点**：
- 每个签署方的签章点坐标归在自己的 `user` 下，用户信息在外层只出现一次
- `document.hash`：PDF SHA-256 哈希（小写 hex 64 位，零依赖）。**hash 为 null 时字段会从 JSON 中省略（不是输出 null）**，所以「JSON 里看不到 hash」= 该场景拿不到字节或无法计算。三种情况对照：

  | 加载方式 | hash | 说明 |
  |---|---|---|
  | `File` / `ArrayBuffer` / `Uint8Array` | ✅ | 字节在手，直接算 |
  | `{ url, headers }` / `{ url, method }`（文件流接口、自定义头） | ✅ | 库自己 fetch 流式取字节并缓存 |
  | `load('a.pdf')` / `load({url:'a.pdf'})` 纯静态地址 | ❌ 无 | 走 pdf.js 原生流式（大文件/Range 友好），**无完整字节缓存** → 不输出 hash |

  需要纯 URL 场景也出 hash（v4.8.27 起）：构造时开 `hashUrl: true`，库会在 PDF 展示后**后台补请求一次该地址**算哈希（不阻塞加载），完成后触发 `hashready` 事件；调用方可用 `picker.getHash()` 等待结果：

  ```js
  const picker = new PdfStampPicker('#stage', { hashUrl: true });
  picker.on('hashready', ({ hash, hashAlgorithm }) => console.log('哈希就绪', hash));
  await picker.load('https://intranet.example.com/a.pdf');   // PDF 立即可见
  const hash = await picker.getHash();                       // 需要时再取（已就绪则立即返回）
  ```

  计算实现：优先 `crypto.subtle`（安全上下文最快）；**内网 HTTP（`http://192.168.x.x`）、`file://` 等【非安全上下文】下 `crypto.subtle` 不存在**，库会自动降级为**库内自带的纯 JS SHA-256**（v4.8.27 起；分块计算 + 让出主线程，大文件不卡 UI），结果与 Web Crypto/`sha256sum` 完全一致 —— 因此内网部署同样能拿到哈希，无需 HTTPS。
- 签章点默认**不含图片**（轻量）；`toJSON({ includeImage: true })` 可**包含章图 dataURL**（数据自包含）
- 扁平版 `toFlatJSON()`：`stamps[]` 每项内嵌 `user`，需要按签章点遍历时用
- 单用户查询：`getStampsByUser(userId)`

### 导入反显

```js
const json = picker.toJSON();                              // 轻量版（不含图）
const jsonWithImg = picker.toJSON({ includeImage: true }); // 含章图 dataURL（自包含）
await saveToServer(jsonWithImg);

// 另一处 / 之后回显
await picker.load('contract.pdf');
await picker.importJSON(jsonWithImg);
```

- **恢复签署方**：id/name/color 自动同步，缺失的自动添加
- **恢复签章点**：坐标/尺寸/页码/备注全部回显，可继续编辑
- **公章图反显**：签章点带 `image` → 显示该章图；无 image → 用内置公章按用户生成
- **两种结构都支持**：`users[]` 分组 / 扁平 `stamps[]`
- 导入整体作为**一步撤销**；自动跳转到第一个有签章点的页面

```js
picker.importJSON(json, { replace: true });  // replace=false 时不清空现有签章
```

---

## 对接第三方签章接口

`toJSON()` 的结构天然对应主流电子签 API 的 `signers[].signAreas[]` 模型：

```js
const { document, users } = picker.toJSON();

// e签宝 / 法大大风格映射
const signFlow = {
  fileName: document.name,
  pages: document.pages,
  signers: users.map(g => ({
    signerId: g.user.id,
    signerName: g.user.name,
    signAreas: g.stamps.map(st => ({
      pageIndex: st.page,                    // 页码（1-based）
      posX: st.x, posY: st.y,                // PDF 坐标（pt，原点左下）
      width: st.width, height: st.height,    // 签章区域尺寸
      sealType: 'COMPANY_SEAL'
    }))
  }))
};
// POST /api/sign 发起签署流程
```

> 第三方接口若要求 mm 或右上原点，可换算：`mm = pt × 25.4/72`；右上原点 `y2 = pageHeight - y`。

---

## 配置

### 构造选项（全部 19 项）

| option | 默认 | 说明 |
|---|---|---|
| `mode` | `'stamp'` | 初始模式：`'stamp'` 签章（默认）/ `'point'` 点选 / `'rect'` 框选 |
| `zoom` | `'fit-width'` | 初始缩放：数字(1pt→N px) / `'fit-width'` 适应宽度 / `'fit-page'` 适应整页 |
| `aspectRatio` | `null` | 框选模式选区固定宽高比（w/h） |
| `minSize` | `4` | 选区最小尺寸（屏幕 px） |
| `showGrid` | `false` | 网格辅助线 |
| `controls` | `true` | 内置工具栏 + 列表面板（全 UI 内置） |
| `toolbar` | 全部显示 | 工具栏按钮显隐配置（见下）；传 `false` 全部隐藏 |
| `showList` | `true` | 签章列表面板 |
| `theme` | `'dark'` | `'dark'`（深色 viewer）/ `'light'`（浅色），背景/工具栏/列表联动 |
| `dpi` | `96` | px 单位换算参考（影响输出 px 字段） |
| `users` | 默认用户 | `[{id, name, color}]` 签署方列表 |
| `currentUser` | 第一个用户 | 当前签章用户 id |
| `allowMulti` | `true` | 允许多签章点（false 时新放置清空旧点） |
| `keepSelectionOnPageChange` | `false` | 翻页时是否保留当前选区/选中态 |
| `stampImage` | 内置公章 | 可选自定义签章图（URL/dataURL/File/canvas；不配则内置公章按用户名生成） |
| `stampSize` | `120` | 签章图基准尺寸 px（章固定大小，不可运行时缩放） |
| `stampMargin` | `12` | 签章距页面边界最小间距 px（0=紧贴；放置/拖动/键盘移动均生效） |
| `minStampSize` / `maxStampSize` | `24` / `480` | ⚠️ 已废弃（v4.4.3 起章固定大小，不再生效） |
| `pdfjsUrl` | 自动探测 | 显式指定 pdf.js 地址（默认自动探测本地 vendor → CDN 兜底） |
| `cMapUrl` | 自动探测 | 中文 PDF 字体映射目录（显式 > 自动探测本地 cMaps/ > pdf.js 默认 CDN） |
| `compatCheck` | `false` | 旧浏览器兼容：默认 `false` 自动兼容（polyfill 兜底，不提示）；`true` 检测到原生缺失时提示升级并拒绝加载 |
| `pdfjs` | — | 已有 pdfjsLib 实例（免重复加载，优先级最高） |

### 工具栏配置（弹窗/容器通用）

```js
// 精简工具栏：只留模式切换 + 翻页
new PdfStampPicker('#stage', {
  toolbar: { zoom: false, copyJson: false, grid: false, undoRedo: false,
             panel: false, clear: false, url: false, open: false, stampThumb: false, users: false }
});

// 全部隐藏（宿主完全自绘 UI）
new PdfStampPicker('#stage', { toolbar: false });
```

| 配置键 | 控制 |
|---|---|
| `modes` | 定位/框选/签章 模式按钮组 |
| `stampThumb` | 公章缩略图 |
| `open` / `url` | 打开本地文件 / URL 加载 |
| `users` | 签署方下拉 |
| `copyJson` | 复制 JSON |
| `zoom` | 缩小/放大/适宽/适页 |
| `pageNav` | 上一页/页码/下一页 |
| `grid` | 网格辅助线 |
| `undoRedo` | 撤销/重做 |
| `panel` | 列表折叠 |
| `clear` | 清除签章 |

---

## API 参考

### 实例方法

| 类别 | 方法 | 说明 |
|---|---|---|
| **加载** | `load(source, {pageNumber, mode, signal})` | 统一入口：5 种 source；支持加载后切模式、AbortSignal 中止 |
| | `loadPDF(source, opts)` | 兼容旧名（同 `load`） |
| | `setPage(meta)` | 纯画布模式：`{canvas, width, height, rotation, pageNumber, totalPages, name}` |
| | `gotoPage(n)` | 翻页（Promise），自动补偿旋转；错误正确传播（不掩盖真实失败原因） |
| **缩放** | `setZoom(z)` / `getZoom()` | 数字 / `'fit-width'` / `'fit-page'`；获取当前缩放 |
| | `fitWidth()` / `fitPage()` | 快捷适应 |
| **模式** | `setMode('point'\|'rect'\|'stamp')` | 切换选择模式 |
| | `setAspectRatio(ratio)` | 框选宽高比锁定（null 解除） |
| | `setShowGrid(bool)` | 网格辅助线 |
| **签章图** | `setStampImage(src)` | 换签章图：File/URL/dataURL/canvas → Promise |
| | `getStampImage()` | 当前签章图 `{src, name, width, height}` |
| **用户** | `setCurrentUser(id)` / `getCurrentUser()` | 切换/获取当前签署方（公章名字随之更新） |
| | `addUser({id,name,color})` | 添加签署方（工具栏下拉同步） |
| | `removeUser(id)` | 移除签署方及其签章点（不可移除当前用户） |
| **签章点** | `addStamp({x,y,width,height,page,userId,note})` | 程序化添加签章点（PDF 坐标）→ 返回 stamp |
| | `getStamps()` | 全部签章点数组（扁平，带 user） |
| | `getStampsByUser(userId)` | 某签署方的签章点 |
| | `getActiveStamp()` / `getSelection()` | 当前选中签章点 / 活动选区（PDF 坐标） |
| | `selectStamp(id)` | 选中签章点（自动跳转所在页） |
| | `removeStamp(id)` | 删除指定签章点 |
| | `removeSelection()` | 删除当前选中（无选中则清空临时选区） |
| | `clear()` / `clearAll()` | 清空全部签章点 |
| **JSON** | `toJSON({includeImage})` | 按用户分组完整 JSON；`includeImage:true` 含章图 |
| | `toFlatJSON({includeImage})` | 扁平版（stamps[] 内嵌 user） |
| | `importJSON(json, opts)` | 从 JSON 反显（`users[]` 或 `stamps[]` 均可） |
| | `copyJSON()` | 复制 JSON 到剪贴板（内置 toast） |
| **撤销** | `undo()` / `redo()` | 撤销/重做（Ctrl+Z / Ctrl+Shift+Z，上限 50 步） |
| **面板** | `toggleList()` | 折叠/展开签章列表面板 |
| **导出** | `exportImage(opts)` | 导出当前页+签章布局为 PNG：`{scale=2, includePdf=true, includeUi=false}`；`includePdf:false` 得透明底章图 |
| **坐标** | `screenToPdf(x,y)` / `pdfToScreen(x,y)` | 屏幕 px ↔ PDF pt（含旋转补偿） |
| **事件** | `on(type, fn)` / `off(type, fn)` | 事件订阅/退订（链式） |
| **销毁** | `destroy()` | 移除 DOM、监听、RAF（必调防泄漏） |

### 静态成员

| 成员 | 说明 |
|---|---|
| `PdfStampPicker.openModal(config)` | 一键弹窗 → Promise\<JSON \| null\> |
| `PdfStampPicker.loadPdfJs(url)` | 预加载 pdf.js（指定地址） |
| `PdfStampPicker.loadPdfJsAuto()` | 自动探测加载（本地 vendor → CDN 兜底） |
| `PdfStampPicker.version` | 库版本号字符串 |

### 事件（全部 14 个）

| 事件 | 触发时机 | payload |
|---|---|---|
| `ready` | 初始化完成 | `{}` |
| `change` | 选区变化（拖动中/微调） | 当前选区 |
| `select` | 选择完成（松手放置） | 签章点对象 |
| `clear` | 全部清空 | `{}` |
| `pagechange` | 翻页完成 | `{page, totalPages, width, height, rotation}` |
| `zoomchange` | 缩放变化 | `{zoom}` |
| `stampadd` | 新增签章点 | 签章点对象 |
| `stampremove` | 删除签章点 | 被删对象 |
| `stampchange` | 签章点被移动/缩放 | 更新后对象 |
| `stampselect` | 选中签章点 | 签章点对象 |
| `stampimage` | 签章图更换 | `{src, name, width, height}` |
| `import` | JSON 导入完成 | `{count, users}` |
| `overlap` | 签章点重叠检测 | `{stamp, overlaps:[{id,userId,name}]}` |
| `error` | 加载/运行错误 | `{message}` |

---

## 坐标约定

- **屏幕坐标**：CSS px，原点页面左上角，Y 向下
- **PDF 坐标（输出）**：pt（1/72 inch），原点页面左下角（含 CropBox 偏移），Y 向上
- 自动补偿页面旋转（0/90/180/270），`rotation` 字段保留原始旋转值

---

## 浏览器兼容

- **现代浏览器**：Chrome/Edge/Firefox/Safari 近两个大版本（Pointer Events + ResizeObserver，无 RO 自动回退）
- **旧浏览器（Edge 90 / Chrome 97 及更旧）**：pdf.js 3.11 依赖多项现代 API（`Array.at` 92+、`TypedArray.at` 92+、`structuredClone` 98+、`String.replaceAll` 85+、可选链等）。库**自动兼容**：注入 polyfill（含 TypedArray.at）+ **worker 源码注入**（fetch worker 文件 → 头部拼 polyfill → Blob 创建改造 worker），Edge 90 真能跑 pdf.js；worker 文件不可达时回退 fake worker。`compatCheck` 可配：**默认 `false` 自动兼容不提示**，`true` 才提示升级并拒绝加载。回归验证见 `demo/edge90-sim-test.html`（模拟删除原生 API 后默认正常渲染；`?strict=1` 验证升级提示）
- **worker fetch + Blob 加载对所有浏览器生效**（v4.8.24 起）：现代浏览器的 `new Worker()` 也会因内网 `nosniff`/错误 MIME 被拒，故 worker 统一走 fetch 源码 → Blob URL，天然绕开 strict MIME checking
- 无任何运行时依赖；pdf.js 3.11.174（内置本地可换）

---

## 项目结构

```
pdf-stamp-picker/
├── pdf-stamp-picker.js      # 库本体（单文件 ~128KB，零依赖）
├── pdf-stamp-picker.d.ts    # TypeScript 类型声明
├── package.json             # npm 包元数据（main/module/types/exports）
├── LICENSE                  # MIT
├── INTEGRATION.md           # 真实项目集成指南（AngularJS/Vue2/Vue3/React/原生）
├── README.md                # 本文档
├── demo/
│   ├── index.html           # 主 Demo（容器/纯画布/弹窗/导入JSON回显）
│   ├── angularjs-test.html  # AngularJS 1.8 集成测试页
│   ├── vue2-test.html       # Vue 2.7 集成测试页
│   ├── vue3-test.html       # Vue 3.4 集成测试页
│   ├── react-test.html      # React 18 集成测试页
│   ├── edge90-sim-test.html # Edge 90 兼容回归测试（?strict=1 验证升级提示）
│   ├── modal-retest.html   # 弹窗反复打开/取消回归测试（验证 worker blob 复用）
│   ├── hash-nonsecure-test.html # 哈希回归：安全上下文/内网HTTP纯JS兜底/纯URL补算 4 场景
│   ├── test.pdf             # 测试 PDF（3 页，含 /Rotate 90）
│   ├── eight-page.pdf       # 8 页测试 PDF（换文档验证）
│   ├── chinese-cid.pdf      # 中文 GBK CID 测试 PDF（验证 cMaps）
│   └── gen_*.py             # 测试 PDF 生成脚本
├── vendor/                  # pdf.js + 框架库（测试用；库零依赖铁律保持）
│   ├── pdf.min.js           # pdf.js 主库（320KB）
│   ├── pdf.worker.min.js    # 解析 worker（1.08MB）
│   ├── cMaps/               # 169 个字体映射（中文 PDF 离线不乱码）
│   └── angular/vue/react*.js # 框架库（仅测试页用）
└── test/
    ├── coords.test.js       # 坐标转换（4 旋转 × 7 点往返）
    └── json.test.js         # JSON 结构 / 多用户 / 探测 / 导入解析 / 哈希
```

---

## Demo 与测试

```bash
cd pdf-stamp-picker && python3 -m http.server 8899
# 打开 http://127.0.0.1:8899/demo/index.html
```

主 Demo 展示：容器模式（多用户多签章/三种模式/动态签署方/导入 JSON 回显）/ 纯画布模式 / 弹窗模式（确认校验）/ JSON 分组输出（含 document.hash）/ 工具栏配置。

框架集成测试页（均已实测运行）：`demo/angularjs-test.html`、`demo/vue2-test.html`、`demo/vue3-test.html`、`demo/react-test.html`。

回归测试页：`demo/edge90-sim-test.html`（Edge 90 兼容）、`demo/modal-retest.html`（弹窗反复打开/取消，验证 worker blob 复用不悬空）。

---

## License

MIT
