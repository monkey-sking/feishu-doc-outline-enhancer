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

      const result = await send("Runtime.evaluate", {
        expression: `
          (() => {
            function toPlain(value) {
              try {
                if (!value) return value;
                if (typeof value.toJS === "function") return value.toJS();
                if (typeof value.toJSON === "function") return value.toJSON();
                return value;
              } catch {
                return value;
              }
            }

            const state = window.__store__?.getState?.();
            const rawState = state?.appState;
            const rawCurrentNoteToken = rawState?.currentNoteToken;
            const rawShortcutLocationMap = rawState?.shortcutLocationMap;

            const plainCurrentNoteToken = toPlain(rawCurrentNoteToken);
            const plainShortcutLocationMap = toPlain(rawShortcutLocationMap);

            const docToken = plainCurrentNoteToken?.obj_token || window.DATA?.meta?.token || "";
            const record = plainShortcutLocationMap?.[docToken];
            const folderToken = record?.objContainerTokenList?.[0] || "";

            return {
              hasStore: !!window.__store__,
              hasState: !!state,
              hasAppState: !!rawState,
              hasCurrentNoteToken: !!rawCurrentNoteToken,
              hasShortcutLocationMap: !!rawShortcutLocationMap,
              currentNoteTokenType: typeof rawCurrentNoteToken,
              shortcutLocationMapType: typeof rawShortcutLocationMap,
              hasToJS: typeof rawCurrentNoteToken?.toJS,
              hasToJSON: typeof rawCurrentNoteToken?.toJSON,
              plainCurrentNoteToken,
              docToken,
              recordKeys: record ? Object.keys(record) : null,
              folderToken,
              objContainerTokenList: record?.objContainerTokenList
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log("\n=== Detailed State Analysis ===");
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
