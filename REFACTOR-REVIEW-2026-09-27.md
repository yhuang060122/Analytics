# Analytics 重构后整体评审（2026-09-27）

> 只分析不动手。所有结论都基于当前工作区代码，运行时结论都有实测证据（见 §7 附录）。
> 代码规模：`analytics/` 约 3.0k 行 TS（core ≈1.5k / adapters ≈1.4k），`tests/` 约 2.0k 行 mjs / 69 个用例，全部通过；`tsc -p demo` 零错误。

---

## 1. 目录结构与模块职责

```
analytics/
  index.ts                     public barrel（core + browser + network + init + detect）
  iife.ts                      <script> 构建入口，只有 bundler 可以指向它
  core/                        不依赖 adapters（架构测试强制）
    api/       analytics.ts 门面（Analytics 类 + 生命周期 + 注册表）
               tracker.ts   端口：EventRecorder / Tracker / BaseTracker
               config.ts    AnalyticsConfig（含对 DebugOptions 的再导出）
    domain/    event / context / session    （纯数据 + sessionStorage）
    factory/   event-factory.ts            事件构造 + CREATED 调试事件
    queue/     event-queue.ts              缓冲、批、重试退避、溢出丢弃
    transport/ destination.ts（端口）/ http-destination.ts（fetch 实现）
    debug/     debug-controller（注册表门面）/ event-bus / plugin / stage-colors
               console-plugin / inspector-plugin / debug-inspector（DOM 面板）
  adapters/
    index.ts                   init() 组合根 + InstallState 单例
    detect.ts                  运行时探测（fetch / jQuery / Angular）
    browser/   click / page / fetch 探针；auto-track.ts（第二组合根）
    network/   network-core.ts（三个 transport 共用）/ active-recorder.ts（第二单例）
    page-context.ts（共享的 page reader，SSR 安全）
    jquery/    jquery-ajax-tracker.ts（动态 import，运行时查找 $）
    angular/   analytics.interceptor.ts（fn + class 两种形式）
```

**依赖方向（已核实，无反向引用）**：`adapters → core` 单向；`core/transport` 不反向依赖 `queue`；`adapters/network/network-core` 只依赖 `core/api/tracker`。

## 2. 核心数据流

**事件流水线**
```
probe.track(name, props)
  → Analytics.track  → EventFactory.track  → createContext(session/url/referrer/UA)
      └─ debug: CREATED
  → EventQueue.enqueue（溢出时丢最旧 + debug: FAILED）
      └─ debug: QUEUED → 满 batchSize 或 timer → flush()
  → flush(): while(队列非空){ peek batch → debug: FLUSHING → destination.send }
        成功 → splice + failures=0
        失败 → failures>=maxRetries ? drop(debug:FAILED) : 退避重试(1s→2s→4s…≤30s)
  → HttpDestination → POST JSON {events}，debug: SENT / FAILED
```
`online` 事件立即重试；`visibilitychange / beforeunload` 触发最后 flush。

**安装流程**
```
<script> → iife.ts → init(options) → createBrowserAnalytics(autoTrack 预设)
        → registerFetchAdapter → setActiveRecorder → exposeGlobal(window.analytics)
        → registerDetectedAdapters() → 动态 import jquery → AdapterReport
```

## 3. 重构带来的实际改进（有证据）

| 改进 | 收益 | 现在由什么守住 |
|---|---|---|
| `EventRecorder` / `Tracker` 端口 + `BaseTracker` | 消除了 5 处手写的 `running` 标志与漏 guard 导致的监听器重复注册 | 架构测试 + 6 个 BaseTracker 用例 |
| `NetworkTrackerCore` 统一命名/属性/ignore | 三个 transport 不可能再漂移；`xhr`、`successEventName`、`enrich()` 等无人使用的成员已删 | network.test.mjs 断言三 transport 输出完全一致 |
| debug 插件化（端口 + 注册表 + 两个内置插件） | 第三方可观测而不侵入 core；同名注册替换而非重复投递；`stop()` 统一收尾 | debug-plugin.test.mjs 11 个用例 |
| `Destination` 端口 + `transport` 不再依赖 `queue` | 依赖有环变有向；队列可测（stub destination） | 架构测试 |
| `STAGE_COLORS` / `DebugOptions` 单点声明 | 消灭重复颜色表与重复类型定义 | 架构测试「declared once」 |
| 组合根状态收成 `InstallState` | `reset()` 一次赋值，不可能漏字段 | 架构测试「只有一个模块级 let」 |
| 构建/工具岛化（根无 package.json） | 根零依赖；demo/build/tests 各自 lockfile；`dist` 双产物 | 架构测试「only the two islands install anything」 |

