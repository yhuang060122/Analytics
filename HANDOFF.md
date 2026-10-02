# Analytics — 项目 Handoff

> 生成时间：2026-10-02 · 起点 commit `cb05371` "refactor"，其上的简化**尚未提交**
> 验证基线：`npm --prefix tests run test` → **85/85 绿**；`npm --prefix demo run build` → tsc 0 错；`npm --prefix build run build` → 产物落在 `dist/`
> 规模：源码 **2051 行 / 27 个 .ts**（起点 41 个），测试 **2708 行 / 6 个 .mjs / 85 个用例**
> 产物：`dist/analytics.js` 一个（`<script>` 构建已删，见 §6 C 类）
> 公共 API：**10 项**（起点 15 项，净减 5）
> 覆盖范围：全部源文件、6 个测试文件、两版 README、评审文档、三个岛的工具链配置
> **简化进度**：八步简化 + 修完全部已知缺陷（79 个测试全绿） —— ① debug 的 DOM inspector 面板整块删除，只留 console；② `stage-colors.ts` 内联、detect 的 Angular 探测删除、**EventQueue 的重试与退避机制整体删除**（用户拍板"连重试机制一起砍"）；③ **Angular adapter 整个目录删除**（252 行）；④ **jQuery adapter 整个目录删除**（165 行）；⑤ **`adapters/network/` 与 `detect.ts` 整个删除**（168 + 53 行），`NetworkTrackerCore` 内联进 `FetchTracker`（次日即随它一起删除，见 ⑥）；⑥ **`adapters/` 整个目录消失** —— 只留 ClickTracker 与 PageTracker 并移进 `core/probes/`，`page-context.ts` 进 `core/domain/`，`FetchTracker` 删除（网络追踪能力整类消失）；⑦ **`<script>` 构建整条产物线删除**（`iife.ts` 103 行），只留一个 ESM 产物；⑧ **debug 层的 event bus 合并进 controller**（`event-bus.ts` 127 + `plugin.ts` 32 行消失），顺带修掉一个泄漏：**匿名 `bus.subscribe()` 的订阅者能活过 `destroy()`**；同时修掉 `cssClass` 在 SVG 上是对象不是字符串

---

## 1. 一句话定位

浏览器端前端埋点 SDK。零运行时依赖，TypeScript 源码直供消费（不是 npm 包），单一 ESM 产物，配一个 Vite 多页 demo 和一个用架构测试自我约束的引擎层。

代码风格有一条贯穿全局的规矩：**注释解释"为什么"，不解释"是什么"**。这个仓库的注释密度远高于平均水平，且大量记录了"这里以前错在哪"——这是刻意维护的资产，改代码时不要顺手删。

---

## 2. 当前架构

```
core/                  整个 SDK，31 个源文件
  api/                 Analytics 门面 + 契约（EventRecorder / Tracker / BaseTracker）
  probes/              ClickTracker、PageTracker —— 唯一的两个探针
  domain/              event / context / session / id / page-context
  factory/             EventFactory：track() / page() → AnalyticsContext
  queue/               EventQueue：批处理、溢出丢最旧（无重试）
  transport/           Destination 端口 + HttpDestination
  debug/               横切观察者：bus + plugin 端口 + console 唯一内置
  dom.ts / warn.ts     hasDom() 守卫 / warnOnce() 降级必须出声
index.ts               公开 barrel（导出全部）
```

**`adapters/` 目录已不存在**（2026-10-02 第 6 步）。两个探针在 `core/probes/`，
`page-context.ts` 在 `core/domain/`。**"core 永不 import adapters" 这条铁律连同
它的架构测试一起没了** —— 因为已经没有可以反向依赖的东西。现在由
`probes depend on the recorder port, not the Analytics class` 与
`nothing outside core/probes listens to the page` 两条新断言守着探针的边界。

**装配方式**（2026-09-28 拍板"不用 init / auto-detect"，2026-10-02 加了 `probes`）：

```ts
const analytics = new Analytics({
  endpoint: "/api/analytics/events",
  probes: [
    recorder => new PageTracker(recorder),
    recorder => new ClickTracker(recorder),
  ],
});
analytics.start();     // probes 只注册；start() 才启动全部
```

