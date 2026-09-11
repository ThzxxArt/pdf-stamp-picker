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

### D10 · P3 · `_pdfBytes` 语义误导 ✅ 已修复（v4.9.2：`keepBytes` + `_pdfBytesRef`）

- **现象**：字段名暗示"缓存了字节"，但 pdf.js 会 transfer 走，实测加载后 `byteLength === 0`（detached）。所有 source 分支都一样。
- **影响**：当前无功能缺陷，但任何后续想复用它（重新解析、导出原件、二次哈希）的代码都会**静默失败**。
- **建议修复**：二选一——(a) 明确改名为 `_pdfBytesRef` 并加注释说明"可能已 detached，勿复用"；(b) 需要保留时就**拷贝一份**（并加 `keepBytes` 选项，默认关，避免大文件内存翻倍）。
- **实际修复（v4.9.2）**：**两条都做**。(a) 补注释说明 `_pdfBytes` 交给 pdf.js 后即 detached、请勿复用；(b) 新增 `keepBytes` 选项（默认 `false` 省内存），为 `true` 时把字节**独立拷贝**一份到 `_pdfBytesRef`（File / ArrayBuffer / URL 三条 source 分支全覆盖）。

### D11 · P3 · 键盘微调的副作用放大 ✅ 已修复（v4.9.2：`beginHistoryGroup` / `endHistoryGroup`）
- **现象**：方向键微调每按一次都 `_commitActive()` → 每按一次 push 一条历史 + 跑一次重叠检测（可能连发 toast）。历史栈上限 50，长按方向键会迅速冲掉有价值的历史。
- **建议修复**：微调改为**合并提交**（防抖 ~300 ms 或"按键抬起/停止后"提交一次），重叠提示做节流。
- **实际修复（v4.9.2）**：没有用防抖（计时器会引入机器快慢相关的不确定行为、难以复现测试），而是把"**一次用户交互**"显式建模成协议：新增公开 API `beginHistoryGroup(key)` / `endHistoryGroup()`，由**结束事件**（keyup / pointerup / blur / destroy）驱动；同一 key 期间连续变更**覆盖栈顶**而非新增条目。顺带：`endHistoryGroup()` 同时清 `_histMergedKey`，`undo()/redo()` 会截断合并上下文（否则下一次变更会把刚撤回的一步原地覆盖）。重叠提示加 `dedupeKey` 节流（同一签章/同一秒只提示一次）。

### D12 · P2 · 中止/失败的加载残留"半成品文档"状态 ✅ 已修复（v4.9.0 / H1）

- **发现于**：v4.9.0 实施过程中的回归用例 ⑪（`abort()` 后 `toJSON().document.name` 仍是未加载完的文件名、`pages=1`，出现"名字显示了、文档却是空的"自相矛盾状态）。
- **根因**：`load()` 会提前写入 `_docName`（用于进度提示），但 `_resetDocState()` 只清画布/页数/哈希，**没清 `_docName`**；且 `abort()` 自增 `_loadToken` 后，在途 `load()` 走的是"被取代"分支（该分支按设计不清理状态），于是清理责任落空。
- **修复**：① `_resetDocState()` 补清 `_docName` / `_totalPages` / `_loadStage`；② 新增 `_discardHalfLoaded()`（仅在 `stage` 非 `ready`/`done` 时清理）；③ `load()` 失败出口、`abort()`（仅当确有未就绪加载在途）均调用它 —— 已完成加载的 `abort()` 仍是空操作。
- **验证**：用例 ⑪a/⑪b 通过；容器冒烟确认 `abort()` 对已加载实例状态零影响。

---