结论：**骨架层面的重构是成功的**，依赖方向、端口抽象、驺动关系都比重构前清晰得多，而且大部分收益被测试固化住了。剩余问题集中在三类：运行时健壮性（系统会真的崩）、配置/组合根的一致性、以及"原则写了但没有系统性执行"。

---

## 4. 高风险问题（单独说明）

### H1. 「永不打断宿主」只在 Angular adapter 里被执行，core 完全没执行 ⚠️ P0

这是本次评审最严重的一致性缺口。`adapters/angular` 里的 `spy()` 很克制：每个 handler 都包了 try/catch，注释写着 *"never break the request"*。但同一条原则在 core 里没有任何落地，实测三处崩溃路径：

| 触发条件 | 实测结果 | 位置 |
|---|---|---|
| 非安全上下文（http 页面、LAN IP 调试、老浏览器）缺 `crypto.randomUUID` | **`init()` 直接抛 TypeError，宿主启动失败** | `event-factory.ts:26,42`、`session.ts:21` |
| `sessionStorage` 被禁用/抛 SecurityError（Safari 隐私模式、第三方 iframe） | `track()` 抛错至调用方 | `session.ts:15,23` |
| 自定义 debug 插件 `onEvent` 抛异常 | **`track()` 把异常抛回宿主点击 handler** | `event-bus.ts:9` |

一个埋点 SDK 的价值前提是"它坏了页面也不能坏"，目前这条在 core 层完全不成立。

### H2. 可靠性三件套叠加 → 弱网下事件静默消失 ⚠️ P0/P1

1. **无请求超时、无 AbortController**（`http-destination.ts:35`）。一个永不 settle 的 `fetch`（挂起的代理、黑洞路由）会让 `flushing` 永久为 `true`，后续所有 `flush()` 早期 return，队列一路涨到 `maxQueueSize` 后开始丢最旧事件 —— 全静默。
2. **`keepalive: true` 恒定开启**。keepalive 请求有 ~64KB body 配额，超限会以一个不可恢复的 TypeError 失败；同一个 body 重试多少次都一样失败，最终整批丢弃。
3. **`close()` 语义漏洞**：`flush()` 在已有 flush 进行时立刻 return，`close()` 因此可能带着未发送的事件就 resolve。

三者叠加的表现就是" outage 期间什么都不上报，而且没人知道"。

### H3. 配置体系分裂 + 隐藏的第二个单例 ⚠️ P1

- **两条注册路径行为不一致（实测）**：`init({ network:{ fetch:false } })` **仍然安装 fetch adapter**，而 `frameworks:{ fetch:false }` 才真的不装。文档里 `NetworkInitOptions.fetch` 明确写着"是否 patch window.fetch"，用户在 `init()` 里写它是合乎文档的，但无效。根因是 `adapters/index.ts:145-152` 自己又写了一套开关解析，没有复用 `registerDetectedAdapters` 的解析逻辑。
- **三个"组合根"**：`adapters/index.ts`（`init`）、`adapters/browser/auto-track.ts`（`createBrowserAnalytics`）、以及架构测试的例外名单本身。README 把 `autoTrack` 称为 "Deprecated shim"，可 `init()` 正是靠它注入默认的 `{page:true, click:true}` —— 注释引导未来读者删除的东西，恰恰是主入口的唯一依赖路径。
- **`getActiveRecorder()` 静默失败**：它只在 `init()` 里被设置。手搓 `new Analytics()` + `createAnalyticsInterceptor()`（无参，README 明确支持的写法）会落到 `NOOP_RECORDER`，事件被**静默丢弃且无任何警告**。这是最难排查的一类 bug：接线看起来是对的，监控里就是没数据。

