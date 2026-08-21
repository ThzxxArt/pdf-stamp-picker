# PdfStampPicker

纯 JavaScript **PDF 电子签章坐标选择器** —— 单文件、零依赖、UMD 通用模块（浏览器 script / ESM / CommonJS 均可使用）。

> 📦 **真实项目集成请直接看 [INTEGRATION.md](INTEGRATION.md)**（npm/原生/Vue/React 示例、CORS 排查、移动端、样式隔离）

> 🛡️ **项目铁律（长期维护约束）**：
> 1. **永远保持单文件** —— 库本体始终是 1 个 `pdf-stamp-picker.js`（UMD），不拆分、不引入构建产物
> 2. **除 pdf.js 外零依赖** —— 唯一外部依赖是 pdf.js（且可选：纯画布模式连它都不需要）；不引入任何框架、图标库、字体、图片资源、外部 URL；CSS/图标/公章全部内联（离线可用）

> ⚠️ 定位说明：这是**签章点坐标选择器**，不是真实盖章渲染器。输出的是签章位置坐标 + 归属用户，**不输出图片**。页面上的公章图只是拖放定位的视觉载体，放置后显示为带用户颜色的占位框。

v4.6 特性：**默认签章模式（点击即放章，章固定大小不越界）** · **JSON 按用户分组（users[].stamps[]，直接对接第三方签章接口）** · **JSON 导入反显（importJSON + 弹窗传 json 回显签章点/公章图）** · 多签章点 · 多用户动态管理 · 撤销/重做 · 一键弹窗（宽高/模式可配）· 统一加载（含进度/中止）· pdf.js 离线资源（cMaps 中文不乱码）· **零框架零依赖（纯原生 JS + Canvas + 注入 CSS）**。

## 快速开始（真实项目只需一个容器）

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
    console.log(picker.toJSON());   // 分组 JSON（输出不含图片，导入时可带 image 反显）
  });