### D13 · P1 · 旋转页坐标与渲染器约定不符（180/270 导出镜像） ✅ 已修复（v4.9.1）
- **现象**：`/Rotate 180`、`/Rotate 270` 的页面，`screenToPdf` 的映射与 pdf.js `viewport.convertToPdfPoint` 不一致。以 180° 页为例，屏幕左上角本应映射到 PDF 右下角 `(W, 0)`，实际给出 `(W, H)`（右上角）——**上下镜像**。
- **为什么极难被发现**：`screenToPdf` / `pdfToScreen` 两条公式**互为逆运算**，所以界面上"点哪画哪"完全正常、往返自洽、中心映射也正确；只有把导出的坐标交给**标准 PDF 坐标系的渲染器**（后端盖章 / pdf-lib / 另一份 pdf.js）才会暴露——章跑到页面对侧。属于典型的"**自洽 ≠ 正确**"：只有与权威实现做**绝对方向**对账才能抓住。
- **根因**：旋转分支里把 y 的镜像项写反（180 用了 `y = H - cy/sy`；270 的 x 项同理），而既有 Node 单测只断言往返闭合与中心对中心，对"整体镜像/翻转"是盲的。
- **修复**：换算收敛为**唯一一份纯函数** `_internals.makeGeom / pdfCoordFromScreen / screenCoordFromPdf`（原型方法只做薄封装，杜绝公式副本），4 个旋转分支按 pdf.js `PageViewport.transform` 重推。
- **验证**：`demo/coords-vs-pdfjs-test.html`（4 旋转 × 正反向，与 pdf.js 最大偏差 **0.0000**）+ `demo/rot-coords-e2e-test.html`（**真实 `load()` 路径**：旋转 0/90/180/270 × CropBox 原点 0/非零 共 8 种页面 × 5 采样点 × 真实指针点击落点 + 回画，64 条断言全绿）+ `test/coords.test.js` 新增**绝对方向快照**（屏幕四角 ↔ PDF 四角，专门拦"自洽但方向错"，Node 侧即可跑）。
- **教训（写进测试基建）**：往返一致、中心对中心这类"不变量"无法约束绝对方向；凡涉及坐标系，必须有一个来自**外部权威实现**的锚点，并且要固化成可重复执行的断言，而不是靠一次性人工核对。

---

### D14 · P1 · 缺省章尺寸单位混淆（两条路径不一致，窄屏产出超大章） ✅ 已修复（v4.9.4）

- **发现于**：v4.9.3 的发布后 review（人工端到端在 412px 窄屏上放置签章时，发现章的尺寸异常）。
- **现象**：同一个 `stampSize`，两条放置路径得到**不同的物理尺寸**，且差值随显示缩放放大：

  | 容器宽 | 实际缩放 | `addStamp({x,y})` 缺省 | 在画布上点一下 | 章宽占页宽 |
  |---|---|---|---|---|
  | 900 px | 0.966 | 120.00 pt | **124.23 pt** | 20.9 % |
  | 480 px | 0.260 | 120.00 pt | **460.86 pt** | 77.5 % |
  | 360 px | 0.084 | 120.00 pt | **1428.67 pt** | **240 %** ❌ |

  → 导出坐标**取决于操作者的窗口宽度**，同文档不同人签署得到不同物理尺寸的章；窄屏（移动端）产出的章远超页面，且**没有任何运行时 API 可纠正**（无 `setStampSize`）。
- **根因**：`_stampDisplaySize()` 返回的是**显示尺寸（屏幕 px）**，而 `_defaultStampSize()` 直接 `return this._stampDisplaySize()`，注释还写着"**与点击放置完全一致**"。但两条路径的**单位处理不同**：点击路径把该显示矩形经 `screenToPdf` 换算（÷`_cssScale`）后才落库，`addStamp` 路径却把它**原样当 PDF 单位存**。于是**只有 `_cssScale === 1` 时两者才相等**——而 `_cssScale` 取决于容器宽度，在真实页面里几乎从不为 1。
- **修复（v4.9.4，行为变更）**：统一到 **PDF pt（物理尺寸恒定）**。
  1. 新增 `_stampSizePdf()` 作为章尺寸的**唯一真源**（PDF pt）；
  2. `_stampDisplaySize()` 改为 = `_stampSizePdf() × _cssScale`（未布局时 `_cssScale = 0` → 退化为 1×，避免 0 尺寸矩形）；
  3. `_defaultStampSize()` 返回 `_stampSizePdf()`。两路径在任何缩放下恒等，章恒占页宽固定比例（120 pt ≈ 4.2 cm，接近标准公章直径）。
