# echocat-skill-panel-3.0

**v3.0.0** · DSH Desktop Beta 的 cordis 插件 —— 统计每轮对话用到了哪些 skill，把结果常驻在界面里；并让你**在应用内直接安装、改名、删除 skill**。

一个 skill 的调用有两条通道 —— 模型自己通过 `skill` 工具加载，或你在输入框打 `/名字` 手动调用。判定不依赖模型自觉：插件从会话事件流推导，模型忘了说也照样报。

三个界面共用一份数据：

| 位置 | 挂载点 | 说明 |
| --- | --- | --- |
| **输入框正上方横栏** | `conversation.input.dock` | 一行结论，点一下就地展开完整报告。**唯一能一键引用 skill 的界面** |
| **左栏图标** | `sidebar.panellist` | 常驻入口，点它在中间打开面板 |
| **中栏面板** | `main`（key `skill-report`） | 完整报告 + skill 目录（只读） |

每轮结束还会弹一次**系统原生通知**。

![面板](docs/panel.png)

## 它能做什么

- **每轮技能审计** —— 本轮调用了哪些 skill（模型自动 / 你手动 `/name` / 一个都没用），可只在本轮用到时才通知
- **一行安装** —— 把作者发布的地址整个粘进来：仓库主页、**仓库里的文件夹链接**、`SKILL.md` 链接、zip 直链、`owner/repo`、SSH 地址；主机侧自己判断该克隆还是该下载
- 另外三种方式：上传 `.md`/`.zip`、粘贴整篇 `SKILL.md`、指定 Git 仓库的分支与子目录
- **中文显示名** —— 安装时填写，或装完在卡片上就地修改；写进该 skill 的 `meta.yaml`（`display-name-zh`），面板按它显示中文
- **改名与删除都留后路** —— 覆盖或删除前先备份到 `skill-report/backups/`
- **没中文的 skill 自动翻译** —— 用你自己配置的默认模型翻一次并缓存，之后永久复用
- **深色主题**
- **宿主不允许写入时自动只读** —— 面板会说明原因，而不是给你一个点了没反应的按钮

## 安装

```powershell
git clone https://github.com/VDERR/echocat-skill-panel-3.0.git
cd echocat-skill-panel-3.0
& ".\安装-3.0.ps1"      # 备份清单 → 镜像 → 清旧包名 → 建联接 → 改 manifest → pnpm install
```

> **装完必须重启 DSH Desktop Beta。** host 半侧在 boot 时快照进内存；客户端 bundle 每次开页面会重新拉取。所以**只改客户端时刷新页面就够，改了 host 必须重启**。

脚本动手前会**备份 profile 清单**，`-Rollback` 一键回退，`-SkipInstall` 只放文件不改 manifest。

手动四步、卸载回滚、以及**四条会让应用起不来的硬性约束**（`dsh.bundle.patch` 必须有、`dsh.client.platform` 必须是 `web`、包名四处一致、`dsh-llm` 只能作 peer）都在 **[安装说明.md](安装说明.md)**。

装完之后，安装面板长这样 —— 默认就是「粘贴地址」：

![安装面板](docs/install-sheet.png)

## 配置

写在 profile 的 `cordis.patch.yml` 里，**按 id 覆盖**（是 `id` 覆盖，不是 `insert`）：

```yaml
- id: skill-report
  config:
    notifyOnNoSkill: true      # false = 只在本轮用到 skill 时才弹通知
    includeSubagents: false
    translateMissing: true     # 关掉可停止一切模型调用
    allowInstall: true         # false = 面板变只读
    skillsRoot: ''             # 留空 = 自动解析（推荐）
    allowPrivateHosts: false   # true = 允许从本机/内网地址安装
```

完整字段见 [安装说明.md](安装说明.md)。

## 架构与实现要点

**两半，各自独立：**

