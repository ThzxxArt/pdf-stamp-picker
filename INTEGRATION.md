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
pdf.js 会**自动探测**（库同目录 `vendor/` → 页面 `vendor/` → CDN 兜底），离线/内网环境把整个 `vendor/` 拷贝即可**全离线可用**：

```
vendor/
├── pdf.min.js           # pdf.js 主库（320KB）
├── pdf.worker.min.js    # 解析 worker（1.08MB）
└── cMaps/               # ★ 中文 PDF 字体映射（169 个，GBK/UniGB 中文不乱码）
```

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

// 回显已保存的签章（换设备/后端回传后继续编辑）
await picker.importJSON(savedJson);
```

## 3. AngularJS（1.x）集成

> 库是纯 JS 单文件（UMD），AngularJS 页面用 `<script>` 引入即可，**不需要**任何模块封装。两种方式：**弹窗模式**（最省事，推荐）和**指令模式**（嵌入页面）。

### 方式 A：弹窗模式（推荐，最省事）

```html
<!-- index.html：引入 pdf.js（可选，库会自动探测）+ 库 -->
<script src="vendor/pdf.min.js"></script>
<script src="pdf-stamp-picker.js"></script>

<!-- 控制器里调用 -->
<script>
  angular.module('myApp', []).controller('ContractCtrl', ['$scope', '$http', function ($scope, $http) {
    $scope.openStampModal = function () {
      // 1) 先拿 PDF（你的接口）
      $http.get('/api/contract/123/pdf', { responseType: 'arraybuffer' })
        .then(function (res) {
          // 2) 打开弹窗选择签章点（传入字节 → 自动算 document.hash）
          return PdfStampPicker.openModal({
            source: res.data,                        // ArrayBuffer
            title: '设置各公司签章位置',
            users: $scope.signers,                   // 合同签署方（从你的后端拿）
            confirmText: '确认签章点',
            requireAllUsers: true,                   // 每个签署方至少一个签章点
            width: 900, height: 700
          });
        })
        .then(function (json) {
          if (json) {
            // 3) 提交签章配置给后端/第三方签章服务
            $scope.savedJson = json;
            $scope.submitSign(json);
          }
        });
    };

    $scope.submitSign = function (json) {
      $http.post('/api/contract/123/sign', json).then(function () {
        $scope.$apply();   // AngularJS 需要手动触发脏检查更新视图
      });
    };
  }]);
</script>
```

**要点**：
- `openModal` 返回的是原生 Promise，AngularJS 是 `$q` —— **回调里更新 `$scope` 后要手动 `$scope.$apply()`**（或在 `.then` 里用 `$timeout` 包装）
- 弹窗 DOM 挂在 `body` 下，不受 AngularJS 模板作用域影响，**无需编译**
- `users` 从后端接口拿（如 `/api/contract/123/signers`）

### 方式 B：指令模式（嵌入页面）

```html
<div ng-app="myApp" ng-controller="ContractCtrl">
  <div pdf-stamp-picker signers="signers" pdf-url="pdfUrl"
       style="width:100%;height:600px;display:block"></div>
  <button ng-click="confirmSign()">确认签章</button>