- **消费者审计**：`_stampDisplaySize()` 全局只有 **1 个**消费者 `_stampRectAt()`（生成屏幕选区供点击放置），语义正好对齐；`_stampSizePdf()` 被 `_stampRectAt` 间接使用与 `_defaultStampSize` 直接使用。`minStampSize` / `maxStampSize` 已废弃、无夹取逻辑，无连带影响。
- **验证**：`demo/addstamp-size-test.html` 新增第 ⑥ 组（3 种容器宽度 × 真实点击 × 真实 `load()`）：章宽恒为 **120.00 / 120.00 / 120.00 pt**、两路差值 **0.000 / 0.000 / 0.000**、显示尺寸 = 120×scale（115.9 / 31.2 / 10.1 px）；`test/addstamp.test.js` 新增"显示尺寸 = 物理 × cssScale（含未布局退化）"断言，让 Node 侧也能拦这类回归。
- **变异测试（验证断言有效性）**：把两处改回旧行为 → ⑥-2/⑥-3/⑥-4 立即转红，且数字与缺陷记录**逐位吻合**（124.23 / 460.86 / 1428.67）；Node 侧新断言同样报红（`期望 7.392，实际 88`）。恢复后全绿。
- **教训（最值钱的三条）**：
  1. **断言两侧取自同一个函数 = 没测**。旧断言 `st.width === p._stampDisplaySize().w`，而 `addStamp` 的缺省**正是**从 `_stampDisplaySize()` 取的 → `f() === f()` 同义反复，永不可能失败；于是"与点击放置一致"这个**错误**的声明一路绿灯过了 v4.9.2 / v4.9.3 两轮回归。凡是"两路一致/extractor 与 impl 一致"的断言，期望值必须来自**与实现无共享来源**的常量或外部权威。
  2. **跨单位、跨坐标系的等价声明，必须在能体现差异的环境里测**。Node 没有布局 → `_cssScale` 恒为 1 → 该缺陷在 Node 侧**天然不可见**。补救办法不是放弃 Node 测试，而是找出**可以脱离布局钉死的比例关系**（"显示尺寸 = 物理尺寸 × `_cssScale`"），本次据此在 Node 侧也补上了拦截。
  3. **替身（mock）不要手工列举"要复制的原型方法"**。本次给库新增内部方法 `_stampSizePdf()` 后，`test/addstamp.test.js` 的手工艺品化 mock 没同步 → **修复版和变异版都**在 `addStamp` 里 `TypeError`，红得毫无信息量（看起来像库崩了，实际是替身过期）。改为 `Object.create(Picker.prototype)` 后自动免疫，并加"替身自检"组，让替身过期立刻**指名报错**而不是伪装成缺陷。



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
| **v4.9.1** | 坐标正确性 + 测试基建 | ✅ 已完成：D13 旋转页坐标与 pdf.js 约定对齐（含裁剪原点 + 旋转组合）+ H7 回归基建（`test-harness.js` 统一断言协议、`run-all.html` 一键聚合 7 套件 109 条、`docs.test.js` 文档一致性、Node 侧绝对方向快照）；D11 顺延 | 中 |
| **v4.9.2** | 一致性打磨 | D11 键盘微调历史合并 + 重叠提示节流 | 小 |
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

## 五之二、坐标正确性（v4.9.1）验收与实施结果

| 编号 | 场景 | 期望 | 结果 |
|---|---|---|---|
| B1 | 4 种旋转（0/90/180/270）正反向换算 vs pdf.js | 偏差 < 0.02 pt | ✅ 最大偏差 **0.0000** — `coords-vs-pdfjs-test.html` 8/8 |
| B2 | 真实 `load()` 后 `_rotation` / `_offsetX` / `_displayW` 与实际页面一致 | 一致 | ✅ 8 种页面（4 旋转 × CropBox 原点 0/非零）全部识别正确 |
| B3 | 在旋转页上**真实点击**，落点 PDF 坐标 = pdf.js 同点值 | 一致 | ✅ 逐点偏差 0.0000（含裁剪原点组合） |
| B4 | 落点回画（绘制路径）回到被点击的屏幕点 | 一致 | ✅ 误差 < 0.005 px |
| B5 | 非零 CropBox 原点 + 旋转的叠加 | offset 不能与旋转项串号 | ✅ `crop-rot0/90/180/270.pdf` 四例全过 |
| B6 | 全部既有回归 + Node 单测 + 文档一致性 | 100% | ✅ `run-all.html` **7 套件 109/109**（25.5 s）；`coords` 123 项、`json`、`docs` 15/15 |

