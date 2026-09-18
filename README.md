# echocat-skill-panel-3.0

**每轮对话结束时报一次 skill 调用情况**：这一轮调用了哪些 skill、是模型自动加载还是你敲 `/name` 手动调用、或者**一个都没调用**。

报告由会话事件日志推导，不依赖模型自觉；并且同时以三种形态呈现，长驻在 DSH 窗口里。

> 面向 DSH Desktop Beta（`dsh-plugin-desktop-beta`）的 host + client 双半插件。
> 实测环境：DSH Desktop Beta `2.0.11-beta.1`，内核 `@deepseek-ai/*` `0.1.6-alpha.1`，cordis 4。

---

## 三个界面

| 位置 | slot | 说明 |
| --- | --- | --- |
| **输入框正上方横栏** | `conversation.input.dock`（list / session） | 默认一行："本轮 gpt-image（模型自动）"，点一下**就地展开**完整报告 + 已安装 skill 列表。**唯一能一键引用 skill 的界面**（见下）。 |
| **左栏图标** | `sidebar.panellist`（list / root） | 常驻入口。点它在**中栏**打开完整面板。折叠成窄轨时只显示图标，悬停有 Tooltip。 |
| **中栏面板** | `main`（keyed / root，key = `skill-report`） | 完整报告，内容与横栏展开后相同（只读，不能引用）。 |

三者共用一份数据，卡顿/失败互不影响。中栏面板被切换走时会被卸载，所以状态放在模块级（`src/client/source.js`），不放在组件里。

除此之外，**每轮结束还会弹一次系统原生通知**（窗口失焦时）。

### 一键引用 skill

横栏展开后有一节「已安装 skill（N）」，每行右侧一个「引用」按钮：点击把 `/skill-name ` **写进输入框**——追加在你已输入的内容后面，不覆盖——按回车即按手动 `/name` 手势调用它。

实现只用官方公开面：`conversation.input.dock` 是 **session 作用域**，所以组件能拿到 `inputActions`（`setDraft`）与 `useInput`（读当前草稿）。另外两个界面是 root 作用域，拿不到这两个，于是把列表渲染成只读并提示去哪里点。

`/name` 正是 `@deepseek-ai/dsh-tool-skill` 识别的手势，所以这条路不需要任何模型侧配合。

## 在界面里安装 / 管理 skill

横栏与中栏面板都能打开安装面板（横栏右侧的 `+` 图标，或「已安装 skill」小节标题上的按钮）。四种方式：

| 方式 | 适合 | 说明 |
| --- | --- | --- |
| **粘贴 SKILL.md** | 最常用 | 整篇粘进去。缺 frontmatter 会自动补（`description` 取正文第一段），但**声明了名字却和安装名不一致**时只警告、不改写你的文件。 |
| **上传文件** | 别人发你的 skill | `.md` 或 `.zip`，可拖拽。zip 会自己找到里面的 `SKILL.md`，并把多余的包装目录压平。 |
| **从链接** | raw.githubusercontent.com 上的 SKILL.md、或直链 zip | 默认拒绝内网地址（`allowPrivateHosts` 可打开）。 |
| **Git 仓库** | `owner/repo`、完整 URL、或 GitHub 的 `…/tree/<分支>/<子目录>` 页面地址 | 需要机器上有 `git`；没有时面板会说明并让你改用前三种。 |

写之前可以先**预览**：解析出的名字、描述、文件数，以及这个名字是否已被占用。同名时不会静默覆盖 —— 先报 `NAME_TAKEN`，勾上「覆盖」后才动手，且旧版先被复制进备份目录。

每张 skill 卡片上有「引用 / 复制名称 / 删除」。删除是两步确认，删掉的目录同样进备份目录，不硬删。

### 安装到底写到哪里

按优先级解析（`resolveSkillsRoot`）：

1. 配置项 `skillsRoot`（必须是绝对路径）；
2. **正在运行的 app 实际报出来的那些 skill 的父目录** —— 这是唯一不会猜错的来源；
3. `$DSH_HOME/skills`，否则 `~/.dsh-beta/skills`。

第 2 条是关键：它如实回报在 `capability.root` 里，所以面板底部显示的路径就是真正会写入的路径。

