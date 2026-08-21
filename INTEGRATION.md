# PdfStampPicker 真实项目集成指南

> 目标：5 分钟内把一个"电子签章坐标选择器"装进你的合同/审批/文档系统。

## 1. 安装

### 方式 A：npm / git 依赖（推荐）

```bash
# 直接装 git 仓库（当前托管在 MetonaTeam）
npm install git+https://git.metona.cn/MetonaTeam/pdf-stamp-picker.git

# 或发布私有 npm 包后
npm install pdf-stamp-picker
```

### 方式 B：script 标签（传统页面）

```html
<script src="pdf-stamp-picker.js"></script>
<!-- 全局变量 PdfStampPicker 可用 -->
```

### 方式 C：拷贝文件

只需 1 个文件：`pdf-stamp-picker.js`（可选带 `pdf-stamp-picker.d.ts`）。
pdf.js 会**自动探测**（库同目录 `vendor/` → 页面 `vendor/` → CDN 兜底），离线环境把 `vendor/pdf.min.js` 也拷上即可。

## 2. 原生 JS 集成（最小可用）

```js
import PdfStampPicker from 'pdf-stamp-picker';   // 或 const { default: Picker } = ...

const picker = new PdfStampPicker('#stage', {
  users: [
    { id: 'a', name: '甲方公司', color: '#4285f4' },
    { id: 'b', name: '乙方公司', color: '#ea4335' }
  ]
});

// 加载真实合同（远程静态地址 / 文件流接口 / File 都行）
await picker.load('https://your-api.com/contracts/123/pdf');

picker.on('stampadd', () => {
  const json = picker.toJSON();   // 按签署方分组
  // → POST 到你的接口，或对接第三方电子签服务
  saveSignAreas(json);
});
```

## 3. Vue 3 集成

```vue
<template>
  <div ref="stage" style="width:100%;height:600px"></div>
  <button @click="confirm">确认签章</button>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import PdfStampPicker from 'pdf-stamp-picker'

const stage = ref(null)
let picker = null

onMounted(() => {
  picker = new PdfStampPicker(stage.value, {
    users: props.signers,          // 从父组件传入合同签署方
    mode: 'stamp'
  })
  picker.load(props.pdfUrl)
})

onBeforeUnmount(() => picker.destroy())   // 记得销毁，防泄漏

function confirm() {
  emit('confirm', picker.toJSON())
}
</script>
```

## 4. React 集成

```tsx
import { useEffect, useRef } from 'react'
import PdfStampPicker from 'pdf-stamp-picker'

export function StampPicker({ pdfUrl, signers, onConfirm }) {
  const ref = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<PdfStampPicker | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const picker = new PdfStampPicker(ref.current, { users: signers })
    picker.load(pdfUrl)
    pickerRef.current = picker
    return () => picker.destroy()
  }, [pdfUrl])

  return (
    <div>
      <div ref={ref} style={{ height: 600 }} />
      <button onClick={() => onConfirm(pickerRef.current!.toJSON())}>确认</button>
    </div>
  )
}
```

## 5. 弹窗模式（最省事，一行调用）

```js
import PdfStampPicker from 'pdf-stamp-picker'

// 用户点"去签章"按钮 → 弹窗选择 → 确认后拿 JSON
const json = await PdfStampPicker.openModal({
  source: 'https://your-api.com/contracts/123/pdf',  // 或 File / {url, headers}
  title: '设置各公司签章位置',
  users: signers,               // 合同签署方列表
  requireStamp: true,           // 必须有签章点才能确认
  pickerOptions: { mode: 'stamp' }
});
if (json) {
  // json.users[].stamps[] → 第三方签章接口 signers[].signAreas[]
  await submitToEsign(json);
}
```

## 6. 加载真实合同数据

```js
// ① 远程静态 PDF 地址（pdf.js 原生流式，支持大文件 Range）
await picker.load('https://static.example.com/contract.pdf')

// ② 文件流接口（带鉴权 / POST / 自定义头）
await picker.load({
  url: 'https://your-api.com/pdf/123',
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token },
  body: JSON.stringify({ templateId: 123 })
})

// ③ 本地上传（File 对象，来自 <input type=file>）
await picker.load(file)
```

> ⚠️ **CORS**：跨域加载 PDF 必须目标服务器允许（`Access-Control-Allow-Origin`）。同域接口无此问题。常见报错与排查见下表。

## 7. 常见问题

| 问题 | 原因 / 解决 |
|---|---|
| 加载失败: Network request failed | 跨域未开 CORS；确认接口返回 `Access-Control-Allow-Origin` |
| pdf.js 走 CDN 慢/失败 | 把 `vendor/pdf.min.js` 放库同目录，自动探测优先本地；或显式 `pdfjsUrl` |
| 内网/离线无法用 | 拷贝 `vendor/` 即可全离线，worker 自动推断 |
| 样式被宿主影响 | 所有类名 `psp-` 前缀 + 样式注入带独立 id，冲突风险极低；`#stage` 容器给宽高即可 |
| 移动端体验 | 基于 Pointer Events，触摸可用；建议容器高度 ≥ 500px |
| 中文 UI 想改语言 | 库内文案集中在 `_buildToolbar/_buildList/openModal`，可按需替换（下版本将抽离 i18n） |
| 包体积敏感 | 单文件 ~98KB（gzip ~30KB）+ 可选 pdf.js（~320KB，可走 CDN 不打包） |
| TypeScript 无提示 | 已内置 `pdf-stamp-picker.d.ts`，`types` 字段自动识别 |

## 8. 样式隔离说明

- 库注入的 CSS 全部使用 `psp-` 前缀，且 style 标签带独立 id（`psp-styles`），不覆盖宿主样式
- 弹窗挂载在 `body` 下（`z-index: 99990`），不受宿主布局影响
- 容器只需要：有宽高（flex 布局下 `flex:1` 也行）+ 非 static 定位（库自动处理）
- 如宿主已有 `#psp-styles`，库会复用不重复注入

## 9. 性能提示

- PDF 渲染按需（仅当前页），翻页才渲染下一页，大文档流畅
- 签章点坐标纯计算，数千个点无压力
- 如需在低端设备使用，建议 `zoom: 'fit-width'`（默认）减少像素开销

## 10. 版本与兼容

- 浏览器：Chrome/Edge/Firefox/Safari 近两个大版本（Pointer Events + ResizeObserver，无 RO 自动回退）
- 无任何运行时依赖；pdf.js 3.11.174（内置本地可换）
- 坐标：PDF 原生 pt、原点左下、自动补偿页面旋转——对接任何签章服务前先对齐坐标约定（README 有换算公式）
