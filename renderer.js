const { ipcRenderer } = require("electron");

let avatar = null;
let isInteracting = false;

// 交互时间：用于“长时间不理自动说话”
let lastUserAt = Date.now();

// 拖拽窗口
let drag = { on: false, sx: 0, sy: 0, wx: 0, wy: 0, raf: 0, nx: 0, ny: 0 };

const storeKey = "oc_pet_state_v2";
const state = {
  affection: 30,
  hunger: 70,
  clean: 70,
  todos: [],

  // UI 状态
  menuOpen: false,
  infoOpen: false,
  toolsOpen: false,
  chatOpen: false,

  // 对话策略
  hasUserChatted: false, // 用户是否发过消息（用于“没发过就不显示人物台词弹窗”）
};

function clamp(v, a = 0, b = 100) { return Math.max(a, Math.min(b, v)); }
function $(id) { return document.getElementById(id); }

function loadState() {
  try {
    const raw = localStorage.getItem(storeKey);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    Object.assign(state, obj);
    return true;
  } catch {
    return false;
  }
}
function saveState() {
  try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---- UI：系统提示（加载/错误），不是人物台词弹窗 ----
let statusTimer = null;
function showStatus(text, ms = 2200) {
  const el = $("status-line");
  if (!el) return;
  el.innerText = text;
  el.style.display = "block";
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (el.style.display = "none"), ms);
}

// ---- UI：输入框上方，仅显示“本次 OC 回复”（聊天未开启时）----
let inlineTimer = null;
function showInlineReply(text, ms = 3200) {
  const el = $("inline-reply");
  if (!el) return;
  el.innerText = text;
  el.style.display = "block";
  clearTimeout(inlineTimer);
  inlineTimer = setTimeout(() => (el.style.display = "none"), ms);
}

function setAvatarScale() {
  const s = OC_CONFIG?.ui?.avatarScale ?? 0.56;
  document.documentElement.style.setProperty("--avatar-scale", String(s));
}

function getBaseWidth() {
  // 用于判断点击位置是否在“桌宠基础区”（右侧固定区域）
  const v = getComputedStyle(document.documentElement).getPropertyValue("--base-w");
  const n = parseInt(String(v).replace("px", "").trim(), 10);
  return Number.isFinite(n) ? n : 320;
}

// ---- 信息面板（数值条）----
function updateInfoPanel() {
  $("info-name").innerText = OC_CONFIG?.name || "OC";

  const aff = clamp(state.affection);
  const hun = clamp(state.hunger);
  const cln = clamp(state.clean);

  $("bar-aff").style.width = `${aff}%`;
  $("bar-hun").style.width = `${hun}%`;
  $("bar-cln").style.width = `${cln}%`;

  $("val-aff").innerText = String(aff);
  $("val-hun").innerText = String(hun);
  $("val-cln").innerText = String(cln);

  saveState();
}

// ---- 面板开关 & 布局通知主进程（用于窗口变宽/变窄）----
function applyBodyFlags() {
  document.body.classList.toggle("menu-open", !!state.menuOpen);
  document.body.classList.toggle("info-open", !!state.infoOpen);
  document.body.classList.toggle("tools-open", !!state.toolsOpen);
  document.body.classList.toggle("chat-open", !!state.chatOpen);

  // 菜单气泡 active 样式
  $("m-info").classList.toggle("active", !!state.infoOpen);
  $("m-tools").classList.toggle("active", !!state.toolsOpen);
  $("m-chat").classList.toggle("active", !!state.chatOpen);

  // 通知主进程：根据左右侧栏开关，动态调整窗口宽度（更贴近你给的布局图）
  ipcRenderer.send("pet:setLayout", {
    toolsOpen: !!state.toolsOpen,
    chatOpen: !!state.chatOpen,
  });

  saveState();
}

function toggleMenu(force) {
  state.menuOpen = typeof force === "boolean" ? force : !state.menuOpen;
  applyBodyFlags();
}

function toggleInfo() {
  state.infoOpen = !state.infoOpen;
  applyBodyFlags();
}

function toggleTools() {
  // 工具与聊天：互斥，避免面板重叠
  state.toolsOpen = !state.toolsOpen;
  if (state.toolsOpen) state.chatOpen = false;
  applyBodyFlags();
}