</script>
```

> 库会自动注入全部 HTML/CSS、自动加载 pdf.js、自动生成**内置红色公章**（公章上的名字 = 当前用户名，切换用户自动更新）。宿主零样式代码。

### pdf.js 加载策略（v4.5 起）

加载优先级：**传入 `pdfjs` 实例 > 全局 `window.pdfjsLib` > 配置 `pdfjsUrl` > 自动探测本地 > CDN 兜底**。

零配置时自动探测本地路径（按顺序）：
1. 库文件同目录 `vendor/pdf.min.js`
2. 宿主页面同目录 `vendor/pdf.min.js` / `../vendor/pdf.min.js` / `libs/pdf.min.js`

全部找不到才回退 CDN（cdnjs）。所以项目里只要把 `pdf-stamp-picker.js` 和 `vendor/` 放一起，**离线/内网环境零配置可用**。worker 自动按 `pdf.min.js → pdf.worker.min.js` 规则推断。

**中文 PDF 离线不乱码（CMap 本地化）**：中文合同 PDF 常用 GBK/UniGB 字体映射，pdf.js 默认从 CDN 拉取。库会**自动探测本地 `cMaps/` 目录**（库同目录或页面目录，放 pdf.js 官方 `cmaps/` 解压内容），找到即本地加载；也可显式配置：

```js
const picker = new PdfStampPicker('#stage', {
  cMapUrl: '/static/pdf/cMaps/'   // 显式指定（优先级高于自动探测）
});
```

**加载进度与中止**：
- 加载时显示真实百分比进度（`PDF 加载中… 45%`），流接口/静态 URL 均支持
- `load(source, { signal })` 支持外部 AbortSignal 中止；切换文档/`destroy()` 自动中止旧加载
- 翻页/缩放自动 cancel 未完成的渲染任务；`destroy()` 释放 pdf.js 文档资源（防内存累积）

## ✨ 签章模式（拖动公章放置）

**签章模式**（`picker.setMode('stamp')` 或工具栏「签章」按钮）：

1. **点击 PDF 任意位置 → 章立即放置**（完整不透明落定，数据即时提交）
2. 按住已放置的章可**拖动调整位置**（拖动中半透明跟手，松手落定）
3. 🛡️ **章大小固定**（`stampSize` 构造选项决定，默认 120px 基准）——**不可缩放**：无缩放手柄、Ctrl+滚轮不缩放、双指不缩放；滚轮正常滚动页面
4. 点击空白处可**连续放置**多个；页面上所有签章点显示**序号角标**（①②③）
5. 🛡️ **全程不能拖出页面边界**（拖拽 clamp 在页面矩形内）
6. **滚轮 = 页面滚动**（不劫持），与浏览器习惯一致

**公章名字跟随用户**：切到"乙方"再放置，公章自动变成"乙方"的名字（内置 canvas 动态生成，零外部资源）。放置后每个签章点快照自己的章图，切换用户不影响已放置的章。

## 一键弹窗模式（最省事）

**适用**：页面上放一个"去签章"按钮，点击弹出选择器，确认后拿 JSON——宿主不用写任何容器/样式/布局。

```js
const json = await PdfStampPicker.openModal({
  source: 'https://api.example.com/pdf/contract/123',  // 或 File / ArrayBuffer / {url,headers}
  title: '设置各公司签章位置',
  users: [{ id: 'a', name: '甲方' }, { id: 'b', name: '乙方' }],
  width: 900,             // 弹窗宽度（数字=px，或 '90%' 字符串），默认 min(94vw,1180px)
  height: 700,            // 弹窗高度（数字=px，或 '70%'），默认 min(90vh,820px)
  mode: 'stamp',          // 弹窗坐标选择模式（默认 stamp 签章 / point / rect）
  requireStamp: true,     // 必须有签章点才能确认（无签章点会 toast 提示）
});
if (json) {
  // json.users[].stamps[] → 对接第三方签章接口
  await submitToEsign(json);
} else {
  // 用户点了取消
}
```

**弹窗回显已有签章（传 JSON）**：打开弹窗时传入之前导出的 JSON（`toJSON()`/`toFlatJSON()` 输出），自动回显全部签章点与公章图，可继续编辑后确认：

```js
const json = await PdfStampPicker.openModal({
  source: 'https://api.example.com/pdf/123',
  json: savedJson,        // ★ 已有签章 JSON（回显签章点/公章图/签署方）
  requireStamp: true
});
// 确认返回：savedJson 的签章 + 弹窗内新加的，全部合并
```

- `json` 与 `source` 配合：先加载 PDF → 自动回显 → 用户可继续加/改 → 确认拿全量 JSON
- 未传 `users` 时自动用 json 里的签署方（不产生多余默认用户）

**弹窗交互**：点击遮罩 / ✕ / 取消按钮 → resolve null；确认 → resolve toJSON()。`onConfirm(json)` 可返回 Promise 阻止关闭（如先提交到后端再关）。

完整参数：`source` `json`（回显已有签章） `title` `users` `currentUser` `width` `height` `mode` `confirmText` `cancelText` `requireStamp` `closeOnBackdrop` `onConfirm(json)` `onCancel()` `pickerOptions`（透传给选择器）。

## 坐标选择模式的可选性加载

三种模式（`point` 点选 / `rect` 框选 / `stamp` 签章）**在初始化或加载时即可指定**，不用等加载完再切换：

```js
// ① 构造时指定（容器模式 / 弹窗均支持）
const picker = new PdfStampPicker('#stage', { mode: 'stamp' });

// ② 加载时指定（加载完成后自动切换）
await picker.load('https://x.com/a.pdf', { mode: 'rect', pageNumber: 2 });

// ③ 弹窗顶层指定
PdfStampPicker.openModal({ source: '...', mode: 'point' });

