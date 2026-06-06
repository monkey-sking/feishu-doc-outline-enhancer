// ==UserScript==
// @name         Feishu Doc Path Popover Enhancer
// @namespace    https://my.feishu.cn/
// @version      0.3.1
// @description  Add parent folder items into the Feishu doc path popover.
// @match        https://my.feishu.cn/docx/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const MARKER_ATTR = "data-tm-feishu-path-injected";
  const POPUP_SELECTOR = ".workspace-suite-path-popover-new";
  const FOLDER_LIST_SELECTOR = ".styles__ContainerFoldersDiv-dxnPGn";
  const ITEM_SELECTOR = ".styles__ContainerItemBoxDiv-jfSIjK";
  const ITEM_TEXT_SELECTOR = ".styles__ContainerItemNameSpan-gaZNkf";

  const IGNORED_EXACT = new Set([
    "Cloud Docs",
    "Drive",
    "Search",
    "External",
    "Share",
    "Edit",
    "Add shortcut to",
    "Move to",
    "Name",
    "Owner",
    "Modified time",
    "Upload",
    "New",
    "Add",
    "Template gallery",
    "Description",
    "No description",
    "Collaborators",
  ]);

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function textOf(value) {
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

  function getState() {
    try {
      return window.__store__?.getState?.() || null;
    } catch {
      return null;
    }
  }

  function getDocToken() {
    const state = getState();
    return (
      toPlain(state?.appState?.currentNoteToken)?.obj_token ||
      textOf(window.DATA?.meta?.token) ||
      ""
    );
  }

  function getFolderInfo(docToken) {
    const state = getState();
    const map = toPlain(state?.appState?.shortcutLocationMap) || {};
    const record = map?.[docToken];
    const token = record?.objContainerTokenList?.[0] || "";
    const nameNode = document.querySelector(
      ".note-title__suite-path-v4, .note-title__suite-path-v4--header-flexible"
    );

    return {
      token,
      name: textOf(nameNode?.textContent),
      url: token ? `https://my.feishu.cn/drive/folder/${token}` : "",
    };
  }

  async function fetchFolderLines(folderUrl) {
    const response = await fetch(folderUrl, { credentials: "include" });
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return textOf(doc.body?.textContent || "")
      .split(/\r?\n/)
      .map((line) => textOf(line))
      .filter(Boolean);
  }

  function shouldIgnore(line, currentFolderName) {
    if (!line) return true;
    if (line === currentFolderName) return true;
    if (IGNORED_EXACT.has(line)) return true;
    if (line.startsWith("http")) return true;
    return false;
  }

  function extractAncestors(lines, currentFolderName) {
    const matches = [];
    lines.forEach((line, index) => {
      if (line === currentFolderName) matches.push(index);
    });

    let best = [];

    for (const index of matches) {
      const chain = [];
      for (let i = index - 1; i >= Math.max(0, index - 12); i -= 1) {
        const value = lines[i];
        if (shouldIgnore(value, currentFolderName)) continue;
        if (chain[0] !== value) {
          chain.unshift(value);
        }
        if (chain.length >= 3) break;
      }
      if (chain.length > best.length) {
        best = chain;
      }
    }

    return best.filter((value, index, arr) => arr.indexOf(value) === index);
  }

  function buildItem(template, label) {
    const item = template.cloneNode(true);
    item.setAttribute(MARKER_ATTR, "true");

    item.querySelectorAll(ITEM_TEXT_SELECTOR).forEach((node, index) => {
      node.textContent = index === 0 ? label : "";
    });

    item.querySelectorAll("a,button").forEach((node) => {
      node.removeAttribute("href");
      node.removeAttribute("target");
      node.removeAttribute("rel");
    });

    item.style.opacity = "0.92";
    return item;
  }

  function injectAncestors(ancestors) {
    if (!ancestors.length) return false;

    const popover = document.querySelector(POPUP_SELECTOR);
    if (!popover) return false;
    if (popover.querySelector(`[${MARKER_ATTR}="true"]`)) return true;

    const list = popover.querySelector(FOLDER_LIST_SELECTOR);
    const template = list?.querySelector(ITEM_SELECTOR);
    if (!list || !template) return false;

    const fragment = document.createDocumentFragment();
    ancestors.forEach((name) => fragment.appendChild(buildItem(template, name)));
    list.insertBefore(fragment, list.firstChild);
    return true;
  }

  async function enhancePopover() {
    const docToken = getDocToken();
    if (!docToken) return false;

    const folderInfo = getFolderInfo(docToken);
    if (!folderInfo.token || !folderInfo.name || !folderInfo.url) return false;

    const lines = await fetchFolderLines(folderInfo.url);
    const ancestors = extractAncestors(lines, folderInfo.name);
    return injectAncestors(ancestors);
  }

  function observePopover() {
    const observer = new MutationObserver(() => {
      const popover = document.querySelector(POPUP_SELECTOR);
      if (!popover) return;
      if (popover.querySelector(`[${MARKER_ATTR}="true"]`)) return;

      enhancePopover().catch((error) => {
        console.warn("[Feishu Doc Path Popover Enhancer]", error);
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function bootstrap() {
    for (let i = 0; i < 10; i += 1) {
      if (getDocToken()) break;
      await sleep(1000);
    }
    observePopover();
  }

  bootstrap();
})();