手写 `new` + `registerTracker()` 照样能用，两者可混用。

**`probes` 收工厂函数而不是类，这是必须的**：探针构造函数需要 recorder，
而 recorder 正是正在构造的那个对象 —— `probes: [PageTracker]` 在类型上就不成立。
传函数还让选项照样能传到探针（`recorder => new ClickTracker(recorder, { attribute })`），
并且**引擎不需要认识任何具体探针**。

**⚠️ 别把它改成命名开关**（`probes: ["page", "click"]`）：那需要在引擎内部维护
一张"名字 → 类"的表，而那张表就是九月刻意删掉的注册表 —— 引擎会从此知道有哪些
探针，新增一个就成了引擎改动。`probes: ["page"]` 这个形态**被用户明确否掉**，
选了工厂函数形态。

新架构断言 `the engine never names a concrete probe` 守着这条：扫 `core/api/`
全部 `.ts`，任何 import 探针路径即红。**双向验证过。**

没有 `init()`、没有 auto-detect、没有配置别名层、没有 adapter 注册表。
**网络请求追踪能力已整类消失**（`FetchTracker` 在第 6 步删除）——
SDK 只报 `Element Clicked`、`Page Duration` 和宿主自己调 `track()`/`page()` 的事件。
需要网络追踪的宿主得自己发。

### 被机器守住的不变量

`tests/architecture.test.mjs`（16 个用例）把架构约束写成断言，改坏了会红：

| 断言 | 守的是什么 |
|---|---|
| `probes depend on the recorder port, not the Analytics class` | 探针只 import `core/api/tracker`，不碰门面（否则就得整机实例才能测） |
| `nothing outside core/probes listens to the page` | 只有 `api/analytics.ts` / `queue` / `transport` 三个文件可挂监听器，且每个都成对移除 |
| `the engine never names a concrete probe` | `core/api/` 不得 import 探针 —— 守的是"`probes` 收工厂函数而不是类"这个决定 |
| `the SDK imports no runtime package at all` | SDK 只 import 自己的相对模块（原来只守 jQuery，现在绝对） |
| `the library entry starts nothing on import` | 任何模块都不得在 import 时构造对象或挂监听 |
| `page context is read from one module` | `pagePath/pageUrl/pageTitle` 三键只从 `domain/page-context.ts` 读 |
| `every probe inherits BaseTracker instead of hand-rolling it` | 幂等标志在基类，子类不可能忘记守卫 |
| `every listener the SDK registers can be removed again` | 匿名 listener 是 destroyed 实例仍刷新的元凶 |
| `only the two islands install anything` | 根目录保持无 `package.json`、tests 零依赖 |
| `every compiled file still has a source file` | `.build` 里不许有源文件已删的孤儿产物 |
| `npm test runs every test file` | 新测试文件忘了登记会报错 |

**原来那条 `core never imports adapters`（源码 + 编译产物双查）已随目录一起消失。**
没有可反向依赖的东西时，那条断言只是在检查一个不存在的路径 —— 但它的**意图**
（探针不能反过来依赖引擎）由上面第一条以更强的形式继承了。

**新增测试文件必须两处登记**：`tests/package.json` 的 test 脚本（手工枚举，cmd 不展开 glob）+ 上一条断言会自动兜底。

---

## 3. 命令速查

| 目的 | 命令 |
|---|---|
| 跑测试（改过 `analytics/` 下任何东西后必跑） | `npm --prefix tests run test` |
| 严格 typecheck + 构建 demo | `npm --prefix demo run build` |
| 打 SDK 产物 | `npm --prefix build run build` |
| 起 demo（5173） | `npm --prefix demo run dev` |

首次准备：`npm --prefix demo install && npm --prefix build install`（`tests/` 装不了任何东西，它借 demo 的 tsc）。

Demo 三个页面各测一件事：`/` 点击 + 手动事件 + 突发批量；`/portfolio` 第二个页面（会话延续）；`/watchlist` 独立的手动事件。mock collector 在 `demo/vite.config.ts`，含一个 `/api/analytics/outage?state=on` 开关专门用来把丢弃路径跑出来。开启 `debug.console` 后每个流水线阶段都打进 devtools console，页面本身不挂调试 UI。