function toggleChat() {
  // 工具与聊天：互斥，避免面板重叠
  state.chatOpen = !state.chatOpen;
  if (state.chatOpen) state.toolsOpen = false;
  applyBodyFlags();
}

// ---- 养成：随时间衰减（可选保留）----
function startDecay() {
  setInterval(() => {
    state.hunger = clamp(state.hunger - 1);
    state.clean = clamp(state.clean - 1);
    const penalty = (state.hunger < 25 ? 1 : 0) + (state.clean < 25 ? 1 : 0);
    state.affection = clamp(state.affection - penalty);
    updateInfoPanel();
  }, 60 * 1000);
}

// -------------------- SDK 初始化 --------------------
function checkWebGL() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    return !!gl;
  } catch {
    return false;
  }
}

function buildSSML(text = "", actionName = null) {
  let ssml = "<speak>";
  if (actionName) {
    ssml += `<ue4event><type>ka</type><data><action_semantic>${actionName}</action_semantic></data></ue4event>`;
  }
  if (text) ssml += escapeHtml(text);
  ssml += "</speak>";
  return ssml;
}

/**
 * 只“语音+表情动作”，不做任何弹窗/气泡文本
 */
function speakVoiceOnly(text, actionName = null) {
  if (!avatar) return;
  isInteracting = true;
  try {
    avatar?.speak?.(buildSSML(text || "", actionName), true, true);
  } catch (e) {
    console.error(e);
  }
  setTimeout(() => (isInteracting = false), Math.max(900, (text || "").length * 220));
}

function playAction(actionName) {
  if (!avatar) return;
  isInteracting = true;
  try {
    avatar?.speak?.(buildSSML("", actionName), true, true);
  } catch {}
  setTimeout(() => (isInteracting = false), 900);
}

function pickLine(arr) {
  if (!arr || !arr.length) return "";
  return arr[Math.floor(Math.random() * arr.length)];
}

async function initAvatar() {
  if (!window.XmovAvatar) {
    showStatus("未加载到 xmovAvatar SDK", 2600);
    return;
  }
  if (!checkWebGL()) {
    showStatus("WebGL 不可用：数字人无法渲染", 3200);
    return;
  }

  const sdkConfig = {
    containerId: OC_CONFIG?.sdk?.containerId ?? "#sdk",
    appId: OC_CONFIG?.sdk?.appId ?? OC_CONFIG?.appId,
    appSecret: OC_CONFIG?.sdk?.appSecret ?? OC_CONFIG?.appSecret,
    gatewayServer: OC_CONFIG?.sdk?.gatewayServer ?? "https://nebula-agent.xingyun3d.com/user/v1/ttsa/session",
    headers: OC_CONFIG?.sdk?.headers,

    // 默认建议硬件加速（如你必须 CPU，可在 config.js 里加 ui.hardwareAcceleration 覆盖）
    hardwareAcceleration: OC_CONFIG?.ui?.hardwareAcceleration ?? "prefer-hardware",

    enableLogger: false,

    // ✅ 禁用 SDK 默认字幕/弹窗（只保留语音 + 口型/动作）
    proxyWidget: {
      subtitle_on: () => {},
      subtitle_off: () => {},
    },
    onWidgetEvent: (data) => {
      // 兜底：如果 SDK 仍抛出字幕类 widget，直接吞掉
      const t = (data?.type || data?.event || "").toString().toLowerCase();
      if (t.includes("subtitle")) return;
    },

    onDownloadProgress: (p) => {
      if (p < 100) showStatus(`元宇宙连接进度：${p}%`, 900);
      else showStatus("元宇宙连接加载完毕", 1200);
    },

    onMessage: (msg) => {
      if (msg?.code && msg.code !== 0) {
        showStatus(`SDK错误 ${msg.code}：${msg.message || ""}`.trim(), 3200);
      }
    },

    onStateChange: (s) => {
      if (s === "idle") {
        // ✅ 登场：只语音，不弹窗
        const greet = OC_CONFIG?.actions?.greet || null;
        speakVoiceOnly(`我是${OC_CONFIG?.name || "OC"}，我来啦～`, greet);
        startIdleAutoSpeak();
      }
    },
  };

  try {
    avatar = new XmovAvatar(sdkConfig);
    window.avatar = avatar;
    if (typeof avatar.init === "function") await avatar.init(sdkConfig);
  } catch (e) {
    console.error(e);
    showStatus("SDK 初始化失败（看 Console）", 3500);
  }
}

