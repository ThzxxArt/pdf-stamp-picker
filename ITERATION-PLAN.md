# PdfStampPicker 下一阶段迭代方案

> 基于对 `pdf-stamp-picker.js`（v4.8.28，3656 行 / 167 KB）的完整通读 + 实测验证
> 制定日期：2026-09-11

---

## 一、通读结论

### 1.1 规模与分层

单文件、零运行时依赖（pdf.js 为可选外部依赖）。内部分层：

| 层 | 内容 | 大致位置 |
|---|---|---|
| 常量与工具 | 颜色表、旋转/坐标换算、HTML 转义、事件总线、SHA-256（Web Crypto + 纯 JS 兜底） | 1–290 |
| 构造与 DOM | 根容器、工具栏、签章列表、样式注入、文本节点工厂 | 284–660 |
| 加载 | 5 种 source 分支 → `_loadRemote` / `_getDoc` → pdf.js 探测与兼容层 | 660–1180 |
| 渲染 | 分页 `gotoPage`、缩放 `setZoom`、`_layout`、`_renderPage` | 1180–1420 |
| 签署方与章图 | `addUser` / `setStampImage` / `_genSeal`（canvas 生成） | 1420–1740 |
| 状态 | 签章点增删改、选区、历史栈（JSON 快照） | 1740–2100 |
| 输出 | `toJSON` / `toFlatJSON` / `toCSV` / `exportImage` | 1740–1810, 2950–3100 |
| 交互 | 指针（拖拽/缩放/新建）、键盘微调、重叠检测、命中测试 | 2280–2760 |
| 弹窗模式 | `PdfStampPicker.openModal` 生命周期 | 3090–3420 |

对外 API：19 项构造选项、约 40 个实例方法、15 个事件。

### 1.2 风险热区（本次实测命中的缺陷全部集中于此）

1. **加载链路的并发与时序** —— 5 条 source 分支 + 异步哈希 + pdf.js 的 `transfer` 语义 + 可中止信号，四者组合出大量时序缝隙。
2. **跨文档状态残留** —— 换文档时需要作废的状态分散在 `load()` 开头、`.then()` 内部、`_loadRemote()` 里三处手工维护，漏一处即串档。
3. **文档与实现漂移** —— README 声称"全部 14 个事件"，实际已有 15 个（`hashready` 未登记）；d.ts 与本版新增项未同步。

> 判断：**这个库的功能面已经相当完整，当前主要风险不在"缺功能"，而在"异步时序与状态生命周期"**。下一阶段应优先加固生命周期的一致性，而不是继续加特性。

---

## 二、缺陷清单

等级定义：P0 = 静默产出错误数据 / 数据损坏；P1 = 可复现的功能错误；P2 = 一致性与体感问题；P3 = 语义与可维护性。

### D1 · P0 · 内网大文件哈希被 transfer 竞态污染 ✅ 已修复（v4.8.28）

- **现象**：内网 HTTP + 文件流接口 + 较大 PDF → 输出的 `document.hash` **格式正常但是错的**，静默无提示。
- **实测证据**（模拟内网：隐藏 `crypto.subtle`，`load({url, headers})` 加载 20 MB PDF）：
  ```
  实际 0958290f74655ddf69b4…   期望 1d9778fb38aae8aa72d8…   ❌
  _pdfBytes 加载后 = 0（已被 pdf.js transfer）
  ```
  同一用例 ≤3.2 MB 时"侥幸通过"→ 属 **flaky**，文件越大越容易中。
- **根因**：`_loadRemote` 中 `sha256(buf)` 与 `_getDoc({data: buf})` **并行**发起，未等哈希完成。pdf.js 以 `transfer` 方式把 ArrayBuffer 交给 worker，主线程侧 buffer 立即 detached；而纯 JS SHA-256 是**分块 512 KB + `setTimeout` 让出主线程**异步读取的，后续分块读到的全是 0。
- **修复**：与其它加载路径对齐，先 `await` 哈希再 `_getDoc`。
- **防回归**：`demo/hash-nonsecure-test.html` 新增用例 ⑤（20 MB 稳定复现）。

