# xingyun-oc-pet（魔珐星云 OC 桌宠）

一个基于 **魔珐星云「具身驱动」Lite SDK（xmovAvatar）** 的 Electron 桌面 OC 桌宠：支持悬浮置顶、拖拽移动、点击互动动作、状态面板、待办工具页、聊天页，以及可选接入 LLM 对话。

> 本项目把「角色表现层」交给具身驱动：数字人渲染 + 语音 + KA 动作；其它能力（对话、待办、天气等）用常规 Web 技术补齐。

---

## ✨ 功能一览

- **桌面悬浮**：透明背景、无边框、置顶、不占任务栏。
- **可拖拽移动**：鼠标按住空白区域拖动窗口（底栏/面板区域不会触发拖拽）。
- **点击互动**：点击右侧桌宠区域触发随机动作 + 语音回应（无黑色弹窗/字幕气泡）。  
- **养成数值**：好感 / 饱腹 / 清洁（0-100），信息面板可开关。  
- **工具页（待办）**：时间/日期、天气（Open-Meteo）、待办列表 + 加号添加。  
- **聊天页**：开启聊天面板时显示对话记录；未开启时只在输入框上方显示“本次 OC 回复”。  
- **长时间无操作自动说话/动作**：可配置触发间隔与阈值。  
- **可选穿透热键**：`Ctrl + Alt + P` 切换窗口“忽略鼠标事件”（开发调试用）。

---

## 🧱 技术栈

- Electron（桌面壳）
- 魔珐星云 具身驱动 Lite SDK（CDN 引入 xmovAvatar）  
- 纯 HTML/CSS/JS（渲染层 UI + 交互）  

---

## 📁 项目结构（核心）

> ├─ main.js # Electron 主进程：窗口/置顶/透明/IPC/内置静态服务器
> ├─ index.html # UI 布局 + 引入 SDK / config / renderer
> ├─ renderer.js # 交互逻辑：拖拽、数值、面板、对话、自动行为、SDK speak
> ├─ config.js # OC 人设、SDK 密钥、KA 动作映射、LLM 配置
> ├─ package.json # 启动脚本与依赖
> └─ tools/
> └─ query_ka.js # （可选）查询 KA 动作池脚本：npm run query-ka

对应入口与依赖见 `package.json`。:contentReference[oaicite:13]{index=13}  

---

## ✅ 环境要求

- Node.js：建议 **18+**
- 系统：Windows 
- 网络：首次加载 SDK/资源、天气接口、（可选）LLM 需要联网
- 配置：CPU

---

## 🚀 快速开始

1) 安装依赖

```bash
npm install
```

1. 启动

```bash
npm start
```

启动脚本与依赖声明见 `package.json`。

------

## 🔐 配置说明（config.js）

`config.js` 中通过 `OC_CONFIG` 配置桌宠的人设、SDK 鉴权、动作映射、以及可选 LLM。

### 1）SDK 鉴权（必须）

在 `config.js` 填入你的：

- `appId`
- `appSecret`

并在 `renderer.js` 初始化时会带上 `gatewayServer` 等参数。

> ⚠️ 安全建议：不要把真实 `appSecret` / LLM `apiKey` 直接提交到公开仓库。
> 推荐做法：提交一个 `config.example.js`（占位符），本地用 `config.local.js` 并加入 `.gitignore`，然后在 `index.html` 里改为加载 `config.local.js`。

### 2）KA 动作映射（建议）

`actions` 用于把「语义动作名」映射到你角色 KA 动作池中的 `action_semantic`，例如：

- `greet`：登场/问候动作
- `idle`：无操作随机动作
- `feed / clean / click`：投喂/清洁/点击互动动作

配置位置在 `config.js`：

```js
actions: {
  idle: ["Standing_Idle_01", "Look_Around"],
  feed: "Happy_Jump",
  clean: "Shy_Hide",
  greet: "Wave_Hello",
  click: ["Wave_Hello", "Happy_Jump", "Look_Around"]
}
```

项目内也预留了 `npm run query-ka` 脚本入口（用于查询 KA 动作池）。

### 3）对话（可选）

在 `renderer.js` 中，若 `llm.enabled=true` 且提供 `endpoint + apiKey`，会走在线对话；否则退化为本地“人格化短回复”。

> 已内置一条关键约束：**禁止用括号输出动作/旁白**（例如“（微笑）”）。

------

## 🕹️ 交互说明

- **拖拽移动**：按住窗口空白处拖动（底栏/面板区域不会触发）。
- **点击互动**：点击右侧桌宠区域触发语音 + 动作。
- **底栏**：菜单（气泡展开）+ 输入框 + 发送。
- **菜单项**：
  - 信息面板（数值条）
  - 投喂 / 清洁
  - 待办工具页
  - 聊天页
  - 退出

------

## 🧩 工作原理

- `main.js` 创建透明置顶窗口，并启动一个本地静态服务器加载 `index.html`（避免直接加载本地文件的一些限制/兼容问题）。
- `index.html` 负责 UI 布局，并引入：
  - xmovAvatar SDK（CDN）
  - `config.js`
  - `renderer.js`
- `renderer.js` 初始化 SDK 后，通过 `speak(SSML + KA)` 实现“语音 + 动作”，并管理：
  - 面板开关与布局（通过 IPC 通知主进程动态改窗口宽度）
  - 养成数值、待办、天气、聊天与自动行为

------

## 🧯 常见问题（Troubleshooting）

- **人物不显示 / 报 WebGL 不可用**：当前渲染依赖 WebGL，检查显卡驱动/远程桌面环境；或在低配环境里尽量调低 `ui.avatarScale`。
- **窗口点不了/误穿透**：默认不穿透；如你手动切换过热键 `Ctrl+Alt+P`，再按一次恢复。
- **动作不生效**：大概率是 `actions.*` 的 `action_semantic` 不匹配你角色的 KA 动作池，请先查询可用动作名再填。
- **LLM 没反应**：检查 `llm.endpoint / llm.apiKey`，或先把 `llm.enabled=false` 走本地回复验证 UI 链路。