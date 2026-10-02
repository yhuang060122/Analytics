# Analytics

前端埋点 SDK。TypeScript，浏览器优先。

本仓库是**一个源码目录，而不是 npm 包** —— 根目录没有 `package.json`。
需要安装的东西分别住在三个自包含的"孤岛"里（`demo/`、`build/`、`tests/`），
各有各的 lockfile。SDK 是按路径引入的，不是按包名。

> 语言：[English](../README.md) | 简体中文

---

## 快速开始

### 环境要求

- **Node.js ≥ 20**（在 22.x 上开发与测试）
- **npm ≥ 9**
- 没有全局安装。每个孤岛装自己的工具。

### 安装

```bash
npm --prefix demo install      # vite + typescript（跑 demo，也负责编译测试）
npm --prefix build install     # tsup + typescript（打产物）
```

`tests/` 不用装任何东西 —— 它的脚本直接用 `demo/node_modules` 里的
TypeScript。

### 跑 demo

```bash
npm --prefix demo run dev
```

打开 **http://localhost:5173**。这是一个 Vite 多页应用：

| 页面 | 它演示什么 |
| --- | --- |
| `/`（index） | 点击、页面浏览、手动事件、突发批量 |
| `/portfolio` | 第二个页面，会话因此延续 |
| `/watchlist` | 独立的手动事件 |

SDK 实例在 `demo/src/analytics.ts` 里跨页面共享。开了 `debug.console` 之后，
流水线的每个阶段都会打进 devtools console，页面本身不挂任何调试 UI。

dev server 内置了一个 **mock collector**（`demo/vite.config.ts`），
让整条流水线可以端到端跑通：

| 端点 | 用途 |
| --- | --- |
| `POST /api/analytics/events` | 接收 SDK 批次，打到终端 |
| `GET /api/analytics/outage?state=on\|off` | 模拟 500，用来演练丢弃路径 |
| `GET /api/portfolio` | portfolio 页的样例数据 |
| `GET /api/news` | watchlist 页的样例数据 |

### 常用命令

| 目的 | 命令 |
| --- | --- |
| 跑 demo（dev server） | `npm --prefix demo run dev` |
| 严格 typecheck + 构建 demo | `npm --prefix demo run build` |
| 打 SDK 产物 | `npm --prefix build run build` |
| 跑测试 | `npm --prefix tests run test` |

- `npm --prefix tests run test` 用 tsc 把 `analytics/` 编译到 `tests/.build`，
  再跑 `node --test`。**改过 `analytics/` 下任何东西之后都要跑它。**