// ④ 运行时切换（仍可用）
picker.setMode('stamp');
```

## 统一加载（load source 支持 5 种）

| 来源 | 写法 | 内部实现 |
|---|---|---|
| 本地上传 | `picker.load(file)`（File 对象） | file.arrayBuffer() |
| 字节流 | `picker.load(arrayBuffer / uint8Array)` | pdf.js `{data}` |
| 远程静态地址 | `picker.load('https://x.com/a.pdf')` | pdf.js 原生流式（支持大文件 Range） |
| 文件流接口 | `picker.load({ url, method:'POST', headers:{Authorization}, body })` | fetch 取字节（支持鉴权头/流接口） |
| pdfjs proxy | `picker.load(pdfDoc)` | 直接使用 |

## JSON 结构（v4：以用户/签署方为主维度）

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
        { "id": "s1", "page": 1, "x": 79.22, "y": 564.62, "width": 67.9, "height": 67.9, "unit": "pt", "rotation": 0, "note": "", "createdAt": "..." },
        { "id": "s2", "page": 1, "x": 0,     "y": 706.08, "width": 67.9, "height": 67.9, "unit": "pt", "rotation": 0, "note": "", "createdAt": "..." }
      ]
    },
    {
      "user": { "id": "u2", "name": "乙方", "color": "#ea4335" },
      "stamps": [
        { "id": "s3", "page": 1, "x": 192.39, "y": 479.74, "width": 67.9, "height": 67.9, "unit": "pt", "rotation": 0, "note": "", "createdAt": "..." }
      ]
    },
    {
      "user": { "id": "u3", "name": "丙方", "color": "#34a853" },
      "stamps": []   // 未设置签章点的签署方也保留（stamps 空数组）
    }
  ]
}
```

- **每个公司（签署方）的签章点坐标归在自己的 `user` 下**，用户信息在外层只出现一次
- **`document.hash`**：PDF 文件 SHA-256 哈希（Web Crypto 计算，零依赖）——防篡改/文件指纹，对接验签服务可用；本地文件/字节/流接口加载时计算（静态 URL 原生流式加载时为 null，因无完整字节缓存）
- 签章点只含坐标，**不含图片信息**（`toJSON()`/`getStamps()` 输出无 image；但 `importJSON()` 支持传入带 `image` 的签章点反显章图，见下节）
- 扁平版 `toFlatJSON()`：`stamps[]` 每项内嵌 `user`，需要按签章点遍历时用
- 单用户查询：`getStampsByUser(userId)`

## JSON 导入反显（回显签章点与公章图）

`toJSON()` 导出的数据可**再导入回显**（换设备继续编辑 / 后端回传盖章结果）：

```js
// 导出 → 存储/传输 → 再导入
const json = picker.toJSON();
await saveToServer(json);

// 另一处/之后回显
await picker.load('contract.pdf');
await picker.importJSON(json);
```

- **恢复签署方列表**（id/name/color 自动同步，缺失的自动添加）
- **恢复签章点**：坐标/尺寸/页码/备注全部回显，可继续拖动/编辑/删除
- **公章图片反显**：签章点带 `image`（`{src,name,width,height}`，如后端回传的盖章图）→ 显示该章图；无 image → 自动用内置公章按用户生成
- **两种结构都支持**：`toJSON()` 的 `users[]` 分组 / `toFlatJSON()` 的扁平 `stamps[]`
- 导入整体作为**一步撤销**（undo 可整体撤销导入）；自动跳转到第一个有签章点的页面

```js
picker.importJSON(json, { replace: true });  // replace=false 时不清空现有签章
```

## 对接第三方签章接口

`toJSON()` 的结构天然对应主流电子签 API 的 `signers[].signAreas[]` 模型，例如：

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

> 坐标约定：**PDF 原生坐标（pt，原点左下）**，已自动补偿页面旋转（0/90/180/270）。第三方接口若要求 mm 或右上原点，可换算：`mm = pt × 25.4/72`；右上原点 `y2 = pageHeight - y`。

## 多用户签章（签署方动态管理）

