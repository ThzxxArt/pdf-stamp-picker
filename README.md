# PdfStampPicker

纯 JavaScript **PDF 电子签章坐标选择器** —— 单文件、零依赖、UMD 通用模块（浏览器 script / ESM / CommonJS 均可使用）。

> 📦 **真实项目集成请直接看 [INTEGRATION.md](INTEGRATION.md)**（npm/原生/Vue/React 示例、CORS 排查、移动端、样式隔离）

> ⚠️ 定位说明：这是**签章点坐标选择器**，不是真实盖章渲染器。输出的是签章位置坐标 + 归属用户，**不输出图片**。页面上的公章图只是拖放定位的视觉载体，放置后显示为带用户颜色的占位框。

v4.1 特性：**精致 UI（图标工具栏/玻璃拟态/卡片列表/动效）** · **JSON 按用户分组（users[].stamps[]，直接对接第三方签章接口）** · 拖动内置公章放置签章点（不越界）· 多签章点 · 多用户归属 · 一键弹窗 · 统一加载 · **零框架零依赖（纯原生 JS + Canvas + 注入 CSS）**。

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
  });

  // 统一加载：本地 File / URL / 文件流接口 都行
  await picker.load('https://example.com/contract.pdf');

  picker.on('stampadd', () => {
    console.log(picker.toJSON());   // 完整 JSON（无图片）
  });
</script>
```

> 库会自动注入全部 HTML/CSS、自动加载 pdf.js、自动生成**内置红色公章**（公章上的名字 = 当前用户名，切换用户自动更新）。宿主零样式代码。

### pdf.js 加载策略（v4.2 起自动探测）

加载优先级：**传入 `pdfjs` 实例 > 全局 `window.pdfjsLib` > 配置 `pdfjsUrl` > 自动探测本地 > CDN 兜底**。

零配置时自动探测本地路径（按顺序）：
1. 库文件同目录 `vendor/pdf.min.js`
2. 宿主页面同目录 `vendor/pdf.min.js` / `../vendor/pdf.min.js` / `libs/pdf.min.js`

全部找不到才回退 CDN（cdnjs）。所以项目里只要把 `pdf-stamp-picker.js` 和 `vendor/` 放一起，**离线/内网环境零配置可用**。worker 自动按 `pdf.min.js → pdf.worker.min.js` 规则推断。

## ✨ 拖动公章放置（签章模式）

**签章模式**（`picker.setMode('stamp')` 或工具栏「签章」按钮）：

1. 鼠标移入页面 → 显示半透明**公章跟随预览**（名字 = 当前用户，自动避让边界）
2. **按下拖动 → 松手放置**：公章从按下点跟手移动，松手落定
3. 放置后显示**用户色占位框 + 用户名标签**（坐标占位，非真实盖章效果）
4. 点击空白处可**连续放置**多个；点击已有签章点选中（8 向手柄拖动/缩放）
5. 🛡️ **全程不能拖出页面边界**（拖拽/预览/缩放均 clamp 在页面矩形内）

**公章名字跟随用户**：切到"乙方"再放置，公章预览图自动变成"乙方"的名字（内置 canvas 动态生成，零外部资源）。

## 一键弹窗模式

```js
const json = await PdfStampPicker.openModal({
  source: 'https://api.example.com/pdf/contract/123',  // 或 File / ArrayBuffer / {url,headers}
  title: '选择签章位置',
  users: [{ id: 'a', name: '甲方' }, { id: 'b', name: '乙方' }],
  requireStamp: true,             // 必须有签章点才能确认
  pickerOptions: { mode: 'stamp' } // 直接进签章模式
});
// json → { document: {...}, stamps: [...] }，取消 → null
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
- 签章点只含坐标，**不含图片信息**
- 扁平版 `toFlatJSON()`：`stamps[]` 每项内嵌 `user`，需要按签章点遍历时用
- 单用户查询：`getStampsByUser(userId)`

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

- 每个签章点在页面上以**用户颜色**边框标识，列表按用户着色
- 切换用户后新放置的签章自动归属当前用户
- JSON 中每项带 `user` 对象，可直接作为后台签名数据

## API 总览

### 构造选项