- `npm --prefix build run build` 产出 `dist/analytics.js`，即 ESM barrel。
  见[构建](#构建)。
- `npm --prefix demo run build` 会用一份更严的 TypeScript 配置跑 demo
  （`noUnusedLocals`、`verbatimModuleSyntax`），比 SDK 自身的构建还严 ——
  提交前拿它再过一遍是个好检查。

---

## 目录结构

```
analytics/
  core/                     整个 SDK
    api/                    端口与门面：Analytics，
                            EventRecorder / Tracker / BaseTracker
                            (tracker.ts)
    probes/                 ClickTracker、PageTracker
    domain/                 event / context / session / id
                            （id.ts 里是 crypto → getRandomValues →
                            Math.random 的降级链；page-context.ts 是
                            那三个页面键的唯一来源）
    factory/                EventFactory：track() / page() → AnalyticsContext
    queue/                  EventQueue：批处理、溢出丢弃（无重试）
    transport/              Destination 端口 + HttpDestination（HTTP POST，
                            超时 + keepalive 门禁）
    debug/                  DebugController、事件总线、插件注册表、
                            一个 console 内置插件
    dom.ts                  hasDom() —— 构造期访问 DOM 的守卫
    warn.ts                 warnOnce() —— 降级时"只警告一次、绝不静默"
  index.ts                  公开 barrel

demo/                       Vite 多页 demo + mock collector
build/                      tsup 配置 → dist/analytics.js
tests/                      node --test 套件（零依赖）
dist/                       构建产物（git-ignored）
```

**没有 `adapters/` 这一层了。** 两个探针在 `core/probes/`，依赖
`EventRecorder` 端口；装配发生在**组合根** —— 你的应用里 —— 在 `probes: [...]`
里点名，或交给 `analytics.registerTracker()`。两种方式下引擎都不 import 探针，
所以新增探针是宿主改动而不是引擎改动。`tests/architecture.test.mjs` 机械地守着
这一条以及另外十几条不变量。

---

## 事件流水线

```
probe.track(name, props)
  → Analytics.track  → EventFactory.track  → createContext(session/url/referrer/UA)
      └─ debug: CREATED
  → EventQueue.enqueue（溢出时丢最旧 + debug: FAILED）
      └─ debug: QUEUED → 满 batchSize 或定时器到 → flush()
  → flush(): 窥视一个批次 → debug: FLUSHING → destination.send
        被接受 → 出缓冲区
        被拒收 → 丢弃，发一条 debug: FAILED · undeliverable
  → HttpDestination → POST JSON {events}，debug: SENT / FAILED
```

`visibilitychange` / `beforeunload` 会触发最后一次 flush，恢复在线也会。

---

## 入口

没有 `init()`，也没有自动探测：你点名要哪些探针，SDK 负责装配。
`probes` 收的是工厂函数：

```ts
import { Analytics } from "analytics";
import { PageTracker } from "analytics/core/probes/page-tracker";
import { ClickTracker } from "analytics/core/probes/click-tracker";

const analytics = new Analytics({
  endpoint: "/api/analytics/events",
  batchSize: 20,

  probes: [
    recorder => new PageTracker(recorder),
    recorder => new ClickTracker(recorder),
  ],
});

analytics.start();
```

**是工厂函数，不是类。** 探针构造函数需要 recorder，而 recorder 正是正在
构造的那个对象 —— 所以 `probes: [PageTracker]` 根本不可能工作。传函数还有
一个好处：选项照样能传到探针，
`recorder => new ClickTracker(recorder, { attribute: "data-tap" })`。

这也让 SDK 不必知道有哪些探针。`probes: ["page", "click"]` 那种写法需要在
引擎内部维护一张"名字 → 类"的表，而那张表正是本项目刻意删掉的注册表。
`architecture.test.mjs` 会在任何引擎文件 import 探针时让构建失败。

**`probes` 决定*装配什么*，绝不决定*何时运行*。** 它只注册；启动全部探针的
仍然是 `start()` 调用 —— 所以 page view 永远不会从构造函数里发出去。

手写 `new` 照样能用，两者可以混用 —— 需要把某个探针留着以后再处理时很方便：

```ts
const click = new ClickTracker(analytics, { attribute: "data-tap" });
analytics.registerTracker(click);
```

`registerTracker()` 只注册；`destroy()` 与 `unregisterTracker()` 停掉探针；
`await analytics.close()` 是可等待的版本。见[投递与销毁](#投递与销毁)。

barrel 导出全部，所以 import 根入口就是消费者需要的全部：

```
analytics/index.ts    全部
```

本 README 里的示例把 import 简写为 `analytics/…`。没有包可安装，所以把
它们指向你放源码的地方即可 —— demo 用的是相对路径。

### 两个探针

| 探针 | 构造函数 | 需要 |
| --- | --- | --- |
| `PageTracker` | `new PageTracker(recorder)` | 一个 DOM（读 `window.location`） |
| `ClickTracker` | `new ClickTracker(recorder, { attribute? })` | 一个 DOM |

`ClickTracker` 会为任何带 `data-analytics="<名字>"` 的元素上报
`Element Clicked`（用 `{ attribute }` 改属性名）。元素的文字**默认不上报**，
除非它还带 `data-analytics-text` —— 见[隐私](#隐私)。

`PageTracker` 在启动时上报一个 `page` 事件，标签页隐藏或页面卸载时再上报一个
`Page Duration`。

**结构上幂等。** 两者都继承 `BaseTracker`，由基类持有 running 标志。子类实现
`onStart()`/`onStop()`，不可能不小心重复注册监听器 —— 所以 `start()` 调多次
也是安全的。

**两个探针在无 DOM 时构造与启动都是安全的。** 服务端渲染会建出整条探针链，
然后发现自己没有东西可监听，所以 `canStart()` 返回 `hasDom()`，
`start()` 让探针保持停止而不是抛错。SDK 在任何地方都能构造、装配、启动、
销毁；只有*记录事件*需要浏览器。

### 隐私

`Element Clicked` 只在元素显式用 `data-analytics-text` 声明时才带上它的
`textContent`。这是刻意的：元素文字是最容易带个人数据的属性 —— 一句
"Hi Sarah" 的问候、一段消息预览、一个旁边带着客户姓名的价格。键始终存在
（未声明时为 `null`），这样属性 schema 不依赖被点击的是哪个元素。

---

## 投递与销毁

队列只在 destination 接受之后才把批次发出去：

```
track() → queued → flushing ──ok──▶ 移除
                      │
                      └──fail──▶ 丢弃，发一条终态的
                                  "failed · undeliverable"
                                  debug 事件
```

| 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `endpoint` | — | 必填；批次 POST 到哪里 |
| `batchSize` | `20` | 每个请求的事件数 |
| `flushInterval` | `1000` | 自动 flush 前的毫秒数 |
| `timeoutMs` | `10000` | 请求允许在途多久；`0` 关闭 |
| `probes` | `[]` | 要装配的探针工厂；见[入口](#入口) |
| `debug` | 关闭 | `{ enabled, console }`；见 [debug 插件](#debug-插件) |
| `apiKey` / `headers` | — | 请求上的额外认证 / 头 |

缓冲区上限 500 条，**不可配置**。满了就丢最旧事件，并以
`failed · queue-overflow` 上报 —— 与 `undeliverable` 是不同的 reason：
前者的事件根本没离开过缓冲区，后者是发出去了但被拒。一个抬不上去的上限，
就是不可能被误触的上限。

**没有重试。** destination 拒收的批次一次之后就丢弃，并以
`failed · undeliverable` 上报，让这次丢失是可见的而不是静默的。这是个
明确的取舍：留着被拒的批次意味着一个永久坏掉的端点会不断撑大缓冲区，
并且之后每次 flush 都重发同一份注定失败的负载。如果你的事件必须在弱网下
存活，就由宿主自己发 —— `navigator.sendBeacon`，或者在
`analytics.track()` 前面套一层自己的队列。

`online` 事件仍会立即 flush：断网期间缓冲的事件没人送得出去，连接恢复
正是一次全新的尝试 —— 这些事件本来就一次都没发过。

`flush()` 永不 reject —— 每个自动调用方都写 `void this.flush()`，
一次 rejection 会变成 unhandled promise rejection。

一次 `flush()` 发现已有 flush 在跑时，会把那个 promise 原样交回，而不是
立即 resolve，所以 `await flush()` 真正意味着"缓冲区已被处理完"、而不是
"已安排了一次 flush"。这正是 `close()` 可信的原因。

**永不响应的请求。** 黑洞路由或强制门户会让一个请求永远挂起，过去这会
把队列停在一个永远 settle 不了的 promise 上 —— 没有失败、没有上报、靠
沉默丢事件。现在 transport 会挂 `AbortController`，把 `timeoutMs` 当作
一次失败尝试，于是批次被丢弃并上报，而不是永远挂着。设 `timeoutMs: 0`
可退出。

**`keepalive` 只花在最后一发上。** 浏览器对这种方式在途的请求量有上限，
所以把它花在普通批次上，正是让那个无法重试的请求失去名额的原因。因此
每次 flush 默认关掉它，除了标签页隐藏 / `beforeunload` 那一次。超过
~60KB 的 body 也不能用它 —— 那些会被直接拒绝 —— 所以它们干脆不带 flag 地
发出去。`navigator.sendBeacon` 刻意不用在最后一发上：它在知道任何东西是否
送达之前就报告成功，而"到底到没到"正是让丢失可被上报的关键。

### debug 事件

`emit()` 点都埋在引擎内部，所以观察者看得到整条流水线：

| 阶段 | 何时 |
| --- | --- |
| `created` | 事件对象已存在 |
| `queued` | 进了缓冲区 |
| `flushing` | 有请求在为它在途 |
| `sent` | destination 接受了 |
| `failed` | 它没了 —— 看 reason |

四种很不一样的结局共用 `failed`，只有 `reason` 能把它们分开：
`queue-overflow`（根本没发出去就被丢）、`undeliverable`（被拒收，无重试）、
`transport-error`（请求本身失败）和 `timeout`（不是被拒绝，而是对方从未
应答）。`error` 保持自由文本并承载消息；要匹配请匹配 `reason`。

销毁会释放实例拥有的一切：

- `destroy()` —— 幂等；停掉每个探针、摘掉自己的
  `visibilitychange` / `beforeunload` 监听器、停掉队列的定时器与
  `online` 监听，然后做最后一次尽力 flush。
- `close()` —— 可等待的版本：先 flush 再停，所以不会留下在途请求。

---

## debug 插件

debug 是与探针**不同的**扩展点：插件观察流水线，探针产生事件。它们不是
一件事的两种叫法，也不能互相替代。

`core/debug/` 只观察，从不参与投递。它的 `emit()` 点在引擎内部
（factory、queue、transport），所以插件能看到宿主永远看不到的事件。

```ts
import { CONSOLE_PLUGIN } from "analytics";

analytics.debug.registerDebugPlugin({
  name: "my-sink",
  onEvent(event) {
    if (event.stage === "sent") myCounter.increment();
  },
});

analytics.debug.debugPlugins;          // ["console", "my-sink"]
analytics.debug.unregisterDebugPlugin(CONSOLE_PLUGIN);
```

- **插件不能搞崩页面。** 每个插件各自包在自己的 try/catch 里：
  一个抛异常的插件过去会一路穿过 `DebugController`、`EventFactory` 冒进
  宿主应用自己的 click handler。现在它只警告一次，连续失败三次的插件会被
  退订（并从 `debugPlugins` 里移除），而不是被永远调用下去。
- **每个观察者都有名字。** 没有匿名 `subscribe()`。注册表点不出名字的订阅者，
  就是 `destroy()` 摘不掉的订阅者 —— 名字正是重点，它让注册表成为唯一的入口，
  因而是穷尽的。（这里原本还有一个公开的 event bus，它在自己的监听器集合之外
  另存一份账，于是 `bus.subscribe(fn)` 能活得比它观察的 SDK 更久。）
- `destroy()` / `close()` 会释放所有插件，所以宿主注册的插件不会活得比 SDK 长。
  插件的 `stop()` 同样包在 try/catch 里，而且它的条目**先**离开注册表 ——
  拆卸时抛错不会让一个已摘掉的插件还留在名单上。

内置项只有一个，而且它也是普通插件，按名字安装：

| 名字 | 模块 | 备注 |
| --- | --- | --- |
| `console` | `core/debug/console-plugin.ts` | 无状态；console 日志器 |

`debug: { console: true }` 因此意味着"安装这个名字"，它也可以像自定义插件
那样被移除。宿主自己注册了同名插件时，以宿主为准：这个开关的意思是"该有个
console 日志器"，不是"不管现在挂的是什么都装一个上去"。

---

## 构建

```
npm --prefix build install        # 一次
npm --prefix build run build
```

根目录没有 `package.json`：本仓库是源码目录，不是包。需要安装的东西都
在自己的目录里、带自己的 lockfile —— `demo/` 放 vite 和测试用的
typescript，`build/` 放 tsup 和打包器，`tests/` 只放测试脚本、什么都不装。

只产出一个 bundle：`dist/analytics.js` —— ESM 库入口，无副作用。
import 它不会启动任何东西；要不要装配探针由你决定。

不产出 `.d.ts`：消费者从它 import 的 TypeScript 源码里拿类型，demo 就是
这么做的。产出声明文件需要根目录有一个 typescript，而把构建收在 `build/`
正是为了避免这个。

**没有 `<script>` 构建。** 过去还有一个 bundle：读一个 `window.analyticsOptions`
全局，在 `DOMContentLoaded` 时自安装。它连同一类问题一起消失了 ——
一个要挡在 barrel 之外的额外入口、一个要写进文档的全局名、一条没法关掉
的自安装路径、一个要额外测试的产物。**打包器是消费这个 SDK 的支持方式。**

---

## 测试

```
npm --prefix tests install    # 没有东西要装
npm --prefix tests run test
```

- `tracker-port.test.mjs` —— 探针只靠一个裸 `EventRecorder` 驱动，无需
  SDK 实例；点击文本是 opt-in
- `registry.test.mjs` —— 注册/销毁语义、`probes` 装配（只注册不启动、选项能传到
  探针、抛错的工厂被跳过）、监听计数、端到端事件流水线
- `queue.test.mjs` —— 被拒批次一次即丢弃并上报、重试接口已彻底移除、
  `flush()` 永不 reject、溢出丢最旧、销毁清空每个监听器
- `debug-plugin.test.mjs` —— 插件观察整条流水线、同名注册替换而非翻倍、
  unregister 静默解绑
- `architecture.test.mjs` —— 下面那些不变量
- `robustness.test.mjs` —— 没有 `crypto.randomUUID`、storage 被禁用或缺失、
  抛异常的插件、永不 settle 的请求、`keepalive` 门禁、SSR 构造、并发
  `flush()` 共用一个请求、`close()` 排空缓冲区，外加 ids / factory /
  session / destination 的单元测试

### 值得知道的不变量

`architecture.test.mjs` 把它们写成断言，所以违反会**让测试红**，
而不是等以后才发现：

- 探针只 import `core/api/tracker` —— 绝不 import `Analytics` 门面，
  正是这一点让它们能被孤立测试
- 没有任何引擎文件 import 探针 —— 所以 `probes` 是一份工厂函数清单，
  新增探针是宿主改动而不是引擎改动
- 没有匿名的 debug 订阅 —— 每个观察者都有名字，`destroy()` 才够得着
- `core/probes` 之外没有文件挂监听器或定时器，只有那三个拥有自己定时器
  且每一个都成对移除的文件例外
- 页面三键（`pagePath` / `pageUrl` / `pageTitle`）只从
  `domain/page-context.ts` 读，别处不许拼
- import 这个库不会启动任何东西 —— 任何模块都不得在 import 时构造或挂监听
- SDK **不 import 任何包** —— 只有自己的相对模块
- SDK 注册的每个监听器都能被移除
- 根目录没有 `package.json`，`tests/` 不声明任何依赖

---

## 刻意不提供的

- **SPA 路由变化不被追踪。** `PageTracker` 只在启动时读一次
  `window.location`，所以客户端路由切换既不会产生第二个 `page` 事件，
  也不会产生第二个 `Page Duration`。**这是分工，不是缺口**：
  框架的路由本来就知道路由何时落定、参数是什么、是不是前进/后退。
  让 SDK 去 patch 全局 History API 猜这些，只会比路由本身更不准 ——
  而且 patch 的是页面上所有库共享的东西。

  改为从路由上报：

  ```ts
  // Angular
  router.events.pipe(filter(e => e instanceof NavigationEnd))
    .subscribe(() => analytics.page());

  // 原生 History API
  addEventListener("popstate", () => analytics.page());
  ```

  `page()` 接受路径，所以比 URL 知道更多的路由可以多说一点：
  `analytics.page("/orders/42")`。