---

## 4. 缺陷记录（全部已修，留作教训）

### ~~P1 — `PageTracker` 构造时摸 `window`，SSR 直接抛~~ —— **已修（2026-10-02）**

原因：`private currentPath = window.location.pathname` 是**字段初始化**，构造时执行。
`core/dom.ts` 明文写着"构造它、再销毁它，必须在哪都安全"，而这个探针违反了它。

修法（两处，不止一处）：

1. **字段初始化改成 `""`**，改在 `onStart()` 里读 `window.location.pathname`。
   顺带 `enteredAt` 从 `performance.now()` 改成 `0`（同理）。
2. **两个探针都加上 `canStart(): boolean { return hasDom(); }`**。
   修完第 1 点后暴露出第二层问题：`onStart()` 摸 `document`，而
   `BaseTracker.canStart()` 默认返回 true，所以**无 DOM 时 `start()` 照样抛**
   （实测两个探针都抛）。这正是 `canStart()` 被保留的原因 ——
   简化第 4 步说过"今天没有探针需要它"，结果**需要它的正是最后留下的这两个**。

**测试盲区才是它活这么久的原因**：`robustness.test.mjs` 的 SSR 用例只
`new Analytics()`，从没 new 过探针。已扩成 `every probe survives construction and
start without a DOM`，覆盖构造 / start / isRunning / 整条链。
**双向验证过**：把字段初始化改回 `window.location.pathname` → 报红；还原 → 转绿。

### ~~P1 — 双 `FetchTracker` 乱序拆卸~~ —— **已随 `FetchTracker` 一起消失**

`FetchTracker` 在第 6 步被删除，这个问题不再存在。

### P1 — 匿名 `bus.subscribe()` 的订阅者能活过 `destroy()` —— **已修（2026-10-02 第 8 步）**

**实测复现**：`destroy()` 之后手动 `debug.bus.emit()`，匿名订阅者仍被送达 4 次。

原因：`teardown()` 只遍历 `DebugController` 自己的 `Map<string, PluginEntry>`，
而匿名订阅者只存在于 `DebugEventBus.listeners` 这个 `Set` 里。两份簿记，
靠一个 `onDrop` 回调保持同步 —— 而 `onDrop` 只在"连续失败三次被退订"时触发，
正常订阅路径上**根本不会**通知 controller。于是 controller 以为世界已经干净，
bus 里还挂着活人。

这不是"简化顺带修掉的"，是简化**暴露**的：正因为两份簿记要靠回调同步，
才值得问一句"回调漏了会怎样"。

修法不是给回调补一个 case，是**消掉第二份簿记**：

- `DebugEventBus` 与 `plugin.ts` 整个删除，失败计数与 try/catch 并进 controller
  自己的 `PluginEntry`（多了 `failures` 一个字段）。
- **`bus` 字段从 controller 上移除** —— 匿名订阅这条路不存在了。
  `registerDebugPlugin(name)` 是唯一入口，因此 `teardown()` 遍历注册表就是穷尽的。
- 顺带：插件的 `stop()` 现在包在 try/catch 里，且**条目先离开 Map 再调 stop** ——
  拆卸抛错不会让一个已摘掉的插件还留在 `debugPlugins` 名单上。
- `enable()` / `disable()` 一起删掉（`disable()` 零调用；`enable()` 只被构造函数
  用）。`enabled` 变成构造期一次决定的 `readonly`。
- `core/debug/index.ts` 从 `export *` 改成具名 `export type` —— 内部 helper
  挪个文件就会意外变公开。

**新的架构断言** `nothing in the SDK offers an anonymous debug subscription`：
扫全部 `.ts`，任何 `subscribe(` 调用即红。**双向验证过**（往 controller 注入
一个匿名 subscribe → 报红；还原 → 转绿）。

### P2 — `Element Clicked` 的 `cssClass` 在 SVG 上是对象 —— **已修（2026-10-02）**