### D2 · P1 · 跨文档哈希串档（`load()` 未重置 `_pdfHashPromise`） ✅ 已修复（v4.9.0 / H1）

- **现象**：先加载 A，再加载 B → B 的 `document.hash` 是 **A 的哈希**；同时 `hashUrl: true` 完全失效（永远走不到补算分支）。
- **实测证据**：
  ```
  ① test.pdf(字节)      hash = fa4f75211d…
  ② eight-page.pdf(URL) hash = fa4f75211d…   ❌ 串成上一篇（应为 a086d6b1…）
  ```
- **根因**：`load()` 开头只清了 `_pdfHash` 和 `_pdfHashPending`，**漏清 `_pdfHashPromise`**。于是：
  1. 后续加载走进 `if (self._pdfHashPromise)` 分支，把**上一篇**的哈希写回 `_pdfHash`；
  2. `else`（`hashUrl` 补算）分支被跳过。
- **建议修复**：`load()` 开头补 `this._pdfHashPromise = null;`，并让哈希回写带**令牌校验**（见 H1）。
- **验收**：连续加载两份不同 PDF，哈希各自正确；`hashUrl` 场景补算能触发。

### D3 · P1 · 并发 `load()` 产生混合状态 ✅ 已修复（v4.9.0 / H1）

- **现象**：上一次 `load()` 尚未完成时再调一次 → 最终状态是两次加载的**混合体**。
- **实测证据**（模拟"大文件读取慢"，随后立即加载小文件）：
  ```
  期望 name=test.pdf, pages=3
  实际 name=test.pdf, pages=8     ❌ pages 来自上一次加载
  ```
- **根因**：`load()` 整条链路**没有并发令牌**。`AbortController` 只能中止 fetch（URL 路径），`File.arrayBuffer()` / `_getDoc()` 不可中止；先发起的慢加载后完成时会覆盖后发起加载写入的状态。
- **建议修复**：引入 `_loadToken`（自增序号），在 `load()` 入口与**每个 await 之后**比对，不匹配即丢弃结果（并销毁已创建的 pdf 文档释放资源）。
- **验收**：任意顺序的并发加载，最终状态始终属于**最后一次调用**。

### D4 · P1 · `_computeHashFromUrl` 缺陈旧性校验 ✅ 已修复（v4.9.0 / H1）

- **现象**：补算期间若发生换档 / `destroy()`，旧文档的哈希可能被写回，甚至已销毁实例仍触发 `hashready`。
- **根因**：该函数只捕获了 `_abortSignal`，但"请求已完成、结果尚未写回"这个窗口没有防护；也没有 `_destroyed` 判断。
- **建议修复**：同上引入令牌 + `_destroyed` 判断；写回前校验令牌一致。
- **验收**：补算进行中换档 → 不产生 `hashready`，`_pdfHash` 不被污染。

### D5 · P2 · 程序化 `load()` 失败不触发 `error` 事件 ✅ 已修复（v4.9.0 / H1）

- **现象**：README 事件表登记了 `error`，但只有 UI 触发路径（工具栏 URL 加载、文件选择、弹窗）会派发；直接 `picker.load(x)` 失败时**不派发**，调用方只能靠 `.catch()`。
- **建议修复**：统一在 `load()` 的失败出口派发 `error`（保留 reject 行为），文档同步说明。
- **验收**：`picker.on('error')` 能收到程序化加载失败。

### D6 · P2 · `toFlatJSON()` 不含 hash，与 `toJSON()` 不一致 ✅ 已修复（v4.9.0）

- **现象**：`toJSON()` 输出 `document.hash`，扁平结构完全不带，消费方按结构不同拿不到同一份指纹。
- **建议修复**：`buildFlatJSON` 补齐 `hash` / `hashAlgorithm`（与 `toJSON` 同源取值）。
- **顺带决策**：`toJSON()` 目前 **hash 为 null 时字段整个省略**（不是输出 `null`）——这正是最初"hash 值没了"的迷惑来源。建议二选一并写进文档：
  - (a) 始终输出 `hash: null`（结构稳定，但属行为变更，需评估下游）；
  - (b) 保持省略，但新增 `hashStatus: 'ok' | 'unavailable'`（无破坏性，**倾向此项**）。

