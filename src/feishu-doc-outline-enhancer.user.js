// ==UserScript==
// @name         Feishu Doc Path Popover Enhancer
// @namespace    https://my.feishu.cn/
// @version      0.3.0
// @description  Show parent folder context inside the small Feishu doc path popover.
// @match        https://my.feishu.cn/docx/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const INJECT_MARKER = "tm-feishu-path-popover-enhanced";
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
    "添加快捷方式到",
    "移动到",
    "协作者",
    "描述",
    "暂无描述",
    "所有者",
    "名称",
    "修改时间",
    "上传",
    "新建",
    "添加",
    "模板库",
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
    };
  }

  async function fetchFolderText(folderUrl) {
    const response = await fetch(folderUrl, { credentials: "include" });
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return safeText(doc.body?.textContent || "");
  }

  function extractAncestorNames(folderText, currentFolderName) {
    const lines = folderText
      .split(/\r?\n/)
      .map((line) => safeText(line))
      .filter(Boolean);

    const matches = [];
    lines.forEach((line, index) => {
      if (line === currentFolderName) {
        matches.push(index);
      }
    });

    const best = [];

    for (const index of matches) {
      const chain = [];
      for (let i = index - 1; i >= Math.max(0, index - 12); i -= 1) {
        const value = lines[i];
        if (!value || BLACKLIST.has(value) || value === currentFolderName) {
          continue;
        }
        if (chain[0] !== value) {
          chain.unshift(value);
        }
        if (chain.length >= 3) {
          break;
        }
      }

      if (chain.length > best.length) {
        best.splice(0, best.length, ...chain);
      }
    }

    return best.filter((value, index, arr) => arr.indexOf(value) === index);
  }

  function buildInjectedItem(text, template) {
    const item = template.cloneNode(true);
    item.setAttribute("data-tm-path-item", "true");

    item.querySelectorAll(".styles__ContainerItemNameSpan-gaZNkf").forEach((node, index) => {
      node.textContent = index === 0 ? text : "";
    });

    const icon = item.querySelector(".universe-icon");
    if (icon) {
      icon.style.color = "var(--icon-n2, #8f959e)";
    }

    item.style.opacity = "0.92";
    return item;
  }

  function injectIntoPopover(ancestorNames, currentFolderName) {
    if (!ancestorNames.length || !currentFolderName) {
      return false;
    }

    const popover = document.querySelector(".workspace-suite-path-popover-new");
    if (!popover || popover.querySelector(`[data-${INJECT_MARKER}]`)) {
      return false;
    }

    const listContainer = popover.querySelector(".styles__ContainerFoldersDiv-dxnPGn");
    const firstItem = listContainer?.querySelector(".styles__ContainerItemBoxDiv-jfSIjK");
    if (!listContainer || !firstItem) {
      return false;
    }

    const marker = document.createElement("div");
    marker.setAttribute(`data-${INJECT_MARKER}`, "true");

    ancestorNames.forEach((name) => {
      marker.appendChild(buildInjectedItem(name, firstItem));
    });

    listContainer.insertBefore(marker, listContainer.firstChild);
    return true;
  }

  async function enhancePopover() {
    const docToken = getDocToken();
    if (!docToken) {
      return false;
    }

    const folderInfo = getFolderInfo(docToken);
    if (!folderInfo.token || !folderInfo.name || !folderInfo.url) {
      return false;
    }

    const folderText = await fetchFolderText(folderInfo.url);
    const ancestorNames = extractAncestorNames(folderText, folderInfo.name);
    return injectIntoPopover(ancestorNames, folderInfo.name);
  }

  function watchPopover() {
    const observer = new MutationObserver(() => {
      const popover = document.querySelector(".workspace-suite-path-popover-new");
      if (popover && !popover.querySelector(`[data-${INJECT_MARKER}]`)) {
        enhancePopover().catch((error) => {
          console.warn("[Feishu Doc Path Popover Enhancer] Failed:", error);
        });
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async function bootstrap() {
    for (let i = 0; i < 10; i += 1) {
      const token = getDocToken();
      if (token) {
        break;
      }
      await wait(1000);
    }

    watchPopover();
  }

  bootstrap();
})();