```js
// 业务侧传入真实签署方列表（如合同里的各公司）
const picker = new PdfStampPicker('#stage', {
  users: [
    { id: 'a', name: '甲方公司', color: '#4285f4' },
    { id: 'b', name: '乙方公司', color: '#ea4335' }
  ]
});

// 动态增删签署方
picker.addUser({ id: 'c', name: '丙方公司', color: '#34a853' });
picker.removeUser('b');               // 移除乙方及其签章点
picker.setCurrentUser('c');           // 后续新增的签章归属丙方
```

- 每个签章点在页面上以**用户颜色**边框标识，列表按用户分组着色
- 切换用户后新放置的签章自动归属当前用户
- JSON 中每项带 `user` 对象，可直接作为后台签名数据
- `removeUser(id)` 移除签署方及其全部签章点（当前用户不可移除）

## 纯画布模式（宿主渲染，库只做坐标选择）

PDF 由宿主自行渲染（图片转 canvas、服务端渲染图、在线合同模板等），库只负责签章坐标：

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

此模式不需要 pdf.js，**连 PDF 解析都不依赖**，纯坐标选择。

## API 总览

### 签章图

```js
// 默认：内置红色公章（名字=当前用户，切换用户自动重新生成）
// 自定义：支持 File / URL / dataURL / canvas
await picker.setStampImage(file);                // 本地图片文件
await picker.setStampImage('https://x.com/seal.png');
await picker.setStampImage(canvasElement);       // canvas 生成的章
picker.getStampImage();  // → {src, name, width, height}
```

> ⚠️ 放置后每个签章点**快照自己的章图**（内部绘制用），切换用户/新放置不影响已放置的章；`toJSON()`/`getStamps()` 输出始终**不含图片**（坐标选择器定位）。若需**反显章图**（如后端回传盖章结果），用 `importJSON()` 传入带 `image` 字段的签章点。

### 坐标转换

```js
picker.screenToPdf(300, 400);   // 屏幕px → {x, y} PDF pt（含旋转补偿）
picker.pdfToScreen(140, 560);   // PDF pt → {x, y} 屏幕px
```

### 程序化添加签章点

```js
picker.addStamp({ x: 100, y: 600, width: 150, height: 80, note: '公章' });
// 指定页/指定签署方
picker.addStamp({ x: 300, y: 200, page: 2, userId: 'u2', note: '骑缝章' });
```

## 构造选项（全部 18 项）

| option | 默认 | 说明 |
|---|---|---|
| `mode` | `'stamp'` | 初始模式：`'stamp'` 签章（默认）/ `'point'` 点选 / `'rect'` 框选 |
| `zoom` | `'fit-width'` | 初始缩放：数字(1pt→N px) / `'fit-width'` 适应宽度 / `'fit-page'` 适应整页 |
| `aspectRatio` | `null` | 框选模式选区固定宽高比（w/h） |
| `minSize` | `4` | 选区最小尺寸(屏幕px) |
| `showGrid` | `false` | 网格辅助线 |
| `controls` | `true` | 内置工具栏 + 列表面板（全 UI 内置） |
| `showList` | `true` | 签章列表面板 |
| `theme` | `'dark'` | `'dark'`（深色 viewer）/ `'light'`（浅色）——v4.3.1 起真正区分（背景/工具栏/列表联动） |
| `dpi` | `96` | px 单位换算参考（影响输出 px 字段） |
| `users` | 默认用户 | `[{id, name, color}]` 签署方列表 |
| `currentUser` | 第一个用户 | 当前签章用户 id |
| `allowMulti` | `true` | 允许多签章点（false 时新放置清空旧点） |
| `keepSelectionOnPageChange` | `false` | 翻页时是否保留当前选区/选中态 |
| `stampImage` | 内置公章 | 可选自定义签章图（URL/dataURL/File/canvas；不配则内置公章按用户名生成） |
| `stampSize` | `120` | 签章图基准尺寸 px（章固定大小，不可运行时缩放） |
| `minStampSize` / `maxStampSize` | `24` / `480` | ⚠️ 已废弃（v4.4.3 起章固定大小，此两项不再生效） |
| `pdfjsUrl` | 自动探测 | 显式指定 pdf.js 地址（默认自动探测本地 vendor → CDN 兜底） |
| `cMapUrl` | 自动探测 | 中文 PDF 字体映射目录（显式指定 > 自动探测本地 cMaps/ > pdf.js 默认 CDN） |
| `pdfjs` | — | 已有 pdfjsLib 实例（免重复加载，优先级最高） |