### D7 · P2 · 文档与实现漂移 ✅ 已修复（v4.9.0）

- README 事件表写"全部 14 个"，实际 15 个（`hashready` 未登记）；
- `hashUrl` / `getHash()` 未进入"构造选项（全部 19 项）"与"API 参考"清单；
- d.ts 已补 `hashUrl` / `getHash`，但事件列表仍只写了一句注释。
- **建议修复**：以库内 `VERSION` 与代码常量为唯一事实来源，加**文档一致性检查脚本**（见 H7）。

### D8 · P2 · `importJSON()` 缺 try/finally，`_currentUserId` 泄漏 ✅ 已修复（v4.9.0）

- **现象**：导入循环中若 `_ensureStampImage()` 抛错（自定义章图加载失败等），`savedUserId` 不会被还原，选择器停在**最后一个导入的签署方**上。
- **建议修复**：`try { ... } finally { this._currentUserId = savedUserId; }`；并对单个签章点的失败做隔离（跳过并计数），不中断整批导入。
- **验收**：构造一个含坏章图的导入数据 → 抛错后当前用户不变，且已成功的签章点保留。

### D9 · P2 · 画布模式 `setPage()` 静默清空签章 ✅ 已加选项（v4.9.0：clearStampsOnSetPage）

- **现象**：纯画布模式（宿主渲染）每次 `setPage()` 都把 `_stamps` 清空 → 宿主要做多页签章时数据丢失，且无任何提示。
- **建议修复**：改为**按页保留**（`_stampsByPage` 或保留全部签章、由 `page` 字段过滤渲染），或至少新增 `clearStamps` 选项，默认不静默丢弃。
- **风险**：行为变更，需确认现有宿主是否依赖"换页即清空"。**建议先加选项、下个主版本再改默认值。**

### D10 · P3 · `_pdfBytes` 语义误导

- **现象**：字段名暗示"缓存了字节"，但 pdf.js 会 transfer 走，实测加载后 `byteLength === 0`（detached）。所有 source 分支都一样。
- **影响**：当前无功能缺陷，但任何后续想复用它（重新解析、导出原件、二次哈希）的代码都会**静默失败**。
- **建议修复**：二选一——(a) 明确改名为 `_pdfBytesRef` 并加注释说明"可能已 detached，勿复用"；(b) 需要保留时就**拷贝一份**（并加 `keepBytes` 选项，默认关，避免大文件内存翻倍）。

### D11 · P3 · 键盘微调的副作用放大
- **现象**：方向键微调每按一次都 `_commitActive()` → 每按一次 push 一条历史 + 跑一次重叠检测（可能连发 toast）。历史栈上限 50，长按方向键会迅速冲掉有价值的历史。
- **建议修复**：微调改为**合并提交**（防抖 ~300 ms 或"按键抬起/停止后"提交一次），重叠提示做节流。

### D12 · P2 · 中止/失败的加载残留"半成品文档"状态 ✅ 已修复（v4.9.0 / H1）

- **发现于**：v4.9.0 实施过程中的回归用例 ⑪（`abort()` 后 `toJSON().document.name` 仍是未加载完的文件名、`pages=1`，出现"名字显示了、文档却是空的"自相矛盾状态）。
- **根因**：`load()` 会提前写入 `_docName`（用于进度提示），但 `_resetDocState()` 只清画布/页数/哈希，**没清 `_docName`**；且 `abort()` 自增 `_loadToken` 后，在途 `load()` 走的是"被取代"分支（该分支按设计不清理状态），于是清理责任落空。
- **修复**：① `_resetDocState()` 补清 `_docName` / `_totalPages` / `_loadStage`；② 新增 `_discardHalfLoaded()`（仅在 `stage` 非 `ready`/`done` 时清理）；③ `load()` 失败出口、`abort()`（仅当确有未就绪加载在途）均调用它 —— 已完成加载的 `abort()` 仍是空操作。
- **验证**：用例 ⑪a/⑪b 通过；容器冒烟确认 `abort()` 对已加载实例状态零影响。

---

## 三、稳定性加固方案

### H1 加载生命周期统一化（**最高优先级**，直接消灭 D1–D4 一类问题）

