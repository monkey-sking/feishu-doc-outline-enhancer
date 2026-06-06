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
    }, 30000);
  });
}

async function main() {
  const wsUrl = await findFeishuDocPage();
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // 捕获控制台日志
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = msg.params.args || [];
      const text = args.map(a => a.value || a.description || "").join(" ");
      if (text.includes("Feishu")) {
        console.log("PAGE_LOG:", text);
      }
    }

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

      console.log("\n=== Testing enhancePopover manually ===");

      const result = await send("Runtime.evaluate", {
        expression: `
          (async () => {
            const DEBUG_PREFIX = "[Manual Test]";

            // toPlain helper
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

            // 1. Check if enhancing
            const isEnhancing = window.isEnhancing || false;
            console.log(DEBUG_PREFIX, "isEnhancing:", isEnhancing);

            // 2. Get folder token
            const state = window.__store__?.getState?.();
            const docToken = toPlain(state?.appState?.currentNoteToken)?.obj_token || "";
            const shortcutMap = toPlain(state?.appState?.shortcutLocationMap) || {};
            const record = shortcutMap[docToken] || {};
            const folderToken = record?.objContainerTokenList?.[0] || "";

            console.log(DEBUG_PREFIX, "docToken:", docToken);
            console.log(DEBUG_PREFIX, "folderToken:", folderToken);

            if (!folderToken) {
              return { error: "No folderToken found" };
            }

            // 3. Try to load folder iframe
            console.log(DEBUG_PREFIX, "Creating iframe for folder:", folderToken);

            const iframe = document.createElement("iframe");
            const url = \`https://my.feishu.cn/drive/folder/\${folderToken}?tm_test=\${Date.now()}\`;
            iframe.src = url;
            iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:1280px;height:900px;opacity:0;pointer-events:none;border:0;";

            document.body.appendChild(iframe);

            // Wait for load
            await new Promise(resolve => {
              iframe.onload = () => {
                console.log(DEBUG_PREFIX, "iframe loaded");
                resolve();
              };
              setTimeout(resolve, 3000);
            });

            // Wait longer and poll for state
            console.log(DEBUG_PREFIX, "Waiting for state to be ready...");
            let folderInfo = null;
            for (let i = 0; i < 10; i++) {
              await new Promise(resolve => setTimeout(resolve, 800));

              try {
                const folderWin = iframe.contentWindow;
                const folderState = folderWin.__store__?.getState?.();

                // Try to get folder token from URL
                const urlMatch = folderWin.location.href.match(/\\/drive\\/folder\\/([^?&#]+)/);
                const folderTokenFromUrl = urlMatch ? urlMatch[1] : "";

                // Try to get parent from shortcutLocationMap
                const rawShortcutLocationMap = folderState?.appState?.shortcutLocationMap;
                const plainShortcutLocationMap = toPlain(rawShortcutLocationMap);
                const folderRecord = plainShortcutLocationMap?.[folderTokenFromUrl] || {};
                const parentToken = folderRecord?.objContainerTokenList?.[0] || "";

                const docTitle = folderWin.document?.title?.replace(/\\s*-\\s*飞书云文档\\s*$/, "").trim();

                console.log(DEBUG_PREFIX, \`Poll \${i + 1}: shortcutMapKeys=\${Object.keys(plainShortcutLocationMap || {}).length}, parentToken=\${parentToken}, title=\${docTitle}\`);

                if (parentToken || Object.keys(plainShortcutLocationMap || {}).length > 0) {
                  folderInfo = {
                    folderTokenFromUrl,
                    docTitle,
                    parentToken,
                    folderRecord,
                    pollCount: i + 1
                  };
                  break;
                }
              } catch (error) {
                console.log(DEBUG_PREFIX, \`Poll \${i + 1} error:\`, String(error));
              }
            }

            // Read folder state
            if (!folderInfo) {
              console.log(DEBUG_PREFIX, "Failed to get folder info after polling");
              folderInfo = { error: "Timeout waiting for shortcutLocationMap" };
            } else {
              console.log(DEBUG_PREFIX, "Success! Got folder info:", JSON.stringify(folderInfo, null, 2));
            }

            iframe.remove();

            return {
              success: true,
              folderToken,
              folderInfo
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log("\n=== Result ===");
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