### 写入的四条规矩

1. **绝不在 skills 目录之外写任何东西。** 名称先过严格 slug，解析后的路径再做一次包含性校验（用 `relative()` 而不是 `startsWith()`，因为 `/skills-evil` 也以 `/skills` 开头）。
2. **绝不破坏用户数据。** 新内容先落在 skills 目录里的 `.echocat-stage-*` 暂存目录，确认完整后才 `rename` 就位；覆盖前把旧的复制进备份目录；卸载是移动不是删除。
3. **绝不静默失败。** 每个失败都是带稳定 `code` 的 `InstallError`，面板按 code 分支并渲染 `message` + 可选 `hint`。
4. **绝不信任输入。** zip 用手写解析器，就是为了在写盘之前挡掉 `../`、绝对路径、符号链接条目与解压炸弹。

## 它报什么

| 情况 | 标题 | 正文 |
| --- | --- | --- |
| 模型用 `skill` 工具加载了 | `本轮调用了 skill（会话标题）` | `gpt-image（模型自动）` |
| 你敲了 `/name` | `本轮调用了 skill（会话标题）` | `h3-prompt-writing（你手动 /）` |
| 两者都有 | `本轮调用了 skill（会话标题）` | `h3-prompt-writing（你手动 /）、gpt-image（模型自动）` |
| 没用到 | `本轮未调用 skill（会话标题）` | `本轮对话没有加载任何 skill。` |

同一轮内重复加载同一个 skill 会去重；`/name` 优先于同名的模型加载（显式手势是更强的信号）。
回合失败（`error` / `max-tokens`）也照样报。子代理默认静音，避免子任务刷屏。

### 为什么 `/name` 必须单独处理

`/name` 的注入**不写进会话日志**：`@deepseek-ai/dsh-tool-skill` 在 `agent/pre-step` 边界把
`<skill_content>` 直接折进进入步骤的消息批次，所以历史里查不到它。
`user/message` 中带 `source.kind === "skill-invocation"` 的事件是该手势**唯一**的持久痕迹。

而且这种事件的 `source.kind` 不是 `"user"`：照搬系统自带通知那套（只把 `source.kind === "user"` 视作人类发起），
**恰好是最需要报告的这种回合会被整段跳过**。插件因此把 `skill-invocation` 也算作人类发起。

## 架构

```
host  session/event ──► detect.js（回合追踪）──► store.js（历史 + 计数）
                                                      │
                          connection.fetch 注册 /api/skill-report/state
                                                      │  GET / HEAD, JSON
client                                    source.js（fetch + uSES 订阅）
                                                      │
                                        panel.js（纯展示）──► 三个界面
```

**为什么面板不自己算**：中栏 `main` 是 **root 作用域**槽位，只暴露 5 个 root 席位
（`useSessions` / `usePanelInfo` / `useWorkspaces` / `useResource` / `useSessionPendingInteraction`），
拿不到任何携带消息的会话级 hook（`useConversation` / `useTrajectory` …）。
所以 skill 统计必须由 host 侧权威计算，浏览器侧只做渲染。

**为什么走 `/api/`**：`dsh-client-connection` 会对整个 `/api` 前缀在派发前跑
`requestRejection`（trusted-Host/Origin 栅栏 + 浏览器会话认证），路由**天然带鉴权**。
裸 `webServer.register` 没有这层保护，会被任何本地进程读到，`networkExposure` 不是 `loopback` 时还会泄露到局域网。

## 只看不写：不污染对话

插件**纯观察**，从不向模型可见表面注入任何东西：不增加请求 token、不改写会话历史、不做模型侧注入。
会话表面的事件类型是封闭的四种，要往历史里塞一条自定义审计消息只能伪装成 `user/message`——
而那会被模型在后续回合读到。本插件刻意不这么做。

## 设计约束：绝不拖死宿主

两处兜底，都是踩过坑之后加的：

1. **`apply()` 顶层 try/catch**。DSH 的插件树加载**没有单插件级隔离**，`apply()` 抛异常 =
   `plugin tree failed to load` = host 启动失败 = 应用打不开。
