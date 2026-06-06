const fs = require("node:fs");
const http = require("node:http");

const scriptPath =
  "C:/Users/Administrator/Documents/Codex/2026-06-06/new-chat/work/feishu-doc-outline-enhancer/dist/feishu-doc-outline-enhancer.user.js";
const userscript = fs.readFileSync(scriptPath, "utf8");

let ws = null;
let id = 0;
const pending = new Map();

async function findFeishuPage() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json", (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const pages = JSON.parse(data);
          // 优先找 docx 文档页面，其次是 drive/folder 页面
          let target = pages.find(
            (p) => p.type === "page" && p.url.includes("my.feishu.cn/docx/")
          );
          if (!target) {
            target = pages.find(
              (p) => p.type === "page" && p.url.includes("my.feishu.cn/drive/folder/")
            );
          }
          if (target) {
            console.log(`Found page: ${target.title} (${target.url})`);
            resolve(target.webSocketDebuggerUrl);
          } else {
            reject(new Error("No Feishu page found (docx or folder)"));
          }
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

function done(code) {
  try {
    if (ws) ws.close();
  } catch {}
  setTimeout(() => process.exit(code), 100);
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject, method });
    ws.send(JSON.stringify({ id: msgId, method, params }));

    // Timeout per request
    setTimeout(() => {
      if (pending.has(msgId)) {
        pending.delete(msgId);
        reject(new Error(`${method} timed out after 15s`));
      }
    }, 15000);
  });
}

function setupWebSocket(wsUrl) {
  ws = new WebSocket(wsUrl);

  ws.onerror = (error) => {
    console.error("WS_ERROR", error.error?.message || error.type || String(error));
    done(1);
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args || [])
        .map((arg) => arg.value || arg.description || "")
        .join(" ");
      console.log("PAGE_LOG:", text);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      console.log("PAGE_EXCEPTION:", JSON.stringify(msg.params.exceptionDetails, null, 2));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    }
  };

  ws.onopen = async () => {
    try {
      console.log("Enabling Runtime...");
      await send("Runtime.enable");

      console.log("Injecting userscript...");
      const inject = await send("Runtime.evaluate", {
        expression: `
          (() => {
            try {
              eval(${JSON.stringify(userscript)});
              return { ok: true };
            } catch (error) {
              return { ok: false, error: String(error), stack: error?.stack || "" };
            }
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log("INJECT_RESULT", JSON.stringify(inject.result.value, null, 2));

      console.log("Finding path element...");
      const target = await send("Runtime.evaluate", {
        expression: `
          (() => {
            // 尝试文档页面的路径元素
            let el = document.querySelector('.note-title__suite-path-v4, .note-title__suite-path-v4--header-flexible');

            // 如果是文件夹页面，尝试其他可能的路径元素
            if (!el) {
              el = document.querySelector('[class*="suite-path"], [class*="breadcrumb"], .header-path');
            }

            if (!el) return { hasElement: false, selectors: document.querySelectorAll('[class*="path"]').length };

            const r = el.getBoundingClientRect();
            return {
              hasElement: true,
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
              text: (el.textContent || '').trim(),
              className: el.className
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log("PATH_TARGET", JSON.stringify(target.result.value, null, 2));

      if (target.result.value?.hasElement) {
        console.log("Simulating click...");
        const { x, y } = target.result.value;
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount: 1,
        });
      } else {
        console.log("No clickable path element found, skipping click");
      }

      console.log("Waiting for popover to appear...");
      await new Promise((resolve) => setTimeout(resolve, 1500));

      console.log("Inspecting popover state...");
      const inspect = await send("Runtime.evaluate", {
        expression: `
          (() => {
            const popover = document.querySelector('.workspace-suite-path-popover-new');
            return {
              hasPopover: !!popover,
              popupHtml: popover ? popover.outerHTML.slice(0, 3000) : null,
              injectedCount: document.querySelectorAll('[data-tm-feishu-path-injected="true"]').length,
              injectedTexts: [...document.querySelectorAll('[data-tm-feishu-path-injected="true"] .styles__ContainerItemNameSpan-gaZNkf')].map(n => (n.textContent || '').trim()).filter(Boolean),
              itemTexts: [...document.querySelectorAll('.workspace-suite-path-popover-new .styles__ContainerItemNameSpan-gaZNkf')].map(n => (n.textContent || '').trim()).filter(Boolean)
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log("POPOVER_STATE", JSON.stringify(inspect.result.value, null, 2));
      done(0);
    } catch (error) {
      console.error("DEBUG_ERROR", String(error));
      done(1);
    }
  };
}

async function main() {
  try {
    console.log("Finding Feishu docx page...");
    const wsUrl = await findFeishuPage();
    console.log("Setting up WebSocket connection...");
    setupWebSocket(wsUrl);
  } catch (error) {
    console.error("INIT_ERROR", String(error));
    process.exit(1);
  }
}

main();