`element.className` 对 SVG 元素返回 `SVGAnimatedString`，事件里就塞了一个
非 JSON 值。改法一行：`element.getAttribute("class")`（对所有元素都是字符串，
属性缺失时为 `null`，与原来的 `|| null` 语义一致）。

新用例 `cssClass is a plain string, whatever the element is` 用一个
`className: { baseVal: "icon" }` 的假元素复现原形状，并断言
`JSON.stringify(properties)` 里不出现 `baseVal`。**双向验证过。**

顺带把 `tracker-port.test.mjs` 里两个已有假元素从"有 `className` 无 `getAttribute`"
改成真实的 `getAttribute` 形状 —— 原来的桩比浏览器宽容，正是 §5 第 1 条那条铁律。

### 已在去 inspector 那轮顺手修掉

- ~~`tests/tsconfig.build.json` 引用已删的 `auto-track.ts` / `adapters/index.ts`~~ —— 已删。
- ~~`architecture.test.mjs` 为已不存在的组合根开豁免~~ —— 已删。
- ~~`tests/.build` 陈旧产物~~ —— 换成一条断言（见 §5 第 6 条），比清理更可靠。
- ~~`browser-stub.mjs` 里为 inspector 面板准备的 DOM 桩（`createElement` / `appendChild` / 真实 `textContent` 语义）~~ —— 已删，理由见 §5 第 1 条。

---

## 5. 隐性知识（从代码里读不出来、但踩过坑才知道的）

1. **测试桩必须不比被测系统更宽容。** 这个坑踩了三次，都记在评审文档里：① 只挂 `window.location` 没挂 `globalThis.location`（浏览器里 `window` **就是**全局对象，桩里不是）；② 手工赋值 `window.fetch` 导致"该装没装"和"运行时没有 fetch"不可区分；③ 假 fetch 不监听 `signal` 的 abort，AbortController 形同虚设。**本次复核又发现第四处**：`browser-stub.mjs` 只设了 `globalThis.fetch`，没设 `window.fetch`（两者在桩里是不同对象），所以任何直接摸 `window.fetch` 的新测试第一版一定是错的——我就是这么误判了 FetchTracker 的表现。写新测试前先确认桩镜像了真实浏览器的哪条 global 链。

2. **删除操作在本 IDE 里会被劫持。** 两条独立的坑：① Bash 沙箱对删除计数（单轮 >50 次全拒），`npm run build` 依赖 unlink 临时文件 `tsup.config.bundled_*.mjs`，被拒后下一轮恢复；② 更要命的是 **Node 侧的 `fs.rmSync` 也被包装**成"安全删除"（走 `genie-trash` 回收站二进制），删 `tests/.build` 这种几百文件的目录直接 `ETIMEDOUT`，而且**会先删一半再失败**，留下更糟的中间态。想清目录别在 Node 里递归删 —— 用断言守住不变量（见第 9 条）。

3. **外部进程会回写 SDK 文件。** 历史上 `build/tsup.config.ts` 的 `outDir` 被回写成 `"./dist"`，导致产物落到 `build/dist` 而非 `dist/`。正确值是 `"../dist"`。**每次构建后确认产物落点**（本次已确认正确）。

4. **npm 会漏装 rollup 的 win 原生包**（npm/cli#4828）。`build/package.json` 的 `optionalDependencies` 里钉了 `@rollup/rollup-win32-x64-msvc`，别删。首次 `npm install` 可能遇到 esbuild postinstall `spawnSync node.exe EBUSY`，重跑一次即好。

5. **keepalive 只给最后一发。** per-call 经 `EventQueue.flush({keepalive:true})` 透传，只在 tab-hidden / beforeunload 使用。理由在重试被砍掉之后**变得更强**了：普通批次花掉浏览器的 keepalive 预算，会让最后那次请求失去名额，而它现在既不能重试、页面也马上就要卸载 —— 那一发丢了就是真丢了。body > ~60KB 自动关掉该 flag（Chrome 直接 TypeError，带不带都一样会失败）。