### H4. 文档/测试给人一种"已经被机器守住"的错觉 ⚠️ P1

`architecture.test.mjs` 守的是**静态形状**：import 里有没有 `adapters`、barrel 有没有拉 framework、有没有 `removeEventListener` 配对。它守不住行为。于是 README 能写出与实现不符的陈述而不报错：

- README 称「SSR: 一个 Node render 不会抛」，但 `Analytics` 构造函数无条件 `document.addEventListener` / `window.addEventListener`（`analytics.ts:191-201`）—— SSR 下 `new Analytics()` 必抛。
- README 把 `autoTrack` 当 deprecated shim 陈述，实际它是主入口的默认路径。
- 架构测试白名单豁免了 `auto-track.ts` / `jquery` / `angular` / `adapters/index.ts` 四个文件，恰好是组合逻辑最复杂的那几个。

---

## 5. 可执行任务清单（按优先级）

工作量按"一人日"估，含自测与回归。

### P0 — 立即处理（会让宿主页面崩溃或静默丢数据）

| # | 问题 | 影响范围 | 建议方案 | 工作量 |
|---|---|---|---|---|
| 1 | `crypto.randomUUID` / `sessionStorage` 依赖未保护，缺任一都崩（H1） | 所有非 https 环境、隐私模式、iframe 场景；崩在 `init()` 而不是单点 | 新增 `core/domain/id.ts` 封装 id 生成（`randomUUID` → `getRandomValues` → `Math.random` 三级降级）；`Session` 读取包 try/catch，失败降级到内存会话；在 `Analytics.track/page` 层再加一层"永不抛"边界并 warn once | 0.5–1d |
| 2 | debug 插件异常冒泡到宿主调用栈 | 任何自定义插件；宿主点击事件会连带炸掉 | `DebugEventBus.emit` 逐 listener try/catch；捕获后 warn once，连续失败可自动 unregister 该插件 | 0.25d |
| 3 | 无请求超时 → 队列死锁（H2-1） | 弱网/黑洞路由下 100% 丢 event，直到溢出 | `HttpDestination` 加 `AbortController` + 可配置 `timeout`（默认 ~10s）；超时按发送失败处理并计入重试预算 | 0.5d |
| 4 | `keepalive` 无条件开启（H2-2） | body 超配额时不可恢复失败 | 仅在 unload/visibility-hidden 的 flush 上用 keepalive；常规 flush 关闭，或按 body 字节数阈值（~60KB）降级。unload 分支另考虑 `sendBeacon` | 0.5d |

### P1 — 本轮内处理（行为不一致 / 难以排查的静默失败）