### 方法（实例 40 个，全部）

| 类别 | 方法 | 说明 |
|---|---|---|
| **加载** | `load(source, {pageNumber, mode, signal})` | 统一入口：File/ArrayBuffer/Uint8Array/静态URL/流接口配置/pdfjs proxy；支持加载后切模式、AbortSignal 中止 |
| | `loadPDF(source, opts)` | 兼容旧名（同 load） |
| | `setPage(meta)` | 纯画布模式：`{canvas, width, height, rotation, pageNumber, totalPages, name}` |
| | `gotoPage(n)` | 翻页（Promise），自动补偿旋转 |
| **缩放** | `setZoom(z)` | 数字 / `'fit-width'` / `'fit-page'` |
| | `getZoom()` | 当前缩放值（px per pt） |
| | `fitWidth()` / `fitPage()` | 快捷适应 |
| **模式** | `setMode('point'\|'rect'\|'stamp')` | 切换选择模式 |
| | `setAspectRatio(ratio)` | 框选宽高比锁定（null 解除） |
| | `setShowGrid(bool)` | 网格辅助线 |
| **签章图** | `setStampImage(src)` | 换签章图：File/URL/dataURL/canvas → Promise<{src,name,width,height}> |
| | `getStampImage()` | 当前签章图信息 |
| **用户** | `setCurrentUser(id)` | 切换当前签署方（公章名字随之更新） |
| | `getCurrentUser()` | 当前签署方对象 |
| | `addUser({id,name,color})` | 添加签署方（工具栏下拉同步） |
| | `removeUser(id)` | 移除签署方及其签章点（不可移除当前用户） |
| **签章点** | `addStamp({x,y,width,height,page,userId,note})` | 程序化添加签章点（PDF 坐标）→ 返回 stamp |
| | `getStamps()` | 全部签章点数组（扁平，带 user） |
| | `getStampsByUser(userId)` | 某签署方的签章点 |
| | `getActiveStamp()` | 当前选中签章点 |
| | `getSelection()` | 当前活动选区（PDF 坐标） |
| | `selectStamp(id)` | 选中签章点（自动跳转所在页） |
| | `removeStamp(id)` | 删除指定签章点 |
| | `removeSelection()` | 删除当前选中（无选中则清空临时选区） |
| | `clear()` / `clearAll()` | 清空全部签章点 |
| **JSON** | `toJSON()` | **按用户分组**完整 JSON（对接第三方接口） |
| | `toFlatJSON()` | 扁平版（stamps[] 内嵌 user） |
| | `importJSON(json, opts)` | 从 JSON 反显签章点/公章图（users[] 或 stamps[] 均可） |
| | `copyJSON()` | 复制 JSON 到剪贴板（内置 toast 反馈） |
| **撤销** | `undo()` / `redo()` | 撤销/重做签章操作（工具栏按钮 + Ctrl+Z / Ctrl+Shift+Z，上限 50 步） |
| **面板** | `toggleList()` | 折叠/展开签章列表面板 |
| **导出** | `exportImage(opts)` | 导出当前页+签章布局图为 PNG：`{scale=2, includePdf=true, includeUi=false}`；`includePdf:false` 得透明底章图 |
| **坐标** | `screenToPdf(x,y)` | 屏幕px → PDF pt（含旋转补偿） |
| | `pdfToScreen(x,y)` | PDF pt → 屏幕px |
| **事件** | `on(type, fn)` / `off(type, fn)` | 事件订阅/退订（链式） |
| **销毁** | `destroy()` | 移除 DOM、监听、RAF（必调防泄漏） |

### 静态成员