建议引入一个内部"加载会话"概念，把散落的手工状态收口：

```
_loadToken 自增 → 本次加载的 token
  每个 await 之后   : if (token !== this._loadToken) return ABORTED;
  每个状态写入之前  : 同上校验（哈希、_pdf、_totalPages、页状态、hashready）
  失败/被取代出口    : 统一派发 error（D5）
  被取代时           : 销毁已创建的 pdf 文档，释放 worker 侧内存
```

配套：`loadTimeout`（默认 0 = 不限，>0 时超时 reject）、`abort()` 公开方法（可中止任意来源，含 File）。

**验收**：并发加载矩阵（File/ArrayBuffer/URL/纯URL 两两组合 × 快慢两种顺序）全部收敛到最后一次调用。

### H2 内存加固

1. **大文件 2× 峰值**：`_loadRemote` 先 `chunks.push()` 再 `new Blob(chunks).arrayBuffer()`，峰值约为文件大小 ×2。建议：已知 `Content-Length` 时预分配单个 `Uint8Array` 直接写入（进度照常上报），未知长度才回退到 chunks。
   > 200 MB 扫描件在移动端当前需要 ~400 MB 峰值，容易直接 OOM。
2. **历史快照去图**：`_history` 存 `JSON.stringify(this._stamps)` 快照，而签章点可能内嵌 `image.src`（base64 dataURL）。50 条历史 × N 个带图签章 = 内存成倍放大。建议快照**只存标量与图片引用 id**，图片单独走一个 `Map<id, dataURL>` 存放。
3. **销毁彻底性**：核对 `destroy()` 是否覆盖所有新增状态（`_pdfHashPending` 已补；建议改为按 `_stateFields` 清单统一清理，避免下次再漏）。

### H3 可观测性与错误分级

- 所有失败路径统一走一个 `_fail(err, stage)`：派发 `error`（带 `stage` 字段：`fetch` / `parse` / `hash` / `render` / `import`）+ 保留 reject。
- 新增只读诊断：`picker.getDiagnostics()` → `{ version, source, bytesCached, hashStatus, pdfjsSource, workerMode, compatPolyfills[] }`，便于内网现场排查（本次排查若早有此物会省很多事）。
- 错误信息统一加 `[PdfStampPicker]` 前缀（现有部分路径缺）。

### H4 输入与边界校验

- `importJSON`：校验 `page` 越界、坐标/尺寸为有限数、`userId` 重复、`version` 不兼容时给出可读提示；坏条目**跳过并计数**而非整批失败（对应 D8）。
- `setStampImage` / 自定义章图：加载失败给出明确错误，而非静默降级。
- `addStamp` / 坐标 API：对 `NaN` / `Infinity` / 负尺寸做防御。

### H5 网络能力补齐

- `credentials`（`omit` / `same-origin` / `include`）可配置 —— 当前固定默认值，跨域带 Cookie 的文件流接口无法工作。
- 可选 `referrerPolicy`、`cache` 透传。

### H6 兼容层收口

- 把 polyfill 清单（`Array.at` / `TypedArray.at` / `structuredClone` / `replaceAll`）集中为一张可查询表，`getDiagnostics()` 暴露"本次实际注入了哪些"。
- 兼容检测与 polyfill 注入逻辑加单测（模拟缺失 API），避免回归（v4.8.25 修过一次，靠的是手工回归页）。

### H7 测试与 CI 化

现状：回归靠手工打开 demo 页。建议：

1. 把 `demo/*-test.html` 统一成**可脚本化**的形式（页面把结果写入 `document.title` 或 `window.__RESULT__`），由一个 `test/run-browser-tests.js` 批量驱动；
2. Node 侧单测（`coords` / `json`）纳入同一入口；
3. 加**文档一致性检查**：`VERSION` vs `package.json` vs README 事件表条目数 vs d.ts；
4. 大 PDF 用例按需生成（已有 `test/gen_big_pdf.py`，产物已 gitignore）。

---

## 四、迭代排期建议