- **host 半侧**（`src/index.js`、`src/install.js`、`src/detect.js`、`src/store.js`）监听 `session/event`，把每轮结果记进环形缓冲；安装引擎独占所有文件写入。
- **浏览器半侧**（`src/client/*.js` → 预构建的 `lib/client.js`）是纯渲染器：它拿不到会话数据（`main` 是 root 作用域，没有携带消息的那几个钩子），所以数据由 host 经 HTTP 提供。

**两条路由都挂在 `/api` 前缀下**，因此免费继承 `dsh-client-connection` 的 `requestRejection`（可信 Host/Origin + 浏览器会话鉴权）。唯一的写入口是没有这层围栏就不能存在的 —— 裸 `webServer.register` 路由会让本机任何进程都能往你的 skills 目录丢文件。

**枚举 skill 必须带 scope。** `skills.snapshot()` 读的是 `[全局层, ...scope 链的层]`；这个部署的全局层**没有任何 provider**（`dsh-web-app` 关掉了宿主的 `skill-filesystem` 行，本地发现归 preset 所有），所以不带 scope 的调用**必然为空** —— 这正是早期"已安装 SKILL 0"的原因。现在 scope 取**活着的会话**，第一帧就是对的。

**安装引擎的四条规矩：**

1. **绝不写到 skills 目录之外** —— 名称先过严格 slug，解析后的绝对路径再做一次包含性校验（用 `relative()` 而不是 `startsWith()`，因为 `/skills-evil` 也以 `/skills` 开头）
2. **绝不破坏你的数据** —— 新内容先落在 `.echocat-stage-*` 暂存目录，完整后才 `rename` 就位；覆盖前把旧的复制进备份目录；**卸载是移动不是删除**
3. **绝不静默失败** —— 每个失败都是带稳定 `code` 的 `InstallError`，界面按 code 分支并渲染 `message` + `hint`
4. **绝不信任输入** —— zip 用手写解析器（只吃 stored/deflate，拒绝 zip64），在写盘前挡掉 zip-slip、绝对路径、符号链接条目与解压炸弹；URL 安装默认拒绝 `localhost` 与 RFC1918

**观察型插件绝不能让宿主起不来。** 插件树没有 per-plugin 隔离：`apply()` 里抛错会失败**整棵插件树**，`ctx.inject()` 的回调是异步激活的、不在 `apply()` 的 try/catch 覆盖范围内，所以路由注册和 `slots.register` 各自也兜一层。这条不是洁癖 —— 它源于实测：把 `session/event` 当成 `ctx.sessions.on(...)` 写过一次，`apply()` 抛 `TypeError`，**DSH 直接不启动**。会话事件是 **cordis 上下文事件**（`ctx.on`，经 `ctx.inject(['sessions'], c => c.effect(...))` 订阅），不是 `sessions` 服务的方法。

## 踩过的坑

这些是调试过程中**量出来的**，写在这里是因为它们比功能列表更能说明这个插件为什么长这样。

**把宿主的语义令牌当视觉令牌用**（一次性造成"浅蓝底色"和"两条黑线"两个抱怨）：

| 令牌 | 实际含义 | 后果 |
| --- | --- | --- |
| `--dsw-alias-label-primary` | **正文字色** `#0f1115` | 所有强调色（左侧竖条、主按钮、下划线、焦点环）都成了近黑色 |
| `--dsw-alias-border-l1` | `#0000000a`，**4% 黑** | 卡片、分隔线、输入框边框等于没画，面板成了一张白纸 |
| `--dsw-alias-fill-l1/l2` | **根本不存在** | `var()` 回退到兜底值，看着像生效了 |
| `--dsw-specific-menu` 等 | 一族**偏蓝**的面 | 大面积借用它 → 整块面板泛蓝 |

结论：**大面积、颜色、边框一律用插件自己的令牌**，只有小范围交互态才借宿主的。