6. **网络事件只有两个名字**：`API Request` / `API Error`，靠 `properties.transport`（现在只有 `fetch`，以及未告知来源时的 `unknown`）区分。历史上有人想加 `successEventName` / `errorEventName` / `enrich()`，都被删了——它们的存在暗示"某个 transport 可以另起名字"，而那正是这个模块要防的。新增 transport 只写挂载代码。

7. **点击文本默认不上报。** `Element Clicked` 的 `text` 只有元素带 `data-analytics-text` 时才填，否则 `null`（键保留）。textContent 是最容易带 PII 的属性，不要"顺手改成总是上报"。

8. **降级必须配 `warnOnce`**（key 区分不同问题）。静默降级等于隐形 bug——仓库里这条铁律已经贯彻到 `createId` 的三级回退、`Session` 的 storage 兜底、`record()` 的边界、debug bus 的三次失败退订。

9. **`.build` 里的陈旧产物用断言治，不用删除治。** tsc 只覆盖它编译过的文件，从不删掉源文件已删的旧产物；因为没人 `require` 它，测试照绿，`tests/.build` 就默默声称一个源码树里已不存在的模块。`architecture.test.mjs` 里 "every compiled file still has a source file" 把 `rootDir: analytics/` 的路径映射对齐后逐个反查源文件——**删了源文件，这条断言就红**。加新断言时记得路径要补上 `analytics/` 那一层，别写成 `.build/x.js → analytics/x.ts` 之外的形式。

10. **测试桩的宽容度会随被测系统一起变化。** 删掉 inspector 面板后，`browser-stub.mjs` 里那套 `createElement` / `appendChild` / 真实 `textContent` 语义的 DOM 桩就没有消费者了，已一并删掉。留着它的问题是：它比真实浏览器宽容，会诱导人写出"桩里过、浏览器里挂"的测试（比如重渲染时 `textContent = ""` 是否真的清空子节点）。要测 DOM 行为就用真实 DOM，不要扩 fake。

---

## 6. 还能砍什么 / 优化什么（2026-10-02 全量复核）

复核基线：见文首规模行。下面每条都查过实际消费者，不是"看着像冗余"。

### A 类：零消费者 —— **已于 2026-10-02 全部砍掉**

| 项 | 处理 | 结果 |
|---|---|---|
| **`Session` 整类退出公共 barrel** | 从 `domain/index.ts` 摘掉 `export * from "./session"` | 公共 API 少一项。`EventFactory` 改为直接 `import { Session } from "../domain/session"` —— **它是唯一的内部消费者，第一版漏了它、tsc 报出来才发现** |
| **`Session.reset()`** | 保留方法（8 处测试靠它隔离状态），但随类一起不再对外可见，注释写明"它存在是为了测试" | 从"公开 API"降为"内部工具" |
| **`clear()` 整条链** | 删掉 `Analytics.clear()` 与它转发的 `EventQueue.clear()` | 两层都是死代码，删了没人知道 |
| **`PageContext` 接口** | 删掉接口，`readPageContext()` 的返回类型改成内联对象字面量 | 零处按它标注，导出它只是多一个名字。键仍由 `page context is read from one module` 断言钉住 |
| **`maxQueueSize`** | 从 `AnalyticsConfig` 与 `EventQueueOptions` 移除，值内联为 `MAX_BUFFERED_EVENTS = 500` 常量 | 行为完全不变（没有任何宿主设过它），只是不再可调 |

**净效果**：公共 API 15 → **11 项**（第 8 步再降到 10）。

**行数反而 +5**（2118 → 2123）—— 因为删掉的 24 行逻辑换成了 29 行注释
（解释每个决定**为什么**，这是本仓库的规矩）。**别把这当成"白干"**：
`maxQueueSize` 那段注释现在说明了"为什么不可配置"以及"真需要更大缓冲区的宿主
应该找别的方案"，这比那个配置项本身值钱。

**唯一的行为改动**：溢出测试从 `maxQueueSize: 3`（4 个事件）改成真的 enqueue
500 个 —— 现在测的是实际发布的那个数字。

### B 类：功能缺口（不是"该砍"，是"该加"）

