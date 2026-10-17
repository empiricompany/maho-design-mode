// SPDX-FileCopyrightText: 2026 Tony MageMEGA <https://magemega.com>
// SPDX-License-Identifier: OSL-3.0

/**
 * Design mode for the Maho content editor.
 *
 * Adds a toolbar button that turns the editor into a full-screen shell: a rail
 * of blocks on the left, the content on the right. A block is inserted with the
 * same Tiptap command the toolbar uses, so the markup is the one the editor
 * already writes and the save path already sanitizes.
 */
(() => {
    'use strict';

    const ACTIVE_CLASS = 'maho-design-mode';
    const RAIL_CLASS = 'maho-design-rail';
    const BUTTON_CLASS = 'maho-design-mode-toggle';
    const LINE_ID = 'maho-design-drop-line';
    const prepared = new WeakSet();

    // daisyUI button variants shipped by the storefront theme
    const CTA_VARIANTS = [
        ['primary', 'Primary'],
        ['secondary', 'Secondary'],
        ['accent', 'Accent'],
        ['neutral', 'Neutral'],
        ['outline', 'Outline'],
        ['ghost', 'Ghost'],
        ['link', 'Link'],
    ];

    // A layout frame with a side panel: the core registry has no icon for the
    // design shell, so the module ships its own
    const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"'
        + ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<rect x="3" y="4" width="18" height="16" rx="2"/>'
        + '<path d="M9 4v16"/><path d="M12.5 9h5.5"/><path d="M12.5 13h5.5"/><path d="M12.5 17h3.5"/>'
        + '</svg>';

    const COLUMNS = [
        ['2 Columns', 'columns-2', '2-equal'],
        ['3 Columns', 'columns-3', '3-equal'],
        ['4 Columns', 'columns-4', '4-equal'],
        ['Sidebar Left', 'columns-sidebar-left', 'sidebar-left'],
        ['Sidebar Right', 'columns-sidebar-right', 'sidebar-right'],
        ['Wide Center', 'columns-wide-center', 'wide-center'],
    ];

    const BENTO = [
        ['Hero + 2 Cards', 'bento-hero-2', 'hero-2'],
        ['Feature Left', 'bento-feature-left', 'feature-left'],
        ['Feature Right', 'bento-feature-right', 'feature-right'],
        ['Hero + 3 Cards', 'bento-hero-3', 'hero-3'],
        ['Dashboard', 'bento-dashboard', 'dashboard'],
        ['Magazine', 'bento-magazine', 'magazine'],
        ['Showcase', 'bento-showcase', 'showcase'],
        ['Mosaic', 'bento-mosaic', 'mosaic'],
        ['Hero + 4 Cards', 'bento-hero-4', 'hero-4'],
        ['Gallery', 'bento-gallery', 'gallery'],
        ['Editorial', 'bento-editorial', 'editorial'],
        ['Banner + Cards', 'bento-banner-cards', 'banner-cards'],
    ];

    const sections = (setup) => [
        {
            title: 'Layout',
            items: COLUMNS.map(([label, icon, preset]) => ({
                label,
                icon,
                command: 'insertColumns',
                args: [preset],
            })),
        },
        {
            title: 'Bento Grid',
            items: BENTO.map(([label, icon, preset]) => ({
                label,
                icon,
                command: 'insertBentoGrid',
                args: [preset],
            })),
        },
        {
            title: 'Accordion',
            items: [
                { label: 'Accordion', icon: 'accordion', command: 'insertAccordion', args: ['accordion'] },
                { label: 'Tabs', icon: 'tabs', command: 'insertAccordion', args: ['tabs'] },
            ],
        },
        {
            title: 'Media',
            items: [
                {
                    label: 'Insert Image',
                    icon: 'image',
                    command: 'insertMahoImage',
                    enabled: (config) => Boolean(config.add_images),
                },
                {
                    label: 'Insert Slideshow',
                    icon: 'slideshow',
                    command: 'insertMahoSlideshow',
                    enabled: (config) => Boolean(config.add_images) && config.add_slideshows !== false,
                },
            ],
        },
        {
            title: 'Dynamic',
            items: [
                {
                    label: 'Insert Widget',
                    icon: 'widget',
                    command: 'insertMahoWidget',
                    enabled: (config) => Boolean(config.add_widgets),
                },
                {
                    label: 'Insert Variable',
                    icon: 'variable',
                    command: 'insertMahoVariable',
                    enabled: (config) => Boolean(config.add_variables),
                },
            ],
        },
        {
            title: 'Calls to action',
            items: [
                {
                    label: 'CTA Button',
                    icon: 'link',
                    run: () => openCtaDialog(setup),
                },
            ],
        },
        {
            title: 'Text',
            items: [
                {
                    label: 'Paragraph',
                    icon: 'block',
                    run: (editor) => editor.chain().focus().setParagraph().run(),
                },
                {
                    label: 'Heading',
                    icon: 'hamburger',
                    run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
                },
                {
                    label: 'Insert Table',
                    icon: 'table',
                    command: 'insertTable',
                    args: [{ rows: 3, cols: 3, withHeaderRow: true }],
                },
            ],
        },
    ];

    const translate = (setup, text) => {
        try {
            return setup.translate(text);
        } catch (error) {
            return text;
        }
    };

    /**
     * The editor publishes its instances and fires an event after setup; a page
     * script may already have created them before this file loads.
     */
    const start = () => {
        if (typeof window.mahoOnReady === 'function') {
            window.mahoOnReady(attach);
            return;
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attach, { once: true });
            return;
        }
        attach();
    };

    const decorateAll = () => {
        window.tiptapEditors?.forEach((setup) => decorate(setup));
    };

    /**
     * The script may load before or after the editor is built, and a dialog
     * builds a second editor later, so watch the DOM for a toolbar instead of
     * relying on a single moment.
     */
    const attach = () => {
        decorateAll();
        window.varienGlobalEvents?.attachEventHandler?.('wysiwygEditorInitialized', (editor) => {
            decorate(editor?.options?.wysiwygSetup ?? null);
        });

        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) {
                return;
            }
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                decorateAll();
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    };

    const decorate = (setup) => {
        if (!setup?.editor || !setup.wrapper || prepared.has(setup)) {
            return;
        }
        if (setup.textarea?.closest('dialog')) {
            // The fullscreen command is disabled in the catalog popup too
            return;
        }
        const toolbar = setup.wrapper.querySelector('.tiptap-toolbar');
        if (!toolbar) {
            return;
        }
        prepared.add(setup);

        const button = createButton(setup);
        const fullscreen = toolbar.querySelector('button[data-command="toggleFullscreen"]');
        if (fullscreen?.parentNode) {
            // Buttons live inside a .toolbar-group, not directly in the toolbar
            fullscreen.parentNode.insertBefore(button, fullscreen);
        } else {
            toolbar.appendChild(button);
        }
        placeCtaButton(setup, toolbar);

        setup.mahoDesignMode = { button, fullscreenAdded: false, keyHandler: null };
        bindCtaEditing(setup);
        bindBlockMoving(setup);
        bindDrag(setup);
    };

    const createButton = (setup) => {
        const holder = setup.createToolbar([{
            type: 'button',
            title: 'Design Mode',
            icon: 'columns',
            onClick: () => toggle(setup),
        }]);
        const button = holder.querySelector('button');
        const template = document.createElement('template');
        template.innerHTML = ICON;
        const svg = button.querySelector('svg');
        if (svg) {
            svg.replaceWith(template.content.firstElementChild);
        } else {
            button.prepend(template.content.firstElementChild);
        }
        button.classList.add(BUTTON_CLASS);
        button.setAttribute('aria-pressed', 'false');
        return button;
    };

    /**
     * The CTA editor belongs next to Link in the main toolbar, not only in the
     * design rail, and it stays available when design mode is off.
     */
    const placeCtaButton = (setup, toolbar) => {
        if (toolbar.querySelector('[data-maho-cta]')) {
            return;
        }
        const holder = setup.createToolbar([{
            type: 'button',
            title: 'CTA',
            icon: 'link',
            onClick: () => openCtaDialog(setup),
        }]);
        const button = holder.querySelector('button');
        button.dataset.mahoCta = '1';
        const link = [...toolbar.querySelectorAll('button')]
            .find((item) => item.title === setup.translate('Link'));
        if (link?.parentNode) {
            link.parentNode.insertBefore(button, link.nextSibling);
        } else {
            toolbar.appendChild(button);
        }
    };

    const toggle = (setup) => {
        if (setup.wrapper.classList.contains(ACTIVE_CLASS)) {
            leave(setup);
        } else {
            enter(setup);
        }
    };

    /**
     * Puts back a scroll position after a re-layout.
     *
     * Both the enter and the leave path focus the editor, and a Tiptap focus
     * scrolls the caret into view: with the caret parked at the end of the
     * document the shell opened at the bottom of the page. The restore runs
     * again on the next frames because the focus itself is deferred with
     * requestAnimationFrame.
     */
    const restoreScroll = (content, top) => {
        if (!content) {
            return;
        }
        const apply = () => {
            content.scrollTop = top;
        };
        apply();
        requestAnimationFrame(() => {
            apply();
            requestAnimationFrame(apply);
        });
    };

    /**
     * A CTA is a plain anchor in the content: a click on it opens its dialog
     * instead of moving the caret, in design mode and outside it.
     */
    const bindCtaEditing = (setup) => {
        if (setup.mahoCtaClick) {
            return;
        }
        const onClick = (event) => {
            const root = setup.wrapper.querySelector('.ProseMirror');
            const target = event.target;
            const anchor = target instanceof Element ? target.closest('a.btn') : null;
            if (!anchor || !root || !root.contains(anchor)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            openCtaDialog(setup, anchor);
        };
        setup.wrapper.addEventListener('click', onClick, true);
        setup.mahoCtaClick = onClick;
    };

    const enter = (setup) => {
        const state = setup.mahoDesignMode;
        if (!state) {
            return;
        }
        const content = setup.wrapper.querySelector('.tiptap-content');
        const scrollTop = content ? content.scrollTop : 0;
        ensureRail(setup);
        if (!setup.wrapper.classList.contains('tiptap-fullscreen')) {
            setup.editor.commands.toggleFullscreen();
            state.fullscreenAdded = true;
        }
        setup.wrapper.classList.add(ACTIVE_CLASS);
        // A tab pane can clip or transform its content, which would trap the
        // fixed wrapper: move it to the body for the duration of the mode.
        state.parent = setup.wrapper.parentNode;
        state.nextSibling = setup.wrapper.nextSibling;
        document.body.appendChild(setup.wrapper);
        state.button.classList.add('is-active');
        state.button.setAttribute('aria-pressed', 'true');
        state.button.title = translate(setup, 'Exit Design Mode');
        state.keyHandler = (event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) {
                return;
            }
            if (document.querySelector('dialog[open]')) {
                return;
            }
            leave(setup);
        };
        document.addEventListener('keydown', state.keyHandler, true);
        setup.editor.commands.focus();
        restoreScroll(content, scrollTop);
    };

    const leave = (setup) => {
        const state = setup.mahoDesignMode;
        if (!state) {
            return;
        }
        const content = setup.wrapper.querySelector('.tiptap-content');
        const scrollTop = content ? content.scrollTop : 0;
        setup.wrapper.classList.remove(ACTIVE_CLASS);
        hideLine();
        state.button.classList.remove('is-active');
        state.button.setAttribute('aria-pressed', 'false');
        state.button.title = translate(setup, 'Design Mode');
        if (state.keyHandler) {
            document.removeEventListener('keydown', state.keyHandler, true);
            state.keyHandler = null;
        }
        if (state.fullscreenAdded && setup.wrapper.classList.contains('tiptap-fullscreen')) {
            setup.editor.commands.toggleFullscreen();
        }
        state.fullscreenAdded = false;
        if (state.parent) {
            const next = state.nextSibling?.parentNode === state.parent ? state.nextSibling : null;
            state.parent.insertBefore(setup.wrapper, next);
            state.parent = null;
            state.nextSibling = null;
        }
        setup.editor.commands.focus();
        restoreScroll(content, scrollTop);
    };

    const ensureRail = (setup) => {
        let rail = setup.wrapper.querySelector(`.${RAIL_CLASS}`);
        if (rail) {
            return rail;
        }
        rail = document.createElement('aside');
        rail.className = RAIL_CLASS;
        rail.setAttribute('aria-label', translate(setup, 'Blocks'));

        const header = document.createElement('div');
        header.className = RAIL_CLASS + '-header';

        const heading = document.createElement('h2');
        heading.className = RAIL_CLASS + '-heading';
        heading.textContent = translate(setup, 'Blocks');

        const collapse = document.createElement('button');
        collapse.type = 'button';
        collapse.className = RAIL_CLASS + '-toggle';
        const setCollapseLabel = (collapsed) => {
            const label = translate(setup, collapsed ? 'Show blocks' : 'Hide blocks');
            collapse.textContent = collapsed ? '\u00bb' : '\u00ab';
            collapse.title = label;
            collapse.setAttribute('aria-label', label);
            collapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        };
        setCollapseLabel(false);
        collapse.addEventListener('click', () => {
            setCollapseLabel(setup.wrapper.classList.toggle('maho-design-rail-collapsed'));
        });

        header.appendChild(heading);
        header.appendChild(collapse);
        rail.appendChild(header);

        const config = setup.config ?? {};
        for (const section of sections(setup)) {
            const items = section.items.filter((item) => !item.enabled || item.enabled(config));
            if (items.length === 0) {
                continue;
            }
            rail.appendChild(createSection(setup, section.title, items));
        }

        const content = setup.wrapper.querySelector('.tiptap-content');
        if (content) {
            setup.wrapper.insertBefore(rail, content);
        } else {
            setup.wrapper.appendChild(rail);
        }
        return rail;
    };

    const createSection = (setup, title, items) => {
        const section = document.createElement('section');
        section.className = 'maho-design-rail-section';

        const heading = document.createElement('h4');
        heading.className = 'maho-design-rail-title';
        heading.textContent = translate(setup, title);
        section.appendChild(heading);

        const list = document.createElement('div');
        list.className = 'maho-design-rail-items';
        for (const definition of items) {
            list.appendChild(createBlock(setup, definition));
        }
        section.appendChild(list);
        return section;
    };

    /**
     * The tiles are divs with a button role, not buttons: Gecko does not start
     * an HTML5 drag from a button element, so the rail would only be draggable
     * in Chromium.
     */
    const createBlock = (setup, definition) => {
        const label = translate(setup, definition.label);
        const block = document.createElement('div');
        block.className = 'maho-design-block';
        block.setAttribute('role', 'button');
        block.setAttribute('tabindex', '0');
        block.setAttribute('aria-label', label);
        block.title = label;
        block.draggable = Boolean(definition.command) || typeof definition.run === 'function';
        block.innerHTML = `<span class="maho-design-block-icon">${setup.getIcon(definition.icon)}</span>`
            + '<span class="maho-design-block-label"></span>';
        block.querySelector('.maho-design-block-label').textContent = label;

        block.addEventListener('click', () => run(setup, definition));
        block.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }
            event.preventDefault();
            run(setup, definition);
        });
        if (block.draggable) {
            block.addEventListener('dragstart', (event) => startDrag(setup, event, definition));
        }
        return block;
    };

    // Plain entities, spelled through escapes so no editor rewrites them
    const HTML_ENTITIES = {
        '&': '\u0026amp;',
        '<': '\u0026lt;',
        '>': '\u0026gt;',
        '"': '\u0026quot;',
        "'": '\u0026#39;',
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]);

    const ctaClassList = (form) => {
        const classes = ['btn'];
        if (form.variant) {
            classes.push(`btn-${form.variant}`);
        }
        if (form.size) {
            classes.push(`btn-${form.size}`);
        }
        if (form.wide) {
            classes.push('btn-wide');
        }
        if (form.block) {
            classes.push('btn-block');
        }
        return classes;
    };

    /**
     * The anchor the storefront theme styles: a plain <a> with daisyUI classes,
     * no wrapper, so an existing CTA keeps the same markup it had before.
     */
    const buildCtaHtml = (form) => {
        const attributes = [
            `class="${ctaClassList(form).join(' ')}"`,
            `href="${escapeHtml(form.href)}"`,
        ];
        if (form.target) {
            attributes.push('target="_blank"', 'rel="noopener"');
        }
        return `<a ${attributes.join(' ')}>${escapeHtml(form.label)}</a>`;
    };

    /** Reads the CTA fields back from the class list of an existing button. */
    const ctaFormFromClassList = (classList) => {
        const classes = String(classList ?? '').split(/\s+/).filter(Boolean);
        const form = { variant: '', size: '', wide: false, block: false };
        for (const item of classes) {
            if (CTA_VARIANTS.some(([value]) => `btn-${value}` === item)) {
                form.variant = item.slice(4);
            } else if (item === 'btn-sm' || item === 'btn-lg') {
                form.size = item.slice(4);
            } else if (item === 'btn-wide') {
                form.wide = true;
            } else if (item === 'btn-block') {
                form.block = true;
            }
        }
        return form;
    };

    const ctaDialogContent = (setup, values) => {
        const select = (id, options, current) => '<select id="' + id + '">'
            + options.map(([value, label]) => `<option value="${escapeHtml(value)}"`
                + (value === current ? ' selected' : '') + `>${escapeHtml(label)}</option>`).join('')
            + '</select>';

        const checkbox = (id, label, checked) => '<label class="maho-design-check">'
            + `<input type="checkbox" id="${id}"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label>`;

        const options = (list) => list.map(([value, label]) => [value, translate(setup, label)]);

        const content = document.createElement('div');
        content.className = 'maho-design-cta-form';
        content.innerHTML = `
            <div class="maho-design-field">
                <label for="maho-cta-label">${escapeHtml(translate(setup, 'Label'))}</label>
                <input type="text" id="maho-cta-label" value="${escapeHtml(values.label)}">
            </div>
            <div class="maho-design-field">
                <label for="maho-cta-href">${escapeHtml(translate(setup, 'Link'))}</label>
                <input type="text" id="maho-cta-href" value="${escapeHtml(values.href)}"
                    placeholder="/food/gift-boxes/">
                <span class="maho-design-hint">${escapeHtml(translate(
                    setup,
                    'Absolute URL, relative path or a store directive.',
                ))}</span>
            </div>
            <div class="maho-design-row">
                <div class="maho-design-field">
                    <label for="maho-cta-variant">${escapeHtml(translate(setup, 'Variant'))}</label>
                    ${select('maho-cta-variant', options(CTA_VARIANTS), values.variant)}
                </div>
                <div class="maho-design-field">
                    <label for="maho-cta-size">${escapeHtml(translate(setup, 'Size'))}</label>
                    ${select('maho-cta-size', options([['', 'Regular'], ['sm', 'Small'], ['lg', 'Large']]), values.size)}
                </div>
            </div>
            <div class="maho-design-row maho-design-row-checks">
                ${checkbox('maho-cta-wide', translate(setup, 'Wide'), values.wide)}
                ${checkbox('maho-cta-block', translate(setup, 'Full width'), values.block)}
                ${checkbox('maho-cta-target', translate(setup, 'New tab'), values.target)}
            </div>
            `;

        return content.innerHTML;
    };

    const readCtaForm = (dialog) => {
        const root = dialog.querySelector('.maho-design-cta-form') ?? dialog;
        const field = (id) => root.querySelector(`#${id}`);
        return {
            label: field('maho-cta-label')?.value.trim() ?? '',
            href: field('maho-cta-href')?.value.trim() ?? '',
            variant: field('maho-cta-variant')?.value ?? '',
            size: field('maho-cta-size')?.value ?? '',
            wide: Boolean(field('maho-cta-wide')?.checked),
            block: Boolean(field('maho-cta-block')?.checked),
            target: Boolean(field('maho-cta-target')?.checked),
        };
    };

    /** Deepest text block at a position, or -1 when there is none. */
    const textblockDepth = ($pos) => {
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
            if ($pos.node(depth).isTextblock) {
                return depth;
            }
        }
        return -1;
    };

    /**
     * A CTA is its own block: it goes into an empty text block, otherwise on a
     * new paragraph right after the one holding the caret, so it can be placed
     * inside a column or a bento cell without being merged with running text.
     */
    const placeCta = (editor, html) => {
        const { selection } = editor.state;
        const { $from } = selection;
        const depth = textblockDepth($from);
        if (depth === -1) {
            editor.commands.insertContentAt(selection.to, html);
            return;
        }
        if ($from.node(depth).content.size === 0) {
            editor.chain().focus().setTextSelection($from.start(depth)).run();
            editor.commands.insertContent(html);
            return;
        }
        editor.commands.insertContentAt($from.after(depth), html);
    };

    /** Maps a CTA element back to the text range covered by its link mark. */
    const linkRange = (editor, element) => {
        const view = editor.view;
        try {
            const from = view.posAtDOM(element, 0);
            const to = view.posAtDOM(element, element.childNodes.length);
            if (to > from) {
                return { from, to };
            }
        } catch (error) {
            console.error('[maho-design-mode]', error);
        }
        return null;
    };

    /**
     * Inserts a CTA at the caret, or updates the one the caret sits in.
     *
     * An existing button is detected through the link mark: when the call comes
     * from a click the anchor range is selected first, and extendMarkRange makes
     * it explicit so the label can be read and replaced. The form is prefilled
     * from the classes already on the anchor.
     */
    const openCtaDialog = (setup, element = null) => {
        const editor = setup.editor;
        const dialogApi = window.Dialog;
        if (!dialogApi?.info || !editor) {
            return;
        }

        if (element) {
            const range = linkRange(editor, element);
            if (range) {
                editor.chain().focus().setTextSelection(range).run();
            }
        }

        editor.commands.extendMarkRange('link');
        const selection = editor.state.selection;
        const mark = selection.$from.marks().find((item) => item.type.name === 'link')
            ?? editor.state.storedMarks?.find((item) => item.type.name === 'link');
        const editing = Boolean(mark) && !selection.empty;
        const existing = ctaFormFromClassList(mark?.attrs.class);

        const values = {
            label: editing ? editor.state.doc.textBetween(selection.from, selection.to, ' ') : '',
            href: mark?.attrs.href ?? '',
            variant: existing.variant || 'primary',
            size: existing.size,
            wide: existing.wide,
            block: existing.block,
            target: mark?.attrs.target === '_blank',
        };

        dialogApi.info(ctaDialogContent(setup, values), {
            id: 'maho-design-cta-dialog',
            title: translate(setup, editing ? 'Edit CTA' : 'Insert CTA'),
            className: 'magento maho-design-cta',
            width: 460,
            ok: true,
            cancel: true,
            okLabel: translate(setup, editing ? 'Update CTA' : 'Insert CTA'),
            onOk: (dialog) => {
                const form = readCtaForm(dialog);
                if (form.label === '' || form.href === '') {
                    alert(translate(setup, 'The label and the link are required.'));
                    return false;
                }

                const anchor = buildCtaHtml(form);
                try {
                    if (editing) {
                        editor.chain().focus().extendMarkRange('link').unsetLink().insertContent(anchor).run();
                    } else {
                        editor.chain().focus().run();
                        placeCta(editor, `<p>${anchor}</p>`);
                    }
                    editor.commands.scrollIntoView?.();
                } catch (error) {
                    console.error('[maho-design-mode]', error);
                }
                return true;
            },
        });
    };

    /**
     * Runs a palette entry through the command registry rather than a chain:
     * focus() is deferred, so a chain would dispatch the transaction before the
     * caret has moved, and a second drop would land on the previous selection.
     */
    const run = (setup, definition) => {
        try {
            const editor = setup.editor;
            editor.commands.focus();
            if (typeof definition.run === 'function') {
                definition.run(editor);
            } else if (definition.command) {
                editor.commands[definition.command](...(definition.args ?? []));
            }
            // The block may be inserted outside the visible scroll area: without
            // this the click looks like it did nothing
            editor.commands.scrollIntoView?.();
        } catch (error) {
            console.error('[maho-design-mode]', error);
        }
    };

    /**
     * A palette drag keeps its payload in memory and sets only an empty
     * text/plain item, which is what Firefox needs to start the drag. The drop is
     * handled on the whole document: releasing anywhere (canvas, rail, toolbar)
     * is claimed by the handler, so it can never fall through to the browser
     * default, which pasted the tile label into the editor as text.
     */
    let dragPayload = null;

    const startDrag = (setup, event, definition) => {
        dragPayload = definition;
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', '');
        document.body.classList.add('maho-design-dragging');
    };

    const endDrag = () => {
        dragPayload = null;
        movingBlock = null;
        draggingSource = null;
        document.body.classList.remove('maho-design-dragging');
        hideLine();
        hideBlockHandle();
    };

    const bindDrag = (setup) => {
        const onDrag = (event) => {
            if (!dragPayload && !movingBlock) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();

            if (event.type === 'drop') {
                const position = dropPosition(setup, event);
                const payload = dragPayload;
                const moving = movingBlock;
                endDrag();
                if (position !== null) {
                    if (moving) {
                        moveBlock(setup, position, event.clientY, moving);
                    } else {
                        insertAt(setup, position, payload, event.clientY);
                    }
                }
                return;
            }

            if (event.dataTransfer) {
                // The move drag declares effectAllowed = 'move': a 'copy'
                // dropEffect is incompatible and the browser shows the deny
                // cursor, dropping nothing at all
                event.dataTransfer.dropEffect = movingBlock ? 'move' : 'copy';
            }
            const position = dropPosition(setup, event);
            if (position === null) {
                hideLine();
                return;
            }
            showLine(setup, position);
        };

        document.addEventListener('dragenter', onDrag, true);
        document.addEventListener('dragover', onDrag, true);
        document.addEventListener('drop', onDrag, true);
        document.addEventListener('dragend', () => {
            if (dragPayload) {
                endDrag();
            }
        }, true);
    };

    const dropPosition = (setup, event) => {
        const content = setup.wrapper.querySelector('.tiptap-content');
        if (!content) {
            return null;
        }
        const rect = content.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right
            || event.clientY < rect.top || event.clientY > rect.bottom) {
            return null;
        }
        const coords = setup.editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        return coords ? coords.pos : null;
    };

    const nearestTextPosition = (doc, position) => {
        const limit = 200;
        for (let candidate = position; candidate >= 0 && position - candidate <= limit; candidate -= 1) {
            if (doc.resolve(candidate).parent.isTextblock) {
                return candidate;
            }
        }
        for (let candidate = position; candidate <= doc.content.size && candidate - position <= limit; candidate += 1) {
            if (doc.resolve(candidate).parent.isTextblock) {
                return candidate;
            }
        }
        return position;
    };

    /**
     * The command inserts at the current selection, so the drop position becomes
     * the selection first. A block command replaces the text block holding the
     * caret either before or after it: the caret goes to the start of the block
     * when the pointer is on its upper half, and to its end on the lower half.
     * Selection.near is not used because it can return a NodeSelection on a
     * structural node, and the command would then replace that whole node.
     */
    const dropSelection = (view, position, clientY) => {
        const { doc } = view.state;
        const $pos = doc.resolve(position);
        const depth = textblockDepth($pos);
        if (depth === -1) {
            return nearestTextPosition(doc, position);
        }
        const dom = view.nodeDOM($pos.before(depth));
        if (!(dom instanceof HTMLElement)) {
            return $pos.start(depth);
        }
        const rect = dom.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2 ? $pos.start(depth) : $pos.end(depth);
    };

    const insertAt = (setup, position, payload, clientY) => {
        const editor = setup.editor;
        const doc = editor.state.doc;
        const target = Math.max(0, Math.min(position, doc.content.size));
        editor.commands.setTextSelection(dropSelection(editor.view, target, clientY));
        run(setup, payload);
    };

    const line = () => {
        let element = document.getElementById(LINE_ID);
        if (!element) {
            element = document.createElement('div');
            element.id = LINE_ID;
            element.className = 'maho-design-drop-line';
            document.body.appendChild(element);
        }
        return element;
    };

    /**
     * The drop indicator must show the container that will receive the block: a
     * line as wide as the whole canvas cannot tell a nested cell from the page
     * root.
     */
    const dropContainer = (setup, position) => {
        try {
            const { doc } = setup.editor.state;
            const $pos = doc.resolve(position);
            for (let depth = $pos.depth; depth > 0; depth -= 1) {
                const name = $pos.node(depth).type.name;
                if (name === 'mahoColumn' || name === 'mahoBentoCell'
                    || name === 'mahoColumns' || name === 'mahoBentoGrid') {
                    const dom = setup.editor.view.nodeDOM($pos.before(depth));
                    return dom instanceof HTMLElement ? dom : null;
                }
            }
        } catch (error) {
            console.error('[maho-design-mode]', error);
        }
        return null;
    };

    let dropTarget = null;

    const highlight = (element) => {
        if (dropTarget === element) {
            return;
        }
        dropTarget?.classList.remove('maho-design-drop-target');
        dropTarget = element;
        dropTarget?.classList.add('maho-design-drop-target');
    };

    const showLine = (setup, position) => {
        const content = setup.wrapper.querySelector('.tiptap-content');
        if (!content) {
            return;
        }
        const rect = content.getBoundingClientRect();
        const container = dropContainer(setup, position);
        let left = rect.left + 8;
        let width = rect.width - 16;
        if (container) {
            const target = container.getBoundingClientRect();
            left = Math.max(rect.left + 4, target.left);
            width = Math.min(rect.right - 4, target.right) - left;
        }
        try {
            const coords = setup.editor.view.coordsAtPos(position);
            const element = line();
            element.style.top = `${Math.round(coords.top)}px`;
            element.style.left = `${Math.round(left)}px`;
            element.style.width = `${Math.round(width)}px`;
            element.style.display = 'block';
        } catch (error) {
            hideLine();
            return;
        }
        highlight(container);
    };

    const hideLine = () => {
        const element = document.getElementById(LINE_ID);
        if (element) {
            element.style.display = 'none';
        }
        highlight(null);
    };

    /**
     * The core DragHandle is configured without its nested mode, so it only
     * moves top level blocks. This handle covers the nested ones and can also
     * move a block out of its container.
     */
    const HANDLE_ID = 'maho-design-block-handle';
    let movingBlock = null;
    let hoverBlock = null;
    let draggingSource = null;

    const blockHandle = () => {
        let element = document.getElementById(HANDLE_ID);
        if (!element) {
            element = document.createElement('div');
            element.id = HANDLE_ID;
            element.className = 'maho-design-block-handle';
            element.draggable = true;
            document.body.appendChild(element);
        }
        return element;
    };

    const hideBlockHandle = () => {
        hoverBlock = null;
        const element = document.getElementById(HANDLE_ID);
        if (element) {
            element.style.display = 'none';
        }
    };

    const showBlockHandle = (setup, event) => {
        const view = setup.editor.view;
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) {
            hideBlockHandle();
            return;
        }
        const $pos = view.state.doc.resolve(coords.pos);
        const depth = textblockDepth($pos);
        if (depth === -1) {
            hideBlockHandle();
            return;
        }
        const dom = view.nodeDOM($pos.before(depth));
        if (!(dom instanceof HTMLElement)) {
            hideBlockHandle();
            return;
        }
        const rect = dom.getBoundingClientRect();
        const element = blockHandle();
        if (!element.firstChild) {
            element.innerHTML = setup.getIcon('drag-handle');
            const label = translate(setup, 'Move block');
            element.title = label;
            element.setAttribute('aria-label', label);
        }
        element.style.top = `${Math.round(rect.top + 2)}px`;
        element.style.left = `${Math.round(Math.max(4, rect.left - 22))}px`;
        element.style.display = 'flex';
        hoverBlock = { pos: $pos.before(depth), node: $pos.node(depth) };
    };

    const bindBlockMoving = (setup) => {
        if (setup.mahoBlockMove) {
            return;
        }
        const content = setup.wrapper.querySelector('.tiptap-content');
        if (!content) {
            return;
        }
        const element = blockHandle();
        const overHandle = (event) => {
            if (element.style.display === 'none') {
                return false;
            }
            const rect = element.getBoundingClientRect();
            return event.clientX >= rect.left - 6 && event.clientX <= rect.right + 6
                && event.clientY >= rect.top - 6 && event.clientY <= rect.bottom + 6;
        };
        const onMove = (event) => {
            if (movingBlock || overHandle(event)) {
                return;
            }
            showBlockHandle(setup, event);
        };
        const onLeave = (event) => {
            const related = event.relatedTarget;
            if (movingBlock || (related instanceof Node && element.contains(related))) {
                return;
            }
            hideBlockHandle();
        };
        const onPress = () => {
            draggingSource = hoverBlock;
        };
        const onDragStart = (event) => {
            const source = hoverBlock ?? draggingSource;
            if (!source) {
                event.preventDefault();
                return;
            }
            movingBlock = { pos: source.pos, node: source.node };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', '');
            document.body.classList.add('maho-design-dragging');
        };
        const onDragEnd = () => {
            endDrag();
        };
        content.addEventListener('mousemove', onMove);
        content.addEventListener('mouseleave', onLeave);
        element.addEventListener('mouseleave', hideBlockHandle);
        element.addEventListener('mousedown', onPress);
        element.addEventListener('dragstart', onDragStart);
        element.addEventListener('dragend', onDragEnd);
        setup.mahoBlockMove = { element, onMove, onLeave, onPress, onDragStart, onDragEnd };
    };

    /**
     * Moves a block to the drop position. The destination is the position
     * before or after the text block under the pointer, which also allows a
     * block to leave its column or bento cell.
     */
    const moveBlock = (setup, position, clientY, moving) => {
        const editor = setup.editor;
        const { state } = editor;
        const { doc } = state;
        const target = Math.max(0, Math.min(position, doc.content.size));
        const $pos = doc.resolve(target);
        const depth = textblockDepth($pos);
        let dest = target;
        if (depth !== -1) {
            const dom = editor.view.nodeDOM($pos.before(depth));
            const rect = dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
            const before = rect ? clientY < rect.top + rect.height / 2 : true;
            dest = before ? $pos.before(depth) : $pos.after(depth);
        }
        const from = moving.pos;
        const size = moving.node.nodeSize;
        if (dest >= from && dest <= from + size) {
            return;
        }
        const $from = doc.resolve(from);
        const onlyChild = $from.parent.childCount === 1 && $from.depth > 0;
        const tr = state.tr.delete(from, from + size);
        let insertAt = dest > from ? dest - size : dest;
        if (onlyChild) {
            const filler = state.schema.nodes.paragraph.create();
            tr.insert(from, filler);
            // The filler sits before a destination that follows the source
            if (dest >= from) {
                insertAt += filler.nodeSize;
            }
        }
        tr.insert(insertAt, moving.node);
        tr.scrollIntoView();
        editor.view.dispatch(tr);
    };

    start();
})();
