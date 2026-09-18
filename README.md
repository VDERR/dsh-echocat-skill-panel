# echocat-skill-panel-3.0

**v3.0.0** · DSH Desktop Beta 的 cordis 插件：统计每轮对话用到了哪些 skill，并让你**在应用里直接装卸它们**。

判定不依赖模型自觉 —— 插件从会话事件流推导本轮调了哪些 skill（模型自动、你手动 `/name`、或一个都没用），模型忘了说也照样报。

![面板](docs/panel.png)

三个界面共用一份数据：

| 位置 | 说明 |
| --- | --- |
| **输入框正上方横栏** | 一行结论，点开就地展开完整报告。**唯一能一键引用 skill 的界面** |
| **左栏图标** | 常驻入口，点它在中间打开面板 |
| **中栏面板** | 完整报告 + skill 目录 |

## 一键安装

把作者给的地址**整个粘进来**就行：

```
https://github.com/owner/repo/tree/main/skills/my-skill
```

仓库主页、仓库里的文件夹链接、`SKILL.md` 链接、zip 直链、`owner/repo`、SSH 地址都认 —— host 自己判断该克隆还是该下载，分支与子目录从地址里解析，不用你填三个框。也可以上传 `.md`/`.zip`，或直接粘贴整篇 `SKILL.md`。

同名不会静默覆盖：先备份再替换。装错了能删，**删掉的进备份目录，永不硬删**。

![安装面板](docs/install-sheet.png)

## 一键调用

输入框正上方常驻一条横栏，点开后在 skill 卡片上按「**引用**」，`/名字 ` 就追加进草稿 —— 回车即按手动手势调用它。装完 skill 的成功提示里有同一个按钮，装完即用。

## 中文显示

中文名写进该 skill 自己的 `meta.yaml`（`display-name-zh`），面板就按中文显示。安装时能填，装完在卡片上随时能改，留空则清除。

`/名字` 手势仍然走 ASCII 代号，两者互不干扰。

## 安装

**GitHub 源码**（推荐，拿到的是完整包）：

```powershell
git clone https://github.com/VDERR/echocat-skill-panel-3.0.git
cd echocat-skill-panel-3.0
& ".\安装-3.0.ps1"      # 备份清单 → 镜像 → 清旧包名 → 建联接 → 改 manifest → pnpm install
```

**npm**（已发布到 npm，包名相同）：

```powershell
dsh plugin --profile web add echocat-skill-panel-3.0     # 走 dsh 的插件安装
npm install echocat-skill-panel-3.0                      # 或直接装进 profile 目录
```

> 两个 `peerDependencies`（`@deepseek-ai/dsh-llm`、`@deepseek-ai/schemastery`）标了 `optional`：由 DSH 运行时提供，npm 不会自己去下载一份来顶替宿主的那份。

> **装完必须重启 DSH Desktop Beta。** host 半侧在 boot 时快照进内存，而客户端 bundle 每次开页面会重新拉取 —— 所以只改客户端刷新页面就够，**改了 host 必须重启**。

脚本动手前会备份 profile 清单，`-Rollback` 一键回退。手动四步、卸载回滚，以及**四条会让应用起不来的硬性约束**都在 [安装说明.md](安装说明.md)。

## 更多

每轮结束弹一次系统原生通知；给没中文的 skill 自动翻译并缓存；深色主题；宿主不允许写入时自动变只读并说明原因；全部配置项 —— 见 [安装说明.md](安装说明.md)。

架构与实现要点、安装引擎的四条安全规矩、**踩过的坑**（宿主语义令牌不能当视觉令牌用、逗号选择器不能共享组合符、`min-height:0` 会架空粘底页脚……），以及 926 项断言 / 十个门的测试明细 —— 见 [docs/设计要点.md](docs/设计要点.md)。

## 开发

```powershell
node tools/build-client.mjs   # 生成 lib/client.js
```

> `lib/client.js` 是**入库的构建产物**（目标机器没有工具链，`lib/` 必须一起提交）。**改了 `src/client/` 就要在同一个 commit 里重建它** —— `verify-install.mjs` 会核对 bundle 与包是否一致，漏了会在门里失败。

运行时没有任何依赖；`@deepseek-ai/dsh-llm` 与 `@deepseek-ai/schemastery` 是 host 提供的 peer。

## 许可

MIT，见 [LICENSE](LICENSE)。