| 项 | 说明 |
|---|---|
| ~~**SPA 路由追踪**~~ | **用户 2026-10-02 明确决定不做**：他会用 Angular 的路由来追踪，SDK 只保留基础功能。分工是对的 —— 路由本来就知道何时落定、参数是什么、是不是前进/后退，SDK 去 patch 全局 History 猜这些只会更不准，而且是 patch 页面上所有库共享的东西。宿主用 `analytics.page(path?)` 自行上报（该 API 完好，已核实） |
| **`PageTracker` 的 title 走 `readPageContext()`** | 它自己读 `document.title`，而 click 探针走共享的 page reader。不受"三键同源"断言管（它只有 title 一个键），但行为不一致 |

### C 类：结构冗余，收益小但能顺手做

| 项 | 说明 |
|---|---|
| ~~**`iife.ts`（103 行，占 5%）**~~ | **已删（2026-10-02）** —— 它零行为测试覆盖，却要带一整条产物线、一个要挡在 barrel 外的额外入口、一个全局名、一条没法关掉的自安装路径。`tsup.config.ts` 从数组配置简化成单对象，`dist/` 只剩一个产物。配套的架构断言换成了 `the library entry starts nothing on import`（守住"import 不得启动任何东西"这个它本来就在守的承诺） |
| ~~**debug 子系统 432 行 / 20%**~~ | **第 8 步已瘦身到 372 行 / 4 个文件**，但没砍功能 —— 砍的是**重复的簿记**：`DebugEventBus` 与 `DebugController` 各存一份订阅者（Map + Set/WeakMap），靠 `onDrop` 回调保持同步。合并后注册表是唯一入口，**顺带修掉一个泄漏**（见 §4）。三次失败退订、`stop()` 拆卸、console 内置全部保留 |
| **`Destination` 端口抽象（37 行）** | `EventQueue` 只依赖它，`HttpDestination` 是唯一实现，且这层抽象是"传输可替换"这个已经不存在的能力留下的。删掉的话 `EventQueue` 直接依赖 `HttpDestination` —— 但那样 `queue.test.mjs` 就得 stub 一个具体类而不是接口，测试会变脆。**我倾向留着**，抽象本身很轻 |
| **`EnterPoint` 测试文件归类** | `robustness.test.mjs`（21 用例 / 727 行）已经成了杂物袋：session、id、queue、debug、transport 的单元测试都在里面。拆分（`domain.test.mjs` / `transport.test.mjs`）能提高可读性，但不减代码量 |

### D 类：别砍（我查过 tempting 但错的）

- **`BaseTracker.canStart()`** —— 第 4 步我以为没用了，结果修 SSR bug 时**两个探针都在用**。它是有使用者的。
- **`EventQueue.inFlight` 并发逻辑（~20 行）** —— 没有它，并发 `flush()` 会让 `await flush()` 提前 resolve，`close()` 的"缓冲区已处理完"就是假的。`queue.test.mjs` 有专门用例。
- **`keepalive` 字节闸门（60KB）** —— Chrome 对超大 body 直接 TypeError，带不带 flag 结果一样但重试会永远失败。
- **`warnOnce`** —— 6 个调用点覆盖 10 条降级路径，静默降级等于隐形 bug。

### 我建议的下一步

**已经没有已知缺陷了。** A 类清完、`cssClass` 修完、SPA 路由追踪由你明确排除、
`iife.ts` 删掉、debug 的重复簿记消掉。79/79 测试绿，三条命令全过。

**剩下的都只是取舍，不是缺陷**：

| 项 | 我的看法 |
|---|---|
| **`Destination` 端口抽象（37 行）** | 倾向留着。抽象很轻，删了反而让 `queue.test.mjs` 得 stub 一个具体类而不是接口，测试会变脆 |
| **`robustness.test.mjs` 拆分** | 21+ 用例的杂物袋（session / id / queue / debug / transport 都在里面）。拆成 `domain.test.mjs` / `transport.test.mjs` 提高可读性，但**不减代码量**，纯整理 |
| **debug 子系统（372 行 / 19%）** | 已从 432 瘦到 372，且没砍功能。要再往下砍就得先回答"这个 SDK 需不需要一个可观察性出口"—— 你目前的用法是 `debug.console`，而插件 API 只有 demo 在用。**这不是代码量问题，是产品定位问题**，别当成瘦身任务做 |
| **`iife.ts` 已删** | 少一条产物线。如果将来 `<script>` 引入是真需求，那是一个明确的新增，而不是"把删掉的加回来" |