2. **异步注册点也各自兜底**。`ctx.inject(deps, cb)` 的回调在**下一拍**才跑，
   **不在** `apply()` 的 try/catch 覆盖范围内。所以 host 侧的路由注册、客户端侧的 `slots.register`
   都各自包了 try/catch：失败只写一行日志（客户端是 `console.error`），绝不让 fiber 挂掉。

## 打包契约（第三方客户端插件的硬性前置）

`dsh.client` 声明错了**不会优雅降级**：它会让 `modules` 这个**必需启动条目**失败，
**整个 DSH 起不来**。必须同时满足：

| # | 要求 | 说明 |
| --- | --- | --- |
| 1 | 有一条**活动 Loader 条目**，且 `options.name` 是**精确包名** | 裸子路径 specifier（`pkg/sub`）会被静默跳过 |
| 2 | `package.json.dsh.client.platform === "web"` | 其它值整包被静默跳过，负缓存 |
| 3 | `exports["./client"]` 是 string 或 `{ default: string }` | **只读 `default`**，没有 `browser` 条件；路径按纯文件系统拼接，不经 exports 解析 |
| 4 | 该文件**在磁盘上真实存在** | 缺失 → `client bundle not found; run pnpm run build before launch`；DSH 不替你构建 |
| 5 | bundle 以包名注册：`window.__ModuleLoader__.load({ id: "<包名>", factory })` | id 不匹配 → `loaded without registering` |
| 6 | bundle 是**经典脚本**：无顶层 `import` / `export` / `await` | 副作用（含 CSS 注入）必须在 factory 闭包内 |
| 7 | `require()` 只落在 **9 个平台种子**或 `dsh.client.external` 声明的模块内 | 见下 |
| 8 | `exports` 里带 `"./package.json"` | 否则子路径解析被 exports 封装挡住（降级解析路径会失败） |

平台种子（可直接 `require`，无需声明 `external`）：
`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、
`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、
`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。

本插件的 bundle 只 `require("react")`，所以在基座内，`external` 为空。

> ⚠️ 别混淆两个 `inject`：`dsh.client.inject` 是**其它客户端包名**（只影响装载/预取顺序，官方原话
> "never apply sequencing"）；bundle 里 `exports.inject` 是 **cordis 服务名**。本插件只声明后者（`['slots']`）。

## 安装

前置：插件依赖 `@deepseek-ai/schemastery`，由 DSH 运行时提供。它声明为 **peerDependency**，
profile 的 `autoInstallPeers: false` 会让它回落到内核副本——**千万不要**写进 `dependencies` 并锁版本，
那会造成内核版本漂移（`dsh-video-lens` 就是这么坏的）。

```powershell
$ProfileDir = "$env:USERPROFILE\.dsh-beta\profiles\desktop"
$Src = "<解包后的>\echocat-skill-panel-3.0"

# 1) 放进 profile 的 vendor 目录
Copy-Item -Recurse $Src "$ProfileDir\vendor\echocat-skill-panel-3.0" -Force
# 2) 建目录联接，让裸 import 能被解析
New-Item -ItemType Junction -Path "$ProfileDir\node_modules\echocat-skill-panel-3.0" `
                             -Target "$ProfileDir\vendor\echocat-skill-panel-3.0" -Force
# 3) profile package.json：
#    dependencies:  { "echocat-skill-panel-3.0": "link:./vendor/echocat-skill-panel-3.0" }
#    dsh.profile.bundles: [ ..., "echocat-skill-panel-3.0" ]
Set-Location $ProfileDir
node "<DSH>\resources\app\node_modules\pnpm\bin\pnpm.mjs" install
```

**必须重启 DSH**：host 半侧在 boot 时读 profile，客户端 bundle 在 boot 时被快照进内存
（响应标为 immutable），改完内容要**重启后端**才生效，刷新页面不够。

重启后在 `%APPDATA%\DSH Desktop Beta\logs\host\dsh-<日期>.log` 确认两行：

```
[I] [echocat-skill-panel-3.0] skill-report: panel feed at /api/skill-report/state
[I] [echocat-skill-panel-3.0] skill-report mounted: per-turn skill audit active
```

看到 `[W] ... mount failed, plugin disabled: ...` 说明插件自身坏了，但**应用会正常启动**。

## 配置

