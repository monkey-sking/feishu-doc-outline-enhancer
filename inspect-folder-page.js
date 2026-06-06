const http = require("node:http");

async function findFeishuPage() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const pages = JSON.parse(data);
          const target = pages.find(
            (p) => p.type === "page" && p.url.includes("my.feishu.cn/drive/folder/")
          );
          if (target) {
            console.log(`Found: ${target.title}`);
            resolve(target.webSocketDebuggerUrl);
          } else {
            reject(new Error("No folder page found"));
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
  const wsUrl = await findFeishuPage();
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

      // 检查页面上所有路径相关的元素
      const result = await send("Runtime.evaluate", {
        expression: `
          (() => {
            return {
              breadcrumbClasses: [...document.querySelectorAll('[class*="breadcrumb"]')].map(el => ({
                class: el.className,
                text: (el.textContent || '').trim().slice(0, 50),
                tag: el.tagName
              })),
              pathClasses: [...document.querySelectorAll('[class*="path"]')].map(el => ({
                class: el.className,
                text: (el.textContent || '').trim().slice(0, 50),
                tag: el.tagName
              })).slice(0, 10),
              popoverClasses: [...document.querySelectorAll('[class*="popover"]')].map(el => el.className).slice(0, 10),
              hasStore: !!window.__store__,
              storeKeys: window.__store__ ? Object.keys(window.__store__).slice(0, 20) : []
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

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
