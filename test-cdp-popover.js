const fs = require("node:fs");

const SCRIPT_PATH =
  "C:/Users/Administrator/Documents/Codex/2026-06-06/new-chat/work/feishu-doc-outline-enhancer/dist/feishu-doc-outline-enhancer.user.js";
const TARGET_WS = "ws://127.0.0.1:9222/devtools/page/21667379E9F08545EC9241EBAFE129D3";

async function main() {
  const script = fs.readFileSync(SCRIPT_PATH, "utf8");
  const ws = new WebSocket(TARGET_WS);
  let id = 0;
  const pending = new Map();
  const forceExit = setTimeout(() => {
    console.error("Timed out waiting for CDP test.");
    try {
      ws.close();
    } catch {}
    process.exit(1);
  }, 20000);

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject, method });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (!msg.id || !pending.has(msg.id)) {
      return;
    }

    const { resolve, reject, method } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
    } else {
      resolve(msg.result);
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error.message || error);
  };

  ws.onopen = async () => {
    try {
      await send("Runtime.enable");

      const injectExpression = `
        (() => {
          try {
            eval(${JSON.stringify(script)});
            return "injected";
          } catch (error) {
            return "inject-error:" + error.message;
          }
        })()
      `;

      const injectResult = await send("Runtime.evaluate", {
        expression: injectExpression,
        returnByValue: true,
        awaitPromise: true,
      });

      const targetResult = await send("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector('.note-title__suite-path-v4, .note-title__suite-path-v4--header-flexible');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`,
        returnByValue: true,
        awaitPromise: true,
      });

      const target = targetResult.result.value;
      if (target) {
        await send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: target.x,
          y: target.y,
          button: "left",
          clickCount: 1,
        });
        await send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: target.x,
          y: target.y,
          button: "left",
          clickCount: 1,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 1200));

      const inspectResult = await send("Runtime.evaluate", {
        expression: `(() => ({
          injectResult: ${JSON.stringify(injectResult.result.value)},
          hasPopover: !!document.querySelector('.workspace-suite-path-popover-new'),
          injectedCount: document.querySelectorAll('[data-tm-path-item="true"]').length,
          injectedTexts: [...document.querySelectorAll('[data-tm-path-item="true"] .styles__ContainerItemNameSpan-gaZNkf')].map(n => (n.textContent || '').trim()).filter(Boolean),
          itemTexts: [...document.querySelectorAll('.workspace-suite-path-popover-new .styles__ContainerItemNameSpan-gaZNkf')].map(n => (n.textContent || '').trim()).filter(Boolean).slice(0, 20)
        }))()`,
        returnByValue: true,
        awaitPromise: true,
      });

      console.log(JSON.stringify(inspectResult.result.value, null, 2));
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      console.error(String(error));
      clearTimeout(forceExit);
      process.exit(1);
    } finally {
      ws.close();
    }
  };
}

main();