</div>
```

```js
angular.module('myApp', []).directive('pdfStampPicker', function () {
  return {
    restrict: 'A',
    scope: {
      signers: '=',    // 签署方列表
      pdfUrl: '='      // PDF 地址
    },
    link: function (scope, element) {
      // 1) 创建实例
      var picker = new PdfStampPicker(element[0], {
        users: scope.signers || [],
        mode: 'stamp'
      });
      // 2) 实例挂到 $rootScope（控制器可靠访问；隔离 scope '=' 绑定有 digest 时序坑）
      scope.$root.picker = picker;
      // 3) 加载 PDF
      if (scope.pdfUrl) picker.load(scope.pdfUrl);
      // 4) 监听 AngularJS 数据变化（签署方/PDF 变化时刷新）
      scope.$watch('signers', function (nv) {
        if (nv && nv.length) { picker._users = nv; picker._renderList(); }
      }, true);
      scope.$watch('pdfUrl', function (nv) {
        if (nv) picker.load(nv);
      });
      // 5) 销毁（用 $destroy 事件）
      scope.$on('$destroy', function () { picker.destroy(); });
    }
  };
}).controller('ContractCtrl', ['$scope', function ($scope) {
  $scope.signers = [{ id: 'a', name: '甲方' }, { id: 'b', name: '乙方' }];
  $scope.pdfUrl = '/api/contract/123/pdf';
  $scope.confirmSign = function () {
    var json = $scope.$root.picker.toJSON();   // 拿分组 JSON
    // POST 给后端/第三方签章服务
  };
}]);
```

**要点**：
- 容器元素**必须有宽高**（`style="width:100%;height:600px"`），AngularJS 不像 Vue/React 管样式
- 指令 `scope` 用**隔离作用域**（`scope: {...}`），不影响页面其他数据
- **实例用 `$rootScope` 传递**（实测可靠）——隔离 scope 的 `picker: '='` 双向绑定在 link 阶段赋值常因 digest 时序拿不到，别用
- 库内部变化（放置/删除）→ 事件回调里手动 `$scope.$apply()` 同步回 AngularJS 视图
- `scope.$on('$destroy')` 调用 `picker.destroy()` 防泄漏

## 4. Vue 3 集成（实测验证 ✅）

> 以下代码在 Vue 3.4 + 本库 4.8 实测通过（`demo/vue3-test.html` 可运行验证）。

### 4.1 安装

```bash
npm install git+https://git.metona.cn/MetonaTeam/pdf-stamp-picker.git
# 或拷贝 pdf-stamp-picker.js 到项目静态目录
```

### 4.2 组件方式（推荐）

```vue
<!-- StampPicker.vue -->
<template>
  <div class="stamp-picker">
    <div ref="stage" class="psp-stage-container"></div>
    <div class="actions">
      <button @click="confirm" :disabled="!picker">确认签章</button>
      <button @click="openModal">弹窗选择</button>
    </div>
    <p class="log">{{ log }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import PdfStampPicker from 'pdf-stamp-picker'

const props = defineProps({
  pdfUrl: { type: String, required: true },     // PDF 地址（或流接口配置对象）
  signers: { type: Array, default: () => [] }   // 合同签署方 [{id, name, color}]
})
const emit = defineEmits(['confirm'])

const stage = ref(null)
const log = ref('等待…')
let picker = null

onMounted(() => {
  if (!stage.value) return
  picker = new PdfStampPicker(stage.value, {
    users: props.signers,
    mode: 'stamp'
  })
  // 加载 PDF（流接口方式 → 自动计算 document.hash）
  picker.load(props.pdfUrl)
  // 库事件 → Vue 状态（响应式自动更新视图）
  picker.on('stampadd', () => { log.value = '已放置签章 ✓' })
  picker.on('error', e => { log.value = '加载失败: ' + e.message })
})

// 卸载必须销毁（Vue 3 的 onBeforeUnmount）
onBeforeUnmount(() => { if (picker) picker.destroy() })

function confirm() {
  if (!picker) return
  const json = picker.toJSON()
  emit('confirm', json)          // 提交给父组件/后端
  log.value = '确认: ' + json.users.length + ' 个签署方'
}

function openModal() {
  // 弹窗模式：一行调用，宿主无需容器
  PdfStampPicker.openModal({
    source: props.pdfUrl,
    users: props.signers,
    title: '设置各公司签章位置',
    confirmText: '确认签章点',
    requireAllUsers: true
  }).then(json => {
    if (json) { emit('confirm', json); log.value = '弹窗确认: ' + json.users.length + ' 组' }
    else log.value = '已取消'
  })
}
</script>

<style scoped>
.psp-stage-container { width: 100%; height: 600px; background: #fff; border-radius: 10px; overflow: hidden; }
</style>
```

### 4.3 使用

```vue
<template>
  <StampPicker :pdf-url="pdfUrl" :signers="signers" @confirm="handleSign" />
</template>

<script setup>
import StampPicker from './StampPicker.vue'

const pdfUrl = '/api/contract/123/pdf'   // 或 {url, headers} 流接口配置
const signers = [{ id: 'a', name: '甲方' }, { id: 'b', name: '乙方' }]

function handleSign(json) {
  console.log(json)   // { document: {name, pages, hash...}, users: [{user, stamps}] }
  // → POST 到你的后端 / 第三方签章服务
}
</script>
```

### 4.4 关键点

- **容器必须有宽高**（style 或 CSS class），Vue 不管样式
- **`onBeforeUnmount` 必须 `picker.destroy()`**，否则事件监听泄漏
- 库回调里改 `ref` 值 → Vue 响应式自动更新（无需手动 $apply，比 AngularJS 省心）
- `props` 变化需刷新：用 `watch(() => props.pdfUrl, v => picker && picker.load(v))`

## 5. Vue 2 集成（实测验证 ✅）

> 以下代码在 Vue 2.7 + 本库 4.8 实测通过（`demo/vue2-test.html` 可运行验证）。

### 5.1 安装

```bash
npm install git+https://git.metona.cn/MetonaTeam/pdf-stamp-picker.git
# 或 <script src="pdf-stamp-picker.js"> 引入（UMD 全局变量）
```

### 5.2 组件方式（Options API）

```vue
<!-- StampPicker.vue -->
<template>
  <div>
    <div ref="stage" style="width:100%;height:600px;background:#fff;border-radius:10px;overflow:hidden"></div>
    <div style="margin-top:10px">
      <button @click="confirm">确认签章</button>
      <button @click="openModal">弹窗选择</button>
    </div>
    <p style="color:#1a73e8;font:12px monospace">{{ log }}</p>
  </div>
</template>

<script>
import PdfStampPicker from 'pdf-stamp-picker'

export default {
  name: 'StampPicker',
  props: {
    pdfUrl: { type: [String, Object], required: true },  // PDF 地址或流接口配置
    signers: { type: Array, default: () => [] }
  },
  data() { return { log: '等待…' } },
  mounted() {
    this.picker = new PdfStampPicker(this.$refs.stage, {
      users: this.signers,
      mode: 'stamp'
    })
    this.picker.load(this.pdfUrl)
    this.picker.on('stampadd', () => { this.log = '已放置签章 ✓' })
    this.picker.on('error', e => { this.log = '加载失败: ' + e.message })
  },
  beforeDestroy() {
    if (this.picker) this.picker.destroy()   // Vue 2 用 beforeDestroy
  },
  watch: {
    pdfUrl(v) { if (this.picker) this.picker.load(v) }
  },
  methods: {
    confirm() {
      if (!this.picker) return
      const json = this.picker.toJSON()
      this.$emit('confirm', json)
      this.log = '确认: ' + json.users.length + ' 个签署方'
    },
    openModal() {
      PdfStampPicker.openModal({
        source: this.pdfUrl,
        users: this.signers,
        title: '设置各公司签章位置',
        confirmText: '确认签章点',
        requireAllUsers: true
      }).then(json => {
        if (json) { this.$emit('confirm', json); this.log = '弹窗确认: ' + json.users.length + ' 组' }
        else this.log = '已取消'
      })
    }
  }
}
</script>
```

### 5.3 关键点

- **Vue 2 用 `beforeDestroy`**（Vue 3 才用 `onBeforeUnmount`）——销毁时 `picker.destroy()`
- **`this.$refs.stage` 拿容器**（ref 挂载后才有，mounted 里可用）
- 库回调里改 `this.log` → Vue 2 响应式自动更新（无需手动 $apply）
- `watch` 监听 `pdfUrl` 变化重新加载

## 6. React 集成（实测验证 ✅）

> 以下代码在 React 18 + 本库 4.8 实测通过（`demo/react-test.html` 可运行验证）。

### 5.1 安装

```bash
npm install git+https://git.metona.cn/MetonaTeam/pdf-stamp-picker.git
```

### 5.2 组件方式

```tsx
// StampPicker.tsx
import { useEffect, useRef, useState } from 'react'
import PdfStampPicker from 'pdf-stamp-picker'

interface Signer { id: string; name: string; color?: string }
interface Props {
  pdfUrl: string | { url: string; headers?: Record<string, string> }
  signers: Signer[]
  onConfirm: (json: any) => void
}

export function StampPicker({ pdfUrl, signers, onConfirm }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<PdfStampPicker | null>(null)
  const [log, setLog] = useState('等待…')

  // 挂载/卸载生命周期（严格模式注意双调用）
  useEffect(() => {
    if (!stageRef.current) return
    const picker = new PdfStampPicker(stageRef.current, {
      users: signers,
      mode: 'stamp'
    })
    pickerRef.current = picker
    picker.load(pdfUrl)
    picker.on('stampadd', () => setLog('已放置签章 ✓'))
    picker.on('error', e => setLog('加载失败: ' + e.message))
    return () => picker.destroy()   // 卸载销毁
  }, [])   // 注意：依赖数组留空，避免重复创建

  // pdfUrl 变化时重新加载
  useEffect(() => { if (pickerRef.current) pickerRef.current.load(pdfUrl) }, [pdfUrl])

  const confirm = () => {
    const j = pickerRef.current?.toJSON()
    if (j) { onConfirm(j); setLog('确认: ' + j.users.length + ' 个签署方') }
  }

  const openModal = () => {
    PdfStampPicker.openModal({
      source: pdfUrl,
      users: signers,
      title: '设置各公司签章位置',
      confirmText: '确认签章点',
      requireAllUsers: true
    }).then(j => {
      if (j) { onConfirm(j); setLog('弹窗确认: ' + j.users.length + ' 组') }
      else setLog('已取消')
    })
  }

  return (
    <div>
      <div ref={stageRef} style={{ width: '100%', height: 600, background: '#fff', borderRadius: 10, overflow: 'hidden' }} />
      <div style={{ marginTop: 10 }}>
        <button onClick={confirm}>确认签章</button>
        <button onClick={openModal}>弹窗选择</button>
      </div>
      <p style={{ color: '#1a73e8', font: '12px monospace' }}>{log}</p>
    </div>
  )
}
```

### 5.3 使用

```tsx
import { StampPicker } from './StampPicker'

function ContractPage() {
  const handleSign = (json: any) => {
    console.log(json)   // { document: {hash...}, users: [{user, stamps}] }
    // POST 到后端 / 第三方签章服务
  }
  return (
    <StampPicker
      pdfUrl={{ url: '/api/contract/123/pdf', headers: { Authorization: 'Bearer token' } }}
      signers={[{ id: 'a', name: '甲方' }, { id: 'b', name: '乙方' }]}
      onConfirm={handleSign}
    />
  )
}
```

### 5.4 关键点

- **`useEffect` 清理函数返回 `picker.destroy()`**（React 18 严格模式开发环境会双调用挂载/卸载，destroy 要幂等——库已处理）
- **`useRef` 存实例**（`useState` 存会触发多余渲染）
- **`useEffect` 依赖数组留空**创建实例，`pdfUrl` 变化用单独 effect 重新 load
- 库事件回调里用 `setLog`（React state）→ 自动重渲染，无需手动触发

## 7. 弹窗模式（最省事，一行调用）

```js
import PdfStampPicker from 'pdf-stamp-picker'

// 用户点"去签章"按钮 → 弹窗选择 → 确认后拿 JSON
const json = await PdfStampPicker.openModal({
  source: 'https://your-api.com/contracts/123/pdf',  // 或 File / {url, headers}
  title: '设置各公司签章位置',
  users: signers,               // 合同签署方列表
  // mode: 'stamp',             // 默认就是签章模式，可省略
  width: 900, height: 700,      // 弹窗尺寸（可选，数字=px 或 '90%'）
  requireStamp: true            // 必须有签章点才能确认
});
if (json) {
  // json.users[].stamps[] → 第三方签章接口 signers[].signAreas[]
  await submitToEsign(json);
}
```

**弹窗回显已有签章**：打开时传之前导出的 JSON（`toJSON()`/`toFlatJSON()` 输出），自动回显签章点与公章图，可继续编辑：

```js
const json = await PdfStampPicker.openModal({
  source: 'https://your-api.com/contracts/123/pdf',
  json: savedJson,       // ★ 已有签章 JSON → 自动回显
  requireStamp: true
});
```

## 8. 加载真实合同数据

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

> 💡 **加载体验**：加载/翻页有真实百分比进度（spinner + `45%`）；`load(source, { signal })` 支持 AbortSignal 中止；切换文档/`destroy()` 自动中止旧加载并释放 pdf.js 资源。

> ⚠️ **CORS**：跨域加载 PDF 必须目标服务器允许（`Access-Control-Allow-Origin`）。**带自定义 header 的跨域请求会触发 OPTIONS 预检**，服务端必须响应（`Access-Control-Allow-Headers`），否则报 "Failed to fetch"。同域接口无此问题。常见报错与排查见下表。

## 9. 常见问题

| 问题 | 原因 / 解决 |
|---|---|
| AngularJS 里回调更新视图不生效 | 库用原生 Promise，非 $q —— 回调里改 $scope 后手动 `$scope.$apply()` 或 `$timeout` 包装 |
| AngularJS 指令容器高度为 0 | 容器需要显式宽高（`style="width:100%;height:600px"`），AngularJS 不管样式 |
| AngularJS 页面库不生效 | 确认库 `<script>` 在 AngularJS 之前/之后均可用（UMD 全局变量，不依赖 Angular） |
| 加载失败: Network request failed | 跨域未开 CORS；确认接口返回 `Access-Control-Allow-Origin`；自定义 header 需服务端处理 OPTIONS 预检 |
| 中文 PDF 乱码 | 缺 cMaps：把 `vendor/cMaps/`（169 个字体映射）放库同目录，自动探测本地加载；或显式 `cMapUrl` |
| pdf.js 走 CDN 慢/失败 | 把 `vendor/pdf.min.js` 放库同目录，自动探测优先本地；或显式 `pdfjsUrl` |
| 内网/离线无法用 | 拷贝整个 `vendor/`（pdf.min.js + worker + cMaps）即可全离线，自动探测 |
| 样式被宿主影响 | 所有类名 `psp-` 前缀 + 样式注入带独立 id，冲突风险极低；`#stage` 容器给宽高即可 |
| 移动端体验 | 基于 Pointer Events，触摸可用（含双指缩放页面）；建议容器高度 ≥ 500px |
| 中文 UI 想改语言 | 库内文案集中在 `_buildToolbar/_buildList/openModal`，可按需替换（下版本将抽离 i18n） |
| 包体积敏感 | 单文件 ~120KB（gzip ~35KB）+ 可选 pdf.js（~1.4MB 含 cMaps，可走 CDN 不打包） |
| TypeScript 无提示 | 已内置 `pdf-stamp-picker.d.ts`，`types` 字段自动识别 |

## 10. 样式隔离说明

- 库注入的 CSS 全部使用 `psp-` 前缀，且 style 标签带独立 id（`psp-styles`），不覆盖宿主样式
- 弹窗挂载在 `body` 下（`z-index: 99990`），不受宿主布局影响
- 容器只需要：有宽高（flex 布局下 `flex:1` 也行）+ 非 static 定位（库自动处理）
- 如宿主已有 `#psp-styles`，库会复用不重复注入

## 11. 性能提示

- PDF 渲染按需（仅当前页），翻页/缩放自动 cancel 未完成的渲染任务，大文档流畅
- 签章点坐标纯计算，数千个点无压力
- 文档切换/`destroy()` 自动释放 pdf.js 文档资源（防长会话内存累积）
- 如需在低端设备使用，建议 `zoom: 'fit-width'`（默认）减少像素开销

## 12. 版本与兼容

- 浏览器：Chrome/Edge/Firefox/Safari 近两个大版本（Pointer Events + ResizeObserver，无 RO 自动回退）
- 无任何运行时依赖；pdf.js 3.11.174（内置本地可换）
- 坐标：PDF 原生 pt、原点左下、自动补偿页面旋转——对接任何签章服务前先对齐坐标约定（README 有换算公式）
- 当前版本 v4.6.x：默认签章模式 · JSON 分组输出/导入反显（`importJSON` / 弹窗传 `json`）· 撤销重做 · 多签署方动态管理 · 章固定大小 · 统一加载（File/URL/流接口/字节/代理 + 进度/中止）· cMaps 中文离线
