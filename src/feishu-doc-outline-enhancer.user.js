// ==UserScript==
// @name         Feishu Doc Path Popover Enhancer
// @namespace    https://my.feishu.cn/
// @version      0.4.0
// @description  Add parent folders into the native Feishu doc path popover.
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
  const DEBUG_PREFIX = "[Feishu Doc Path Popover Enhancer]";
  const CACHE_TTL = 2 * 60 * 1000;
  const MAX_LEVELS = 6;

  const chainCache = new Map();
  let isEnhancing = false;
  let lastEnhanceAt = 0;

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

  function normalizeTitle(title) {
    return textOf(String(title || "").replace(/\s*-\s*飞书云文档\s*$/, ""));
  }

  function getCachedChain(token) {
    const record = chainCache.get(token);
    if (!record) return null;
    if (Date.now() - record.ts > CACHE_TTL) {
      chainCache.delete(token);
      return null;
    }
    return record.chain.slice();
  }

  function setCachedChain(token, chain) {
    chainCache.set(token, {
      ts: Date.now(),
      chain: chain.slice(),
    });
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
      node.setAttribute("type", "button");
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

  function hasInjectedItems() {
    return !!document.querySelector(`[${MARKER_ATTR}="true"]`);
  }

  function shouldSkipEnhance() {
    return isEnhancing || Date.now() - lastEnhanceAt < 1200;
  }

  function readFolderState(win) {
    const state = win?.__store__?.getState?.();
    const docToken =
      toPlain(state?.appState?.currentNoteToken)?.obj_token ||
      textOf(win?.DATA?.meta?.token) ||
      "";
    const map = toPlain(state?.appState?.shortcutLocationMap) || {};
    const record = map?.[docToken] || {};
    const title = normalizeTitle(win?.document?.title);
    const parentToken = record?.objContainerTokenList?.[0] || "";

    return {
      docToken,
      title,
      parentToken,
    };
  }

  async function loadFolderNode(folderToken) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      const url = `https://my.feishu.cn/drive/folder/${folderToken}?tm_path_popover=${Date.now()}`;

      iframe.src = url;
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;left:-9999px;top:-9999px;width:1280px;height:900px;opacity:0;pointer-events:none;border:0;";

      let settled = false;
      const cleanup = () => {
        try {
          iframe.remove();
        } catch {}
      };
      const finish = (handler, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler(value);
      };

      const timer = window.setTimeout(() => {
        finish(reject, new Error(`Timed out loading folder ${folderToken}`));
      }, 15000);

      iframe.onload = () => {
        const startedAt = Date.now();

        const poll = () => {
          try {
            const info = readFolderState(iframe.contentWindow);
            if (info.docToken && info.title) {
              window.clearTimeout(timer);
              finish(resolve, info);
              return;
            }
          } catch (error) {
            window.clearTimeout(timer);
            finish(reject, error);
            return;
          }

          if (Date.now() - startedAt > 12000) {
            window.clearTimeout(timer);
            finish(
              reject,
              new Error(`Folder state not ready for ${folderToken}`)
            );
            return;
          }

          window.setTimeout(poll, 400);
        };

        window.setTimeout(poll, 1200);
      };

      document.body.appendChild(iframe);
    });
  }

  async function resolveAncestorChain(startToken) {
    const cached = getCachedChain(startToken);
    if (cached) return cached;

    const chain = [];
    const visited = new Set();
    let currentToken = startToken;

    for (let level = 0; level < MAX_LEVELS && currentToken; level += 1) {
      if (visited.has(currentToken)) break;
      visited.add(currentToken);

      const info = await loadFolderNode(currentToken);
      if (info.title) {
        chain.unshift(info.title);
      }

      currentToken = info.parentToken;
    }

    setCachedChain(startToken, chain);
    return chain.slice();
  }

  async function enhancePopover() {
    if (shouldSkipEnhance()) return false;

    const docToken = getDocToken();
    if (!docToken) return false;

    const folderInfo = getFolderInfo(docToken);
    if (!folderInfo.token || !folderInfo.name) return false;

    isEnhancing = true;
    lastEnhanceAt = Date.now();

    try {
      const chain = await resolveAncestorChain(folderInfo.token);
      const ancestors = chain.filter(
        (name, index, arr) =>
          name && name !== folderInfo.name && arr.indexOf(name) === index
      );
      return injectAncestors(ancestors);
    } finally {
      isEnhancing = false;
    }
  }

  function observePopover() {
    const observer = new MutationObserver(() => {
      const popover = document.querySelector(POPUP_SELECTOR);
      if (!popover) return;
      if (hasInjectedItems()) return;
      if (shouldSkipEnhance()) return;

      enhancePopover().catch((error) => {
        console.warn(DEBUG_PREFIX, error);
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
