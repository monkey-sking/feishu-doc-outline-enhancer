const fs = require("node:fs");
const http = require("node:http");

const scriptPath = "C:/Users/Administrator/Documents/Codex/2026-06-06/new-chat/work/feishu-doc-outline-enhancer/dist/feishu-doc-outline-enhancer.user.js";
const userscript = fs.readFileSync(scriptPath, "utf8");

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
const consoleLogs = [];

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
    }, 15000);
  });
}

async function main() {
  const wsUrl = await findFeishuDocPage();
  ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    // Log console messages
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args || [])
        .map(a => a.value || a.description || "")
        .join(" ");
      consoleLogs.push(text);
      console.log("PAGE:", text);
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

      console.log("\n=== Step 1: Inject userscript ===");
      const injectResult = await send("Runtime.evaluate", {
        expression: `
          (() => {
            try {
              ${userscript}
              return { ok: true };
            } catch (error) {
              return { ok: false, error: String(error), stack: error.stack };
            }
          })()
        `,
        returnByValue: true,
        awaitPromise: false,
      });
      console.log("Inject result:", JSON.stringify(injectResult.result.value, null, 2));

      console.log("\n=== Step 2: Wait for script to bootstrap ===");
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if script created any globals
      const checkGlobals = await send("Runtime.evaluate", {
        expression: `
          (() => {
            // Check if the IIFE ran and left any traces
            return {
              windowKeys: Object.keys(window).filter(k => k.includes('feishu') || k.includes('Feishu') || k.includes('enhancer')).slice(0, 10),
              hasStore: !!window.__store__,
              docToken: window.__store__?.getState?.()?.appState?.currentNoteToken,
              timestamp: Date.now()
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });
      console.log("Globals check:", JSON.stringify(checkGlobals.result.value, null, 2));

      console.log("\n=== Step 3: Check if popover exists ===");
      const checkPopover = await send("Runtime.evaluate", {
        expression: `
          (() => {
            const popover = document.querySelector('.workspace-suite-path-popover-new');
            return {
              hasPopover: !!popover,
              popoverVisible: popover ? (popover.offsetParent !== null) : false
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });
      console.log("Popover status:", JSON.stringify(checkPopover.result.value));

      if (!checkPopover.result.value.hasPopover) {
        console.log("\n=== Step 4: Trigger popover by clicking path element ===");
        const clickResult = await send("Runtime.evaluate", {
          expression: `
            (() => {
              const el = document.querySelector('.note-title__suite-path-v4, .note-title__suite-path-v4--header-flexible');
              if (el) {
                el.click();
                return { clicked: true };
              }
              return { clicked: false, error: 'Element not found' };
            })()
          `,
          returnByValue: true,
          awaitPromise: true,
        });
        console.log("Click result:", JSON.stringify(clickResult.result.value));

        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      console.log("\n=== Step 5: Wait for user to open popover ===");
      console.log("Please click the path element in the browser to open the popover...");
      console.log("Waiting 10 seconds...");

      await new Promise(resolve => setTimeout(resolve, 10000));

      console.log("\n=== Step 6: Check injection result ===");
      const finalCheck = await send("Runtime.evaluate", {
        expression: `
          (() => {
            const popover = document.querySelector('.workspace-suite-path-popover-new');
            const injected = document.querySelectorAll('[data-tm-feishu-path-injected="true"]');
            const allItems = popover ? [...popover.querySelectorAll('.styles__ContainerItemNameSpan-gaZNkf')].map(el => el.textContent?.trim()) : [];

            return {
              hasPopover: !!popover,
              injectedCount: injected.length,
              injectedTexts: [...injected].map(el => el.textContent?.trim()).slice(0, 5),
              allItemTexts: allItems
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log("\n=== FINAL RESULT ===");
      console.log(JSON.stringify(finalCheck.result.value, null, 2));

      console.log("\n=== Console Logs Captured ===");
      console.log(`Total logs: ${consoleLogs.length}`);
      consoleLogs.forEach(log => console.log(log));

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