**H7 测试基建落地**：
- `demo/test-harness.js` —— 统一断言协议 `__TEST.start/expect/record/finish/summary()`，结果挂 `window.__RESULT__`，标题实时显示 `PASS/FAIL n/m`，并兜底捕获页面未捕获异常 / Promise 拒绝；
- `demo/run-all.html` —— iframe 顺序驱动全部回归页 + 超时/漏跑检测，输出单一结论；
- `test/docs.test.js` —— 版本号 ↔ `package.json` ↔ demo 缓存戳、构造选项 ↔ README ↔ d.ts、事件表 ↔ 源码、公开方法 ↔ d.ts（15 项）；
- `test/gen_rotated_pdf.py` 扩展 —— 零依赖手写 PDF 字节，生成 `rot*.pdf` 与带非零 CropBox 的 `crop-rot*.pdf`。

**测试基建踩坑（已写进 README 提示）**：
1. demo 页的库引用**和** `test-harness.js` 都必须带 `?v=<版本>` 缓存戳；只升库不升 harness → 浏览器用旧 harness → 假失败（本次真实踩到）。
2. 调试期用外部工具（如浏览器 JS 注入）往页面里塞脚本，脚本自身报错会被 harness 记成「未处理的 Promise 拒绝」，表现为 `total` 比 `expect` 多 1、日志里却看不到失败行 —— 看到这种"多 1 条"优先怀疑**注入/页面脚本自身**的异常，而不是被测库。
3. `expect()` 必须等于 `record()` 实际条数；写成"设想中的条数"会把通过的页面判成 FAIL（本次两页都中招）。

---

## 五之三、签章尺寸单位一致性（v4.9.4）验收与实施结果

| 编号 | 场景 | 期望 | 结果 |
|---|---|---|---|
| C1 | 3 种容器宽度（900 / 480 / 360 px）下 `addStamp()` 缺省章宽 | 恒为 120 pt | ✅ **120.00 / 120.00 / 120.00** |
| C2 | 同 3 种缩放下**在画布上真实点击**放置的章宽 | 恒为 120 pt | ✅ **120.00 / 120.00 / 120.00**（修复前 124.23 / 460.86 / **1428.67**） |
| C3 | 两路物理尺寸差（逐对比值） | 0 | ✅ **0.000 / 0.000 / 0.000** |
| C4 | 显示尺寸 = 120 × 当前缩放 | 成立 | ✅ 115.9 / 31.2 / 10.1 px（缩放 0.966 / 0.260 / 0.084） |
| C5 | 未布局（`_cssScale = 0`）时显示尺寸 | 退化为 1×，不得为 0 | ✅ 120（`addstamp.test.js`） |
| C6 | **变异测试**：把两处改回旧行为 | 回归必须报红 | ✅ ⑥-2/⑥-3/⑥-4 转红，数字与缺陷记录逐位吻合；Node 新增断言报红（`期望 7.392，实际 88`） |
| C7 | 全量回归 | 100% | ✅ `run-all.html` **10 套件 176/176**，两轮一致（37.2 s / 35.7 s，无 flaky）；Node **6 套**（docs 21 / json / coords 123 / history 25 / addstamp 15 组 / docmeta 10 组） |

**消费者审计**：`_stampDisplaySize()` 唯一消费者 = `_stampRectAt()`（屏幕选区）；`minStampSize` / `maxStampSize` 已废弃无夹取逻辑 —— 无连带影响。

**为何旧回归没能拦住**：旧断言 `st.width === p._stampDisplaySize().w` 的两侧**同源**（`addStamp` 缺省本就是从它取的），是 `f() === f()`，永不可能失败。新断言把期望值锚在**与实现无共享来源的常量**（`88 × cssScale`、`120`）上，并补了"显示尺寸 = 物理 × 缩放"这条**可脱离布局**的比例关系，使 Node 侧也能拦截。

---

## 六、需要拍板的点

1. **v4.9.0 是否现在就做？** 我倾向做 —— D2/D3 与本轮 D1 同源，趁上下文热一次性收口。
2. **D6 的 JSON 行为**：`hash` 为 null 时，是"始终输出 `null`"还是"保持省略 + 新增 `hashStatus`"？**倾向后者**（零破坏性）。
3. **D9 画布模式换页清签章**：是否有现成宿主依赖这个行为？若是未知，则先加选项、v5.0 再改默认。
4. **D10 / H2-1（大文件内存）**：目标场景的最大 PDF 有多大？若有明确上限（如 ≤50 MB），H2-1 可降级为"仅提示"。
