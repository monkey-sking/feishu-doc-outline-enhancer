const http = require("node:http");

async function findFeishuDocPage() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const pages = JSON.parse(data);
          const target = pages.find(
            (p) => p.type === "page" && p.url.includes("my.feishu.cn/docx/")
          );
          if (target) {
            console.log(`Found: ${target.title}`);
            resolve(target.webSocketDebuggerUrl);
          } else {
            reject(new Error("No docx page found"));
          }
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

let ws = null;
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject, method });
    ws.send(JSON.stringify({ id: msgId, method, params }));
    setTimeout(() => {
      if (pending.has(msgId)) {
        pending.delete(msgId);
        reject(new Error(`${method} timeout`));
      }
    }, 10000);
  });
}

async function main() {
  const wsUrl = await findFeishuDocPage();
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };

  ws.onerror = (err) => {
    console.error("WS Error:", err.type);
    process.exit(1);
  };

  ws.onopen = async () => {
    try {
      await send("Runtime.enable");

      // 检查关键状态
      const result = await send("Runtime.evaluate", {
        expression: `
          (() => {
            const state = window.__store__?.getState?.();
            const docToken = state?.appState?.currentNoteToken?.obj_token || window.DATA?.meta?.token || "";
            const shortcutMap = state?.appState?.shortcutLocationMap || {};
            const record = shortcutMap[docToken] || {};
            const folderToken = record?.objContainerTokenList?.[0] || "";

            const pathNode = document.querySelector('.note-title__suite-path-v4, .note-title__suite-path-v4--header-flexible');
            const popover = document.querySelector('.workspace-suite-path-popover-new');
            const injectedItems = document.querySelectorAll('[data-tm-feishu-path-injected="true"]');

            return {
              docToken,
              folderToken,
              folderName: pathNode?.textContent?.trim() || null,
              hasPopover: !!popover,
              popoverVisible: popover ? popover.style.display !== 'none' : false,
              injectedCount: injectedItems.length,
              shortcutMapKeys: Object.keys(shortcutMap).slice(0, 5),
              record: record,
              consoleErrors: []
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log("\n=== Current State ===");
      console.log(JSON.stringify(result.result.value, null, 2));

      ws.close();
      process.exit(0);
    } catch (error) {
      console.error("Error:", String(error));
      process.exit(1);
    }
  };
}

main().catch(err => {
  console.error("Main error:", String(err));
  process.exit(1);
});