在 **profile 的** `cordis.patch.yml` 里加一条**按 id 的覆盖**——是 `id` 覆盖，**不是 `insert`**
（`insert` 会再塞一个重复条目）：

```yaml
- id: skill-report
  config:
    enabled: true                              # 总开关
    notifyOnNoSkill: true                      # false = 只在本轮用到 skill 时才弹通知
    includeSubagents: false                    # true = 子代理回合也提醒
    logReports: false                          # true = 每条报告也写进 host 日志
    maxRecent: 200                             # 面板保留多少个回合
    httpRoute: true                            # 关闭面板供数路由
    httpPath: /api/skill-report/state          # 必须落在 /api/ 下，否则回落到默认值
```

`dsh.profile.patchReload: live` 时改完保存即可生效（客户端 bundle 除外，那需要重启）。

## 开发与测试

```powershell
pnpm run build      # 生成 lib/client.js（手写打包器，无构建依赖）
pnpm test           # 七套测试
```

| 套件 | 覆盖 |
| --- | --- |
| `test/units.mjs` | `detect.js` / `store.js` 纯逻辑：两条通道、去重、环形缓冲边界、快照深拷贝、订阅隔离、异常观察者不传染 |
| `test/smoke.mjs` | host 半侧跑在**真实 cordis** 的 `Context` + `Service` 上 |
| `test/install.mjs` | 安装引擎：真临时目录 + 真 zip 字节（stored/deflate），含 zip-slip、绝对路径、符号链接条目、解压炸弹、体积上限、覆盖备份、卸载两步确认、URL/SSRF 围栏 |
| `test/http.mjs` | 真实 cordis + 记录型 connection 服务；直接调用注册的路由 handler，断言 JSON 载荷、HEAD 无 body、降级行为 |
| `test/install-route.mjs` | 安装端点真挂载：协议形状、HTTP 状态码映射、`allowInstall:false` 变只读、非法路径回退 |
| `test/client-bundle.mjs` | 真实 `lib/client.js` 按 `__ModuleLoader__` 协议求值，**真实 React**；自带 hook 运行时（`setState` 是真的），把安装、预览、覆盖重试、两步删除、尺寸拒绝都端到端跑一遍 |
| `test/client-css.mjs` | 样式表契约：`--sr-*` 令牌必须定义在**每一个界面根**上（`.sr-root` / `.sr-strip-wrap` / `.sr-backdrop` / `.sr-rail`）、不得引用未定义令牌、组件用到的类都必须有规则 |

> `client-css.mjs` 是补上来的：安装面板第一次从横栏打开时渲染成了裸 HTML —— 类全都定义了，但令牌只挂在 `.sr-root` 上，而面板是 `.sr-strip-wrap` 的**兄弟节点**，于是每个 `var(--sr-*)` 都是未定义，整条声明在计算值阶段失效，边框、内边距、间距、颜色一起消失。"类有没有定义"这种覆盖率检查永远抓不到它。

> 测试要在能解析 `@deepseek-ai/cordis` 的环境里跑（profile 目录下，或包位于某个 profile 的 `node_modules` 中）。
>
> 两个容易踩的坑：`ctx.inject(deps, cb)` 在 cordis 里是**异步激活**的，挂载后必须让出一拍再发事件；
> 这是测试写法问题，不是插件问题。

## 卸载 / 回滚

1. 从 profile `package.json` 的 `dsh.profile.bundles` 删掉 `"echocat-skill-panel-3.0"`。
2. 删掉 `dependencies` 里的条目，跑一次 pnpm install。
3. 删除 `vendor\echocat-skill-panel-3.0` 与 `node_modules` 下的链接。
4. 重启。

起不来时用 `--dsh-desktop-safe-mode` 启动，或 `--dsh-desktop-recovery` 进恢复界面回滚检查点。

## 变更历史

### 3.0.0 — 2026-09-18