| # | 问题 | 影响范围 | 建议方案 | 工作量 |
|---|---|---|---|---|
| 5 | `init()` 忽略 `network.fetch:false`（H3-1，实测） | 配置写了不生效；`init` 与 `registerDetectedAdapters` 语义分裂 | 抽出单一的 `resolveNetworkOptions(InitOptions)`，`init()` 与 `registerDetectedAdapters()` 共用；补 2 条 option 矩阵回归测试 | 0.5d |
| 6 | `getActiveRecorder()` 缺省导致事件静默进入 NOOP（H3-3） | 手搓实例的 Angular 集成全线丢数 | 无 recorder 且不处于"尚未 init"状态时 `console.warn` 一次；README 明确其适用边界；避免直接 throw 以免破坏现有接线 | 0.25d |
| 7 | `close()` 可能在缓冲未空时 resolve（H2-3） | 测试/SPA unmount 里的数据丢失误解 | `EventQueue` 保存 in-flight promise，`flush()` 在无事可做时返回它而不是 undefined | 0.25d |
| 8 | Inspector 每个事件全量重建 DOM（≤30 行 → ~150 节点），且折叠/页面隐藏时照渲 | debug 开启时的页面卡顿，尤其 burst 场景 | 增量 prepend + 移除尾部；`requestAnimationFrame` 合并渲染；`collapsed` 或 `document.hidden` 时跳过渲染只更新计数 | 0.5–1d |
| 9 | `PageTracker.navigate()` 是死代码，SPA 路由变更无上报出口 | SPA 用户拿不到页面切换事件 | 二选一：删除该方法；或让组合根暴露 page tracker（`/ analytics.page()` 手动）并在 README 写明 SPA 该怎么用 | 0.5d |
| 10 | 测试覆盖缺口：EventFactory 事件形状、Session 复用/降级、HttpDestination 头部与 body、`Analytics.page()`、IIFE 入口、以及本清单所有健壮性用例 | 上述 P0 项之所以还没暴露，就是没有用例 | 新增 `tests/robustness.test.mjs`（非安全上下文、存储禁用、插件抛错、悬挂请求、超时）+ 补齐 factory/session/destination 单测 | 1–2d |
| 11 | README 与实现漂移（SSR 安全、deprecated shim）（H4） | 误导集成方 | 修实现或修文档，二选一，**不要**继续并存；建议从 `Analytics` 构造加 DOM 守卫做起（顺手覆盖 #9 的一部分诉求） | 0.5d |

### P2 — 可以延后（技术债与一致性清理）

| # | 问题 | 建议方案 | 工作量 |
|---|---|---|---|
| 12 | 命名风格分裂：core 用点式（`event.queue.ts`、`http.destination.ts`），adapters 用短横线（`network-core.ts`、`jquery-ajax-tracker.ts`） | 全仓统一到一种（建议短横线 + 文件命名与导出主符号一致） | 0.5d（纯重命名，收益低但成本也低） |
| 13 | page context 三处重复且键名两套：`AnalyticsContext.url/referrer/userAgent` vs `readPageContext()` 的 `pagePath/pageUrl/pageTitle`，ClickTracker 还内联硬编了一套 | 统一一份 `readPageContext()`（移到 `adapters/browser/` 更合适，它跟网络无关）；网络事件不再重复上报 envelope 里已有的字段 | 0.5–1d（改动会进 payload，需与后端确认） |
| 14 | 死代码：`describeAngularWiring()`、`Session.reset()`、`Analytics.clear()`、`NetworkTrackerOptions.transport`（adapter 都会覆盖）、`startAutoTrack` 的 `api` 选项（与 `network.fetch` 是两套开关，加重了 #5 的混乱）、空继承的 `FetchTrackerOptions` | 逐个确认后删除；`api` 选项建议与 #5 一并并入单一开关体系 | 0.5d |
| 15 | `PipelineStage` 语义过载：队列溢出丢弃 / 重试耗尽 / 请求失败共用 `failed`，只能靠 error 字符串匹配区分 | `DebugEvent` 增加 `reason: "overflow" \| "retries-exhausted" \| "transport-error"` | 0.5d（会动调试事件的公共形状） |
| 16 | 隐私：ClickTracker 默认上报 `element.textContent`，可能含 PII，且没有脱敏钩子 | `text` 改为 opt-in，或提供 `redact(properties)` 挂载点 | 0.5d |
| 17 | 类型严格度：SDK 自身的 tsconfig 未开 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `noImplicitOverride`；`noUnusedLocals` 也只开在 demo | 逐步开，先 `noImplicitOverride`，其余逐个清错误 | 1d+ |
| 18 | `exposeGlobal` 遇到已存在的 `window.analytics` 时静默跳过 | 至少 warn once | 0.1d |
| 19 | README TODO：队列持久化（localStorage / IndexedDB）未做 | 独立议题，作为后续 feature 排期 | — |

### 建议的执行顺序

