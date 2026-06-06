// ==UserScript==
// @name         Feishu Doc Outline Enhancer
// @namespace    https://my.feishu.cn/
// @version      0.1.0
// @description  Enhance Feishu doc outline with folder context, sibling docs, and a stronger in-page navigation panel.
// @match        https://my.feishu.cn/docx/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "tm-feishu-outline-enhancer";
  const STYLE_ID = "tm-feishu-outline-enhancer-style";
  const STATE = {
    currentDocToken: null,
    currentDocTitle: "",
    currentFolderToken: "",
    currentFolderName: "",
    currentFolderUrl: "",
    siblingDocs: [],
    siblingFolders: [],
    headings: [],
  };

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function safeText(value) {
    return (value || "").replace(/\u200b|\u200c|\u200d|\ufeff/g, "").trim();
  }

  function getStoreState() {
    try {
      return window.__store__?.getState?.() || null;
    } catch {
      return null;
    }
  }

  function toPlain(value) {
    try {
      if (!value) {
        return value;
      }
      if (typeof value.toJS === "function") {
        return value.toJS();
      }
      if (typeof value.toJSON === "function") {
        return value.toJSON();
      }
      return value;
    } catch {
      return value;
    }
  }

  function getCurrentDocToken() {
    const state = getStoreState();
    const token = toPlain(state?.appState?.currentNoteToken)?.obj_token;
    return token || safeText(window.DATA?.meta?.token) || "";
  }

  function getCurrentDocTitle() {
    const titleNode =
      document.querySelector("#ssrHeaderTitle") ||
      document.querySelector(".suite-title__title") ||
      document.querySelector(".note-title__input");
    return (
      safeText(titleNode?.textContent) ||
      safeText(window.DATA?.meta?.title) ||
      safeText(document.title.replace(/\s*-\s*飞书云文档$/, ""))
    );
  }

  function getCurrentFolderInfo(docToken) {
    const state = getStoreState();
    const locationMap = toPlain(state?.appState?.shortcutLocationMap) || {};
    const record = locationMap?.[docToken];
    const token = record?.objContainerTokenList?.[0] || "";
    const nameNode =
      document.querySelector(".note-title__suite-path-v4") ||
      document.querySelector(".note-title__suite-path-v4--header-flexible");
    const name = safeText(nameNode?.textContent);
    return {
      token,
      name,
      url: token ? `https://my.feishu.cn/drive/folder/${token}` : "",
    };
  }

  function collectHeadings() {
    const nodes = [...document.querySelectorAll(".heading-content")];
    const seen = new Set();
    const items = [];

    for (const node of nodes) {
      const text = safeText(node.textContent);
      if (!text || seen.has(text)) {
        continue;
      }
      const block = node.closest(
        ".docx-heading1-block, .docx-heading2-block, .docx-heading3-block, .docx-heading4-block, .docx-heading5-block, .docx-heading6-block"
      );
      let level = 2;
      if (block) {
        const match = block.className.match(/docx-heading(\d)-block/);
        if (match) {
          level = Number(match[1]);
        }
      }
      seen.add(text);
      items.push({
        text,
        level,
        node: block || node,
      });
    }

    return items;
  }

  async function fetchFolderHtml(folderUrl) {
    const response = await fetch(folderUrl, {
      credentials: "include",
    });
    return response.text();
  }

  function parseFolderPage(html, currentDocTitle) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const bodyText = safeText(doc.body?.textContent || "");
    const lines = bodyText
      .split(/\r?\n/)
      .map((line) => safeText(line))
      .filter(Boolean);

    const folderTitle =
      safeText(doc.title.replace(/\s*-\s*飞书云文档$/, "")) || "";

    const rows = [];
    const blacklist = new Set([
      "飞书云文档",
      "云盘",
      "搜索",
      "我的文件夹",
      "共享文件夹",
      "新建",
      "上传",
      "添加",
      "模板库",
      "名称",
      "所有者",
      "修改时间",
      "分享",
      "协作者",
      "描述",
      "暂无描述",
      "外部",
      "编辑",
    ]);

    for (let i = 0; i < lines.length; i += 3) {
      const name = lines[i];
      const owner = lines[i + 1];
      const modified = lines[i + 2];

      if (!name || blacklist.has(name)) {
        continue;
      }
      if (!owner || !modified) {
        continue;
      }
      if (name === folderTitle) {
        continue;
      }

      rows.push({
        name,
        owner,
        modified,
        isCurrent: name === currentDocTitle,
      });
    }

    const deduped = [];
    const seen = new Set();
    for (const row of rows) {
      const key = `${row.name}__${row.owner}__${row.modified}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(row);
    }

    return {
      folderTitle,
      rows: deduped,
    };
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
        color: #22304a;
        background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,244,234,0.98) 100%);
        border: 1px solid rgba(118, 94, 55, 0.16);
        border-radius: 16px;
        box-shadow: 0 12px 36px rgba(70, 52, 24, 0.12);
        overflow: hidden;
        margin-bottom: 12px;
      }

      #${PANEL_ID} .tm-fde-header {
        padding: 14px 16px 10px;
        border-bottom: 1px solid rgba(118, 94, 55, 0.12);
        background: linear-gradient(135deg, rgba(243,232,208,0.95) 0%, rgba(255,248,235,0.96) 100%);
      }

      #${PANEL_ID} .tm-fde-title {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      #${PANEL_ID} .tm-fde-subtitle {
        margin-top: 4px;
        font-size: 12px;
        color: #7a6445;
        line-height: 1.5;
      }

      #${PANEL_ID} .tm-fde-section {
        padding: 12px 16px;
        border-bottom: 1px solid rgba(118, 94, 55, 0.08);
      }

      #${PANEL_ID} .tm-fde-section:last-child {
        border-bottom: 0;
      }

      #${PANEL_ID} .tm-fde-label {
        margin-bottom: 8px;
        font-size: 12px;
        font-weight: 700;
        color: #8b6f45;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      #${PANEL_ID} .tm-fde-path,
      #${PANEL_ID} .tm-fde-list,
      #${PANEL_ID} .tm-fde-outline {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      #${PANEL_ID} a,
      #${PANEL_ID} button.tm-fde-link {
        text-decoration: none;
        border: 0;
        background: none;
        padding: 0;
        text-align: left;
        cursor: pointer;
        color: #214f8b;
        font-size: 13px;
        line-height: 1.45;
      }

      #${PANEL_ID} a:hover,
      #${PANEL_ID} button.tm-fde-link:hover {
        color: #15365d;
      }

      #${PANEL_ID} .tm-fde-crumb {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      #${PANEL_ID} .tm-fde-crumb-sep {
        color: #9f8457;
      }

      #${PANEL_ID} .tm-fde-muted {
        color: #887259;
        font-size: 12px;
      }

      #${PANEL_ID} .tm-fde-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(160, 123, 62, 0.10);
        color: #684c24;
      }

      #${PANEL_ID} .tm-fde-current {
        font-weight: 700;
        color: #6b4717;
      }

      #${PANEL_ID} .tm-fde-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255,255,255,0.6);
      }

      #${PANEL_ID} .tm-fde-item.tm-fde-item-current {
        background: rgba(204, 150, 61, 0.16);
      }

      #${PANEL_ID} .tm-fde-item-meta {
        font-size: 11px;
        color: #8a7759;
      }

      #${PANEL_ID} .tm-fde-outline-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      #${PANEL_ID} .tm-fde-outline-level-3 { padding-left: 12px; }
      #${PANEL_ID} .tm-fde-outline-level-4 { padding-left: 24px; }
      #${PANEL_ID} .tm-fde-outline-level-5 { padding-left: 36px; }
      #${PANEL_ID} .tm-fde-outline-level-6 { padding-left: 48px; }

      #${PANEL_ID} .tm-fde-bullet {
        flex: 0 0 auto;
        width: 6px;
        height: 6px;
        margin-top: 7px;
        border-radius: 50%;
        background: #b28a4f;
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderPanel() {
    ensureStyle();

    const catalogueContainer = document.querySelector(".catalogue-container");
    if (!catalogueContainer || !catalogueContainer.parentElement) {
      return false;
    }

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("section");
      panel.id = PANEL_ID;
      catalogueContainer.parentElement.insertBefore(panel, catalogueContainer);
    }

    const siblingsHtml =
      STATE.siblingDocs.length === 0 && STATE.siblingFolders.length === 0
        ? `<div class="tm-fde-muted">Current folder context is still loading.</div>`
        : [
            ...STATE.siblingFolders.slice(0, 8).map(
              (item) => `
                <div class="tm-fde-item">
                  <a href="${STATE.currentFolderUrl}" target="_blank" rel="noreferrer">[Folder] ${escapeHtml(item.name)}</a>
                </div>
              `
            ),
            ...STATE.siblingDocs.slice(0, 18).map(
              (item) => `
                <div class="tm-fde-item ${item.isCurrent ? "tm-fde-item-current" : ""}">
                  <div class="${item.isCurrent ? "tm-fde-current" : ""}">${escapeHtml(item.name)}</div>
                  <div class="tm-fde-item-meta">${escapeHtml(item.owner)} · ${escapeHtml(item.modified)}</div>
                </div>
              `
            ),
          ].join("");

    const outlineHtml =
      STATE.headings.length === 0
        ? `<div class="tm-fde-muted">No visible heading blocks were found yet.</div>`
        : STATE.headings
            .map(
              (item, index) => `
                <div class="tm-fde-outline-item tm-fde-outline-level-${item.level}">
                  <span class="tm-fde-bullet"></span>
                  <button class="tm-fde-link" data-heading-index="${index}">${escapeHtml(item.text)}</button>
                </div>
              `
            )
            .join("");

    panel.innerHTML = `
      <div class="tm-fde-header">
        <div class="tm-fde-title">Enhanced Outline</div>
        <div class="tm-fde-subtitle">Adds folder context on top of the native Feishu doc outline.</div>
      </div>
      <div class="tm-fde-section">
        <div class="tm-fde-label">Path</div>
        <div class="tm-fde-path">
          <div class="tm-fde-crumb">
            ${
              STATE.currentFolderUrl
                ? `<a class="tm-fde-pill" href="${STATE.currentFolderUrl}" target="_blank" rel="noreferrer">Folder: ${escapeHtml(
                    STATE.currentFolderName || "Current folder"
                  )}</a>`
                : `<span class="tm-fde-pill">Folder: unresolved</span>`
            }
            <span class="tm-fde-crumb-sep">/</span>
            <span class="tm-fde-pill tm-fde-current">${escapeHtml(STATE.currentDocTitle || "Current doc")}</span>
          </div>
          <div class="tm-fde-muted">The native header only shows one layer of path; this panel keeps the folder entry visible.</div>
        </div>
      </div>
      <div class="tm-fde-section">
        <div class="tm-fde-label">Sibling Docs</div>
        <div class="tm-fde-list">${siblingsHtml}</div>
      </div>
      <div class="tm-fde-section">
        <div class="tm-fde-label">Current Doc Outline</div>
        <div class="tm-fde-outline">${outlineHtml}</div>
      </div>
    `;

    panel.querySelectorAll("[data-heading-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.getAttribute("data-heading-index"));
        const target = STATE.headings[index]?.node;
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

    return true;
  }

  async function loadFolderContext() {
    if (!STATE.currentFolderUrl) {
      return;
    }

    try {
      const html = await fetchFolderHtml(STATE.currentFolderUrl);
      const parsed = parseFolderPage(html, STATE.currentDocTitle);

      if (!STATE.currentFolderName && parsed.folderTitle) {
        STATE.currentFolderName = parsed.folderTitle;
      }

      STATE.siblingDocs = parsed.rows.filter((row) => !row.name.startsWith("[Folder]"));
      renderPanel();
    } catch (error) {
      console.warn("[Feishu Doc Outline Enhancer] Failed to load folder context:", error);
    }
  }

  function refreshState() {
    const docToken = getCurrentDocToken();
    if (!docToken) {
      return false;
    }

    STATE.currentDocToken = docToken;
    STATE.currentDocTitle = getCurrentDocTitle();

    const folder = getCurrentFolderInfo(docToken);
    STATE.currentFolderToken = folder.token;
    STATE.currentFolderName = folder.name;
    STATE.currentFolderUrl = folder.url;
    STATE.headings = collectHeadings();

    return true;
  }

  async function bootstrap() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (refreshState() && renderPanel()) {
        await loadFolderContext();
        break;
      }
      await wait(1000);
    }

    const observer = new MutationObserver(() => {
      if (refreshState()) {
        renderPanel();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  bootstrap();
})();
