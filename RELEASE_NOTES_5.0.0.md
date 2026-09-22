# EchoCat Skill Panel 5.0.0 — 改名：`dsh-echocat-skill-panel`

**这一版只做了一件事：改名。功能、界面、行为与 4.4.2 完全一致**，没有任何新功能或修复。

## 为什么是 5.0.0 而不是 4.5.0

因为**它换了一个 npm 包名**。包名在 DSH 里不只是名字 —— 它同时是 Loader 条目名、vendor 目录名和客户端 bundle id，插件就是靠这一个字符串被解析的。所以：

- 这是**另一个包**，不是同一个包的升级；
- 版本号必须**高于**旧包，否则任何更新检查都会把它当成降级或是别的插件；
- **旧安装不是原地升级**（见下）。

## ⚠️ 从 4.x 升级：必须重装，不能原地更新

插件身份变了，所以 `vendor/echocat-skill-panel` 和它对应的 junction 不会被新版本接管。旧目录、旧 junction、旧 `bundles` 条目**三者必须一起清掉** —— 只留一个而目录已不存在，会让 profile 拼装失败、应用起不来。

`安装.ps1` 会自动清理这几个旧名字：`echocat-skill-panel`、`echocat-skill-panel-3.0`、`echocat-skill-panel-2.0`、`EchoCat-skill-Panel-2.0`、`dsh-skill-report`。

```powershell
# 新名字
dsh plugin --profile web add dsh-echocat-skill-panel
npm install dsh-echocat-skill-panel
```

旧包 `echocat-skill-panel`（以及更早的 `echocat-skill-panel-3.0`）**不再发新版本**，它们停在 4.4.2。

## 改了什么

| | 旧 | 新 |
|---|---|---|
| npm 包名 | `echocat-skill-panel` | **`dsh-echocat-skill-panel`** |
| GitHub 仓库 | `VDERR/echocat-skill-panel` | **`VDERR/dsh-echocat-skill-panel`** |
| 目录名 / Loader 条目 / bundle id | `echocat-skill-panel` | **`dsh-echocat-skill-panel`** |
| 版本 | 4.4.2 | **5.0.0** |

仓库改过名，**旧 GitHub 地址仍然有效**（GitHub 自动重定向），老的 release 链接和 clone 地址不会失效。

## 你的设置不会丢

以下几处**故意保留旧前缀**，因为它们**不是身份、而是存储结构**：

- `echocat-skill-panel/sections` —— 你展开了哪些区块
- `echocat-skill-panel/prefs` —— 筛选与排序偏好
- `echocat-skill-panel/scroll` —— 各表面的滚动位置
- IndexedDB `echocat-skill-panel-appearance-v1` —— **背景自定义的设置和你选的那张本地图片**

跟着改名的话，这些数据**不会报错、也不会消失，只是再也读不到** —— 表现就是设置全部回到默认、背景和图片不见了。所以它们保持原样，源代码里也写明了原因，避免下次改名再踩。

## 一个被自己抓住的 bug

改名脚本是**逐行判定**的，不是无脑全局替换，但仍然改坏了两处，都已修复：

1. **`安装.ps1` 里那份「要清理的旧包名」列表**被改成了 `dsh-echocat-skill-panel-3.0` —— 一个**从未存在过**的包。于是它会去清理不存在的目录，而**真正的旧包永远不会被清理**，正好触发上面那个"应用起不来"的场景。
2. **`tools/check-identity.mjs` 里的旧名常量**同样被改写，导致这条守卫在校验一个不存在的名字 —— 它对真正的残留**报 clean**。

第 2 条还暴露出一个更隐蔽的问题：**新名字包含旧名字**（`dsh-echocat-skill-panel` ⊃ `echocat-skill-panel`），所以任何子串扫描**两个方向都会误判**。守卫现在用**负向后顾**来区分，并把两处**有意保留**的旧名连带理由一起列出来 —— 而不是整文件跳过，因为跳过会让一个文件**悄悄不再被检查**。

## 验证

1550 条断言 + 浏览器门 14/14 + 十二个门全绿；身份守卫确认四处身份一致，且除了两条注明的例外，没有任何源文件还提到旧名字。
