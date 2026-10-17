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
    const PREVIEW_CLASS = 'maho-design-preview';
    const PREVIEW_OPEN_CLASS = 'maho-design-preview-open';
    const PREVIEW_WIDTH_KEY = 'maho-design-preview-width';
    const PREVIEW_SYNC_KEY = 'maho-design-preview-sync';
    const PREVIEW_RENDER_DELAY = 400;
    const PREVIEW_DEVICES = [['mobile', 390], ['tablet', 768], ['desktop', 1280]];
    const PREVIEW_WINDOW_NAME = 'maho-design-preview';
    const prepared = new WeakSet();
    let previewSequence = 0;

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

    /**
     * The preview renders the content with the storefront styles inside an
     * iframe: the theme stylesheet carries a global preflight, so it cannot be
     * injected in the admin document. The page of the store is the real one -
     * header, navigation, footer - and it marks the block being edited (see
     * MM_DesignMode_Model_Observer): the rendered content replaces that marker,
     * so the preview shows exactly the page the visitor gets.
     */
    const previewConfig = () => window.mahoDesignModePreview ?? null;

    const createElement = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = text;
        }
        return element;
    };

    /**
     * Icons of the preview toolbar only. They stay local to the module instead
     * of borrowing the editor registry: the toolbar speaks its own vocabulary
     * (reload, devices, popout) and the module keeps working on a theme that
     * ships a different icon set.
     */
    const PREVIEW_ICONS = {
        reload: '<path d="M20 11a8 8 0 1 0 -2.34 5.66"/><path d="M20 4v7h-7"/>',
        stop: '<path d="M6 6l12 12"/><path d="M18 6l-12 12"/>',
        go: '<path d="M5 12l13 0"/><path d="M12 6l6 6l-6 6"/>',
        popout: '<path d="M13 5h6v6"/><path d="M19 5l-8 8"/><path d="M18 14v4a2 2 0 0 1 -2 2h-9a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2h4"/>',
        sync: '<path d="M4 11h13"/><path d="M14 8l3 3l-3 3"/><path d="M20 13h-13"/><path d="M10 16l-3 -3l3 -3"/>',
        desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8"/><path d="M12 16v4"/>',
        tablet: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 17v.01"/>',
        mobile: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18v.01"/>',
    };

    const previewIcon = (name) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (PREVIEW_ICONS[name] ?? '') + '</svg>';

    /**
     * The status line only speaks when there is something to say: a page that
     * rendered in place needs no confirmation, the preview itself is the answer.
     * Loading is not one of those: the reload icon spins the way a browser does.
     */
    const previewStatus = (setup, state, key) => {
        const labels = {
            loading: '',
            placed: '',
            error: 'The preview could not be rendered',
        };
        const label = labels[key] ?? key;
        state.status.textContent = label === '' ? '' : translate(setup, label);
        state.status.dataset.state = key;
        state.status.hidden = state.status.textContent === '';
        if (state.reloadButton) {
            const busy = key === 'loading';
            state.reloadButton.innerHTML = previewIcon(busy ? 'stop' : 'reload');
            state.reloadButton.title = translate(setup, busy ? 'Cancel loading' : 'Reload the page and initialize its components');
            state.reloadButton.setAttribute('aria-label', translate(setup, busy ? 'Cancel loading' : 'Reload'));
            state.reloadButton.setAttribute('aria-busy', busy ? 'true' : 'false');
        }
    };

    const previewStoreUrl = (storeId) => {
        const config = previewConfig();
        const store = config?.stores?.find((item) => item.id === storeId);
        if (!store) {
            return config?.defaultUrl ?? '';
        }
        return store.baseUrl + (config.pagePath ?? '');
    };

    /**
     * The framed page carries the token that lets the observer take the content
     * being edited from the POST that opened it instead of the saved copy.
     */
    const previewUrl = (state) => {
        const config = previewConfig();
        let url;
        try {
            url = new URL(state.url, window.location.href);
        } catch (error) {
            url = new URL(config?.defaultUrl ?? window.location.href, window.location.href);
        }
        if (config?.previewParam) {
            url.searchParams.delete(config.previewParam);
            if (config.token) {
                url.searchParams.set(config.previewParam, config.token);
            }
        }
        url.searchParams.set('_mmts', String(Date.now()));
        return url.toString();
    };

    /**
     * The page in the preview cannot receive the content: the store home answers
     * GET only and redirects a POST before the request reaches the block, and a
     * GET cannot carry a page of HTML. The draft is therefore left in the cache
     * under the preview token by the admin, and the storefront reads it while it
     * renders: the page still arrives complete, with the theme's own init.
     */
    const postDraft = (setup, state, html, loaded) => {
        const config = previewConfig();
        if (!config?.draftUrl) {
            state.inFlight = false;
            previewStatus(setup, state, 'error');
            return;
        }

        const controller = new AbortController();
        state.abort = controller;
        fetch(config.draftUrl, {
            method: 'POST',
            body: previewPost({ token: config.token, html }),
            credentials: 'same-origin',
            signal: controller.signal,
        })
            .then((response) => {
                if (state.abort !== controller) {
                    return;
                }
                state.abort = null;
                if (!response.ok) {
                    throw new Error('draft rejected');
                }
                loaded();
            })
            .catch(() => {
                if (controller.signal.aborted) {
                    return;
                }
                state.abort = null;
                state.inFlight = false;
                previewStatus(setup, state, 'error');
            });
    };

    const submitPreview = (setup, state) => {
        window.clearTimeout(state.timer);
        state.lastSent = state.pending ?? state.lastSent ?? '';
        state.pending = null;
        state.inFlight = true;
        previewStatus(setup, state, 'loading');
        postDraft(setup, state, state.lastSent, () => {
            state.frame.src = previewUrl(state);
        });
    };

    /**
     * The reload control turns into a stop while a page is loading: the request
     * for the draft is aborted and the frame stops where it is, leaving the
     * previous page in place instead of a half-empty one.
     */
    const cancelPreview = (setup, state) => {
        window.clearTimeout(state.timer);
        state.timer = null;
        state.pending = null;
        if (state.abort) {
            state.abort.abort();
            state.abort = null;
        }
        try {
            state.frame.contentWindow?.stop();
        } catch (error) {
            // A blank or cross-origin window has nothing to stop.
        }
        state.inFlight = false;
        previewStatus(setup, state, 'placed');
    };

    /**
     * One request at a time, never a queue: while a page is loading the editor
     * keeps overwriting the pending content, and on load only the last one is
     * sent — and only if it differs from the one that is already rendered.
     */
    const scheduleRender = (setup, state) => {
        state.pending = editorHtml(setup);
        if (state.inFlight || state.pending === state.lastSent) {
            return;
        }
        window.clearTimeout(state.timer);
        state.timer = window.setTimeout(() => {
            if (!state.inFlight && state.pending !== null && state.pending !== state.lastSent) {
                submitPreview(setup, state);
            }
        }, PREVIEW_RENDER_DELAY);
    };

    /**
     * A page load together with the content: the draft is stored first, then the
     * frame is pointed at the page, which reads it while rendering.
     */
    const navigatePreview = (setup, state) => {
        state.pending = editorHtml(setup);
        state.lastSent = null;
        submitPreview(setup, state);
    };

    const applyDevice = (state) => {
        const width = Number(state.deviceWidth);
        const available = Math.max(160, state.stage.clientWidth - 24);
        const height = Math.max(240, state.stage.clientHeight - 24);
        const scale = Math.min(1, available / width);
        state.frame.style.width = width + 'px';
        state.frame.style.height = Math.round(height / scale) + 'px';
        state.frame.style.transform = 'translateX(-50%) scale(' + scale.toFixed(3) + ')';
        state.deviceButtons.forEach((button, name) => {
            const active = name === state.device;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    };

    /**
     * An admin POST body carries the form key: the admin controller refuses a
     * POST without it even when the secret key in the URL is valid.
     */
    const previewPost = (fields) => {
        const body = new FormData();
        Object.entries(fields).forEach(([key, value]) => body.append(key, String(value)));
        if (typeof window.FORM_KEY === 'string') {
            body.append('form_key', window.FORM_KEY);
        }
        return body;
    };

    /**
     * The editor keeps every directive it cannot model in a data-directive
     * attribute; the save path turns them back into the plain text the CMS
     * filter expects. Posting the raw editor HTML instead would hand the filter
     * an attribute to fill with markup, and the browser truncates the element
     * it is injected into. The preview must post the same form that gets saved.
     */
    const editorHtml = (setup) => {
        const html = setup.editor.getHTML();

        return typeof setup.convertToPlain === 'function' ? setup.convertToPlain(html) : html;
    };

    /**
     * A frame without a document yet fires a load event for the empty page:
     * clearing the in-flight flag there would let a second POST start while the
     * first one is still loading.
     */
    const isBlankWindow = (frameWindow) => {
        try {
            return frameWindow?.location?.href === 'about:blank';
        } catch (error) {
            // Another origin: it is a real page
            return false;
        }
    };

    /**
     * The preview browses like the storefront: a click follows the link inside the
     * frame, so the address field follows the frame instead of staying on the
     * first page. Reload then re-applies the draft to the page in view.
     */
    const syncPreviewUrl = (state, frameWindow) => {
        let href;
        try {
            href = frameWindow?.location?.href;
        } catch (error) {
            return;
        }
        if (typeof href !== 'string' || href === '' || href === 'about:blank') {
            return;
        }
        try {
            const url = new URL(href);
            url.searchParams.delete('_mmts');
            const config = previewConfig();
            if (config?.previewParam) {
                url.searchParams.delete(config.previewParam);
            }
            state.url = url.toString();
        } catch (error) {
            state.url = href;
        }
        state.urlInput.value = state.url;
    };

    const openPopout = (setup, state) => {
        const popout = window.open('', state.windowName);
        if (!popout) {
            previewStatus(setup, state, 'error');
            return;
        }
        state.popout = popout;
        postDraft(setup, state, editorHtml(setup), () => {
            popout.location.href = previewUrl(state);
        });
    };

    const bindSplitter = (setup, state) => {
        const splitter = state.splitter;
        const setWidth = (percent) => {
            const clamped = Math.min(75, Math.max(20, percent));
            setup.wrapper.style.setProperty('--maho-preview-width', clamped.toFixed(2) + '%');
            applyDevice(state);
        };
        let dragging = false;
        splitter.addEventListener('pointerdown', (event) => {
            dragging = true;
            splitter.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        splitter.addEventListener('pointermove', (event) => {
            if (!dragging) {
                return;
            }
            const rect = setup.wrapper.getBoundingClientRect();
            if (rect.width === 0) {
                return;
            }
            setWidth(((rect.right - event.clientX) / rect.width) * 100);
        });
        const stop = (event) => {
            if (!dragging) {
                return;
            }
            dragging = false;
            if (splitter.hasPointerCapture(event.pointerId)) {
                splitter.releasePointerCapture(event.pointerId);
            }
            const value = parseFloat(setup.wrapper.style.getPropertyValue('--maho-preview-width'));
            try {
                localStorage.setItem(PREVIEW_WIDTH_KEY, String(Number.isFinite(value) ? value : 45));
            } catch (error) {
                // Storage can be disabled by the browser
            }
        };
        splitter.addEventListener('pointerup', stop);
        splitter.addEventListener('pointercancel', stop);
        splitter.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                return;
            }
            event.preventDefault();
            const current = parseFloat(setup.wrapper.style.getPropertyValue('--maho-preview-width'));
            setWidth((Number.isFinite(current) ? current : 45) + (event.key === 'ArrowLeft' ? 2 : -2));
        });
    };

    /**
     * The element that scrolls the editor: the first ancestor of the content
     * that really overflows, since the editor wrapper itself does not.
     */
    const editorScroller = (setup) => {
        let element = setup.wrapper.querySelector('.ProseMirror');
        while (element && element !== setup.wrapper) {
            const overflow = window.getComputedStyle(element).overflowY;
            if ((overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight) {
                return element;
            }
            element = element.parentElement;
        }

        return setup.wrapper.querySelector('.tiptap-content') ?? null;
    };

    const scrollRatio = (element) => {
        const max = element.scrollHeight - element.clientHeight;

        return max > 0 ? Math.min(1, Math.max(0, element.scrollTop / max)) : 0;
    };

    /**
     * Position and height of the previewed block inside the framed page: the
     * header and the footer around it have no counterpart in the editor, so the
     * two panes can only share the block.
     *
     * @returns {{ top: number, height: number } | null}
     */
    const previewBlockBox = (doc) => {
        const block = doc.querySelector('[data-mm-design-target], [data-mm-design-fallback]')
            ?? doc.querySelector('.col-main, #main-content, main, .main');
        if (!block) {
            return null;
        }

        let top = 0;
        let node = block;
        while (node) {
            top += node.offsetTop || 0;
            node = node.offsetParent;
        }

        return { top, height: block.offsetHeight };
    };

    /**
     * Keeps the two panes on the same passage. The mapping is proportional
     * inside the previewed block: the editor and the rendered page do not agree
     * on line heights, so anchoring single elements would drift apart.
     */
    const bindScrollSync = (setup, state) => {
        state.syncCleanup?.();
        state.syncCleanup = null;

        const frameWindow = state.frame.contentWindow;
        const doc = frameWindow?.document;
        const editor = editorScroller(setup);
        if (!frameWindow || !doc || !editor) {
            return;
        }

        let locked = false;
        const lock = () => {
            locked = true;
            window.setTimeout(() => {
                locked = false;
            }, 120);
        };

        const scrollFrameTo = (ratio) => {
            const view = doc.scrollingElement ?? doc.documentElement;
            const box = previewBlockBox(doc);
            if (!box) {
                view.scrollTop = ratio * Math.max(0, view.scrollHeight - view.clientHeight);
                return;
            }
            const span = Math.max(0, box.height - frameWindow.innerHeight);
            view.scrollTop = box.top + ratio * span;
        };

        const ratioInFrame = () => {
            const view = doc.scrollingElement ?? doc.documentElement;
            const box = previewBlockBox(doc);
            if (!box) {
                const max = view.scrollHeight - view.clientHeight;
                return max > 0 ? Math.min(1, Math.max(0, view.scrollTop / max)) : 0;
            }
            const span = Math.max(1, box.height - frameWindow.innerHeight);

            return Math.min(1, Math.max(0, (view.scrollTop - box.top) / span));
        };

        const onEditorScroll = () => {
            if (locked || !state.syncEnabled) {
                return;
            }
            lock();
            scrollFrameTo(scrollRatio(editor));
        };

        const onFrameScroll = () => {
            if (locked || !state.syncEnabled) {
                return;
            }
            lock();
            const max = editor.scrollHeight - editor.clientHeight;
            editor.scrollTop = ratioInFrame() * Math.max(0, max);
        };

        editor.addEventListener('scroll', onEditorScroll, { passive: true });
        frameWindow.addEventListener('scroll', onFrameScroll, { passive: true });
        state.syncCleanup = () => {
            editor.removeEventListener('scroll', onEditorScroll);
            frameWindow.removeEventListener('scroll', onFrameScroll);
        };
    };

    const ensurePreview = (setup) => {
        const config = previewConfig();
        const state = setup.mahoDesignMode;
        if (!config?.entity || !state) {
            return null;
        }
        if (state.preview) {
            return state.preview;
        }

        const aside = createElement('aside', PREVIEW_CLASS);
        aside.setAttribute('aria-label', translate(setup, 'Preview'));

        // The framed window and the popup are two separate targets; the name is
        // unique per editor instance.
        const windowName = PREVIEW_WINDOW_NAME + '-' + (++previewSequence);
        const frameName = windowName + '-frame';

        const bar = createElement('div', PREVIEW_CLASS + '-bar');
        const storeLabel = createElement('label', PREVIEW_CLASS + '-store', translate(setup, 'Store'));
        const storeSelect = document.createElement('select');
        // Same shape as the system configuration select: one optgroup per
        // website, so "English" on two websites is still two distinct entries.
        const storeGroups = new Map();
        for (const store of config.stores ?? []) {
            const groupKey = String(store.websiteId ?? store.website ?? '');
            if (!storeGroups.has(groupKey)) {
                const group = document.createElement('optgroup');
                group.label = store.website || store.name;
                storeGroups.set(groupKey, group);
                storeSelect.appendChild(group);
            }
            const option = document.createElement('option');
            option.value = String(store.id);
            option.textContent = store.name;
            option.selected = store.id === config.storeId;
            storeGroups.get(groupKey).appendChild(option);
        }
        storeLabel.appendChild(storeSelect);
        bar.appendChild(storeLabel);

        const devices = createElement('div', PREVIEW_CLASS + '-devices');
        const deviceButtons = new Map();
        for (const [name, width] of PREVIEW_DEVICES) {
            const button = createElement('button', PREVIEW_CLASS + '-device');
            button.type = 'button';
            button.innerHTML = previewIcon(name);
            button.dataset.width = String(width);
            button.title = translate(setup, name) + ' · ' + width + 'px';
            button.setAttribute('aria-label', button.title);
            devices.appendChild(button);
            deviceButtons.set(name, button);
        }
        bar.appendChild(devices);

        const syncButton = createElement('button', PREVIEW_CLASS + '-action');
        syncButton.type = 'button';
        syncButton.innerHTML = previewIcon('sync');
        syncButton.title = translate(setup, 'Sync scroll');
        syncButton.setAttribute('aria-label', translate(setup, 'Sync scroll'));
        bar.appendChild(syncButton);

        const popoutButton = createElement('button', PREVIEW_CLASS + '-action');
        popoutButton.type = 'button';
        popoutButton.innerHTML = previewIcon('popout');
        popoutButton.title = translate(setup, 'Open in window');
        popoutButton.setAttribute('aria-label', translate(setup, 'Open in window'));
        bar.appendChild(popoutButton);
        aside.appendChild(bar);

        // Second row of the same band, laid out like a browser: the reload sits
        // before the address, then the address itself, the action that opens it
        // and, in closing, the state of the preview.
        const urlBar = createElement('div', PREVIEW_CLASS + '-url');
        const reloadButton = createElement('button', PREVIEW_CLASS + '-action');
        reloadButton.type = 'button';
        reloadButton.innerHTML = previewIcon('reload');
        reloadButton.title = translate(setup, 'Reload the page and initialize its components');
        reloadButton.setAttribute('aria-label', translate(setup, 'Reload'));
        urlBar.appendChild(reloadButton);

        const urlInput = document.createElement('input');
        urlInput.type = 'url';
        urlInput.value = config.defaultUrl ?? '';
        urlInput.setAttribute('aria-label', translate(setup, 'Preview URL'));
        urlBar.appendChild(urlInput);

        const goButton = createElement('button', PREVIEW_CLASS + '-action');
        goButton.type = 'button';
        goButton.innerHTML = previewIcon('go');
        goButton.title = translate(setup, 'Open');
        goButton.setAttribute('aria-label', translate(setup, 'Open'));
        urlBar.appendChild(goButton);

        aside.appendChild(urlBar);

        const status = createElement('div', PREVIEW_CLASS + '-status');
        urlBar.appendChild(status);

        const stage = createElement('div', PREVIEW_CLASS + '-stage');
        const frame = document.createElement('iframe');
        frame.className = PREVIEW_CLASS + '-frame';
        frame.title = translate(setup, 'Preview');
        frame.setAttribute('name', frameName);
        stage.appendChild(frame);
        aside.appendChild(stage);

        const splitter = createElement('div', 'maho-design-splitter');
        splitter.setAttribute('role', 'separator');
        splitter.setAttribute('aria-orientation', 'vertical');
        splitter.setAttribute('aria-label', translate(setup, 'Resize the preview'));
        splitter.tabIndex = 0;

        let syncEnabled = true;
        try {
            syncEnabled = localStorage.getItem(PREVIEW_SYNC_KEY) !== '0';
        } catch (error) {
            // Storage can be disabled by the browser
        }

        const preview = {
            aside,
            splitter,
            frame,
            frameName,
            windowName,
            stage,
            status,
            urlInput,
            reloadButton,
            deviceButtons,
            syncButton,
            syncEnabled,
            syncCleanup: null,
            device: 'desktop',
            deviceWidth: 1280,
            storeId: config.storeId,
            url: config.defaultUrl ?? '',
            pending: null,
            lastSent: null,
            inFlight: false,
            abort: null,
            timer: null,
            onUpdate: null,
            popout: null,
            resizeObserver: null,
        };
        state.preview = preview;

        deviceButtons.forEach((button, name) => {
            button.addEventListener('click', () => {
                preview.device = name;
                preview.deviceWidth = Number(button.dataset.width);
                applyDevice(preview);
            });
        });
        popoutButton.addEventListener('click', () => openPopout(setup, preview));
        goButton.addEventListener('click', () => {
            if (preview.inFlight) {
                return;
            }
            preview.url = urlInput.value.trim() || config.defaultUrl || '';
            navigatePreview(setup, preview);
        });
        urlInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                goButton.click();
            }
        });
        storeSelect.addEventListener('change', () => {
            preview.storeId = Number(storeSelect.value);
            preview.url = previewStoreUrl(preview.storeId);
            urlInput.value = preview.url;
            navigatePreview(setup, preview);
        });

        const paintSyncButton = () => {
            syncButton.setAttribute('aria-pressed', preview.syncEnabled ? 'true' : 'false');
            syncButton.classList.toggle('is-active', preview.syncEnabled);
        };
        paintSyncButton();
        // The preview is a page load already, so this is the "send it again"
        // action: it re-posts the current content to a fresh page.
        reloadButton.addEventListener('click', () => {
            if (preview.inFlight) {
                cancelPreview(setup, preview);
                return;
            }
            navigatePreview(setup, preview);
        });
        syncButton.addEventListener('click', () => {
            preview.syncEnabled = !preview.syncEnabled;
            paintSyncButton();
            try {
                localStorage.setItem(PREVIEW_SYNC_KEY, preview.syncEnabled ? '1' : '0');
            } catch (error) {
                // Storage can be disabled by the browser
            }
        });

        let stored = 45;
        try {
            const saved = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
            if (Number.isFinite(saved) && saved >= 20 && saved <= 75) {
                stored = saved;
            }
        } catch (error) {
            // Storage can be disabled by the browser
        }
        setup.wrapper.style.setProperty('--maho-preview-width', stored + '%');

        frame.addEventListener('load', () => {
            const frameWindow = preview.frame.contentWindow;
            if (isBlankWindow(frameWindow)) {
                return;
            }
            preview.inFlight = false;
            previewStatus(setup, preview, 'placed');
            applyDevice(preview);
            bindScrollSync(setup, preview);
            syncPreviewUrl(preview, frameWindow);
            if (preview.pending !== null && preview.pending !== preview.lastSent) {
                submitPreview(setup, preview);
            }
        });

        setup.wrapper.appendChild(splitter);
        setup.wrapper.appendChild(aside);
        setup.wrapper.classList.add(PREVIEW_OPEN_CLASS);
        preview.resizeObserver = new ResizeObserver(() => applyDevice(preview));
        preview.resizeObserver.observe(stage);
        bindSplitter(setup, preview);
        applyDevice(preview);

        preview.onUpdate = () => scheduleRender(setup, preview);
        setup.editor.on('update', preview.onUpdate);

        return preview;
    };

    const closePreview = (setup) => {
        const state = setup.mahoDesignMode;
        const preview = state?.preview;
        if (!preview) {
            return;
        }
        window.clearTimeout(preview.timer);
        preview.resizeObserver?.disconnect();
        preview.syncCleanup?.();
        preview.syncCleanup = null;
        if (preview.onUpdate) {
            setup.editor.off('update', preview.onUpdate);
        }
        preview.aside.remove();
        preview.splitter.remove();
        setup.wrapper.classList.remove(PREVIEW_OPEN_CLASS);
        setup.wrapper.style.removeProperty('--maho-preview-width');
        state.preview = null;
    };

    const enter = (setup) => {
        const state = setup.mahoDesignMode;
        if (!state) {
            return;
        }
        const content = setup.wrapper.querySelector('.tiptap-content');
        const scrollTop = content ? content.scrollTop : 0;
        ensureRail(setup);
        const preview = ensurePreview(setup);
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
        if (preview) {
            // The pane had no size while the wrapper was still inside the tab
            applyDevice(preview);
            navigatePreview(setup, preview);
        }
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
        closePreview(setup);
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
