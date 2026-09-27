# Analytics

前端埋点 SDK。TypeScript，浏览器优先。

本仓库是**一个源码目录，而不是 npm 包** —— 根目录没有 `package.json`。
需要安装的东西分别住在三个自包含的"孤岛"里（`demo/`、`build/`、`tests/`），
各有各的 lockfile。SDK 是按路径引入的，不是按包名。

> 语言：[English](../README.md) | 简体中文

---

## 快速上手

### 环境要求

- **Node.js ≥ 20**（在 22.x 上开发并测试）
- **npm ≥ 9**
- 无需任何全局安装。每个孤岛各自安装自己的工具。

### 安装

```bash
npm --prefix demo install      # vite + typescript（跑 demo、编译测试都用它）
npm --prefix build install     # tsup + typescript（打包用）
```

`tests/` 什么都不用装 —— 它的脚本直接取用 `demo/node_modules` 里的 TypeScript。

### 运行 demo

```bash
npm --prefix demo run dev
```

打开 **http://localhost:5173**。这是一个 Vite 多页应用：

| 页面 | 它演示什么 |
| --- | --- |
| `/`（index） | 点击、页面浏览、调试 Inspector、手动 flush |
| `/portfolio` | 对 mock API 的 fetch 追踪 |
| `/watchlist` | jQuery 风格请求、故障/重试行为 |

SDK 实例在 `demo/src/analytics.ts` 里跨页面共享；调试工具条控件在
`demo/src/inspector-toolbar.ts`。

dev server 内置了一个 **mock collector**（`demo/vite.config.ts`），
让整条流水线可以端到端跑通：

| 接口 | 用途 |
| --- | --- |
| `POST /api/analytics/events` | 接收 SDK 批次，打印到终端 |
| `GET /api/analytics/outage?state=on\|off` | 模拟 500，用来演练队列重试 |
| `GET /api/portfolio` | portfolio 页的示例数据 |
| `GET /api/news` | watchlist 页的示例数据 |

### 常用命令

| 做什么 | 命令 |
| --- | --- |
| 跑 demo（dev server） | `npm --prefix demo run dev` |
| demo 类型检查 + 构建 | `npm --prefix demo run build` |
| 构建 SDK 产物 | `npm --prefix build run build` |
| 跑测试套件 | `npm --prefix tests run test` |

- `npm --prefix tests run test` 先用 tsc 把 `analytics/` 编译到
  `tests/.build`，再跑 `node --test`。改动 `core/` 或 `adapters/`
  之后必须跑它。