// -------------------- 互动：点击/投喂/清洁 --------------------
function touchUser() { lastUserAt = Date.now(); }

function onPetClick() {
  if (!avatar || isInteracting) return;
  touchUser();

  state.affection = clamp(state.affection + 1);
  updateInfoPanel();

  const list = OC_CONFIG?.actions?.click || [];
  const action = list.length ? list[Math.floor(Math.random() * list.length)] : OC_CONFIG?.actions?.greet;

  // ✅ 用户没发过消息，也不显示弹窗，只语音
  const say = pickLine([
    ...(OC_CONFIG.catchphrases || []),
    "你还在吗～",
    "我在看了！",
    "戳我干嘛～"
  ]);

  speakVoiceOnly(say, action);
}

function feed() {
  if (!avatar) return;
  touchUser();

  state.hunger = clamp(state.hunger + 25);
  state.affection = clamp(state.affection + 3);
  updateInfoPanel();

  speakVoiceOnly("这个我喜欢吃好吃！谢谢投喂～", OC_CONFIG?.actions?.feed);
}

function clean() {
  if (!avatar) return;
  touchUser();

  state.clean = clamp(state.clean + 25);
  state.affection = clamp(state.affection + 2);
  updateInfoPanel();

  speakVoiceOnly("感谢投喂，好干净！舒服～", OC_CONFIG?.actions?.clean);
}

// -------------------- 长时间不理：自动说话（只语音） --------------------
let idleTimer = null;
function startIdleAutoSpeak() {
  if (idleTimer) return;

  // 检查频率：用 config 的 randomIntervalSec
  const tickSec = OC_CONFIG?.ui?.randomIntervalSec ?? 14;

  // “长时间不理”的阈值（秒）：你可在 config.js 里加 ui.idleSpeakAfterSec 覆盖
  const idleAfter = OC_CONFIG?.ui?.idleSpeakAfterSec ?? 60;

  idleTimer = setInterval(() => {
    if (!avatar || isInteracting) return;

    const idleMs = Date.now() - lastUserAt;
    if (idleMs < idleAfter * 1000) return;

    // ✅ 用户没有发过内容：人物自动说话也不弹任何窗（这里本来就只语音）
    let textPool = [...(OC_CONFIG.randomLines || [])];
    if (state.hunger < 30) textPool.push("我有点饿了…可以投喂一下嘛？");
    if (state.clean < 30) textPool.push("呜…有点脏脏的…想洗澡");

    const roll = Math.random();
    if (roll < 0.65) {
      speakVoiceOnly(pickLine(textPool), null);
    } else {
      const idles = OC_CONFIG?.actions?.idle || [];
      if (idles.length) playAction(pickLine(idles));
    }
  }, tickSec * 1000);
}