1. **第一批（1–2 天）**：#1 #2 #3 #4 —— 四个 P0，都是小改动，先把"SDK 不让页面崩、不让数据静默丢"这条底线立住。
2. **第二批（和第一批同步）**：#10 的一半 —— 把第一批的每个修复都配一条回归用例，否则下轮重构还会退化。
3. **第三批（2–3 天）**：#5 #6 #7 #8 #11 —— 消灭配置分裂与静默失败。
4. **第四批**：#9 #12–#18 —— 一致性清理，随时可做，建议攒成一次"纯删除 + 重命名"的提交，便于 review。

---

## 6. 测试与类型覆盖评估

**现状**：69 个用例全绿，覆盖探针生命周期、注册表、队列重试/退避/溢出、debug 插件、三 transport 一致性、以及 19 条架构约束。

**主要缺口**
- `EventFactory` / `Session` / `HttpDestination` 没有独立用例（只被间接覆盖，因此头部构造、keepalive、body 形状完全没断言）。
- `tests/browser-stub.mjs` 无条件注入 `webcrypto`（自带 `randomUUID`）和一个永不失败的 `sessionStorage`，**恰好把 H1 的两条崩溃路径从测试视野里屏蔽掉了** —— 这是"桩比被测系统更宽容"的典型例子。
- 没有 "hanging destination" 用例 → 覆盖不到 H2 的死锁。
- `demo/` 不参与测试，只有 `npm --prefix demo run build` 时才 typecheck。
- `tests/tsconfig.build.json` 只列了 7 个 root 文件；新文件若无人 import 就不会被编译检查。
- `tests/package.json` 的 test 脚本手工枚举文件名（已有架构测试兜底，OK，但加文件仍需记得改脚本 —— 已被 `npm test runs every test file` 守住了）。

---

## 7. 附录：实测证据

用 `tests/.build`（tsc 产物，CJS）+ 一个最小浏览器桩跑的探针脚本，未改动仓库任何文件：

```
1) init({network:{fetch:false}})      -> fetch adapter installed? true    ← 应是 false
2) init({frameworks:{fetch:false}})   -> fetch adapter installed? false
3) init({}) default                   -> fetch adapter installed? true
4) throwing debug plugin              -> track() THREW into host app: plugin blew up
5) headers: {"Content-Type":"application/json","X-API-Key":"K-1","X-Tenant":"acme"} keepalive: true
6) sessionStorage disabled            -> THREW: SecurityError: storage disabled
7) crypto.randomUUID missing          -> init()/track() THREW: TypeError: crypto.randomUUID is not a function
    at EventFactory.page → Analytics.page → PageTracker.trackPage → init()
```

第 7 条尤其值得看：崩溃发生在 `init()` 内部（`PageTracker.onStart` 立刻打第一个 page 事件），也就是**宿主页面加载埋点 SDK 的第一步就炸了**，而不是某个边缘路径。

---

## 8. P2 执行情况（同日晚，一次「删除 + 重命名」提交）

按第 5 节的 P2 清单执行，未触碰 P0/P1（那些会改运行时行为，另开提交）。

| 项 | 做了什么 |
|---|---|
| #12 命名双套 | `event.queue.ts` / `http.destination.ts` / `event.factory.ts` → 短横线，全仓统一；barrel 与测试引用同步 |
| #13 page context 三处重复 | `PageContext` + `readPageContext()` 从 `adapters/network/network-core.ts` 抽到 **`adapters/page-context.ts`**（它跟 HTTP 无关）；ClickTracker 删掉内联的 `window.location` / `document.title` 复制，改调同一个 reader。payload 键与顺序不变。新增架构测试 **page context is read from one module**：除 `page-context.ts` 外任何 adapters 文件都不许同时出现 `pagePath`/`pageUrl`/`pageTitle` |
| #14 死代码 | 删 `describeAngularWiring()`（全仓零引用）、删空继承的 `FetchTrackerOptions`（改用 `NetworkTrackerOptions`）、删 `startAutoTrack` 的 `api` 选项（与 `network.fetch` 是两套开关）。按确认结果**保留** `Analytics.clear()` / `retrying` / `Session.reset()`（合理契约，只是没人调用） |
| #15 PipelineStage 语义过载 | `DebugEvent` 新增可选 `reason`：`queue-overflow` / `undeliverable` / `transport-error`，三个失败点各自打标；console 插件把它拼进标签，Inspector 拼进错误行。`error` 保持自由文本 |
| #16 PII | `Element Clicked` 的 `text` 改为**元素级 opt-in**：只有带 `data-analytics-text` 的元素才上报文本，否则为 `null`（键保留，schema 稳定）。demo 的 Primary button A 加了该属性做演示，README 补充隐私说明 |