| option | 默认 | 说明 |
|---|---|---|
| `mode` | `'rect'` | `'point'` 点选 / `'rect'` 框选 / `'stamp'` 拖放签章图 |
| `zoom` | `'fit-width'` | 数字 / `'fit-width'` / `'fit-page'` |
| `aspectRatio` | `null` | 选区固定宽高比 |
| `minSize` | `4` | 选区最小尺寸(px) |
| `showGrid` | `false` | 网格辅助线 |
| `controls` | `true` | 内置工具栏 + 列表（全 UI 内置） |
| `showList` | `true` | 签章列表面板 |
| `theme` | `'dark'` | `'dark'` / `'light'` |
| `users` | 默认用户 | `[{id, name, color}]` |
| `currentUser` | 第一个用户 | 当前签章用户 |
| `allowMulti` | `true` | 允许多签章 |
| `stampImage` | 内置公章 | 可选自定义签章图（不配则内置公章按用户名生成） |
| `stampSize` | `120` | 签章图显示基准宽度 px |
| `minStampSize` / `maxStampSize` | `24` / `480` | 签章图缩放范围 |
| `pdfjsUrl` | 自动探测 | 显式指定 pdf.js 地址（默认自动探测本地 vendor → CDN 兜底） |
| `pdfjs` | — | 已有 pdfjsLib 实例（免重复加载） |

### 方法

| 类别 | 方法 |
|---|---|
| 加载 | `load(source)` `loadPDF()` `setPage(meta)` `gotoPage(n)` |
| 缩放 | `setZoom(z)` `getZoom()` `fitWidth()` `fitPage()` |
| 模式 | `setMode('point'\|'rect'\|'stamp')` `setAspectRatio()` `setShowGrid()` |
| 签章图 | `setStampImage(src)` `getStampImage()` |
| 用户 | `setCurrentUser()` `getCurrentUser()` `addUser()` |
| 签章 | `getStamps()` `addStamp()` `removeStamp()` `selectStamp()` `getSelection()` `clear()` `removeSelection()` |
| JSON | `toJSON()` `copyJSON()` |
| 坐标 | `screenToPdf()` `pdfToScreen()` |
| 事件 | `on(type, fn)` `off(type, fn)` |
| 弹窗 | `PdfStampPicker.openModal(config)`（静态） |
| 其他 | `PdfStampPicker.loadPdfJs(url)`（静态预加载） `destroy()` |

### 事件

`ready` `load` `change` `select` `clear` `pagechange` `zoomchange` `stampadd` `stampremove` `stampchange` `stampselect` `stampimage` `error`

## 交互

- **签章模式**：跟随预览（公章名=当前用户）→ 按下拖动 → 松手放置（用户色占位框）；滚轮缩放；点击已有签章选中；**不越界**
- **框选**：拖动绘制；`Shift` 锁正方形；完成后自动加入签章列表
- **点选**：单击放置锚点，可拖动移动
- **多签章**：点击已有签章点切换选中（带手柄），拖拽移动、8 向手柄缩放
- **微调**：方向键移动（`Shift` 加速），`Delete` 删除，`Esc` 取消拖动
- **列表面板**：点击跳转选中、删除；翻页跨页保留各页签章
- **工具栏**：模式切换 / 当前签章图缩略图（名字=当前用户）/ 打开本地文件 / URL 加载 / 用户切换 / 复制 JSON / 缩放 / 翻页 / 网格

## 坐标约定

- 屏幕坐标：CSS px，原点页面左上角，Y 向下
- **PDF 坐标（输出）**：pt（1/72 inch），原点页面左下角（含 CropBox 偏移），Y 向上
- 自动补偿页面旋转（0/90/180/270），`rotation` 字段保留原始旋转值

## 运行 Demo

```bash
cd pdf-stamp-picker && python3 -m http.server 8899
# 打开 http://127.0.0.1:8899/demo/index.html
```

Demo 展示：签章模式（拖动公章放置）/ 容器模式（多用户多签章）/ 弹窗模式 / 更换签章图 / JSON 复制。

## 目录

```
pdf-stamp-picker/
├── pdf-stamp-picker.js      # 库本体（单文件 ~98KB，零依赖）
├── pdf-stamp-picker.d.ts    # TypeScript 类型声明
├── package.json             # npm 包元数据（main/module/types/exports）
├── LICENSE                  # MIT
├── INTEGRATION.md           # 真实项目集成指南（Vue/React/原生/弹窗/CORS）
├── README.md                # 完整文档（含第三方接口对接示例）
├── demo/
│   ├── index.html           # Demo（多用户多签章/纯画布/弹窗）
│   ├── test.pdf             # 测试 PDF（3 页，含 /Rotate 90）
│   └── gen_test_pdf.py      # 测试 PDF 生成脚本
├── vendor/                  # 本地化 pdf.js（可选，库会自动探测/加载 CDN）
└── test/
    ├── coords.test.js       # 坐标转换（4 旋转 × 7 点往返）
    └── json.test.js         # JSON 结构 / 多用户 / 本地候选探测
```

## License

MIT