**逗号选择器列表不能共享尾随组合符。** `.a,.b ::selection` 的含义是"`.a` **元素本身**、以及 `.b` 里的选中文字"。写成 `.sr-root,.sr-strip-wrap,.sr-backdrop,.sr-rail ::selection` 后，前三个界面根被当成了元素本身 —— `background:var(--sr-accent-weak)` 把整块面板刷成蓝色，`outline:2px solid` 给它套了个黑框，`box-sizing` 只对最后一个生效。修法是让界面根**声明为数组**、每个变体逐个映射生成。

**滚动列里给 flex 子项加 `min-height:0` 会让粘底页脚卡在中间。** 它把内容体压成一屏高，`flex:1` 于是把页脚的*流内位置*放到了**容器底部**（而不是内容末尾），`sticky;bottom:0` 无事可做，溢出的内容继续画在页脚下面。

**`finally` 里的清理失败会把成功变成失败。** `git clone` 留下只读的 pack 文件，Windows 上删不掉（`force:true` 只忽略 ENOENT，不忽略 EPERM）。它写在 `finally` 里，于是一次**已经成功**的安装给用户报的是 `EPERM`。现在清理会先清只读位、带重试，并且**永不抛出**。

**CSS 注释里不能有反引号** —— 整张样式表是模板字符串，一个反引号就提前闭合它。打包器现在**会解析自己的产物**再报成功，这个错误再也出不了门（它已经拦下三次）。

## 测试

| 套件 | 覆盖 |
| --- | --- |
| `test/units.mjs` | `detect.js` / `store.js` 纯逻辑：两条通道、去重、环形缓冲边界、订阅隔离 |
| `test/smoke.mjs` | host 半侧跑在**真实 cordis** 的 `Context` + `Service` 上 |
| `test/install.mjs` | 安装引擎：真临时目录 + 真 zip 字节，含 zip-slip、绝对路径、符号链接、解压炸弹、体积上限、覆盖备份、卸载确认、SSRF 围栏、地址识别、只读文件清理 |
| `test/http.mjs` | 真实 cordis + 记录型 connection 服务；直接调用路由 handler，断言载荷、HEAD 无 body、降级行为 |
| `test/install-route.mjs` | 安装/改名端点真挂载：协议形状、状态码映射、`allowInstall:false` 变只读、改名往返回读 |
| `test/scope.mjs` | **首个回合完成前也必须能列出已安装 skill**（scope 取自活跃会话） |
| `test/client-bundle.mjs` | 真实 `lib/client.js` 按 `__ModuleLoader__` 协议求值，**真实 React**；自带 hook 运行时，把安装、预览、覆盖重试、两步删除、改中文名、尺寸拒绝端到端跑一遍 |
| `test/client-css.mjs` | 样式表契约：令牌必须覆盖每个界面根、不得引用未定义令牌、类必须有规则、选择器不得共享组合符、粘底页脚不得被压 |

**当前 926 项断言，十个门全绿：**

```
units 54 · smoke 25 · install 164 · http 44 · install-route 91 · scope 17
client-bundle 373 · client-css 109          （八套共 877）
verify-install 33 · verify-compose 16       （两个重启前门禁，共 49）
```

两个门禁是**重启前**检查：它们读活的 profile 与 `dsh-client-modules` 的真实行为，确认"装到一半"的状态也不会让应用起不来。

## 开发

```powershell
node tools/build-client.mjs   # 生成 lib/client.js（手写打包器，无构建依赖）
```

> `lib/client.js` 是**入库的构建产物** —— 目标机器没有工具链，所以 `lib/` 必须一起提交。**改了 `src/client/` 就必须在同一个 commit 里重建它**；`verify-install.mjs` 会核对 bundle 与包是否一致，漏了会在门里失败。

运行时**没有任何依赖**；`@deepseek-ai/dsh-llm` 与 `@deepseek-ai/schemastery` 是 host 提供的 peer。

## 许可

MIT，见 [LICENSE](LICENSE)。