顺带修的测试盲点：`browser-stub.mjs` 只把 `location` 挂在 `window` 上，而 `readPageContext()` 读的是 `globalThis`（浏览器里二者是同一个对象）—— 桩现在也暴露 `globalThis.location`，否则"探针手写 page triple"和"调 reader"在测试里长得一样，都返回空串。

验证：`npm --prefix tests run test` **72/72**（新增 3 条：click text opt-in、transport-error 打标、network-core 依赖面）；demo 严格 tsc 0 错；`npm --prefix build run build` 产出不变。

---

## 9. P1 执行情况（同日，一次提交 `da76b8c`）

| 项 | 做了什么 |
|---|---|
| #5 `init()` 忽略 `network.fetch:false` | 抽出单一 `resolveAdapters(options)`，`init()` 与 `registerDetectedAdapters()` 共用。语义：`network:false` 整体关闭；`network.fetch` / `network.jquery` 是默认值；`frameworks.*` 强制覆盖二者。补 2 条 option 矩阵回归测试（6 种组合 × 两个入口 + 空参数继承 init 配置） |
| #6 默认 recorder 静默 NOOP | Angular 拦截器 `resolveRecorder()` 拿不到实例时 **warn once**，说明边界（把实例传给 `createAnalyticsInterceptor()`，或先 `init()`），不抛错 |
| #7 `close()` 可能在缓冲区非空时 resolve | `EventQueue` 把 `flushing` 布尔换成 `inFlight?: Promise<void>`，`flush()` 不再 async、原样交回正在跑的承诺；循环体挪进 `drain()`。并发 `flush()` 现在拿到同一个 promise |
| #8 Inspector 每事件重建 ~150 节点 | 改为增量前插（`insertBefore(firstChild)`，超过 `MAX_ROWS=30` 裁尾）+ rAF 合并一帧内的突发；`visible()` 为 false（折叠 / `document.hidden`）时只进缓冲不渲染，展开时整体重建。无 rAF 环境（SSR、node 测试）立即渲染 |
| #9 `PageTracker.navigate()` 死代码 | 删除（全仓零引用）。SPA 用法写进 README：路由里直接 `analytics.page(path)` |
| #10 测试覆盖 | 新增 `tests/robustness.test.mjs`：SSR 构造/销毁、并发 `flush()` 共用一个请求、`close()` 排空缓冲区、`EventFactory` 事件形状、`Session` 复用与 reset、`HttpDestination` 头部/body/keepalive/transport-error 打标 |
| #11 README 与实现漂移 | 新增 `core/dom.ts` 的 `hasDom()`，`Analytics` 的 `visibilitychange`/`beforeunload` 与队列的 `online` 监听都在无 DOM 时跳过；README 的 SSR 段按实现重写。`autoTrack` 的 "deprecated shim" 注释与事实相反（它是 `init()` 默认 `{page:true,click:true}` 的唯一通路），改为说明它是 adapter 层的正式开关 |

### 一个必须记下的坑：桩比被测系统更宽容（第二次）

加 `resolveAdapters()` 后 3 条 network 测试立刻变红。第一反应是"新 resolver 错了"，
实际是我把 `network: undefined`（未配置 → 走默认开启）和 `network: false`（整体关闭）
合并成了同一个分支。**桩没有暴露这个问题**：测试里 `globalThis.window.fetch` 是手
工赋值的，而 `isFetchAvailable()` 读的是全局 fetch，所以"该装没装"和"运行时没有 fetch"
在测试里长得一样。修的是实现不是测试。