- `npm --prefix build run build` 产出 `dist/analytics.js`（ESM
  barrel）和 `dist/analytics.iife.js`（自安装的 `<script>` 构建）。
  见[构建](#构建)。
- `npm --prefix demo run build` 用一份更严格的 TypeScript 配置
  （`noUnusedLocals`、`verbatimModuleSyntax`）编译 demo —— 比 SDK
  构建更严，提交前是个不错的最后检查。

---

## 项目结构

```
analytics/                  SDK 本体
  core/                     与框架无关的引擎 —— 永不 import adapters/
    api/                    端口与 SDK 本身：Analytics、EventRecorder/Tracker
                            （tracker.ts）、adapter 插件契约（plugin.ts）
    domain/                 event / context / session / id（id.ts 里是
                            crypto → getRandomValues → Math.random 的降级链）
    factory/                EventFactory：track()/page() → AnalyticsContext
    queue/                  EventQueue：批处理、重试 + 退避、溢出丢弃
    transport/              Destination 端口 + HttpDestination（HTTP POST，
                            超时 + keepalive 门禁）
    debug/                  DebugController、事件总线、插件注册表、
                            console + inspector 两个内置插件
    dom.ts                  hasDom() —— 构造期访问 DOM 的守卫
    warn.ts                 warnOnce() —— 降级时"只警告一次、绝不静默"
  adapters/                 探针 —— 依赖方向朝内（指向 core/）
    browser/                click-tracker、page-tracker、fetch-tracker、
                            auto-track.ts（startAutoTrack）
    network/                NetworkTrackerCore（统一的事件名/忽略规则）
                            + active-recorder.ts（script-tag 的槽位）
    jquery/                 JQueryAjaxTracker（$.ajax 全局事件）
    angular/                createAnalyticsInterceptor（HttpClient）
    detect.ts               运行时特性探测
    page-context.ts         readPageContext() —— page 三元组唯一的出处
    registry.ts             name → adapter 表（插件发现机制）
    index.ts                init() —— 组合根
  index.ts                  公开 barrel（不重导出框架适配器）
  iife.ts                   <script> 构建入口 —— 带副作用、自安装

demo/                       Vite 多页 demo + mock collector
build/                      tsup 配置 → dist/analytics.js、dist/analytics.iife.js
tests/                      node --test 套件（零依赖）
dist/                       构建产物（已 gitignore）
```

唯一要紧的方向是：**core 永不 import adapters。** 适配器依赖朝内、只依赖
core 的端口；装配只发生在组合根（`adapters/index.ts`）里。
`tests/architecture.test.mjs` 机械地守着这条以及另外十几条不变量。

---

## 分层

```
adapters/   探针：Click、Page、Network（fetch / jQuery / Angular）
   | 依赖朝内
   v
core/       domain、factory、queue、transport、api、debug
```

**core 永不 import adapters。** 契约在 `core/api/tracker.ts` 里：

- `EventRecorder` —— 探针对 SDK 能做什么（`track`、`page`）
- `Tracker` —— 生命周期（`start`、`stop`）

探针依赖 `EventRecorder`、实现 `Tracker`。装配发生在**组合根**（应用侧），
从不发生在 core 内部。

```ts
import { Analytics } from "./analytics/core/api/analytics";
import { startAutoTrack } from "./analytics/adapters/browser/auto-track";

const analytics = new Analytics({ endpoint: "/api/analytics/events" });

analytics.registerTracker(
  startAutoTrack(analytics, { page: true, click: true }),
);
```

`registerTracker()` 只注册，不启动 —— 何时启动是调用方的决定。
`destroy()` 与 `unregisterTracker()` 会停掉探针；`await analytics.close()`
是可等待的版本。见[投递与销毁](#投递与销毁)。

**结构上幂等。** 每个探针都继承 `BaseTracker`，由基类持有 running 标志。
子类实现 `onStart()`/`onStop()`，不可能不小心重复注册监听器。`canStart()`
是给运行时可能不存在的探针（jQuery）留的后门：此时 `start()` 让它保持
停止状态，而不是半启动。

## 一套 API，多种技术栈

三个 transport 曾经各自复制自己的事件名、属性形状与忽略规则。现在这些
归 `adapters/network/` 所有；每个框架适配器只把自己的生命周期翻译成
`record()` 调用。

```
analytics/
  core/                      与框架无关的 SDK
    api/  domain/  factory/  queue/  transport/  debug/
  adapters/
    browser/                 DOM 探针：click、page、fetch
    network/                 <-- 共享的 network core
      network-core.ts        命名、属性、忽略规则、
                             状态分类、transport 标签
      active-recorder.ts     script-tag 流程的槽位
    jquery/                  $.ajax 全局事件
    angular/                 HttpClient 拦截器
    detect.ts                运行时特性探测
    page-context.ts          事件发生在哪；SSR 安全
    registry.ts              name -> adapter 表（发现机制）
    index.ts                 init() —— 组合根
  index.ts                   公开 barrel
  iife.ts                    <script> 构建入口 —— 带副作用
```

每个 transport 发出相同的两个事件名，并给自己打上标签：

```json
{ "name": "API Request",
  "properties": {
    "method": "GET", "url": "/api/users", "status": 200,
    "durationMs": 42, "transport": "fetch",
    "pagePath": "/portfolio", "pageUrl": "...", "pageTitle": "..."
  } }
```

`transport` 是 `fetch`、`jquery` 或 `angular` —— 按它过滤，而不是按三个
不同的事件名。

这两个事件名**不允许按 transport 配置**。`successEventName` /
`errorEventName` 曾经作为选项存在：从没人设置过它们，而它们的存在本身
就在暗示"某个 transport 可以用别的事件名" —— 恰恰是这个模块存在的意义
要禁止的事。`enrich()` 同理被删：它会允许某个栈多出别的栈没有的属性。

### 适配器遵守的规则

- **零包依赖。** `adapters/angular` 与 `adapters/jquery` 都不 import
  `@angular/*` 或 `rxjs`；它们用结构化类型。因此一个 jQuery 项目构建时
  永远不需要装 Angular，反之亦然。`HTTP_INTERCEPTORS` 也因同样理由留在
  应用侧。
- **无环境全局声明。** jQuery 适配器在运行时查找 `$`，所以没有
  `declare const $` 去强迫消费者装 `@types/jquery`。
- **绝不破坏宿主。** 框架缺失时 `start()` 变成 no-op；每一次观测都被
  包起来，保证追踪失败不会让一次 HTTP 请求失败。
- **结构上幂等。** 探针继承 `BaseTracker`、实现 `onStart()`/`onStop()`；
  `running` 标志在基类里，探针不可能忘掉守卫而重复注册监听器。
  `canStart()` 是给运行时可能不存在的探针留的钩子。

## 入口

```ts
import { init } from "analytics/adapters";

const analytics = init({
  endpoint: "/api/analytics/events",
  batchSize: 20,
  autoTrack: { page: true, click: true },
  network: { fetch: true, ignoreUrls: ["/internal/health"] },
});
```

`init()` 是**同步且幂等**的 —— 第二次调用（或 script 标签被包含两次）
返回第一个实例，而不是注册第二套探针（那样每个事件都会翻倍）。
`getAnalytics()` 把它读回来，`reset()` 为测试和热重载拆掉它。

不能同步装配的适配器要单独显式接入：

```ts
const report = await registerDetectedAdapters(analytics);
// { fetch: "registered", jquery: "registered", angular: "manual" }
```

`angular: "manual"` 不是缺口：HTTP 拦截器无法把自己挂到 `HttpClient` 上，
必须由应用提供。

不带参数调用时，它会继承 `init()` 当初收到的选项，所以
`init({ network: false })` 不会被稍后的 `registerDetectedAdapters()` 悄悄
推翻。显式参数优先于那个回退。每个值的取值是 `registered` / `skipped` /
`unavailable`（Angular 是 `manual`），其中 `skipped` 表示"存在但被配置关了"。

两套开关可以打开或关闭一个适配器，且它们在两个入口里解析结果一致：

| 配置 | 效果 |
| --- | --- |
| *（缺省）* | 运行时支持就开 |
| `network: false` | 网络追踪整体关闭 |
| `network: { fetch: false }` | 关掉那个 transport |
| `frameworks: { fetch: false }` | 强制关，压过 `network` |
| `adapters: { fetch: false }` | 按适配器配置，压过上面所有 |

`init()` 与 `registerDetectedAdapters()` 共用同一个解析器，所以
`init({ network: { fetch: false } })` 不可能通过一条路径装上适配器、
又通过另一条路径跳过它。通用形式是
`adapters: { <name>: <boolean | options> }`，这也正是配置第三方适配器的
方式 —— 见[适配器即插件](#适配器即插件)。

如果你自己构建 SDK 而不调 `init()`，同步的那一半也是公开的：

```ts
import { Analytics } from "analytics";
import { registerFetchAdapter } from "analytics/adapters";

const analytics = new Analytics({ endpoint: "/api/analytics/events" });

registerFetchAdapter(analytics, { ignoreUrls: ["/health"] });
// 当 window.fetch 不存在时返回 false（SSR、老浏览器）
```

它设计上就是幂等的：网络适配器会 patch 全局，第二个 FetchTracker 会把
"已经被 patch 过的 fetch"当成它的"原始版本"，于是同一个请求会发出两个
`API Request` 事件。`registerFetchAdapter` 和 `registerDetectedAdapters`
都拒绝叠加。

### 探测

`detect.ts` 检查运行时，只注册真实存在的东西：

| 信号 | 启用 |
|---|---|
| `window.fetch` 是函数 | fetch 适配器 |
| `jQuery` / `$` 有 `.ajax` | jQuery 适配器 |
| `window.angular` / `window.ng` | 报告 `manual` |

`$.ajax` 才是真正的信号，而不是那个裸的 `$` 全局 —— 别的库也认领 `$`。
`window.angular` 只能证明 AngularJS 1.x —— Angular 2+ 在生产构建里不暴露
可靠的全局，这就是 Angular 装配必须显式的原因。

```ts
import { detectEnvironment } from "analytics/adapters/detect";

detectEnvironment();
// { fetch: true, jquery: false, angularjs: false,
//   angularDevMode: false, dom: true }
```

## 适配器即插件

现在每个内置适配器 —— click、page、fetch、jQuery、Angular —— 都是一个
*插件*：一个描述符，坐在同一个注册表（`adapters/registry.ts`）里，实现
同一个契约（`core/api/plugin.ts`）。`init()` 不再内置一张名字开关表；它
安装"已注册的东西"。这正是第三方适配器无需改动 SDK 就能存在的原因。

契约有两个角色，因为其中只有一个能由我们启动：

```ts
import type { AnalyticsPlugin } from "analytics";

export const vueRouter: AnalyticsPlugin<{ routes: unknown }> = {
  name: "vue-router",

  available: () => typeof router !== "undefined",

  start(host, options) {
    const off = options.routes.afterEach(to => host.page(to.fullPath));
    host.registerTracker({ start: () => {}, stop: off });
  },
};
```

- `name` —— 身份，也是寻址它的配置键。
- `available?(host)` —— 当前运行时是否支持它。探测刻意做成每个适配器
  自带：它曾经是一张必须和适配器保持同步的开关表，所以新增 transport
  意味着还要去改第二个文件、且那个文件必须和第一个保持一致。
- `start(host, options)` —— 安装。`host` 是一个 `PluginHost`：它记录事件
  （`track` / `page`）、为销毁注册 tracker、并暴露 `debug`。
- `stop?()` —— 释放 `start()` 拿走的、不属于已注册 tracker 的那部分资源。

`AdapterIntegration` 是第二个角色，给*应用*驱动的适配器用。HTTP 拦截器
无法把自己挂到 `HttpClient` 上，所以没有可"启动"的东西 —— 它暴露
`create(host)` 而不是生命周期，并报告为 `manual`。Angular 适配器就是内置
的例子。

**注册**有三种方式 —— `init()` 之前 `registerAdapter(plugin)`、
`init({ plugins: [plugin] })`，或从 `<script>` 里
`window.analyticsAdapters = [plugin]`：

```ts
import { registerAdapter, init } from "analytics/adapters";

registerAdapter(vueRouter);

const analytics = init({
  endpoint: "/api/analytics/events",
  adapters: { "vue-router": { routes: router } },
});
```

**配置**用 `adapters.<name>`：`false` 关闭它，对象则成为它的选项。旧的
开关（`network`、`frameworks`、`autoTrack`）仍是别名。优先级，越具体越先：
`adapters.*` → `frameworks.*` / `autoTrack.*` → `network.*` →
`network: false` → 开。

**查看**用 `listAdapters()`、`getAdapter(name)`，以及
`installAdapters()` / `registerDetectedAdapters()` 返回的报告 —— 它的
`adapters` map 里每个已注册的适配器占一项
（`registered` / `skipped` / `unavailable` / `manual`），而
`fetch` / `jquery` / `angular` 为老调用方保留在顶层。

新增一个适配器的足迹是**一个文件**（描述符 + 逻辑）加宿主应用里一次
`registerAdapter(...)` 调用。不改任何 SDK 文件：不加 switch case、不碰
`detect.ts`、不改报告形状。

## jQuery 项目

Script 标签 —— 无打包器、无 import：

```html
<script src="/vendor/jquery.min.js"></script>
<script>
  // 由 analytics.iife.js 自安装时读取。
  window.analyticsOptions = { endpoint: "/api/analytics/events" };
</script>
<script src="/analytics.iife.js"></script>
<!-- 从这之后 window.analytics 就存在了 -->
```

那个构建是唯一会自安装的产物；见[构建](#构建)。它全是副作用，且只在
DOMContentLoaded 时读一次 `window.analyticsOptions` —— 这就是选项可以在
script 标签之后设置的原因。改成从 deferred module 里设置的话，那时还没
东西可读：构建会警告一次、什么也不装。

顺序很关键：**jQuery 必须先加载。** 否则探测找不到东西，适配器保持
no-op，页面照常工作 —— 你只是丢掉了 jQuery 追踪，没有别的。

用打包器的话：

```ts
import { init, registerDetectedAdapters } from "analytics/adapters";

const analytics = init({ endpoint: "/api/analytics/events" });

await registerDetectedAdapters(analytics);
```

## Angular 项目

```ts
// app.config.ts
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { init } from "analytics/adapters";
import { createAnalyticsInterceptor } from "analytics/adapters/angular";

const analytics = init({ endpoint: "/api/analytics/events" });

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(
      withInterceptors([createAnalyticsInterceptor(analytics)]),
    ),
  ],
};
```

Angular 15+ 接受一个普通函数，所以不涉及装饰器、也不涉及 DI token。
对更老的版本：

```ts
import { HTTP_INTERCEPTORS } from "@angular/common/http";
import { createAnalyticsHttpInterceptor } from "analytics/adapters/angular";

{
  provide: HTTP_INTERCEPTORS,
  useFactory: () => createAnalyticsHttpInterceptor(analytics),
  multi: true,
}
```

两者都接受"不传 recorder"、回退到 `init()` 存下的那个，这是 script-tag
安装触达 Angular 的方式：

```ts
withInterceptors([createAnalyticsInterceptor()]);
```

## 入口点

barrel 从不拉入框架适配器，所以在任何地方 import 根都是安全的：

```
analytics/index.ts           core + browser + network + init + detect
analytics/adapters/index.ts  init、getAnalytics、reset、
                             registerFetchAdapter、registerDetectedAdapters
analytics/adapters/network/  NetworkTrackerCore、active recorder
analytics/adapters/jquery/   JQueryAjaxTracker
analytics/adapters/angular/  createAnalyticsInterceptor（函数 + 类）
```

后两者刻意走各自的路径：这正是让 Angular 不进 jQuery bundle 的办法，
因为 import 根时永远看不到它们。

本 README 里的示例把 import 简写为 `analytics/…`。没有包可安装，所以把
它们指向你放源码的地方即可 —— demo 用的是相对路径。

## 边界情形

**加载顺序。** jQuery 在 SDK 之前。Angular 无所谓 —— 拦截器在 bootstrap
时、`init()` 之后提供。

**重复上报。** 两道守卫，都容易丢：

- `init()` 幂等，所以两个入口不会产出两个 SDK。
- SDK 自己的端点写死在 `DEFAULT_IGNORE_URLS` 里，且与 `ignoreUrls` 是
  **合并**关系、永不替换。设了 `ignoreUrls: ["/health"]` 的用户依然无法
  触发 上报 → `API Request` → 上报 的死循环。

重叠的适配器不会重复计数：`$.ajax` 处理器只为 jQuery 发起的请求触发，
而 Angular 的 `HttpClient` 走 XHR，所以一个同时有 jQuery 和 Angular 的页面
不会把同一次调用报两遍。如果应用在 Angular 里直接调 `$.ajax`，它可能把
*不同的*调用报两遍 —— 那种情况按 `transport` 过滤即可。

**SPA 导航。** `PageTracker` 在启动时上报一个 `page` 事件，标签页隐藏或
卸载时再上报一个 `Page Duration`。它**不**监听 History API，所以客户端路由
切换不算页面浏览 —— 从你的 router 里调用：

```ts
router.afterEach(to => analytics.page(to.fullPath));
```

`page(path)` 缺省用 `location.pathname`，并把 `title` 放进属性里，可覆盖。
曾经有个 `PageTracker.navigate()` 专干这个；从没人调用它，而一个需要应用
手动的探针，其实就是实例上的一个方法调用。

**全局污染。** 只有一个全局，用 `globalName: false` 可关闭。`window.fetch`
会被 patch，但在 `stop()`/`destroy()` 时恢复；要在其他包装 fetch 的库
*之后* patch，否则它们会互相捕获。

**没有 crypto、没有 storage。** `crypto.randomUUID` 只存在于安全上下文，
所以纯 http 内网页与沙箱 iframe 里都没有 —— 隐私模式还可能直接拒绝
`sessionStorage`。过去不加保护地读它们会在宿主应用还没做错任何事之前就从
`init()` 抛异常。现在 `core/domain/id.ts` 会一路降级：`crypto.getRandomValues`
→ `Math.random`（每个分支产出同样的 v4 形状），`Session` 在 storage 拒绝时
把 id 留在内存里，`track()` / `page()` 则把剩下的都吞掉并警告一次。
事件可能被丢弃；页面照常工作。

**点击里的个人数据。** `Element Clicked` 上报 `element`、`tag`、`id` 和
`cssClass`，但**不**上报元素文本 —— 除非元素还带着
`data-analytics-text`，否则 `text` 为 `null`。元素文本是那个例行携带个人
数据的属性（"Hi Sarah"、一条消息预览），所以按元素 opt-in。键始终保留，
这样属性 schema 不随点的是哪个元素而变。

**SSR。** 三件事让 Node 渲染不抛异常：

- `readPageContext()`（`adapters/page-context.ts`，每个探针共用）返回空串
  而不是去摸 `document`。
- jQuery / Angular 适配器在框架缺失时 no-op。
- 一切在*构造期*访问 DOM 全局的代码都套在 `hasDom()`（`core/dom.ts`）里：
  `new Analytics()` 只在 DOM 存在时才注册 `visibilitychange` /
  `beforeunload` 监听，队列的 `online` 监听同理。

仍然只有浏览器能做的只是*追踪*：`track()` 和 `page()` 会读 `location`、
`document.title` 和 `navigator`。在服务端构造与销毁 SDK 是安全的；在服务端
记录事件则不是。

## 投递与销毁

队列只有在 destination 接受之后才把批次发出去：

```
track() → queued → flushing ──ok──▶ 移除
                      │
                      └──fail──▶ 留在队列里，按退避重试
                                  （retryDelay × 2ⁿ，封顶 30s）
                                  超过 maxRetries → 丢弃，发一条
                                  终态的 "failed" debug 事件
```

| 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `batchSize` | `20` | 每个请求的事件数 |
| `flushInterval` | `1000` | 自动 flush 前的毫秒数 |
| `maxRetries` | `3` | 批次被丢弃前的重试次数 |
| `retryDelay` | `1000` | 基础退避，翻倍，封顶 30s |
| `maxQueueSize` | `500` | 满时丢弃最旧事件 |
| `timeoutMs` | `10000` | 请求允许在途多久；`0` 关闭 |

一次失败批次绝不会因为*暂时性*的断网而丢，`online` 事件会立即 flush 而
不是干等退避。`flush()` 永不 reject —— 每个自动调用方都写
`void this.flush()`，一次 rejection 会变成 unhandled promise rejection。

一次 `flush()` 发现已有 flush 在跑时，会把那个 promise 原样交回，而不是
立即 resolve，所以 `await flush()` 真正意味着"缓冲区已被处理完"、而不是
"已安排了一次 flush"。这正是 `close()` 可信的原因。

**永不响应的请求。** 黑洞路由或强制门户会让一个请求永远挂起，过去这会
把队列停在一个永远 settle 不了的 promise 上 —— 没有重试、没有失败、靠
沉默丢事件。现在 transport 会挂 `AbortController`，把 `timeoutMs` 当作
一次失败尝试，同一份重试预算照样生效。设 `timeoutMs: 0` 可退出。

**`keepalive` 只花在最后一发上。** 浏览器对这种方式在途的请求量有上限，
所以把它花在普通批次上，正是让那个无法重试的请求失去名额的原因。因此
每次 flush 默认关掉它，除了标签页隐藏 / `beforeunload` 那一次。超过
~60KB 的 body 也不能用它 —— 那些会被直接拒绝 —— 所以它们干脆不带 flag 地
发出去。`navigator.sendBeacon` 刻意不用在最后一发上：它在知道任何东西是否
送达之前就报告成功，而"到底到没到"正是队列重试逻辑依赖的东西。

销毁会释放实例拥有的一切：

- `destroy()` —— 幂等；停掉每个探针、移除它自己的 `visibilitychange` /
  `beforeunload` 监听、停掉队列的定时器和 `online` 监听，然后做最后一次
  尽力而为的 flush。
- `close()` —— 一样，但会等待 flush。当你需要确定缓冲区已空时用它
  （测试、SPA 卸载）。
- 两者之后，`track()` / `page()` 变成 no-op，`isDestroyed` 为 `true`。

SDK 注册的每个监听器都是有名字的字段，所以 `architecture.test.mjs` 会在
有人加了监听却忘了对应的 `removeEventListener` 时报错。

## 调试插件

`core/debug` 从根 barrel 导出，所以任何东西都能观察流水线而无需被接进
SDK：

```ts
import type { DebugEvent, DebugPlugin } from "analytics";

const toDatadog: DebugPlugin = {
  name: "datadog",
  onEvent(event: DebugEvent) {
    metrics.increment(`analytics.${event.stage}`);
  },
};

const off = analytics.debug.registerDebugPlugin(toDatadog);
// ...
off(); // 或：analytics.debug.unregisterDebugPlugin("datadog")
```

- 注册一个已被占用的名字会**替换**掉之前的插件，这样热重载不可能把每个
  事件投递两遍。
- `stop?()` 是 teardown 钩子。它在 `unregister` 和 `Analytics.destroy()` /
  `close()` 时运行，所以没有插件能比 SDK 活得久。
- `debug.enabled` 为 false 时插件收不到任何东西 —— `emit()` 在到达总线前
  就短路了。
- 一条 `failed` 事件除了自由文本的 `error`，还带着 `reason`：
  `queue-overflow`（根本没发出去就被丢）、`undeliverable`（SDK 停止重试）、
  `transport-error`（请求本身失败）和 `timeout`（不是被拒绝，而是对方从未
  应答）。匹配 `reason`，别匹配消息文本。
- **插件不能搞崩页面。** `emit()` 把每个监听器包在各自的 try/catch 里：
  一个抛异常的插件过去会一路穿过 `DebugController`、`EventFactory` 冒进
  宿主应用自己的 click handler。现在它只警告一次，连续失败三次的插件会被
  退订（并从 `debugPlugins` 里移除），而不是被永远调用下去。
- `analytics.debug.debugPlugins` 列出已挂载的名字。

两个内置项也是插件，按名字安装：

| 名字 | 模块 | 备注 |
| --- | --- | --- |
| `console` | `core/debug/console-plugin.ts` | 无状态；console 日志器 |
| `inspector` | `core/debug/inspector-plugin.ts` | 持有 DOM 面板；`stop()` 移除它 |

`debug: { console: true, inspector: true }` 因此意味着"安装这两个名字"，
其中任何一个都可以像自定义插件那样被移除：

```ts
import { CONSOLE_PLUGIN } from "analytics";
analytics.debug.unregisterDebugPlugin(CONSOLE_PLUGIN);
```

因为 inspector 的生命周期就是它那个插件的生命周期，`destroy()` 会连同面板
一起移除它。

## 构建

```
npm --prefix build install        # 首次
npm --prefix build run build
```

根目录没有 `package.json`：这个仓库是源码目录，不是包。需要安装的东西
住在各自的目录、带着各自的 lockfile —— `demo/` 放 vite 和测试要用的
typescript，`build/` 放 tsup 和打包器，`tests/` 放测试脚本、什么都不装。
根目录没东西可装，也就意味着根目录没东西可忘。

`build/tsup.config.ts` 里：两个入口、两种格式、同一份源码：

| 文件 | 格式 | 用谁加载 |
| --- | --- | --- |
| `dist/analytics.js` | ESM，barrel | `<script type="module">`、打包器 |
| `dist/analytics.iife.js` | IIFE，自安装 | `<script src="…">` |

这里的扩展名不承载任何模块系统含义：没东西声明 `type: module`，所以 Node
会把 `analytics.js` 当 CommonJS 读、在 `export` 上报错。它是浏览器产物，
不是任何东西去 resolve 的入口 —— 消费者直接 import TypeScript 源码。

这两条入口还带着一条规则：`analytics/` 里没有任何东西 import `iife.ts`。
它只能通过 `build/tsup.config.ts` 被触达，因为通过 barrel 触达它意味着
"import 这个库"会用页面恰好设好的选项安装 SDK。架构测试守着这条，也守着
"根目录始终是源码目录"。

有意不放进构建的东西：

- **`.d.ts`** —— 消费者从他们 import 的 TypeScript 源码拿类型；demo 也
  从源码构建。产出声明文件会把 typescript 从它现在所在的孤岛里拉出来。
- **minification** —— 这些文件是给人读的，人正调试一个他们无法控制的
  页面上的追踪问题。
- **`clean`** —— 两个配置并行构建，谁先跑完谁可能被对方清掉。两个入口
  名字固定，所以每次构建覆盖自己的文件；重命名其中一个，旧产物会一直留
  到整个目录被删掉。

`build/` 里有个奇怪的条目：`@rollup/rollup-win32-x64-msvc` 被钉成 optional
dependency，因为 npm 会漏掉 rollup 的平台二进制（npm/cli#4828），而 tsup
无论是否产出声明文件都要加载 rollup。npm 在其他平台上会忽略这个钉。

## 测试

```
npm --prefix tests run test
```

无需安装 —— 脚本取用 `demo/` 里的 typescript。它把 core + adapters 用
tsc 编译进 `tests/.build`，然后对它显式列出的文件跑 `node --test`：

- `tracker-port.test.mjs` —— 探针只靠一个裸 `EventRecorder` 驱动，无需
  `Analytics` 实例
- `registry.test.mjs` —— 注册/销毁语义、监听计数、端到端事件流水线
- `queue.test.mjs` —— 失败批次留在缓冲里并被重试、只在预算耗尽后才丢弃、
  `flush()` 永不 reject、溢出丢最旧、销毁清空每个监听器
- `debug-plugin.test.mjs` —— 插件观察整条流水线、同名注册替换而非翻倍、
  unregister 静默解绑
- `network.test.mjs` —— 三个 transport 发出相同的名字与属性；框架缺失时
  每个适配器 no-op；`init()` 幂等；`network` / `frameworks` 选项矩阵在两个
  入口里解析一致
- `robustness.test.mjs` —— 没有 `crypto.randomUUID`、storage 被禁用或缺失、
  抛异常的插件、永不 settle 的请求、`keepalive` 门禁、SSR 构造、并发
  `flush()` 共用一个请求、`close()` 排空缓冲区，外加 ids / factory /
  session / destination 的单元测试
- `adapter-plugin.test.mjs` —— 插件注册表：注册 / 安装 / 配置第三方适配器、
  可用性门禁、抛异常的适配器、名字替换、integration 报 `manual`、
  `adapters.*` 压过旧开关
- `architecture.test.mjs` —— 断言 core 永不 import adapters、barrel 永不
  拉入框架适配器、没有适配器 import `@angular/*` 或 `rxjs`、每个监听器都可
  移除、script-tag 入口留在库之外、根目录没有 package.json、测试脚本真的
  跑到了每个 `*.test.mjs`

## TODO

- 队列持久化（localStorage / IndexedDB），让事件能扛过刷新