| 成员 | 说明 |
|---|---|
| `PdfStampPicker.openModal(config)` | 一键弹窗 → Promise&lt;JSON \| null&gt; |
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

## 交互

- **签章模式（默认）**：点击即放置（完整落定）；拖动微调（拖动中半透明）；**章固定大小不可缩放**（无手柄/Ctrl+滚轮/双指均不缩放章）；点击选中；**不越界**；滚轮=页面滚动
- **框选**：拖动绘制矩形；`Shift` 锁正方形；完成后自动加入签章列表
- **点选**：单击放置锚点（双环+准星样式），可拖动移动
- **多签章**：点击已有签章点切换选中（章固定大小，选中外发光边框），拖拽移动；框选/点选模式的选区仍带 8 向手柄缩放；每个签章点有**序号角标**
- **撤销/重做**：工具栏按钮或 Ctrl+Z / Ctrl+Shift+Z（含删除、清空、移动、缩放）
- **备注编辑**：双击列表项内联编辑签章点备注（note 字段）
- **重叠警告**：签章点与同页其他签章点重叠时 toast 警告 + `overlap` 事件（不阻止）
- **微调**：方向键移动（`Shift` 加速 10px），`Delete` 删除，`Esc` 取消拖动
- **列表面板**：按签署方分组显示（色点+数量），点击跳转选中、删除（悬停显现）；工具栏可折叠；跨页保留各页签章
- **加载反馈**：加载/翻页时页面中央 spinner + 文案
- **导出布局图**：`exportImage()` 把当前页+签章点导出 PNG（审批留档/预览），可只导出透明底章图
- **工具栏**：模式切换 / 当前公章缩略图（名字=当前用户）/ 打开本地文件 / URL 加载 / 签署方下拉 / 复制 JSON / 撤销 / 重做 / 面板折叠 / 缩放 / 翻页 / 网格 / 清空

## 坐标约定

- 屏幕坐标：CSS px，原点页面左上角，Y 向下
- **PDF 坐标（输出）**：pt（1/72 inch），原点页面左下角（含 CropBox 偏移），Y 向上
- 自动补偿页面旋转（0/90/180/270），`rotation` 字段保留原始旋转值

## 运行 Demo

```bash
cd pdf-stamp-picker && python3 -m http.server 8899
# 打开 http://127.0.0.1:8899/demo/index.html
```

Demo 展示：容器模式（多用户多签章/三种模式/动态签署方）/ 纯画布模式 / 弹窗模式 / JSON 分组输出 / 签署方动态增删。

## 目录

```
pdf-stamp-picker/
├── pdf-stamp-picker.js      # 库本体（单文件 ~110KB，零依赖）
├── pdf-stamp-picker.d.ts    # TypeScript 类型声明
├── package.json             # npm 包元数据（main/module/types/exports）
├── LICENSE                  # MIT
├── INTEGRATION.md           # 真实项目集成指南（Vue/React/原生/弹窗/CORS）
├── README.md                # 完整文档（含第三方接口对接示例）
├── demo/
│   ├── index.html           # Demo（多用户多签章/纯画布/弹窗）
│   ├── test.pdf             # 测试 PDF（3 页，含 /Rotate 90）
│   ├── chinese-cid.pdf      # 中文 GBK CID 测试 PDF（验证 cMaps）
│   ├── gen_test_pdf.py      # 测试 PDF 生成脚本
│   └── gen_chinese_pdf.py   # 中文 PDF 生成脚本
├── vendor/                  # pdf.js 完整离线资源（自动探测加载）
│   ├── pdf.min.js           # pdf.js 主库（320KB）
│   ├── pdf.worker.min.js    # 解析 worker（1.08MB）
│   └── cMaps/               # 169 个字体映射（中文 PDF 离线不乱码）
└── test/
    ├── coords.test.js       # 坐标转换（4 旋转 × 7 点往返）
    └── json.test.js         # JSON 结构 / 多用户 / 本地候选探测
```

## License

MIT
