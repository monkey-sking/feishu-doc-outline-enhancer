// ==UserScript==
// @name         Feishu Doc Path Enhancer
// @namespace    https://my.feishu.cn/
// @version      0.2.0
// @description  Enhance the small Feishu doc header path area with parent folder context.
// @match        https://my.feishu.cn/docx/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STYLE_ID = "tm-feishu-path-enhancer-style";
  const PATH_CLASS = "tm-feishu-path-enhancer";
  const BLACKLIST = new Set([
    "飞书云文档",
    "云盘",
    "搜索",
    "我的文件夹",
    "共享文件夹",
    "外部",
    "最近修改",
    "分享",
    "编辑",
  ]);

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function safeText(value) {
    return (value || "").replace(/\u200b|\u200c|\u200d|\ufeff/g, "").trim();
  }

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

  function getStoreState() {
    try {
      return window.__store__?.getState?.() || null;
    } catch {
      return null;
    }
  }

  function getDocToken() {
    const state = getStoreState();
    return (
      toPlain(state?.appState?.currentNoteToken)?.obj_token ||
      safeText(window.DATA?.meta?.token) ||
      ""
    );
  }

  function getFolderInfo(docToken) {
    const state = getStoreState();
    const map = toPlain(state?.appState?.shortcutLocationMap) || {};
    const record = map?.[docToken];
    const token = record?.objContainerTokenList?.[0] || "";
    const pathNode =
      document.querySelector(".note-title__suite-path-v4") ||
      document.querySelector(".note-title__suite-path-v4--header-flexible");

    return {
      token,
      name: safeText(pathNode?.textContent),
      url: token ? `https://my.feishu.cn/drive/folder/${token}` : "",
      node: pathNode,
    };
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${PATH_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        font-size: 14px;
        line-height: 20px;
        color: #5f6670;
      }

      .${PATH_CLASS}__link,
      .${PATH_CLASS}__current {
        min-width: 0;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .${PATH_CLASS}__link {
        color: #5f6670;
        text-decoration: none;
      }

      .${PATH_CLASS}__link:hover {
        color: #315efb;
        text-decoration: underline;
      }

      .${PATH_CLASS}__sep {
        color: #a0a7b3;
        flex: 0 0 auto;
      }

      .${PATH_CLASS}__current {
        color: #1f2329;
      }
    `;
    document.head.appendChild(style);
  }

  async function fetchFolderText(folderUrl) {
    const response = await fetch(folderUrl, { credentials: "include" });
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return safeText(doc.body?.textContent || "");
  }

  function extractParentFolderName(folderText, currentFolderName) {
    const lines = folderText
      .split(/\r?\n/)
      .map((line) => safeText(line))
      .filter(Boolean);

    const indexes = [];
    lines.forEach((line, index) => {
      if (line === currentFolderName) indexes.push(index);
    });

    for (const index of indexes) {
      for (let i = index - 1; i >= Math.max(0, index - 8); i -= 1) {
        const value = lines[i];
        if (!value || value === currentFolderName || BLACKLIST.has(value)) continue;
        return value;
      }
    }

    return "";
  }

  function renderInlinePath({ targetNode, parentName, folderName, folderUrl }) {
    if (!targetNode || !folderName) return false;
    ensureStyle();

    let mount = targetNode.parentElement.querySelector(`.${PATH_CLASS}`);
    if (!mount) {
      mount = document.createElement("span");
      mount.className = PATH_CLASS;
      targetNode.parentElement.insertBefore(mount, targetNode);
    }

    const parentPart = parentName
      ? `<a class="${PATH_CLASS}__link" href="${folderUrl}" target="_blank" rel="noreferrer" title="${escapeHtml(parentName)}">${escapeHtml(parentName)}</a>
         <span class="${PATH_CLASS}__sep">/</span>`
      : "";

    mount.innerHTML = `
      ${parentPart}
      <span class="${PATH_CLASS}__current" title="${escapeHtml(folderName)}">${escapeHtml(folderName)}</span>
    `;

    targetNode.style.display = "none";
    return true;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function enhancePath() {
    const docToken = getDocToken();
    if (!docToken) return false;

    const folderInfo = getFolderInfo(docToken);
    if (!folderInfo.token || !folderInfo.name || !folderInfo.node) return false;

    try {
      const folderText = await fetchFolderText(folderInfo.url);
      const parentName = extractParentFolderName(folderText, folderInfo.name);
      return renderInlinePath({
        targetNode: folderInfo.node,
        parentName,
        folderName: folderInfo.name,
        folderUrl: folderInfo.url,
      });
    } catch (error) {
      console.warn("[Feishu Doc Path Enhancer] Failed to enhance path:", error);
      return renderInlinePath({
        targetNode: folderInfo.node,
        parentName: "",
        folderName: folderInfo.name,
        folderUrl: folderInfo.url,
      });
    }
  }

  async function bootstrap() {
    for (let i = 0; i < 20; i += 1) {
      const ok = await enhancePath();
      if (ok) break;
      await wait(1000);
    }

    const observer = new MutationObserver(() => {
      const existing = document.querySelector(`.${PATH_CLASS}`);
      if (!existing) {
        enhancePath();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  bootstrap();
})();