// -------------------- 工具：时间/天气/待办 --------------------
function startClock() {
  setInterval(() => {
    const d = new Date();
    $("clock").innerText = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("date").innerText = d.toLocaleDateString([], { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  }, 1000);
}

function weatherCodeToText(code) {
  if (code == null) return "--";
  if (code === 0) return "晴";
  if ([1,2,3].includes(code)) return "多云";
  if ([45,48].includes(code)) return "雾";
  if ([51,53,55,56,57].includes(code)) return "毛毛雨";
  if ([61,63,65,66,67].includes(code)) return "下雨";
  if ([71,73,75,77].includes(code)) return "下雪";
  if ([80,81,82].includes(code)) return "阵雨";
  if ([95,96,99].includes(code)) return "雷暴";
  return `天气码${code}`;
}

async function updateWeather() {
  const loc = OC_CONFIG?.tools?.weather?.location || "Los Angeles";
  try {
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=zh&format=json`).then(r=>r.json());
    const r0 = geo?.results?.[0];
    if (!r0) throw new Error("no geo");

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${r0.latitude}&longitude=${r0.longitude}&current=temperature_2m,weather_code&timezone=auto`;
    const w = await fetch(url).then(r=>r.json());
    const t = w?.current?.temperature_2m;
    const c = w?.current?.weather_code;

    $("weather").innerText = `天气：${weatherCodeToText(c)} ${t != null ? (t + "°C") : ""}`;
    $("weather2").innerText = `${r0.name}${r0.admin1 ? " · " + r0.admin1 : ""}`;
  } catch {
    $("weather").innerText = "天气：--";
    $("weather2").innerText = "（可在 config.js 改城市）";
  }
}

function renderTodos() {
  const ul = $("todo-list");
  ul.innerHTML = "";

  state.todos
    .filter(t => !t.done)
    .slice(0, 50)
    .forEach(t => {
      const li = document.createElement("li");

      const left = document.createElement("div");
      left.innerHTML = `<div>${escapeHtml(t.text)}</div><small>${t.dueAt ? ("提醒：" + new Date(t.dueAt).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})) : "不提醒"}</small>`;

      const del = document.createElement("button");
      del.innerHTML = `<i class="fa-solid fa-trash"></i>`;
      del.onclick = () => {
        state.todos = state.todos.filter(x => x.id !== t.id);
        saveState();
        renderTodos();
      };

      li.appendChild(left);
      li.appendChild(del);
      ul.appendChild(li);
    });
}

function addTodo() {
  const input = $("todo-input");
  const sel = $("todo-due");
  const text = (input.value || "").trim();
  if (!text) return;

  const minutes = parseInt(sel.value, 10);
  const dueAt = minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;

  state.todos.unshift({
    id: String(Date.now()) + "_" + Math.random().toString(16).slice(2),
    text,
    dueAt: dueAt || 0,
    done: false,
    notified: false,
  });

  input.value = "";
  saveState();
  renderTodos();
  showStatus("已添加待办", 1200);
}

// -------------------- 对话：文本输入 -> OC 回复规则 --------------------
function logChat(who, text) {
  const box = $("chat-log");
  if (!box) return;

  const div = document.createElement("div");
  div.className = `msg ${who === "me" ? "me" : "oc"}`;
  div.innerHTML = `<div class="who">${who === "me" ? "你" : (OC_CONFIG?.name || "OC")}</div><div>${escapeHtml(text)}</div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function localReply(userText) {
  const p = OC_CONFIG?.personality || "";
  const c = pickLine(OC_CONFIG?.catchphrases || []);
  const pool = [
    `${c} 我在听～你刚刚说「${userText}」对吧？`,
    `嗯嗯～以我这种${p}的感觉来说，你说得很有道理！`,
    `让我想想…我陪你一起捋一捋～`,
    `好呀～要不要我给你一个小建议？`
  ];
  return pickLine(pool);
}

async function llmReply(userText) {
  const llm = OC_CONFIG?.llm;
  if (!llm?.enabled || !llm.apiKey || !llm.endpoint) return localReply(userText);

  const sys = [
    `你是桌面OC桌宠，名字叫「${OC_CONFIG.name}」。`,
    `性格：${OC_CONFIG.personality || "友好可爱"}`,
    `口头禅：${(OC_CONFIG.catchphrases || []).join("、") || "（无）"}`,
    `背景：${OC_CONFIG.backstory || "（无）"}`,
    `NG内容：${(OC_CONFIG.ngTopics || []).join("、") || "（无）"}`,
    "说话要简短、可爱、像桌宠；不要长篇说教；必要时给一句可执行的小建议。严禁用括号写动作/旁白/舞台提示，例如“（微笑）”“（起身）”“(laughs)”；动作只能用对白表达。"
  ].join("\n");

  const body = {
    model: llm.model || "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userText }
    ],
    temperature: 0.8
  };

  try {
    const resp = await fetch(llm.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${llm.apiKey}`
      },
      body: JSON.stringify(body)
    }).then(r => r.json());

    const text = resp?.choices?.[0]?.message?.content;
    if (!text) return localReply(userText);
    return String(text).trim().slice(0, 180);
  } catch {
    return localReply(userText);
  }
}