**如果一定要找下一件事**：把 `robustness.test.mjs` 拆开。理由不是"更干净"，
而是它现在 21 个用例横跨 5 个子系统，改任何一个都要在 700+ 行里定位 ——
拆分能让未来的每次改动都更不容易出错。

---

## 7. 文件地图（改代码前先看这里）

按行数排序 —— 大的地方改动影响面最大。

```
analytics/                                    2118 行 / 30 文件
  index.ts                    14  公共 barrel（导出全部）
  core/
    queue/event-queue.ts     270  批处理、定时 flush、溢出丢最旧、online 重发
                                         peek-then-splice：发送成功才出队
    api/analytics.ts         310  门面：registerTracker/start/destroy/close/track/page/flush
                                         + wireProbes（消费 config.probes）
    api/tracker.ts            115  EventRecorder + Tracker + ProbeFactory + BaseTracker
    transport/
      http-destination.ts    225  POST + 超时 + keepalive 字节闸门
    debug/
      debug-controller.ts    253  注册表 + 故障隔离 + console 内置
                                         （原 event-bus.ts 与 plugin.ts 已并入）
      console-plugin.ts       58  唯一内置（颜色表已内联其中）
      debug-event.ts          44  PipelineStage / DebugFailureReason
      index.ts                17  具名导出（不再 export *）
    domain/
      session.ts             124  sessionStorage 全 try/catch，降级到内存会话
      id.ts                  103  createId：randomUUID → getRandomValues → Math.random
      event-factory 归 factory/  77  （这里也读 window，故 SSR 下只能 record 不能直接调）
      page-context.ts         36  readPageContext() —— 三键唯一来源
    probes/
      page-tracker.ts        115  page / Page Duration
      click-tracker.ts       112  data-analytics 属性 → Element Clicked
    dom.ts                     15  hasDom() —— 构造期摸 DOM 的代码都要走它
    warn.ts                    22  warnOnce() —— 降级必须出声

demo/src/analytics.ts         demo 的组合根（装配样板在这看）
demo/vite.config.ts           mock collector（含 outage 开关）

tests/architecture.test.mjs   492 行 / 16 条不变量
tests/robustness.test.mjs     727 行 / 21 条 —— 已是杂物袋（见 §6 C 类）
tests/browser-stub.mjs         97 行  浏览器桩 —— 加新测试前先读，见 §5 第 1 条
build/tsup.config.ts                  双产物配置；outDir 必须是 "../dist"
```

**没有 `adapters/` 了**（第 6 步简化）。找文件时注意探针在 `core/probes/`，
共享的 page reader 在 `core/domain/page-context.ts`。

---

## 8. 维护约定（改之前先确认，别顺手破坏）

- **UI 文案与代码注释一律英文**（用户明确要求）。
- **文件命名统一短横线**（`event-queue.ts`），core 早期用点式的历史已全部改掉。
- **新增探针**放进 `core/probes/`，继承 `BaseTracker` 实现 `onStart`/`onStop`
  （+ `canStart`，若它的运行时可能不存在），只 import `core/api/tracker` 的
  `EventRecorder`，**绝不 import `core/api/analytics`** —— 架构测试会拦。
- **不要在 `core/probes/` 之外挂监听器或定时器**（`api/analytics.ts` /
  `queue/event-queue.ts` / `transport/http-destination.ts` 三个白名单除外），
  同样有断言守着。
- **新事件名 / 新共享常量**只声明一次，架构测试会数声明点数。
- **每条降级路径配一个 `warnOnce`**，key 要能区分不同问题。
- **新增监听器必须能被移除**，架构测试数 add/remove 配对。
- 改完 `analytics/` 下任何东西必跑 `npm --prefix tests run test`；提交前建议再跑 `npm --prefix demo run build`（它的 tsc 比 SDK 构建更严，`verbatimModuleSyntax` + `noUnusedLocals`）。
