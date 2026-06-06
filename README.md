# Feishu Doc Outline Enhancer

Enhance the small Feishu doc path popover instead of adding a large extra panel.

## What it does

- Enhances the existing small Feishu path popover
- Injects parent folder names above the current folder item
- Keeps the change inside the native popover instead of rendering a large extra block
- Reuses the native popover item structure so it stays visually close to Feishu

## Why

Feishu only shows one layer inside the small path popover. This userscript focuses on that exact popup and adds parent-folder context there, instead of rendering a large separate block somewhere else.

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
- fetches the current folder page
- heuristically extracts the parent folder name from the folder page text
- injects extra folder rows into `.workspace-suite-path-popover-new`

## Limitations

- The script currently targets the compact path popover only.
- Parent-folder extraction is heuristic and based on current Feishu page text structure.
- Feishu's internal DOM and state shape may change over time.

## Development

The main userscript source lives in `src/feishu-doc-outline-enhancer.user.js`.

The `dist/` copy is the installable file.

## License

MIT