| 版本 | 主题 | 内容 | 预估 |
|---|---|---|---|
| **v4.8.28** | 紧急修复 | D1 transfer 竞态（✅ 已完成并回归） | — |
| **v4.9.0** | 稳定性 | ✅ 已完成：H1 加载生命周期统一（消灭 D2/D3/D4/D5）+ H2 内存（远端读取单块预分配 / destroy 统一释放 / 历史快照共享 image）+ H3 可观测性（`_loadStage` / `error.stage` / `hashStatus`）+ H4 部分（坏条目计数 + 非有限坐标校验）+ H5 网络语义可配（credentials/cache/referrerPolicy）+ D6/D7/D8/D9 | — |
| **v4.9.1** | 一致性打磨 | D11 键盘微调历史合并（D6/D7/D8/D9 已提前至 v4.9.0 完成） | 小 |
| **v5.0.0** | 架构演进 | 加载器抽象（SourceLoader 接口）、状态机化、渲染可插拔；D9 默认值变更、D10 收口 | 大 |

**建议的执行顺序**：v4.9.0 优先，因为 D2/D3 都是"用户会真实踩到且难以自查"的正确性问题，且与刚修的 D1 同源 —— 一次收口比逐个打补丁更划算。

---

## 五、验收标准（v4.9.0）

| 编号 | 场景 | 期望 |
|---|---|---|
| A1 | 连续加载两份不同 PDF（任意来源组合） | 哈希、页数、文件名三者同属最后一份 |
| A2 | 并发加载：慢的先发起、快的后发起 | 最终状态属于后发起者，无混合字段 |
| A3 | 内网模拟 + 20 MB + 文件流接口 | 哈希与 `sha256sum` 一致（已回归） |
| A4 | 补算哈希期间换档 / destroy | 无 `hashready`，`_pdfHash` 不被污染 |
| A5 | 程序化 `load()` 失败 | 派发 `error` 且 reject |
| A6 | 加载中 destroy | 无异常、无残留定时器/监听、pdf 文档已销毁 |
| A7 | 全部既有回归页 + Node 单测 | 100% 通过 |

### 实施结果（v4.9.0，2026-09-11）

| 编号 | 结果 | 证据 |
|---|---|---|
| A1 | ✅ | 回归 ②：A=`fa4f7521…` → B=`a086d6b1…`（与独立实例一致）；③ 切到纯 URL 后 hash=null 且 `hashStatus=unavailable` |
| A2 | ✅ | 回归 ①：慢 A 被快 B 取代，A 以 `AbortError` 结束，实例 `pages=8 name=eight-page.pdf pageNumber=1` |
| A3 | ✅ | `demo/hash-nonsecure-test.html` ⑤（20 MB 内网模拟） |
| A4 | ✅ | 回归 ④：`hashready` 次数 = 0，无泄漏，`_pdfHash` 为新文档哈希 |
| A5 | ✅ | 回归 ⑤：`error` 事件 `stage='parse'` 且 reject |
| A6 | ✅ | 回归 ⑦：`error` 事件 = 0，结果 `AbortError`，无未捕获异常 |
| A7 | ✅ | `demo/h1-lifecycle-test.html` **16/16**；`hash-nonsecure` 5/5；`edge90-sim`（默认+strict）通过；`modal-retest` 三次打开均真实渲染（774800 不透明像素 × 3，worker fetch=1）；Node 单测全过；容器端到端冒烟通过 |

**拍板结果**：① 立即执行（已完成）；② 采用「省略 hash + 新增 `hashStatus`」；③ D9 只加选项、默认保持 `true`、v5.0 再改；④ H2-1 仍按「预分配单块」实现（已落地，无额外成本）。

---

## 六、需要拍板的点

1. **v4.9.0 是否现在就做？** 我倾向做 —— D2/D3 与本轮 D1 同源，趁上下文热一次性收口。
2. **D6 的 JSON 行为**：`hash` 为 null 时，是"始终输出 `null`"还是"保持省略 + 新增 `hashStatus`"？**倾向后者**（零破坏性）。
3. **D9 画布模式换页清签章**：是否有现成宿主依赖这个行为？若是未知，则先加选项、v5.0 再改默认。
4. **D10 / H2-1（大文件内存）**：目标场景的最大 PDF 有多大？若有明确上限（如 ≤50 MB），H2-1 可降级为"仅提示"。