async function sendChat() {
  const input = $("chat-input");
  const text = (input.value || "").trim();
  if (!text) return;

  touchUser();
  state.hasUserChatted = true;

  input.value = "";
  toggleMenu(false);

  // 规则：
  // - 如果开启聊天界面：右侧依次显示两人对话
  // - 如果没开聊天界面：仅在输入框上方显示“本次 OC 回复”，不显示用户文本
  if (state.chatOpen) logChat("me", text);

  const reply = await llmReply(text);

  if (state.chatOpen) {
    logChat("oc", reply);
  } else {
    showInlineReply(reply, Math.max(2200, reply.length * 300));
  }

  // ✅ 人物回复：语音（不额外弹人物台词窗）
  speakVoiceOnly(reply, OC_CONFIG?.actions?.greet || null);

  state.affection = clamp(state.affection + 1);
  updateInfoPanel();
}

// -------------------- 拖拽移动：修复“人物无法移动” --------------------
async function startDrag(e) {
  // 菜单/输入/侧栏/信息面板 不触发拖拽
  if (e.target.closest("#bottom") || e.target.closest("#tools-panel") || e.target.closest("#chat-panel") || e.target.closest("#info-panel")) return;

  drag.on = true;
  drag.sx = e.screenX;
  drag.sy = e.screenY;

  const b = await ipcRenderer.invoke("pet:getBounds");
  drag.wx = b.x;
  drag.wy = b.y;

  e.preventDefault();
}

function moveDrag(e) {
  if (!drag.on) return;
  drag.nx = drag.wx + (e.screenX - drag.sx);
  drag.ny = drag.wy + (e.screenY - drag.sy);

  if (!drag.raf) {
    drag.raf = requestAnimationFrame(() => {
      ipcRenderer.send("pet:setPos", { x: drag.nx, y: drag.ny });
      drag.raf = 0;
    });
  }
}
function endDrag() { drag.on = false; }

// -------------------- 绑定 UI --------------------
function bindUI() {
  // 窗口拖拽
  window.addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", moveDrag);
  window.addEventListener("mouseup", endDrag);

  // 点击人物：互动动作/语音（不弹窗）
  $("stage").addEventListener("click", (e) => {
    // ✅ 只在右侧“桌宠基础区”内点击才触发人物互动，避免左侧面板空白区误触
    const baseW = getBaseWidth();
    if (e.clientX < window.innerWidth - baseW) return;

    // 点击底部/侧栏/信息面板不算点人物
    if (e.target.closest("#bottom") || e.target.closest("#tools-panel") || e.target.closest("#chat-panel") || e.target.closest("#info-panel")) return;
    onPetClick();
  });

  // 菜单开关
  $("btn-menu").onclick = () => toggleMenu();
  // 点空白处收起菜单
  document.addEventListener("click", (e) => {
    if (!state.menuOpen) return;
    if (e.target.closest("#menu-wrap")) return;
    toggleMenu(false);
  });

  // 菜单项
  $("m-info").onclick = () => { touchUser(); toggleInfo(); };
  $("m-feed").onclick = () => { touchUser(); feed(); };
  $("m-clean").onclick = () => { touchUser(); clean(); };
  $("m-tools").onclick = () => { touchUser(); toggleTools(); };
  $("m-chat").onclick = () => { touchUser(); toggleChat(); };
  $("m-quit").onclick = () => ipcRenderer.send("pet:quit");

  // 侧栏关闭按钮
  $("btn-tools-close").onclick = () => { state.toolsOpen = false; applyBodyFlags(); };
  $("btn-chat-close").onclick = () => { state.chatOpen = false; applyBodyFlags(); };

  // 发送
  $("btn-send").onclick = sendChat;
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  // todo
  $("btn-add-todo").onclick = addTodo;

}

window.onload = async () => {
  loadState();

  setAvatarScale();
  updateInfoPanel();
  applyBodyFlags();
  bindUI();

  // 工具页数据
  startClock();
  updateWeather();
  setInterval(updateWeather, 30 * 60 * 1000);
  renderTodos();
  startDecay();

  await initAvatar();
};