- **插件变成 skill 管理器**，不再只是报告器：新增 `src/install.js`，从「粘贴 SKILL.md / 上传 .md 或 .zip / 从链接 / 从 Git 仓库」四条路安装，外加预览、卸载、重新扫描。
- **新增唯一一条写入路由** `GET|POST /api/skill-report/skills`。它敢存在，只因为它落在 `/api` 前缀下 —— `dsh-client-connection` 的 `requestRejection` 已经替它做了浏览器会话鉴权。没有这层围栏的写路由会让任何本机进程都能往用户的 skills 目录里丢文件。
- **卸载不删，只移动**：覆盖与删除都先复制进 `<备份目录>/<时间戳>-<名字>`。这个插件没有硬删除路径。
- **安全边界**：手写 zip 读取器（只支持 stored/deflate，拒绝 zip64），在写盘之前逐条挡下 zip-slip、绝对路径、符号链接条目与解压炸弹；名称必须是严格 slug；URL 安装默认拒绝 `localhost` 与 RFC1918 地址。
- **载荷新增 `capability` 与 `installHistory`**：面板只提供真能成功的动作，不能做的会说清原因（例如配置里关掉了写入）。
- 新增 `test/install.mjs`（100 项：真临时目录、真 zip 字节、真恶意压缩包）与 `test/install-route.mjs`（66 项：真挂载、真协议、真错误码）。
- 包名改为全小写 `echocat-skill-panel-3.0` —— npm 风格名称是小写，而这个名字同时是 Loader 条目名、vendor 目录名与客户端 bundle id。
- 界面侧：新增安装面板，并做了 26 项 UI 优化（清单见 `src/client/panel.js` 头部注释）。
- **修**：安装面板从横栏打开时渲染成裸 HTML —— `--sr-*` 设计令牌原本只定义在 `.sr-root` 上，而横栏里的面板是它的**兄弟节点**，于是每个 `var(--sr-*)` 都未定义，整条声明在计算值阶段失效，边框/内边距/间距/颜色一起消失。令牌改为定义在**所有界面根**（`.sr-root` / `.sr-strip-wrap` / `.sr-backdrop` / `.sr-rail`）上，并补 `test/client-css.mjs` 守住"令牌必须覆盖每个界面根、且不得引用未定义令牌"这条不变量。

### 2.0.0 — 2026-09-18

- **新增客户端半侧**：`dsh.client` + 预构建的懒加载 CJS `lib/client.js`，三个界面（输入框上方横栏 / 左栏图标 / 中栏面板）。
- **新增主机侧供数路由**：`GET|HEAD /api/skill-report/state`，走 `connection.fetch` 拿到 `/api` 的鉴权。
- **新增已安装 skill 列表 + 一键引用**：主机侧 `ctx.skills.list()` 随载荷下发；横栏展开后每行一个「引用」按钮，把 `/name ` 追加进输入框。只有 session 作用域的席位拿得到 `inputActions`，另两个界面渲染成只读并提示。
- **检测与状态抽成零依赖纯模块**（`detect.js` / `store.js`），带 54 项单测。
- 异步注册点补兜底：路由注册与 `slots.register` 各自 try/catch，不再有拖死 fiber 的路径。
- 修轮询参考计数：三个界面共用一个计时器，任一面板卸载不再掐掉其他界面的自动刷新。
- 修草稿保护：`setDraft` 是替换语义，读不到当前草稿时改为**什么都不做**，绝不覆盖用户已输入的内容。
- `exports` 补 `"./package.json"`。

### 0.2.0 — 2026-09-18

首次真正挂载成功后发布。修掉三个问题，其中两个会让 **DSH 直接起不来**：

| # | 问题 | 后果 | 修法 |
| --- | --- | --- | --- |
| 1 | `package.json` 缺 `dsh.bundle` | profile 拼装阶段抛错，应用不启动 | 补上 `dsh.bundle.patch` |
| 2 | `ctx.sessions.on('session/event', …)` —— 该 API 不存在 | `apply()` 抛 `TypeError`，插件树加载失败，应用不启动 | 改为 `ctx.inject(['sessions'], c => c.effect(() => c.on(…)))`，与内核自带 `desktop-notifications` 一致 |
| 3 | 标题取自 `session.header.title` —— 该字段不存在 | 通知标题里的 `（会话标题）` 永远为空 | 改从 `sessionTitle` 服务投影读取 |

另外**新增** `apply()` 顶层 try/catch 兜底。

### 0.1.0

初版：检测逻辑、通知、配置开关。

## 许可

MIT，见 `LICENSE`。
