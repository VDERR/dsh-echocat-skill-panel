# EchoCat Skill Panel 5.1.1 — 修复：横栏被错误的窄屏规则压扁并裁切

## 症状

新会话时，输入框上方的横栏**被压窄、并垂直裁切**（四个计数「回合 / 用到 SKILL / 未用 / 调用次数」从中间被切断），下面的输入框正常。

## 根因：容器查询没有名字

样式表里有三段**匿名**容器查询：

```css
@container (max-width:640px){ ...窄屏布局... }
```

**匿名容器查询问的是「最近的祖先容器」**，而这份样式表在 `.sr-strip-shell` **和** `.sr-root`（中栏面板）上都声明了 `container-type: inline-size`。横栏又被渲染在宿主自己的输入框列里，所以"最近的祖先容器"**根本不是横栏** —— 它取决于宿主在 dock 上方放了什么。

结果：**窄屏布局套用在了全宽的横栏上** —— 四个计数折成两行、横栏变高、再被 `.sr-strip-shell` 的 `overflow:hidden` 从中间裁掉。

你给的 DevTools 截图直接指到了这里：Styles 面板里 `@container` 规则**正在生效**，而 Computed 里 `container-type` 解析成 **0px** —— 说明它问的那个容器没有尺寸。

## 修法：给容器起名字

```css
/* 之前 */  @container (max-width:640px){ ... }
/* 之后 */  @container sr-strip (max-width:640px){ ... }
            .sr-strip-shell.sr-strip-shell{container-type:inline-size;container-name:sr-strip}
            .sr-root.sr-root{container-type:inline-size;container-name:sr-panel}
```

三处全部命名：

| 查询 | 名字 | 意义 |
|---|---|---|
| 横栏窄屏布局（`liquid-style.js`） | `sr-strip` | **这根横栏**窄了 |
| 「背景自定义」按钮收成图标（`background-style.js`） | `sr-strip` | 同一个容器 —— 之前它也问错了祖先 |
| 面板网格列数（`liquid-style.js`） | `sr-panel` | **这个面板**窄了 |

**顺带修掉一个你可能没注意到的表现**：那个按钮的收/放判断原本也在问错误的祖先 —— 所以全宽横栏上它的文字标签也可能被误隐藏。现在两处都问同一个正确的容器。

## 为什么现有测试全都没发现

**断裂的规则本身都是对的**，孤立看每一段 CSS 都正确 —— 错的是**它问谁**。所以只检查"规则存在"的断言全部通过了。

新增 4 条断言专门盯这件事：

- 每一段 `@container` **必须有名字**
- 每个被查询的名字**必须在某处真的声明了**（否则那条查询永远不会匹配）
- 横栏的断点必须**问横栏自己**

**这 4 条经过反向验证**：把命名去掉、还原成原始的匿名写法，**3 条立刻失败**（119 → 116）。不是摆设。

## 验证

- 断言 **1577 条**全绿（`client-css` 从 115 增至 119）
- 宽度契约 **57/57**
- 身份守卫通过
- 十二个门全绿

## 安装

```powershell
dsh plugin --profile web add dsh-echocat-skill-panel
```

装完**重启** DSH Desktop Beta。背景设置与本地图片不受影响。

## 说明

这一版只改了容器查询的命名。**横栏的尺寸规则本身没有动** —— `width: calc(100% - 16px)`、`max-width`、内边距都保持原样，因为宽度契约测试（57 条）逐条确认过它们是对的。
