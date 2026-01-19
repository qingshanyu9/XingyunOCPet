const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");

let server = null;
let win = null;

// ---- 窗口布局参数（可按需微调）----
// 说明：BASE_W/BASE_H 对应“右侧固定的桌宠区域（人物+底栏）”，
// 当打开聊天/工具时，窗口只向左变宽，保证桌宠区域大小/位置不变。
const BASE_W = 320;     // 桌宠基础宽度（人物+底栏）
const BASE_H = 480;
const PANEL_W = 300;    // 左/右侧栏宽度（聊天/工具）
const MARGIN = 20;

let clickThrough = false; // 默认不穿透（因为要操作输入框/菜单）

function startStaticServer(rootDir, port = 0) {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        if (urlPath === "/") urlPath = "/index.html";
        const filePath = path.join(rootDir, urlPath);

        if (!filePath.startsWith(rootDir)) {
          res.writeHead(403);
          return res.end("Forbidden");
        }

        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404);
            return res.end("Not found");
          }
          const ext = path.extname(filePath).toLowerCase();
          const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[ext] || "application/octet-stream";
          res.writeHead(200, { "Content-Type": mime });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500);
        res.end("Error");
      }
    });

    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  });
}

function applyClickThrough(enabled) {
  clickThrough = !!enabled;
  if (!win) return;
  win.setIgnoreMouseEvents(clickThrough);
  win.webContents.send("pet:clickThroughChanged", clickThrough);
}

// 让窗口在改宽度时“右下角不漂移”：保持右下角锚点不变
function setWindowLayout({ toolsOpen = false, chatOpen = false }) {
  if (!win) return;
  const b = win.getBounds();
  const right = b.x + b.width;
  const bottom = b.y + b.height;

  const newW = BASE_W + (toolsOpen ? PANEL_W : 0) + (chatOpen ? PANEL_W : 0);
  const newH = BASE_H;

  win.setBounds(
    { x: Math.round(right - newW), y: Math.round(bottom - newH), width: newW, height: newH },
    false
  );
}

async function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const rootDir = __dirname;
  const port = await startStaticServer(rootDir);

  win = new BrowserWindow({
    width: BASE_W,
    height: BASE_H,
    x: width - BASE_W - MARGIN,
    y: height - BASE_H - MARGIN,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      backgroundThrottling: false,
    },
  });

  await win.loadURL(`http://127.0.0.1:${port}/index.html`);

  applyClickThrough(false);

  // 可选：保留一个隐藏热键，方便你临时开启“穿透”
  globalShortcut.register("Control+Alt+P", () => {
    applyClickThrough(!clickThrough);
  });
}

// -------- IPC：renderer.js 需要的能力（移动/退出/布局/穿透）--------
ipcMain.handle("pet:getBounds", () => {
  if (!win) return { x: 0, y: 0, width: 0, height: 0 };
  return win.getBounds();
});

ipcMain.on("pet:setPos", (_e, pos) => {
  if (!win || !pos) return;
  win.setPosition(Math.round(pos.x), Math.round(pos.y), false);
});

ipcMain.on("pet:quit", () => {
  app.quit();
});

ipcMain.on("pet:setClickThrough", (_e, enabled) => {
  applyClickThrough(!!enabled);
});

ipcMain.on("pet:setLayout", (_e, layout) => {
  setWindowLayout(layout || {});
});

// ------------------------------------------------------------
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  try { globalShortcut.unregisterAll(); } catch {}
  try { server?.close?.(); } catch {}
});
