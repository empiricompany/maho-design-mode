# Maho Design Mode

![Maho Commerce](https://img.shields.io/badge/Maho_Commerce-module-orange)
![License](https://img.shields.io/badge/license-OSL--3.0-blue)
![PHP](https://img.shields.io/badge/php-%3E%3D8.5-8892BF)
![PHPStan Level](https://img.shields.io/badge/PHPStan-level%208-brightgreen)

**Design mode and CTA components for the Maho Commerce admin content editor.** Adds a Design Mode shell with a block rail on the left and a **split preview** that renders the edited page on the storefront itself, a real theme button for calls to action, and a move handle that reorders blocks inside nested columns and bento cells. Built for [Maho Commerce](https://mahocommerce.com).

<img width="1919" height="976" alt="immagine" src="https://github.com/user-attachments/assets/63287ee9-21ed-40c2-94e2-f96e9560f3ac" />

## What it does

- **Design Mode** button in the editor toolbar: opens a full-screen shell with the content on the right and a **block rail** on the left; closes with the button or `Esc`
- The rail exposes the presets the core already knows (columns, bento grids, accordion/tabs, image, slideshow, widget, variable, table) and inserts them with the same editor commands, so the saved markup is the one the editor already writes
- Blocks are inserted by click at the caret or by dragging them into the content; the drop line is as wide as the container that will receive the block and that container is outlined, so a nested cell can be told apart from the page root
- The line picks the side of the block under the pointer: above the block on its upper half, below it on the lower half
- **Block move handle** on every text block, nested ones included: drag it to reorder blocks inside the same column or to take a block out of its container. The core `DragHandle` runs without its nested mode, so the module ships its own handle and hides the core one
- **CTA Button** next to Link in the main toolbar: a dialog with label, link, variant (daisyUI `primary`…`link`), size, wide, full width and new tab
- A CTA is a plain `<a class="btn …">`: the editor renders it with the storefront theme button look (height, padding, radius, colors) and a click on it reopens the dialog. Both the toolbar button and the rendered component work **outside Design Mode**
- CTA insertion keeps its own block: an empty text block is used as is, otherwise a new paragraph is added after the block under the caret, inside the current column or bento cell
- The editor scroll position is preserved when entering and leaving Design Mode
- **Split preview**: the pane on the right loads the real storefront page and shows the content being typed in place of the saved block, so the theme initializes slideshows, tabs and widgets exactly as on the frontend
- The preview toolbar carries the store, device presets (mobile, tablet, desktop), scroll sync and a popout window, plus a browser-like row with reload, URL and open; the controls are icon-only, with the label in `title` and `aria-label`
- The preview **browses like the storefront**: links work, the address field follows the page you are on, and Reload re-applies the draft there that is how a static block is reached on the page that renders it
- Typing updates the preview with a single-flight debounce: one request at a time, only the last content is sent

## Requirements

- PHP >= 8.5
- Maho Commerce with the TipTap editor

## Installation

```bash
composer require empiricompany/maho-design-mode
./maho cache:flush
```

The module ships no install script and no schema migration: it is layout, JS and CSS only. Assets are published to `public/js/mage/adminhtml/wysiwyg/` by the Maho composer plugin; after editing files in `public/`, run `composer update` again from the project root to republish them.

## Files

| File | Role |
| --- | --- |
| `app/etc/modules/MM_DesignMode.xml` | module declaration (`local` code pool) |
| `app/code/local/MM/DesignMode/etc/config.xml` | version, model/block group and adminhtml layout update |
| `app/code/local/MM/DesignMode/Helper/Data.php` | admin URLs, store list and the signed, expiring preview token |
| `app/code/local/MM/DesignMode/Block/Adminhtml/Preview.php` | preview configuration (entity, assigned stores, URLs) rendered as a global |
| `app/code/local/MM/DesignMode/Model/Observer.php` | puts the posted draft in place of the edited block and disables the page cache |
| `app/code/local/MM/DesignMode/controllers/Adminhtml/Designmode/PreviewController.php` | `draft` endpoint: stores the content being edited for the page in the preview |
| `app/design/adminhtml/default/default/layout/design_mode.xml` | adds the JS, the CSS and the preview global to the `editor` handle, behind `can_load_wysiwyg` |
| `public/js/mage/adminhtml/wysiwyg/design-mode.js` | Design Mode shell, rail, split preview, CTA dialog, drop handling and block move handle |
| `public/js/mage/adminhtml/wysiwyg/design-mode.css` | shell grid, rail, preview header and stage, drop line, move handle and the theme button reproduction for `.ProseMirror a.btn` |

## How it works

- The editor is reached through the core globals (`window.tiptapEditors`, the `wysiwygEditorInitialized` event) and the rail and buttons are built with `setup.createToolbar()`, so they share the toolbar style and the editor translations
- The drop does not use the native ProseMirror dropcursor: the module handles the drag and draws the line itself, because the indicator must match the container that will receive the block
- The destination is resolved from the drop position with a text block lookup (`textblockDepth`), not with `Selection.near`, which can return a NodeSelection on a structural node and make the command replace the whole column or cell
- A move drag declares `effectAllowed = 'move'`; the dragover sets `dropEffect` to `move` for blocks and `copy` for rail items, otherwise the browser shows the deny cursor and drops nothing
- When a block leaves a container that would become empty, an empty paragraph keeps the schema valid
- The product/category popup editor does not get the button, like the fullscreen command
- The preview does not inject HTML into the saved page: the editor POSTs the content to the module, which keeps it in the cache under the preview token, and the framed page reads it while rendering. An observer then replaces the edited block with it, after filtering it through the CMS template processor like any saved content, so the page arrives complete and the theme initializes it with its own code
- The page itself is loaded with a plain `GET`: the store home answers `GET` only and redirects a `POST` before the request reaches the block, so the content cannot travel in the page request
- The URL carries a signed, expiring token (`mm_preview`) naming the edited entity, and the response is marked `no-store`. Without a valid token the page is the normal one, and the draft expires after five minutes

## What it does not do yet

- No right-hand properties panel
- No new block types: the palette is the core registry
- No block palette inside the preview: blocks are inserted in the editor

## Development

The module ships the standard Maho CI gates:

- **PHP CS Fixer** (dry-run) `composer cs` (or `composer cs-fix` to apply)
- **PHPStan** (level 8) `composer phpstan`
- **Rector** (dry-run) `composer rector`
- **JS syntax** `node --check public/js/mage/adminhtml/wysiwyg/design-mode.js`
- **XML syntax** module, config and layout files

Run them all at once with `composer check`.