### 4 条 P0 用例现在以 `todo` 形式存在

`robustness.test.mjs` 里这四条断言的是**目标行为**，当前是红的：

- 非安全上下文（无 `crypto.randomUUID`）
- `sessionStorage` 被禁用
- debug 插件抛错
- 请求永久挂起（无超时）

用 `node:test` 的 `{ todo: true }`：失败不计入 `fail`、退出码仍为 0，但 `# todo 4`
会一直挂在汇总里。P0 落地后把这 4 处的 `todo` 去掉即可转绿——不需要重写断言。

验证：86 个用例 **82 pass / 0 fail / 4 todo**；demo 严格 tsc 0 错；
`npm --prefix build run build` 两个产物均可产出（`outDir` 仍是 `../dist`）。

---

## 10. P0 执行情况（同日晚，一次提交）

四条都是"SDK 不让宿主页面崩、不让数据静默丢"的底线，逐条落地并把 §9 里
那 4 条 `todo` 用例全部转绿（`node --test` 现在 94 pass / 0 fail / 0 todo）。

| 项 | 做了什么 |
|---|---|
| #1 crypto / storage 未保护 | 新增 **`core/domain/id.ts`** 的 `createId()`：`crypto.randomUUID` → `crypto.getRandomValues`（自己盖 v4 的 version/variant 位）→ `Math.random`。三条分支产出同一个形状（v4 字符串），下游无法分辨，也不会多一个分支判断。`Session` 的读写全部包 try/catch，失败后**闩锁**（不再每事件都去碰一个会抛的 API）并降级到**内存会话**（同一页面内 id 稳定）。最后在 `Analytics.track/page` 加 `record()` 边界：任何漏出来的异常都吞掉并 warn once —— `track()` 是在宿主的 click handler 里被调用的，那里抛异常等于把点击连带炸掉 |
| #2 插件异常冒泡 | `DebugEventBus.emit` 逐 listener try/catch。失败计数进 WeakMap，成功清零；连续 3 次失败才 unsubscribe。额外给 `subscribe()` 加了 `onDrop` 回调 —— bus 摘掉监听器后必须通知 owner，否则 `DebugController.debugPlugins` 会继续宣告一个收不到事件的插件，这比原 bug 更难查 |
| #3 无请求超时 | `HttpDestination` 加 `AbortController` + 可配 `timeoutMs`（默认 10s，`0` 关闭）。超时即一次失败尝试，计入队列的重试预算；debug 事件打 `reason: "timeout"`，与 `transport-error` 区分（前者是对方没回，后者是被拒绝，处置不同） |
| #4 keepalive 无条件开启 | `Destination.send(events, options?)` 接受 per-call 的 `keepalive`；只有 tab-hidden / `beforeunload` 那次 flush 会置上（经 `EventQueue.flush(options)` → `drain` 透传）。超过 ~60KB 的 body 自动降级关掉 —— Chrome 是直接拒绝，带着 flag 重试只会一直失败 |

### 两个值得记下的判断

- **为什么没用 `sendBeacon`**：它返回 true 只表示"已交给浏览器"，不代表送达，
  而队列的重试逻辑完全依赖"成功/失败"这个区分。unload 场景宁可用 keepalive +
  明确的失败语义。已写进 README。
- **为什么超时按失败而不是按成功**：计入重试预算才有意义，否则弱网下超时会
  变成静默丢事件的另一种形式。

### 测试桩的又一个盲点

第一版那个"永不返回"的假 fetch 写成 `() => new Promise(() => {})`——**完全忽略
`signal`**，于是 AbortController 再正确也不会中止任何东西，超时用例直接超时失败。
桩必须模拟"真的会响应 abort 的 fetch"：监听 `signal` 的 abort 事件并 reject。
这条和 §8、§9 那两次同源：**桩比被测系统更宽容时，红灯会指向错误的方向**。
