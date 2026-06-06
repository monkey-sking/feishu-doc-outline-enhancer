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
    }, 5000);
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

      console.log("\n=== Deep scan for Tampermonkey ===");

      const result = await send("Runtime.evaluate", {
        expression: `
          (() => {
            // Check all possible Tampermonkey globals
            const checks = {
              GM_info: typeof GM_info !== 'undefined',
              GM: typeof GM !== 'undefined',
              unsafeWindow: typeof unsafeWindow !== 'undefined',
              Tampermonkey: typeof Tampermonkey !== 'undefined',

              // Check for Tampermonkey extension in DOM
              hasTampermonkeyElements: !!document.querySelector('[data-tampermonkey]'),

              // Check extensions
              hasExtensions: !!window.chrome?.runtime,

              // List all script tags
              scriptTags: [...document.querySelectorAll('script')]
                .map(s => ({
                  src: s.src || null,
                  hasContent: !!s.textContent,
                  length: s.textContent?.length || 0,
                  id: s.id || null,
                  className: s.className || null
                }))
                .filter(s => s.length > 1000 || s.src?.includes('tamper') || s.id)
                .slice(0, 10)
            };

            return checks;
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
