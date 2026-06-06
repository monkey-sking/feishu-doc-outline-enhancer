# Feishu Doc Outline Enhancer

Enhance Feishu Docs with a stronger outline panel that adds folder context above the native catalogue.

## What it does

- Adds an enhanced panel above Feishu's native `.catalogue-container`
- Shows a quick entry back to the current folder
- Lists sibling docs from the same folder
- Rebuilds the current document outline from heading blocks
- Supports smooth scrolling when clicking outline items

## Why

Feishu's built-in doc outline is good for in-page headings, but it does not surface enough parent-folder context when you are working across a document set. This userscript keeps the current doc outline while also exposing the surrounding folder context.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open [`dist/feishu-doc-outline-enhancer.user.js`](./dist/feishu-doc-outline-enhancer.user.js).
3. Install the script in Tampermonkey.
4. Refresh any `https://my.feishu.cn/docx/*` page.

## Current behavior

The current version is designed against a real Feishu doc page and currently:

- reads the current doc token from Feishu page state
- reads the current folder token from Feishu shortcut location state
- reads the current folder label from the Feishu header path
- fetches the current folder page and extracts sibling documents
- rebuilds a local outline from `.heading-content`

## Limitations

- The script currently guarantees the current folder entry, but not yet a full multi-level breadcrumb chain.
- Sibling document links are currently shown as a contextual list; a future version can resolve and attach direct doc URLs more aggressively.
- Feishu's internal DOM and state shape may change over time.

## Development

The main userscript source lives in `src/feishu-doc-outline-enhancer.user.js`.

The `dist/` copy is the installable file.

## License

MIT
