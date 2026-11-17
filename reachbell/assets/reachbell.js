var ReachBellBundle = (function (exports) {
    'use strict';

    /**
     * ReachBell official SDK.
     *
     *   import { ReachBell } from '@reachbell/sdk';
     *   ReachBell.init({ apiKey: 'rb_live_…' });
     *   await ReachBell.prompt();              // shows the configured opt-in prompt
     *   const r = await ReachBell.identify('user_42');
     *   if (!r.ok) console.warn(r.reason);
     *
     * The SDK auto-loads the service worker (reachbell-sw.js) and bridges
     * configuration from the server (GET /projects/context) — including the
     * dashboard-configured prompt UI.
     *
     * Design notes
     * ─────────────
     *   - init() is idempotent. A second call is a no-op unless `force:true`.
     *   - Every fetch is wrapped in a 10s AbortController budget so a hung
     *     network never deadlocks the bootstrap chain.
     *   - prompt() returns a discriminated SubscribeResult — it never throws
     *     for any failure mode the API contract acknowledges. SW-register and
     *     pushManager.subscribe() rejections are mapped to specific reasons.
     *   - Custom prompt UI is built via imperative DOM (element.style.X = v)
     *     instead of innerHTML with inline `style="…"` attributes, so it
     *     renders cleanly under `Content-Security-Policy: style-src 'self'`
     *     without needing 'unsafe-inline'.
     *   - The subscription token is mirrored in memory so identify()/tag()
     *     keep working through a Safari private-mode storage failure.
     *   - The class instance is exposed both as a named export and on
     *     `window.ReachBell` so theme + plugin integrations on WordPress
     *     end up sharing one client.
     */
    const PROMPT_PLACEMENTS = [
        'center-modal', 'top-bar', 'top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right',
    ];
    const PROMPT_ALIASES = {
        center: 'center-modal',
        centre: 'center-modal',
        middle: 'center-modal',
        modal: 'center-modal',
        'centre-modal': 'center-modal',
        'center-center': 'center-modal',
        banner: 'top-bar',
        top: 'top-center',
        bottom: 'bottom-center',
        left: 'bottom-left',
        right: 'bottom-right',
    };
    function resolvePromptPlacement(raw) {
        var _a;
        if (typeof raw !== 'string')
            return 'bottom-center';
        const key = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
        if (PROMPT_PLACEMENTS.includes(key))
            return key;
        return (_a = PROMPT_ALIASES[key]) !== null && _a !== void 0 ? _a : 'bottom-center';
    }
    function promptCapAllows(shownAt, now, cap) {
        var _a;
        const maxShows = cap === null || cap === void 0 ? void 0 : cap.maxShows;
        if (typeof maxShows !== 'number' || maxShows <= 0)
            return true;
        const periodMs = Math.max(0, (_a = cap === null || cap === void 0 ? void 0 : cap.periodDays) !== null && _a !== void 0 ? _a : 0) * 86400000;
        const recent = periodMs > 0 ? shownAt.filter(time => now - time < periodMs) : shownAt;
        return recent.length < maxShows;
    }
    const TOKEN_KEY = 'reachbell_token';
    const PROMPT_SHOWS_KEY = 'reachbell_prompt_shows';
    const NOTIFICATION_HISTORY = 'reachbell_notif_history';
    const DEFAULT_API_URL = 'https://api.reachbell.com';
    const DEFAULT_SW_PATH = '/reachbell-sw.js';
    const DEFAULT_TIMEOUT_MS = 10000;
    /**
     * Brand primary — canonical ReachBell blue (`brand-600`). Source of
     * truth: BRAND.md at the repo root + tailwind config in the marketing
     * site. Do NOT drift toward Tailwind's default indigo `#6366f1` — that
     * shifts purple and clashes with the rest of the surfaces.
     */
    const DEFAULT_ACCENT = '#2563EB';
    const DEFAULT_TITLE = 'Stay in the loop';
    const DEFAULT_ACCEPT = 'Allow';
    const DEFAULT_DECLINE = 'Not now';
    /* ─── Pure helpers — exported for testability ─────────────────── */
    /** Escape the 5 HTML chars that matter inside element bodies + attribute values. */
    function escapeHtml(s) {
        return s.replace(/[&<>"']/g, c => { var _a; return (_a = ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]) !== null && _a !== void 0 ? _a : c; });
    }
    /**
     * Accept only well-formed CSS colour strings before applying them to an
     * `element.style.X` property. Anything else falls back to the default.
     *
     * Server-controlled values (the dashboard's promptConfig.accentColor)
     * route through here so a compromised admin can't inject extra CSS
     * properties / pseudo-element overlays / `javascript:` URLs.
     */
    function safeColor(input, fallback) {
        if (typeof input !== 'string')
            return fallback;
        // hex: #abc, #aabbcc, #aabbccdd (with optional alpha)
        if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(input))
            return input;
        // rgb/rgba/hsl/hsla with conservative char set — no quotes, parens, semis, url()
        if (/^(?:rgb|hsl)a?\(\s*[\d.\s,%/-]+\s*\)$/i.test(input))
            return input;
        return fallback;
    }
    /**
     * Decode the URL-safe base64 VAPID public key into a Uint8Array backed by
     * a real ArrayBuffer (not ArrayBufferLike) so it satisfies BufferSource
     * under TS ≥5.7 strict typing.
     */
    function urlBase64ToUint8Array(base64) {
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(b64);
        const buffer = new ArrayBuffer(raw.length);
        const arr = new Uint8Array(buffer);
        for (let i = 0; i < raw.length; i++)
            arr[i] = raw.charCodeAt(i);
        return arr;
    }
    const DAY_MS = 86400000;
    const SESSION_SHOWS_KEY = 'reachbell_prompt_session_shows';
    const ENDPOINT_KEY = 'reachbell_endpoint';
    const SW_ACTIVATE_TIMEOUT_MS = 10000;
    function promptFrequencyAllows(history, now, cfg) {
        var _a;
        const frequency = cfg === null || cfg === void 0 ? void 0 : cfg.frequency;
        if (frequency && typeof frequency === 'object') {
            const max = frequency.maxPerSession;
            if (typeof max === 'number' && max > 0 && history.sessionShows >= max)
                return false;
            const cooldownMs = Math.max(0, (_a = frequency.cooldownDays) !== null && _a !== void 0 ? _a : 0) * DAY_MS;
            if (history.sessionShows === 0 && cooldownMs > 0 && history.lastShownAt !== null && now - history.lastShownAt < cooldownMs) {
                return false;
            }
            return true;
        }
        return promptCapAllows(history.shownAt, now, cfg === null || cfg === void 0 ? void 0 : cfg.frequencyCap);
    }
    function widgetEnabled(layout) {
        return !!layout && typeof layout === 'object' && layout.enabled === true;
    }
    function safeUrl(raw) {
        if (typeof raw !== 'string' || !raw.trim())
            return null;
        try {
            const base = typeof window !== 'undefined' ? window.location.href : 'https://localhost/';
            const url = new URL(raw.trim(), base);
            return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
        }
        catch (_a) {
            return null;
        }
    }
    function safeBackground(input, fallback) {
        if (typeof input !== 'string')
            return fallback;
        if (safeColor(input, '') === input)
            return input;
        if (/^(?:linear|radial)-gradient\([#\w\s.,%()-]+\)$/i.test(input) && !/url\s*\(/i.test(input))
            return input;
        return fallback;
    }
    function normalizeApiUrl(raw) {
        return raw.trim().replace(/\/+$/, '');
    }
    function scrollProgress(scrollTop, scrollHeight, viewportHeight) {
        const max = scrollHeight - viewportHeight;
        if (max <= 0)
            return 100;
        return Math.min(100, Math.max(0, (scrollTop / max) * 100));
    }
    function sameApplicationServerKey(current, publicKey) {
        if (!current)
            return true;
        const expected = urlBase64ToUint8Array(publicKey);
        const actual = new Uint8Array(current);
        if (actual.length !== expected.length)
            return false;
        return actual.every((byte, index) => byte === expected[index]);
    }
    /* ─── Client ──────────────────────────────────────────────────── */
    class ReachBellClient {
        constructor() {
            this.config = null;
            this.promptConfig = null;
            this.serverContext = null;
            this.swReg = null;
            this.bootstrapping = null;
            this.prompting = null;
            this.closeActivePrompt = null;
            this.cleanups = {};
            this.swListenerInstalled = false;
            this.warned = false;
            this.token = null;
        }
        init(config) {
            if (this.config && !config.force) {
                this.log('init() called twice — ignoring. Pass force:true to override.');
                return;
            }
            if (this.config)
                this.reset();
            this.config = {
                apiUrl: DEFAULT_API_URL,
                swPath: DEFAULT_SW_PATH,
                autoPrompt: false,
                debug: false,
                ...config,
            };
            this.config.apiUrl = normalizeApiUrl(this.config.apiUrl || DEFAULT_API_URL);
            this.config.swPath = this.config.swPath || DEFAULT_SW_PATH;
            this.log('Initialized', this.config);
            this.bootstrapping = this.bootstrap();
            void this.bootstrapping;
        }
        /** Resolves once the boot chain (context + SW registration) has settled. */
        get ready() {
            var _a;
            return (_a = this.bootstrapping) !== null && _a !== void 0 ? _a : Promise.reject(new Error('Call ReachBell.init() first'));
        }
        reset() {
            var _a;
            Object.values(this.cleanups).forEach(cleanup => cleanup());
            this.cleanups = {};
            (_a = this.closeActivePrompt) === null || _a === void 0 ? void 0 : _a.call(this);
            this.promptConfig = null;
            this.serverContext = null;
            this.swReg = null;
            this.prompting = null;
            this.token = null;
        }
        async bootstrap() {
            var _a, _b;
            if (typeof window === 'undefined')
                return;
            try {
                await this.loadContext();
            }
            catch (e) {
                this.warnOnce('Could not load ReachBell settings — push notifications will not work on this page', e);
                return;
            }
            try {
                this.mountLayouts((_b = (_a = this.serverContext) === null || _a === void 0 ? void 0 : _a.customLayouts) !== null && _b !== void 0 ? _b : {});
            }
            catch (e) {
                this.log('In-page widgets failed', e);
            }
            try {
                await this.registerServiceWorker();
            }
            catch (e) {
                this.warnOnce('Service worker registration failed — push notifications will not work on this page', e);
            }
            try {
                this.armPromptUi();
            }
            catch (e) {
                this.log('Prompt setup failed', e);
            }
            await this.syncSubscription();
        }
        async loadContext() {
            var _a;
            const ctx = await this.fetchContext();
            this.serverContext = ctx;
            this.promptConfig = (_a = ctx === null || ctx === void 0 ? void 0 : ctx.promptConfig) !== null && _a !== void 0 ? _a : null;
        }
        mountLayouts(layouts) {
            const banner = layouts === null || layouts === void 0 ? void 0 : layouts.banner;
            if (widgetEnabled(banner)) {
                const title = banner.message || banner.title || banner.headline;
                if (title) {
                    this.showBanner({
                        title,
                        body: banner.highlightText || banner.secondaryText || banner.body || '',
                        ctaText: banner.showCta !== false ? banner.ctaText || undefined : undefined,
                        url: banner.ctaUrl || banner.url,
                        position: banner.position === 'bottom' ? 'bottom' : 'top',
                        backgroundColor: banner.backgroundColor,
                        textColor: banner.textColor,
                        dismissible: banner.dismissible !== false,
                        duration: banner.duration,
                    });
                }
            }
            const notifCenter = layouts === null || layouts === void 0 ? void 0 : layouts.notificationCenter;
            if (widgetEnabled(notifCenter)) {
                this.showNotificationCenter({
                    position: notifCenter.position,
                    accentColor: notifCenter.accentColor,
                    title: notifCenter.title,
                    maxItems: notifCenter.maxItems,
                });
            }
            const toast = layouts === null || layouts === void 0 ? void 0 : layouts.toast;
            if (widgetEnabled(toast)) {
                const title = toast.title || toast.message;
                if (title) {
                    const delaySec = typeof toast.delaySeconds === 'number' ? toast.delaySeconds : 2;
                    const timer = setTimeout(() => {
                        this.showToast({
                            title,
                            body: toast.title ? toast.message || toast.body : toast.body,
                            url: toast.actionUrl || toast.url,
                            accentColor: toast.accentColor,
                            position: toast.position,
                            duration: typeof toast.duration === 'number' ? toast.duration : 6000,
                            ctaText: toast.showCtaButton !== false ? toast.ctaText || undefined : undefined,
                        });
                    }, Math.max(0, delaySec * 1000));
                    this.cleanups.layoutToast = () => clearTimeout(timer);
                }
            }
        }
        isBellWidget(cfg) {
            var _a;
            return (cfg === null || cfg === void 0 ? void 0 : cfg.type) === 'bell_widget' || ((_a = cfg === null || cfg === void 0 ? void 0 : cfg.bellWidget) === null || _a === void 0 ? void 0 : _a.enabled) === true;
        }
        armPromptUi() {
            var _a, _b;
            const cfg = this.promptConfig;
            if (!cfg || cfg.enabled !== true)
                return;
            if (this.isBellWidget(cfg)) {
                this.mountBellWidget(cfg);
                return;
            }
            const autoPrompt = ((_a = this.config) === null || _a === void 0 ? void 0 : _a.autoPrompt) === true || ((_b = this.config) === null || _b === void 0 ? void 0 : _b.autoPrompt) === undefined;
            if (!autoPrompt)
                return;
            if (typeof Notification === 'undefined' || Notification.permission !== 'default')
                return;
            const fire = () => {
                if (Notification.permission !== 'default')
                    return;
                if (!promptFrequencyAllows(this.readPromptHistory(), Date.now(), cfg))
                    return;
                void this.prompt();
            };
            const trigger = cfg.type === 'native' ? () => this.armAutoPromptOnGesture(fire) : fire;
            this.afterPromptTriggers(cfg, trigger);
        }
        afterPromptTriggers(cfg, run) {
            const delayMs = Math.max(0, (typeof cfg.delay === 'number' ? cfg.delay : 1) * 1000);
            const percent = typeof cfg.scrollPercent === 'number' ? Math.min(100, Math.max(0, cfg.scrollPercent)) : 0;
            let removeScroll = null;
            const timer = setTimeout(() => {
                if (percent <= 0) {
                    run();
                    return;
                }
                const check = () => {
                    const doc = document.documentElement;
                    if (scrollProgress(window.scrollY || doc.scrollTop, doc.scrollHeight, window.innerHeight) < percent)
                        return;
                    removeScroll === null || removeScroll === void 0 ? void 0 : removeScroll();
                    run();
                };
                window.addEventListener('scroll', check, { passive: true });
                removeScroll = () => window.removeEventListener('scroll', check);
                check();
            }, delayMs);
            this.cleanups.promptTrigger = () => {
                clearTimeout(timer);
                removeScroll === null || removeScroll === void 0 ? void 0 : removeScroll();
            };
        }
        readPromptHistory() {
            var _a, _b;
            let shownAt = [];
            try {
                const parsed = JSON.parse((_a = localStorage.getItem(PROMPT_SHOWS_KEY)) !== null && _a !== void 0 ? _a : '[]');
                if (Array.isArray(parsed))
                    shownAt = parsed.filter((item) => typeof item === 'number');
            }
            catch (_c) { }
            let sessionShows = 0;
            try {
                sessionShows = Number((_b = sessionStorage.getItem(SESSION_SHOWS_KEY)) !== null && _b !== void 0 ? _b : 0) || 0;
            }
            catch (_d) { }
            return { sessionShows, lastShownAt: shownAt.length ? Math.max(...shownAt) : null, shownAt };
        }
        recordPromptShow(now) {
            const history = this.readPromptHistory();
            const kept = history.shownAt.filter(time => now - time < 365 * DAY_MS);
            try {
                localStorage.setItem(PROMPT_SHOWS_KEY, JSON.stringify([...kept, now].slice(-50)));
            }
            catch (_a) { }
            try {
                sessionStorage.setItem(SESSION_SHOWS_KEY, String(history.sessionShows + 1));
            }
            catch (_b) { }
        }
        armAutoPromptOnGesture(run) {
            if (typeof document === 'undefined')
                return;
            const events = ['click', 'keydown', 'touchstart'];
            const fire = () => {
                remove();
                run();
            };
            const remove = () => events.forEach(ev => document.removeEventListener(ev, fire));
            events.forEach(ev => document.addEventListener(ev, fire, { passive: true }));
            this.cleanups.gesture = remove;
        }
        /**
         * Shared fetch wrapper. Adds the API key, sets a hard timeout (default
         * 10s), and links any caller-provided AbortSignal so cancellation from
         * either source aborts the fetch.
         */
        async request(path, init = {}, ms = DEFAULT_TIMEOUT_MS) {
            var _a;
            if (!this.config)
                throw new Error('Call ReachBell.init() first');
            const ctrl = new AbortController();
            const outerSignal = init.signal;
            const onOuterAbort = () => ctrl.abort();
            outerSignal === null || outerSignal === void 0 ? void 0 : outerSignal.addEventListener('abort', onOuterAbort, { once: true });
            const timer = setTimeout(() => ctrl.abort(), ms);
            try {
                return await fetch(`${this.config.apiUrl}${path}`, {
                    ...init,
                    signal: ctrl.signal,
                    headers: {
                        'x-api-key': this.config.apiKey,
                        ...((_a = init.headers) !== null && _a !== void 0 ? _a : {}),
                    },
                });
            }
            finally {
                clearTimeout(timer);
                outerSignal === null || outerSignal === void 0 ? void 0 : outerSignal.removeEventListener('abort', onOuterAbort);
            }
        }
        async fetchContext() {
            const res = await this.request('/projects/context');
            if (!res.ok)
                throw new Error(`Failed to fetch ReachBell context (status ${res.status})`);
            return res.json();
        }
        async registerServiceWorker() {
            var _a, _b;
            if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
                this.log('Service workers not supported');
                return;
            }
            const reg = await navigator.serviceWorker.register(this.config.swPath);
            this.swReg = reg;
            this.log('SW registered', reg);
            this.sendWorkerConfig((_b = (_a = reg.active) !== null && _a !== void 0 ? _a : reg.waiting) !== null && _b !== void 0 ? _b : reg.installing);
            void this.activeRegistration().then(active => this.sendWorkerConfig(active === null || active === void 0 ? void 0 : active.active));
            this.listenToWorker();
        }
        sendWorkerConfig(worker) {
            if (!worker || !this.config)
                return;
            try {
                worker.postMessage({ type: 'REACHBELL_CONFIG', apiUrl: this.config.apiUrl });
            }
            catch (_a) { }
        }
        listenToWorker() {
            var _a;
            if (this.swListenerInstalled || !((_a = navigator.serviceWorker) === null || _a === void 0 ? void 0 : _a.addEventListener))
                return;
            this.swListenerInstalled = true;
            navigator.serviceWorker.addEventListener('message', event => {
                var _a, _b, _c;
                const data = event.data;
                if (!data || data.type !== 'REACHBELL_NOTIFICATION' || typeof ((_a = data.notification) === null || _a === void 0 ? void 0 : _a.title) !== 'string')
                    return;
                const n = data.notification;
                this.recordNotification({
                    id: typeof n.id === 'string' ? n.id : undefined,
                    title: n.title,
                    body: typeof n.body === 'string' ? n.body : undefined,
                    url: (_b = safeUrl(n.url)) !== null && _b !== void 0 ? _b : undefined,
                    iconUrl: (_c = safeUrl(n.icon)) !== null && _c !== void 0 ? _c : undefined,
                });
            });
        }
        async activeRegistration() {
            var _a;
            const reg = this.swReg;
            if (!reg)
                return null;
            if (reg.active)
                return reg;
            const worker = (_a = reg.installing) !== null && _a !== void 0 ? _a : reg.waiting;
            if (!worker)
                return null;
            await new Promise(resolve => {
                const done = () => {
                    clearTimeout(timer);
                    worker.removeEventListener('statechange', onChange);
                    resolve();
                };
                const onChange = () => {
                    if (worker.state === 'activated' || worker.state === 'redundant')
                        done();
                };
                const timer = setTimeout(done, SW_ACTIVATE_TIMEOUT_MS);
                worker.addEventListener('statechange', onChange);
                onChange();
            });
            return reg.active ? reg : null;
        }
        async syncSubscription() {
            var _a, _b, _c;
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted')
                return;
            if (!this.swReg || !((_b = (_a = this.serverContext) === null || _a === void 0 ? void 0 : _a.vapidKeys) === null || _b === void 0 ? void 0 : _b.public))
                return;
            try {
                const reg = await this.activeRegistration();
                if (!reg)
                    return;
                const sub = await reg.pushManager.getSubscription();
                const stale = !sub
                    || !sameApplicationServerKey((_c = sub.options) === null || _c === void 0 ? void 0 : _c.applicationServerKey, this.serverContext.vapidKeys.public)
                    || !this.readToken()
                    || this.readEndpoint() !== sub.endpoint;
                if (!stale)
                    return;
                const result = await this.subscribe();
                if (!result.success)
                    this.log('Subscription sync failed', result.reason);
            }
            catch (e) {
                this.log('Subscription sync failed', e);
            }
        }
        async prompt() {
            if (!this.config)
                return { success: false, reason: 'sdk_not_initialized' };
            if (this.bootstrapping) {
                try {
                    await this.bootstrapping;
                }
                catch (_a) { }
            }
            if (this.prompting)
                return this.prompting;
            this.prompting = this.runPrompt().finally(() => { this.prompting = null; });
            return this.prompting;
        }
        async runPrompt() {
            var _a, _b, _c;
            if (typeof window === 'undefined' || !('PushManager' in window) || typeof Notification === 'undefined') {
                return { success: false, reason: 'push_not_supported' };
            }
            if (Notification.permission === 'denied')
                return { success: false, reason: 'permission_denied' };
            if (!this.serverContext) {
                try {
                    await this.loadContext();
                }
                catch (_d) {
                    return { success: false, reason: 'not_ready' };
                }
            }
            if (!((_b = (_a = this.serverContext) === null || _a === void 0 ? void 0 : _a.vapidKeys) === null || _b === void 0 ? void 0 : _b.public))
                return { success: false, reason: 'not_ready' };
            if (!this.swReg) {
                try {
                    await this.registerServiceWorker();
                }
                catch (e) {
                    return { success: false, reason: `sw_register_failed_${(_c = e === null || e === void 0 ? void 0 : e.name) !== null && _c !== void 0 ? _c : 'unknown'}` };
                }
                if (!this.swReg)
                    return { success: false, reason: 'push_not_supported' };
            }
            if (Notification.permission === 'granted')
                return this.subscribe();
            const cfg = this.promptConfig;
            if ((cfg === null || cfg === void 0 ? void 0 : cfg.enabled) === true && cfg.type !== 'native' && !this.isBellWidget(cfg)) {
                this.recordPromptShow(Date.now());
                const accepted = await this.showCustomPrompt(cfg);
                if (!accepted)
                    return { success: false, reason: 'user_declined_soft_prompt' };
            }
            else {
                this.recordPromptShow(Date.now());
            }
            const permission = await Notification.requestPermission();
            if (permission !== 'granted')
                return { success: false, reason: 'permission_denied' };
            return this.subscribe();
        }
        async subscribe() {
            var _a, _b, _c, _d, _e;
            const publicKey = (_b = (_a = this.serverContext) === null || _a === void 0 ? void 0 : _a.vapidKeys) === null || _b === void 0 ? void 0 : _b.public;
            if (!this.swReg || !publicKey)
                return { success: false, reason: 'not_ready' };
            const reg = await this.activeRegistration();
            if (!reg)
                return { success: false, reason: 'sw_not_active' };
            let sub;
            try {
                let existing = await reg.pushManager.getSubscription();
                if (existing && !sameApplicationServerKey((_c = existing.options) === null || _c === void 0 ? void 0 : _c.applicationServerKey, publicKey)) {
                    await existing.unsubscribe();
                    existing = null;
                }
                sub = existing !== null && existing !== void 0 ? existing : await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey),
                });
            }
            catch (e) {
                return { success: false, reason: `push_subscribe_failed_${(_d = e === null || e === void 0 ? void 0 : e.name) !== null && _d !== void 0 ? _d : 'unknown'}` };
            }
            try {
                const res = await this.request('/subscribers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subscription: sub.toJSON(),
                        token: JSON.stringify(sub),
                        tokenType: 'vapid',
                    }),
                });
                if (!res.ok)
                    return { success: false, reason: `subscribe_failed_${res.status}` };
                const data = await res.json();
                const t = (_e = data.token) !== null && _e !== void 0 ? _e : null;
                this.storeToken(t, sub.endpoint);
                return { success: true, token: t !== null && t !== void 0 ? t : undefined };
            }
            catch (e) {
                return { success: false, reason: (e === null || e === void 0 ? void 0 : e.name) === 'AbortError' ? 'timed_out' : 'network_error' };
            }
        }
        async unsubscribe() {
            var _a, _b;
            if (!this.config)
                return { ok: false, reason: 'sdk_not_initialized' };
            try {
                const reg = (_a = this.swReg) !== null && _a !== void 0 ? _a : null;
                const sub = reg ? await reg.pushManager.getSubscription() : null;
                if (sub)
                    await sub.unsubscribe();
                this.storeToken(null, null);
                return { ok: true };
            }
            catch (e) {
                return { ok: false, reason: `unsubscribe_failed_${(_b = e === null || e === void 0 ? void 0 : e.name) !== null && _b !== void 0 ? _b : 'unknown'}` };
            }
        }
        tokenKey() {
            var _a, _b;
            return `${TOKEN_KEY}:${(_b = (_a = this.config) === null || _a === void 0 ? void 0 : _a.apiKey) !== null && _b !== void 0 ? _b : ''}`;
        }
        storeToken(token, endpoint) {
            var _a, _b, _c, _d;
            this.token = token;
            try {
                if (token)
                    localStorage.setItem(this.tokenKey(), token);
                else
                    localStorage.removeItem(this.tokenKey());
                if (endpoint)
                    localStorage.setItem(`${ENDPOINT_KEY}:${(_b = (_a = this.config) === null || _a === void 0 ? void 0 : _a.apiKey) !== null && _b !== void 0 ? _b : ''}`, endpoint);
                else
                    localStorage.removeItem(`${ENDPOINT_KEY}:${(_d = (_c = this.config) === null || _c === void 0 ? void 0 : _c.apiKey) !== null && _d !== void 0 ? _d : ''}`);
                localStorage.removeItem(TOKEN_KEY);
            }
            catch (_e) { }
        }
        readEndpoint() {
            var _a, _b;
            try {
                return localStorage.getItem(`${ENDPOINT_KEY}:${(_b = (_a = this.config) === null || _a === void 0 ? void 0 : _a.apiKey) !== null && _b !== void 0 ? _b : ''}`);
            }
            catch (_c) {
                return null;
            }
        }
        async identify(externalId) {
            if (!this.config)
                return { ok: false, reason: 'sdk_not_initialized' };
            const token = this.readToken();
            if (!token)
                return { ok: false, reason: 'no_subscription' };
            return this.postJson('/subscribers/identify', { token, externalId });
        }
        async tag(tags) {
            if (!this.config)
                return { ok: false, reason: 'sdk_not_initialized' };
            const token = this.readToken();
            if (!token)
                return { ok: false, reason: 'no_subscription' };
            return this.postJson('/subscribers/tag', { token, tags });
        }
        async postJson(path, body) {
            try {
                const res = await this.request(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                return res.ok ? { ok: true } : { ok: false, reason: `server_${res.status}` };
            }
            catch (e) {
                return { ok: false, reason: (e === null || e === void 0 ? void 0 : e.name) === 'AbortError' ? 'timed_out' : 'network_error' };
            }
        }
        /**
         * Show an in-page toast notification. Returns a function that dismisses
         * the toast early; toasts also auto-dismiss after `duration` ms
         * (default 5000). Multiple toasts stack at the chosen corner.
         *
         * Unlike push notifications, toasts don't require permission — they
         * render entirely inside the page DOM, useful for real-time alerts
         * to users who are already on your site.
         *
         *   const dismiss = ReachBell.showToast({
         *     title:    'Order shipped 📦',
         *     body:     'Order #4821 arrives tomorrow.',
         *     url:      '/orders/4821',
         *     duration: 6000,
         *   });
         */
        showToast(opts) {
            var _a, _b, _c, _d, _e, _f;
            if (typeof document === 'undefined')
                return () => { };
            const defaults = (_c = (_b = (_a = this.serverContext) === null || _a === void 0 ? void 0 : _a.customLayouts) === null || _b === void 0 ? void 0 : _b.toast) !== null && _c !== void 0 ? _c : {};
            const titleText = opts.title || opts.message || '';
            if (!titleText)
                return () => { };
            const pos = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes((_d = opts.position) !== null && _d !== void 0 ? _d : defaults.position)
                ? ((_e = opts.position) !== null && _e !== void 0 ? _e : defaults.position)
                : 'bottom-right';
            const layer = this.ensureToastLayer(pos);
            const accent = safeColor((_f = opts.accentColor) !== null && _f !== void 0 ? _f : defaults.accentColor, DEFAULT_ACCENT);
            const duration = typeof opts.duration === 'number'
                ? Math.max(0, opts.duration)
                : (typeof defaults.duration === 'number' ? defaults.duration : 6000);
            const bodyText = opts.body || (opts.title ? opts.message : '') || '';
            const targetUrl = safeUrl(opts.url || opts.actionUrl);
            const ctaText = opts.ctaText;
            const card = document.createElement('div');
            Object.assign(card.style, {
                background: '#0f172a',
                color: '#f8fafc',
                borderRadius: '14px',
                boxShadow: '0 18px 50px rgba(15,23,42,.35)',
                padding: '12px 14px',
                width: '320px',
                maxWidth: 'calc(100vw - 40px)',
                cursor: targetUrl ? 'pointer' : 'default',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                transition: 'opacity 200ms ease, transform 200ms ease',
                opacity: '0',
                transform: 'translateY(8px)',
                boxSizing: 'border-box',
                pointerEvents: 'auto',
            });
            card.setAttribute('role', 'status');
            const topRow = document.createElement('div');
            Object.assign(topRow.style, { display: 'flex', gap: '10px', alignItems: 'flex-start', width: '100%' });
            card.appendChild(topRow);
            const dot = document.createElement('div');
            Object.assign(dot.style, {
                width: '9px', height: '9px', borderRadius: '999px',
                background: accent, marginTop: '5px', flexShrink: '0',
                boxShadow: `0 0 8px ${accent}`,
            });
            topRow.appendChild(dot);
            const text = document.createElement('div');
            Object.assign(text.style, { flex: '1', minWidth: '0' });
            const titleEl = document.createElement('div');
            Object.assign(titleEl.style, { fontSize: '13px', fontWeight: '700', lineHeight: '1.3' });
            titleEl.textContent = titleText;
            text.appendChild(titleEl);
            if (bodyText && bodyText !== titleText) {
                const bodyEl = document.createElement('div');
                Object.assign(bodyEl.style, {
                    fontSize: '11.5px', color: '#cbd5e1', marginTop: '2px', lineHeight: '1.4',
                });
                bodyEl.textContent = bodyText;
                text.appendChild(bodyEl);
            }
            if (ctaText) {
                const ctaBtn = document.createElement('div');
                Object.assign(ctaBtn.style, {
                    alignSelf: 'flex-start',
                    padding: '3px 10px',
                    borderRadius: '8px',
                    background: accent,
                    color: '#ffffff',
                    fontSize: '10.5px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    marginTop: '6px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    boxShadow: `0 2px 8px ${accent}40`,
                });
                ctaBtn.textContent = ctaText;
                text.appendChild(ctaBtn);
            }
            topRow.appendChild(text);
            const close = document.createElement('button');
            Object.assign(close.style, {
                border: '0', background: 'transparent', color: '#94a3b8',
                padding: '0 2px', cursor: 'pointer', fontSize: '16px', lineHeight: '1',
                flexShrink: '0', opacity: '0.6', transition: 'opacity 0.15s',
            });
            close.onmouseenter = () => { close.style.opacity = '1'; };
            close.onmouseleave = () => { close.style.opacity = '0.6'; };
            close.setAttribute('aria-label', 'Dismiss');
            close.textContent = '×';
            topRow.appendChild(close);
            let dismissed = false;
            const dismiss = () => {
                if (dismissed)
                    return;
                dismissed = true;
                card.style.opacity = '0';
                card.style.transform = 'translateY(8px)';
                setTimeout(() => card.remove(), 200);
            };
            close.addEventListener('click', e => { e.stopPropagation(); dismiss(); });
            if (targetUrl) {
                card.addEventListener('click', () => {
                    try {
                        window.location.href = targetUrl;
                    }
                    catch (_a) { }
                    dismiss();
                });
            }
            layer.appendChild(card);
            // Animate in on the next frame so the transition fires.
            requestAnimationFrame(() => {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            });
            if (duration > 0)
                setTimeout(dismiss, duration);
            return dismiss;
        }
        ensureToastLayer(position) {
            const id = `reachbell-toast-layer-${position}`;
            let layer = document.getElementById(id);
            if (layer)
                return layer;
            layer = document.createElement('div');
            layer.id = id;
            Object.assign(layer.style, {
                position: 'fixed',
                zIndex: '2147483646',
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                maxWidth: '360px',
            });
            // Pin to the appropriate corner.
            if (position.startsWith('top'))
                layer.style.top = '20px';
            if (position === 'bottom-right') {
                const hasNotifCenter = !!document.getElementById('reachbell-notification-center');
                layer.style.bottom = hasNotifCenter ? '76px' : '20px';
                layer.style.right = '20px';
            }
            else {
                if (position.startsWith('bottom'))
                    layer.style.bottom = '20px';
                if (position.endsWith('right'))
                    layer.style.right = '20px';
                if (position.endsWith('left'))
                    layer.style.left = '20px';
            }
            document.body.appendChild(layer);
            return layer;
        }
        /**
         * Apply UTM parameters to every outbound link click on the page,
         * tagging traffic so Google Analytics / etc. attribute the session to
         * ReachBell as the source. Safe to call repeatedly — installs a single
         * delegated click listener regardless of how many times it's invoked.
         *
         *   ReachBell.attachUtmTagger({
         *     source:   'reachbell',
         *     medium:   'push',
         *     campaign: 'fall-2026',
         *   });
         */
        attachUtmTagger(utm) {
            if (typeof document === 'undefined' || this._utmHandlerInstalled)
                return;
            this._utmHandlerInstalled = true;
            const apply = (target) => {
                if (!target || !target.href)
                    return;
                try {
                    const u = new URL(target.href, window.location.href);
                    // Skip same-origin links — UTM is for outbound attribution only.
                    if (u.origin === window.location.origin)
                        return;
                    if (!u.searchParams.has('utm_source'))
                        u.searchParams.set('utm_source', utm.source);
                    if (!u.searchParams.has('utm_medium'))
                        u.searchParams.set('utm_medium', utm.medium);
                    if (utm.campaign && !u.searchParams.has('utm_campaign'))
                        u.searchParams.set('utm_campaign', utm.campaign);
                    if (utm.term && !u.searchParams.has('utm_term'))
                        u.searchParams.set('utm_term', utm.term);
                    if (utm.content && !u.searchParams.has('utm_content'))
                        u.searchParams.set('utm_content', utm.content);
                    target.href = u.toString();
                }
                catch ( /* malformed href — ignore */_a) { /* malformed href — ignore */ }
            };
            // Capture phase so we run before any user click handler that might
            // call preventDefault / change the href.
            document.addEventListener('click', ev => {
                var _a, _b;
                const path = ((_b = (_a = ev.composedPath) === null || _a === void 0 ? void 0 : _a.call(ev)) !== null && _b !== void 0 ? _b : []);
                const anchor = path.find(el => (el === null || el === void 0 ? void 0 : el.tagName) === 'A');
                apply(anchor !== null && anchor !== void 0 ? anchor : null);
            }, true);
        }
        /**
         * Show a sticky banner across the top or bottom of the viewport. Returns
         * a `dismiss()` function. Banners are stacked one-per-position, so a
         * second call replaces the first at the same position.
         *
         * Common uses: site-wide announcements, sale promotions, system alerts
         * that need higher visibility than a corner toast.
         *
         *   const dismiss = ReachBell.showBanner({
         *     title:   '🚀 Black Friday — 30% off everything',
         *     body:    'Code BLACK30 — ends midnight',
         *     ctaText: 'Shop now',
         *     url:     '/sale',
         *   });
         */
        showBanner(opts) {
            var _a;
            if (typeof document === 'undefined')
                return () => { };
            const position = opts.position === 'bottom' ? 'bottom' : 'top';
            const dismissible = opts.dismissible !== false;
            const bg = safeBackground(opts.backgroundColor, DEFAULT_ACCENT);
            const text = safeColor(opts.textColor, '#ffffff');
            const headline = opts.title || opts.message || opts.headline || '';
            if (!headline)
                return () => { };
            const sub = opts.body || opts.highlightText || opts.secondaryText || '';
            const cta = opts.ctaText;
            const targetUrl = safeUrl(opts.url || opts.ctaUrl);
            // Only one banner per position. Replacing dismisses the previous so
            // the page never accumulates a stack of overlapping bars.
            const layerId = `reachbell-banner-${position}`;
            (_a = document.getElementById(layerId)) === null || _a === void 0 ? void 0 : _a.remove();
            const bar = document.createElement('div');
            bar.id = layerId;
            Object.assign(bar.style, {
                position: 'fixed',
                left: '0', right: '0',
                [position]: '0',
                background: bg,
                color: text,
                padding: '10px 18px',
                zIndex: '2147483645',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '14px',
                fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
                fontSize: '13px',
                lineHeight: '1.35',
                boxShadow: position === 'top'
                    ? '0 6px 18px rgba(0,0,0,.12)'
                    : '0 -6px 18px rgba(0,0,0,.12)',
                cursor: targetUrl && !cta ? 'pointer' : 'default',
                transition: 'transform 200ms ease',
                transform: position === 'top' ? 'translateY(-100%)' : 'translateY(100%)',
                boxSizing: 'border-box',
            });
            const content = document.createElement('div');
            Object.assign(content.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                flex: '1',
                minWidth: '0',
                justifyContent: 'center',
            });
            const titleEl = document.createElement('strong');
            titleEl.style.fontWeight = '700';
            titleEl.textContent = headline;
            content.appendChild(titleEl);
            if (sub) {
                const bodyEl = document.createElement('span');
                bodyEl.style.opacity = '0.92';
                bodyEl.textContent = sub;
                content.appendChild(bodyEl);
            }
            bar.appendChild(content);
            const rightActions = document.createElement('div');
            Object.assign(rightActions.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                flexShrink: '0',
            });
            if (cta) {
                const ctaBtn = document.createElement('button');
                ctaBtn.type = 'button';
                Object.assign(ctaBtn.style, {
                    padding: '5px 14px',
                    borderRadius: '999px',
                    background: safeColor(opts.ctaButtonColor, '#ffffff'),
                    color: safeColor(opts.ctaButtonTextColor, '#0f172a'),
                    fontWeight: '700',
                    fontSize: '11px',
                    border: '0',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    flexShrink: '0',
                });
                ctaBtn.textContent = cta;
                ctaBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (targetUrl) {
                        try {
                            window.location.href = targetUrl;
                        }
                        catch (_a) { }
                    }
                    dismiss();
                });
                rightActions.appendChild(ctaBtn);
            }
            let dismissed = false;
            const dismiss = () => {
                if (dismissed)
                    return;
                dismissed = true;
                bar.style.transform = position === 'top' ? 'translateY(-100%)' : 'translateY(100%)';
                setTimeout(() => bar.remove(), 220);
            };
            if (dismissible) {
                const close = document.createElement('button');
                Object.assign(close.style, {
                    background: 'transparent', border: '0', color: text,
                    opacity: '0.85', cursor: 'pointer', fontSize: '18px',
                    lineHeight: '1', padding: '0 4px',
                });
                close.setAttribute('aria-label', 'Dismiss banner');
                close.textContent = '×';
                close.addEventListener('click', e => { e.stopPropagation(); dismiss(); });
                rightActions.appendChild(close);
            }
            bar.appendChild(rightActions);
            if (targetUrl && !cta) {
                bar.addEventListener('click', () => {
                    try {
                        window.location.href = targetUrl;
                    }
                    catch (_a) { }
                });
            }
            bar.setAttribute('role', 'region');
            bar.setAttribute('aria-label', headline);
            document.body.appendChild(bar);
            requestAnimationFrame(() => { bar.style.transform = 'translateY(0)'; });
            const duration = typeof opts.duration === 'number' ? opts.duration : 0;
            if (duration > 0)
                setTimeout(dismiss, duration);
            return dismiss;
        }
        /**
         * Record a notification in the local history store. Hosts call this from
         * the service worker (or anywhere they receive a push payload) so the
         * notification center widget can show a recent feed. Bounded to
         * `maxItems` newest, oldest evicted FIFO.
         *
         * Safe to call before init() — items still get persisted.
         */
        recordNotification(item) {
            var _a, _b;
            if (typeof localStorage === 'undefined')
                return;
            try {
                const existing = this.readNotificationHistory();
                const next = {
                    id: (_a = item.id) !== null && _a !== void 0 ? _a : `nh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                    title: item.title,
                    body: item.body,
                    url: item.url,
                    iconUrl: item.iconUrl,
                    receivedAt: (_b = item.receivedAt) !== null && _b !== void 0 ? _b : Date.now(),
                    read: !!item.read,
                };
                const merged = [next, ...existing].slice(0, 50); // hard cap regardless of viewer
                localStorage.setItem(NOTIFICATION_HISTORY, JSON.stringify(merged));
                // Push a CustomEvent so an open notification center can refresh.
                try {
                    window.dispatchEvent(new CustomEvent('reachbell:notification-recorded', { detail: next }));
                }
                catch ( /* CustomEvent unsupported — best-effort */_c) { /* CustomEvent unsupported — best-effort */ }
            }
            catch ( /* JSON or quota — drop silently */_d) { /* JSON or quota — drop silently */ }
        }
        /** Read up to `limit` items, newest first. */
        getNotificationHistory(limit = 20) {
            const all = this.readNotificationHistory();
            return all.slice(0, Math.max(0, limit));
        }
        /** Clear all stored notifications. */
        clearNotificationHistory() {
            if (typeof localStorage === 'undefined')
                return;
            try {
                localStorage.removeItem(NOTIFICATION_HISTORY);
            }
            catch ( /* ignore */_a) { /* ignore */ }
        }
        readNotificationHistory() {
            if (typeof localStorage === 'undefined')
                return [];
            try {
                const raw = localStorage.getItem(NOTIFICATION_HISTORY);
                if (!raw)
                    return [];
                const parsed = JSON.parse(raw);
                return Array.isArray(parsed) ? parsed : [];
            }
            catch (_a) {
                return [];
            }
        }
        /**
         * Render a floating bell-icon button anchored in a corner; clicking it
         * opens a dropdown of recent notifications pulled from
         * recordNotification() history. Calling twice replaces the existing
         * widget so callers can re-skin without reloading the page.
         *
         *   ReachBell.showNotificationCenter({ position: 'bottom-right' });
         */
        showNotificationCenter(opts = {}) {
            var _a, _b, _c, _d;
            if (typeof document === 'undefined')
                return () => { };
            const position = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(opts.position)
                ? opts.position
                : 'bottom-right';
            const accent = safeColor(opts.accentColor, DEFAULT_ACCENT);
            const maxItems = typeof opts.maxItems === 'number' && opts.maxItems > 0 ? opts.maxItems : 20;
            const heading = opts.title || 'Notifications';
            const emptyTx = (_a = opts.emptyText) !== null && _a !== void 0 ? _a : 'No notifications yet.';
            const id = 'reachbell-notification-center';
            (_c = (_b = this.cleanups).notificationCenter) === null || _c === void 0 ? void 0 : _c.call(_b);
            (_d = document.getElementById(id)) === null || _d === void 0 ? void 0 : _d.remove();
            const root = document.createElement('div');
            root.id = id;
            Object.assign(root.style, {
                position: 'fixed', zIndex: '2147483645',
                fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
            });
            if (position.startsWith('top'))
                root.style.top = '20px';
            if (position.startsWith('bottom'))
                root.style.bottom = '20px';
            if (position.endsWith('right'))
                root.style.right = '20px';
            if (position.endsWith('left'))
                root.style.left = '20px';
            // Bell button.
            const bell = document.createElement('button');
            Object.assign(bell.style, {
                width: '46px', height: '46px', borderRadius: '999px',
                background: accent, color: '#fff', border: '0',
                cursor: 'pointer', boxShadow: '0 8px 24px rgba(15,23,42,.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0', position: 'relative',
            });
            bell.type = 'button';
            bell.setAttribute('aria-label', heading);
            bell.setAttribute('aria-expanded', 'false');
            // Inline SVG — no external asset, no remote font.
            bell.innerHTML =
                '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
                    + '<path d="M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22Zm6.36-6.36V11a6.36 6.36 0 1 0-12.72 0v4.64L4 17.27v.91h16v-.91l-1.64-1.63Z" fill="currentColor"/>'
                    + '</svg>';
            // Unread badge.
            const badge = document.createElement('span');
            Object.assign(badge.style, {
                position: 'absolute', top: '-2px', right: '-2px',
                background: '#ef4444', color: '#fff', borderRadius: '999px',
                minWidth: '18px', height: '18px', padding: '0 5px',
                fontSize: '10px', fontWeight: '800', lineHeight: '18px',
                display: 'none', boxShadow: '0 0 0 2px #fff',
            });
            bell.appendChild(badge);
            // Dropdown panel.
            const panel = document.createElement('div');
            Object.assign(panel.style, {
                position: 'absolute',
                [position.startsWith('top') ? 'top' : 'bottom']: '56px',
                [position.endsWith('right') ? 'right' : 'left']: '0',
                width: '320px',
                maxHeight: '420px',
                overflow: 'hidden',
                display: 'none',
                flexDirection: 'column',
                background: '#fff', color: '#0f172a',
                borderRadius: '14px',
                boxShadow: '0 20px 50px rgba(15,23,42,.22)',
                border: '1px solid rgba(15,23,42,.08)',
            });
            const header = document.createElement('div');
            Object.assign(header.style, {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 14px', borderBottom: '1px solid rgba(15,23,42,.08)',
                fontWeight: '700', fontSize: '13.5px',
            });
            const title = document.createElement('span');
            title.textContent = heading;
            const clear = document.createElement('button');
            Object.assign(clear.style, {
                background: 'transparent', border: '0', color: '#64748b',
                cursor: 'pointer', fontSize: '11.5px', fontWeight: '600',
            });
            clear.type = 'button';
            clear.textContent = 'Clear';
            header.append(title, clear);
            const list = document.createElement('div');
            Object.assign(list.style, { overflowY: 'auto', flex: '1' });
            panel.append(header, list);
            root.append(bell, panel);
            document.body.appendChild(root);
            const render = () => {
                const items = this.getNotificationHistory(maxItems);
                const unread = items.filter(i => !i.read).length;
                badge.style.display = unread > 0 ? 'inline-block' : 'none';
                badge.textContent = unread > 99 ? '99+' : String(unread);
                list.replaceChildren();
                if (items.length === 0) {
                    const empty = document.createElement('div');
                    Object.assign(empty.style, {
                        padding: '28px 16px', textAlign: 'center', color: '#94a3b8',
                        fontSize: '12.5px',
                    });
                    empty.textContent = emptyTx;
                    list.appendChild(empty);
                    return;
                }
                items.forEach(item => {
                    const row = document.createElement('div');
                    Object.assign(row.style, {
                        padding: '12px 14px', cursor: item.url ? 'pointer' : 'default',
                        borderBottom: '1px solid rgba(15,23,42,.05)',
                        background: item.read ? 'transparent' : 'rgba(99,102,241,.06)',
                    });
                    const t = document.createElement('div');
                    Object.assign(t.style, { fontSize: '13px', fontWeight: '700' });
                    t.textContent = item.title;
                    row.appendChild(t);
                    if (item.body) {
                        const b = document.createElement('div');
                        Object.assign(b.style, {
                            fontSize: '12px', color: '#475569', marginTop: '2px',
                            lineHeight: '1.4',
                        });
                        b.textContent = item.body;
                        row.appendChild(b);
                    }
                    const time = document.createElement('div');
                    Object.assign(time.style, {
                        fontSize: '10.5px', color: '#94a3b8', marginTop: '4px',
                        fontWeight: '600',
                    });
                    time.textContent = this.relativeTime(item.receivedAt);
                    row.appendChild(time);
                    row.addEventListener('click', () => {
                        item.read = true;
                        this.markRead(item.id);
                        render();
                        const itemUrl = safeUrl(item.url);
                        if (itemUrl) {
                            try {
                                window.location.href = itemUrl;
                            }
                            catch (_a) { }
                        }
                    });
                    list.appendChild(row);
                });
            };
            let open = false;
            const toggle = () => {
                open = !open;
                panel.style.display = open ? 'flex' : 'none';
                bell.setAttribute('aria-expanded', String(open));
                if (open)
                    render();
            };
            bell.addEventListener('click', toggle);
            clear.addEventListener('click', e => {
                e.stopPropagation();
                this.clearNotificationHistory();
                render();
            });
            // Close on outside click.
            const outside = (ev) => {
                if (!open)
                    return;
                if (!root.contains(ev.target)) {
                    open = false;
                    panel.style.display = 'none';
                    bell.setAttribute('aria-expanded', 'false');
                }
            };
            document.addEventListener('click', outside);
            // Live update when recordNotification() fires while open.
            const liveHandler = () => render();
            window.addEventListener('reachbell:notification-recorded', liveHandler);
            // Initial badge render so unread count is visible immediately.
            render();
            const cleanup = () => {
                document.removeEventListener('click', outside);
                window.removeEventListener('reachbell:notification-recorded', liveHandler);
                root.remove();
                if (this.cleanups.notificationCenter === cleanup)
                    delete this.cleanups.notificationCenter;
            };
            this.cleanups.notificationCenter = cleanup;
            return cleanup;
        }
        /**
         * Render an interactive floating bell launcher on the page.
         * Automatically mounted during bootstrap if configured in the dashboard.
         */
        showBellWidget(options) {
            var _a;
            const cfg = (_a = options !== null && options !== void 0 ? options : this.promptConfig) !== null && _a !== void 0 ? _a : {};
            return this.mountBellWidget(cfg);
        }
        mountBellWidget(cfg) {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            if (typeof document === 'undefined')
                return () => { };
            const id = 'reachbell-bell-widget';
            (_b = (_a = this.cleanups).bellWidget) === null || _b === void 0 ? void 0 : _b.call(_a);
            (_c = document.getElementById(id)) === null || _c === void 0 ? void 0 : _c.remove();
            const position = cfg.position || ((_d = cfg.bellWidget) === null || _d === void 0 ? void 0 : _d.position) || 'bottom-right';
            const accent = safeColor(cfg.accentColor || ((_e = cfg.bellWidget) === null || _e === void 0 ? void 0 : _e.color), DEFAULT_ACCENT);
            const sizeStr = cfg.bellSize || ((_f = cfg.bellWidget) === null || _f === void 0 ? void 0 : _f.size) || 'medium';
            const sizePx = sizeStr === 'small' ? 40 : sizeStr === 'large' ? 56 : 48;
            const tooltipText = cfg.bellTooltip || ((_g = cfg.bellWidget) === null || _g === void 0 ? void 0 : _g.tooltipText) || 'Enable notifications';
            const pulse = cfg.bellPulse !== false && ((_h = cfg.bellWidget) === null || _h === void 0 ? void 0 : _h.pulseAnimation) !== false;
            const container = document.createElement('div');
            container.id = id;
            Object.assign(container.style, {
                position: 'fixed',
                zIndex: '2147483640',
                display: 'flex',
                flexDirection: 'column',
                alignItems: position.endsWith('left') ? 'flex-start' : 'flex-end',
                fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
                transition: 'transform 0.2s ease',
            });
            const center = document.getElementById('reachbell-notification-center');
            const sharesCorner = !!center
                && (position.startsWith('top') ? center.style.top : center.style.bottom) === '20px'
                && (position.endsWith('left') ? center.style.left : center.style.right) === '20px';
            const edgeOffset = sharesCorner ? '76px' : '20px';
            if (position.startsWith('top'))
                container.style.top = edgeOffset;
            else
                container.style.bottom = edgeOffset;
            if (position.endsWith('left'))
                container.style.left = '20px';
            else
                container.style.right = '20px';
            let tooltip = null;
            if (tooltipText) {
                tooltip = document.createElement('div');
                tooltip.setAttribute('aria-hidden', 'true');
                Object.assign(tooltip.style, {
                    padding: '6px 12px',
                    borderRadius: '8px',
                    background: '#0f172a',
                    color: '#ffffff',
                    fontSize: '11px',
                    fontWeight: '600',
                    boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
                    whiteSpace: 'nowrap',
                    marginBottom: '8px',
                    opacity: '0',
                    transform: 'translateY(4px)',
                    transition: 'opacity 0.2s ease, transform 0.2s ease',
                    pointerEvents: 'none',
                });
                tooltip.textContent = tooltipText;
                container.appendChild(tooltip);
            }
            const showTooltip = (visible) => {
                if (!tooltip)
                    return;
                tooltip.style.opacity = visible ? '1' : '0';
                tooltip.style.transform = visible ? 'translateY(0)' : 'translateY(4px)';
            };
            const btnWrap = document.createElement('div');
            Object.assign(btnWrap.style, {
                position: 'relative',
                width: `${sizePx}px`,
                height: `${sizePx}px`,
            });
            if (pulse) {
                const pulseRing = document.createElement('div');
                Object.assign(pulseRing.style, {
                    position: 'absolute', inset: '0', borderRadius: '9999px',
                    background: accent, pointerEvents: 'none', opacity: '0',
                });
                btnWrap.appendChild(pulseRing);
                const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (!reduceMotion && typeof pulseRing.animate === 'function') {
                    pulseRing.animate([
                        { transform: 'scale(1)', opacity: 0.6 },
                        { transform: 'scale(1.6)', opacity: 0, offset: 0.75 },
                        { transform: 'scale(1.6)', opacity: 0 },
                    ], { duration: 2000, iterations: Infinity, easing: 'cubic-bezier(0, 0, 0.2, 1)' });
                }
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-label', tooltipText);
            Object.assign(button.style, {
                width: `${sizePx}px`,
                height: `${sizePx}px`,
                borderRadius: '9999px',
                background: accent,
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 10px 25px -3px rgba(0,0,0,0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                zIndex: '1',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                outline: 'none',
                padding: '0',
            });
            const iconSize = Math.round(sizePx * 0.45);
            button.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`;
            button.addEventListener('mouseenter', () => {
                button.style.transform = 'scale(1.08)';
                showTooltip(true);
            });
            button.addEventListener('mouseleave', () => {
                button.style.transform = 'scale(1)';
                showTooltip(false);
            });
            button.addEventListener('focus', () => showTooltip(true));
            button.addEventListener('blur', () => showTooltip(false));
            button.addEventListener('click', async () => {
                if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
                    this.showToast({
                        title: 'Notifications Blocked',
                        body: 'Notifications are blocked in your browser settings. Click the site settings icon to allow.',
                        duration: 5000,
                        accentColor: '#ef4444',
                    });
                    return;
                }
                const result = await this.prompt();
                if (result.success) {
                    this.showToast({
                        title: 'Notifications Active',
                        body: 'You are subscribed to receive updates from this site.',
                        duration: 3500,
                        accentColor: accent,
                    });
                }
            });
            btnWrap.appendChild(button);
            container.appendChild(btnWrap);
            document.body.appendChild(container);
            const cleanup = () => {
                container.remove();
                if (this.cleanups.bellWidget === cleanup)
                    delete this.cleanups.bellWidget;
            };
            this.cleanups.bellWidget = cleanup;
            return cleanup;
        }
        markRead(id) {
            if (typeof localStorage === 'undefined')
                return;
            try {
                const next = this.readNotificationHistory().map(i => i.id === id ? { ...i, read: true } : i);
                localStorage.setItem(NOTIFICATION_HISTORY, JSON.stringify(next));
            }
            catch ( /* ignore */_a) { /* ignore */ }
        }
        relativeTime(epochMs) {
            const diff = Math.max(0, Date.now() - epochMs);
            const s = Math.floor(diff / 1000);
            if (s < 60)
                return 'just now';
            if (s < 3600)
                return `${Math.floor(s / 60)}m ago`;
            if (s < 86400)
                return `${Math.floor(s / 3600)}h ago`;
            if (s < 86400 * 7)
                return `${Math.floor(s / 86400)}d ago`;
            return new Date(epochMs).toLocaleDateString();
        }
        /** Read order: in-memory mirror → localStorage. Survives Safari private mode. */
        readToken() {
            var _a;
            if (this.token)
                return this.token;
            try {
                const t = (_a = localStorage.getItem(this.tokenKey())) !== null && _a !== void 0 ? _a : localStorage.getItem(TOKEN_KEY);
                if (t)
                    this.token = t;
                return t;
            }
            catch (_b) {
                return null;
            }
        }
        /**
         * Build the prompt UI imperatively via element.style.* assignments instead
         * of an innerHTML template with inline `style="…"` attributes. JS-set styles
         * are NOT gated by `Content-Security-Policy: style-src` — only
         * parser-processed style attributes are — so this renders cleanly on
         * customer sites with strict CSP.
         */
        async showCustomPrompt(cfg) {
            return new Promise(resolve => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                (_a = this.closeActivePrompt) === null || _a === void 0 ? void 0 : _a.call(this);
                (_b = document.getElementById('reachbell-custom-prompt')) === null || _b === void 0 ? void 0 : _b.remove();
                const accent = safeColor(cfg.accentColor, DEFAULT_ACCENT);
                const pos = resolvePromptPlacement(cfg.position || ((_c = cfg.softPrompt) === null || _c === void 0 ? void 0 : _c.position));
                const isCenterModal = pos === 'center-modal';
                const isTopBar = pos === 'top-bar';
                const overlayEnabled = ((_d = cfg.overlayEnabled) !== null && _d !== void 0 ? _d : (_e = cfg.softPrompt) === null || _e === void 0 ? void 0 : _e.overlayEnabled) !== false;
                const overlayColor = safeColor((_f = cfg.overlayColor) !== null && _f !== void 0 ? _f : (_g = cfg.softPrompt) === null || _g === void 0 ? void 0 : _g.overlayColor, 'rgba(15, 23, 42, 0.48)');
                const allowBg = safeColor(cfg.allowButtonBackground || cfg.accentColor, accent);
                const allowColor = safeColor(cfg.allowButtonTextColor || cfg.buttonTextColor, '#ffffff');
                const allowRadius = (_h = cfg.allowButtonBorderRadius) !== null && _h !== void 0 ? _h : 10;
                const declineBg = safeColor(cfg.declineButtonBackground, '#f8fafc');
                const declineColor = safeColor(cfg.declineButtonTextColor, '#475569');
                const declineBorder = safeColor(cfg.declineButtonBorderColor, '#e2e8f0');
                const declineRadius = (_j = cfg.declineButtonBorderRadius) !== null && _j !== void 0 ? _j : 10;
                const cardBg = safeColor(cfg.cardBackground, '#ffffff');
                const cardText = safeColor(cfg.cardTextColor, '#0f172a');
                const cardBorder = safeColor(cfg.borderColor, '#e2e8f0');
                const cardBorderWidth = typeof cfg.borderWidth === 'number' ? cfg.borderWidth : 1;
                const cardRadius = isTopBar ? 0 : (typeof cfg.borderRadius === 'number' ? cfg.borderRadius : 16);
                const shadowMap = {
                    none: 'none',
                    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
                    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
                    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    glow: `0 12px 36px -4px ${(cfg.accentColor && cfg.accentColor.startsWith('#') && cfg.accentColor.length === 7) ? `${cfg.accentColor}45` : 'rgba(99, 102, 241, 0.35)'}`,
                };
                const cardShadow = shadowMap[cfg.boxShadow || ''] || '0 20px 45px -10px rgba(15,23,42,.22), 0 0 0 1px rgba(0,0,0,0.06)';
                const root = document.createElement('div');
                root.id = 'reachbell-custom-prompt';
                const titleId = 'reachbell-custom-prompt-title';
                root.setAttribute('role', isCenterModal ? 'alertdialog' : 'dialog');
                root.setAttribute('aria-labelledby', titleId);
                if (isCenterModal && overlayEnabled)
                    root.setAttribute('aria-modal', 'true');
                Object.assign(root.style, {
                    position: 'fixed',
                    zIndex: '2147483647',
                    fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
                });
                if (isCenterModal) {
                    Object.assign(root.style, {
                        inset: '0',
                        width: '100vw',
                        height: '100vh',
                        background: overlayEnabled ? overlayColor : 'transparent',
                        backdropFilter: overlayEnabled ? 'blur(4px)' : 'none',
                        WebkitBackdropFilter: overlayEnabled ? 'blur(4px)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '16px',
                        boxSizing: 'border-box',
                        pointerEvents: overlayEnabled ? 'auto' : 'none',
                    });
                }
                else if (isTopBar) {
                    Object.assign(root.style, {
                        top: '0',
                        left: '0',
                        right: '0',
                        width: '100%',
                        pointerEvents: 'auto',
                    });
                }
                else {
                    Object.assign(root.style, {
                        pointerEvents: 'none',
                    });
                    if (pos.startsWith('top'))
                        root.style.top = '24px';
                    else
                        root.style.bottom = '24px';
                    if (pos.endsWith('left'))
                        root.style.left = '24px';
                    else if (pos.endsWith('right'))
                        root.style.right = '24px';
                    else {
                        root.style.left = '50%';
                        root.style.transform = 'translateX(-50%)';
                    }
                }
                if (isTopBar) {
                    const banner = document.createElement('div');
                    Object.assign(banner.style, {
                        width: '100%',
                        background: cardBg,
                        color: cardText,
                        borderBottom: `${cardBorderWidth}px solid ${cardBorder}`,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                        padding: '12px 20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '16px',
                        boxSizing: 'border-box',
                    });
                    const leftCol = document.createElement('div');
                    Object.assign(leftCol.style, {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        flex: '1',
                        minWidth: '0',
                    });
                    if (cfg.iconUrl) {
                        const img = document.createElement('img');
                        img.src = cfg.iconUrl;
                        img.alt = 'Logo';
                        Object.assign(img.style, {
                            width: '32px', height: '32px', borderRadius: '8px', objectFit: 'contain',
                            flexShrink: '0', border: '1px solid rgba(226,232,240,0.6)', background: '#fff', padding: '2px', boxSizing: 'border-box',
                        });
                        leftCol.appendChild(img);
                    }
                    else {
                        const icon = document.createElement('div');
                        Object.assign(icon.style, {
                            width: '32px', height: '32px', borderRadius: '8px', background: allowBg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0', color: allowColor,
                        });
                        icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
                        leftCol.appendChild(icon);
                    }
                    const bannerText = document.createElement('div');
                    Object.assign(bannerText.style, { fontSize: '13px', lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
                    const bannerTitle = document.createElement('strong');
                    bannerTitle.id = titleId;
                    bannerTitle.textContent = cfg.title || DEFAULT_TITLE;
                    bannerText.appendChild(bannerTitle);
                    if (cfg.body) {
                        const bannerBody = document.createElement('span');
                        bannerBody.style.opacity = '0.85';
                        bannerBody.textContent = `: ${cfg.body}`;
                        bannerText.appendChild(bannerBody);
                    }
                    leftCol.appendChild(bannerText);
                    banner.appendChild(leftCol);
                    const rightCol = document.createElement('div');
                    Object.assign(rightCol.style, { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: '0' });
                    const allowBtn = document.createElement('button');
                    allowBtn.dataset.action = 'accept';
                    Object.assign(allowBtn.style, {
                        border: '0', padding: '7px 16px', borderRadius: `${allowRadius}px`,
                        background: allowBg, color: allowColor, fontWeight: '700', fontSize: '12.5px', cursor: 'pointer',
                    });
                    allowBtn.type = 'button';
                    allowBtn.textContent = cfg.acceptText || DEFAULT_ACCEPT;
                    rightCol.appendChild(allowBtn);
                    const dismissBtn = document.createElement('button');
                    dismissBtn.dataset.action = 'decline';
                    Object.assign(dismissBtn.style, {
                        border: `1px solid ${declineBorder}`, padding: '7px 14px', borderRadius: `${declineRadius}px`,
                        background: declineBg, color: declineColor, fontWeight: '600', fontSize: '12.5px', cursor: 'pointer',
                    });
                    dismissBtn.type = 'button';
                    dismissBtn.textContent = cfg.declineText || DEFAULT_DECLINE;
                    rightCol.appendChild(dismissBtn);
                    banner.appendChild(rightCol);
                    root.appendChild(banner);
                }
                else {
                    const card = document.createElement('div');
                    Object.assign(card.style, {
                        background: cardBg,
                        color: cardText,
                        borderRadius: `${cardRadius}px`,
                        border: cardBorderWidth > 0 ? `${cardBorderWidth}px solid ${cardBorder}` : 'none',
                        boxShadow: cardShadow,
                        padding: '18px',
                        width: '340px',
                        maxWidth: 'calc(100vw - 32px)',
                        position: 'relative',
                        boxSizing: 'border-box',
                        pointerEvents: 'auto',
                    });
                    root.appendChild(card);
                    const row = document.createElement('div');
                    Object.assign(row.style, { display: 'flex', gap: '12px', alignItems: 'flex-start' });
                    card.appendChild(row);
                    if (cfg.iconUrl) {
                        const img = document.createElement('img');
                        img.src = cfg.iconUrl;
                        img.alt = 'Brand Logo';
                        Object.assign(img.style, {
                            width: '40px',
                            height: '40px',
                            borderRadius: '12px',
                            objectFit: 'contain',
                            flexShrink: '0',
                            border: '1px solid rgba(226, 232, 240, 0.6)',
                            background: '#ffffff',
                            padding: '2px',
                            boxSizing: 'border-box',
                        });
                        row.appendChild(img);
                    }
                    else {
                        const iconBox = document.createElement('div');
                        Object.assign(iconBox.style, {
                            width: '40px', height: '40px', borderRadius: '12px',
                            background: allowBg,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
                            color: allowColor,
                        });
                        iconBox.innerHTML =
                            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">' +
                                '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>' +
                                '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>' +
                                '</svg>';
                        row.appendChild(iconBox);
                    }
                    const textCol = document.createElement('div');
                    Object.assign(textCol.style, { flex: '1', minWidth: '0' });
                    row.appendChild(textCol);
                    const titleEl = document.createElement('div');
                    Object.assign(titleEl.style, {
                        fontWeight: '800', color: cardText, fontSize: '14.5px', lineHeight: '1.3',
                    });
                    titleEl.id = titleId;
                    titleEl.textContent = cfg.title || DEFAULT_TITLE;
                    textCol.appendChild(titleEl);
                    const bodyEl = document.createElement('div');
                    Object.assign(bodyEl.style, {
                        color: cardText, opacity: '0.8', fontSize: '12px', lineHeight: '1.5', marginTop: '4px',
                    });
                    bodyEl.textContent = (_k = cfg.body) !== null && _k !== void 0 ? _k : '';
                    textCol.appendChild(bodyEl);
                    // Close 'x' button in header
                    const closeBtn = document.createElement('button');
                    closeBtn.dataset.action = 'decline';
                    closeBtn.setAttribute('aria-label', 'Close');
                    Object.assign(closeBtn.style, {
                        background: 'transparent',
                        border: '0',
                        color: cardText,
                        opacity: '0.45',
                        fontSize: '16px',
                        cursor: 'pointer',
                        padding: '0 4px',
                        lineHeight: '1',
                        transition: 'opacity 0.15s ease',
                    });
                    closeBtn.onmouseenter = () => { closeBtn.style.opacity = '0.9'; };
                    closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.45'; };
                    closeBtn.type = 'button';
                    closeBtn.textContent = '✕';
                    row.appendChild(closeBtn);
                    const buttons = document.createElement('div');
                    Object.assign(buttons.style, { display: 'flex', gap: '8px', marginTop: '14px' });
                    card.appendChild(buttons);
                    const acceptBtn = document.createElement('button');
                    acceptBtn.dataset.action = 'accept';
                    Object.assign(acceptBtn.style, {
                        flex: '1', border: '0', padding: '9px 14px', borderRadius: `${allowRadius}px`,
                        background: allowBg, color: allowColor, fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                        boxShadow: '0 4px 12px ' + allowBg + '40',
                    });
                    acceptBtn.type = 'button';
                    acceptBtn.textContent = cfg.acceptText || DEFAULT_ACCEPT;
                    buttons.appendChild(acceptBtn);
                    const declineBtn = document.createElement('button');
                    declineBtn.dataset.action = 'decline';
                    Object.assign(declineBtn.style, {
                        flex: '1', border: `1px solid ${declineBorder}`, padding: '9px 14px', borderRadius: `${declineRadius}px`,
                        background: declineBg, color: declineColor, fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                    });
                    declineBtn.type = 'button';
                    declineBtn.textContent = cfg.declineText || DEFAULT_DECLINE;
                    buttons.appendChild(declineBtn);
                    if (cfg.showPoweredBy !== false) {
                        const poweredBy = document.createElement('div');
                        Object.assign(poweredBy.style, {
                            marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(148, 163, 184, 0.15)',
                            fontSize: '10.5px', textAlign: 'center', color: cardText, opacity: '0.6',
                        });
                        poweredBy.append('Powered by ');
                        const brand = document.createElement('strong');
                        brand.style.color = DEFAULT_ACCENT;
                        brand.textContent = 'ReachBell';
                        poweredBy.appendChild(brand);
                        card.appendChild(poweredBy);
                    }
                }
                const previousFocus = document.activeElement;
                let settled = false;
                const finish = (accepted) => {
                    var _a;
                    if (settled)
                        return;
                    settled = true;
                    document.removeEventListener('keydown', onKey, true);
                    root.remove();
                    if (this.closeActivePrompt === close)
                        this.closeActivePrompt = null;
                    try {
                        (_a = previousFocus === null || previousFocus === void 0 ? void 0 : previousFocus.focus) === null || _a === void 0 ? void 0 : _a.call(previousFocus);
                    }
                    catch (_b) { }
                    resolve(accepted);
                };
                const close = () => finish(false);
                const onKey = (e) => {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        finish(false);
                        return;
                    }
                    if (e.key !== 'Tab' || !(isCenterModal && overlayEnabled))
                        return;
                    const focusable = Array.from(root.querySelectorAll('button'));
                    if (!focusable.length)
                        return;
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];
                    const active = document.activeElement;
                    if (e.shiftKey && (active === first || !root.contains(active))) {
                        e.preventDefault();
                        last.focus();
                    }
                    else if (!e.shiftKey && (active === last || !root.contains(active))) {
                        e.preventDefault();
                        first.focus();
                    }
                };
                this.closeActivePrompt = close;
                document.addEventListener('keydown', onKey, true);
                document.body.appendChild(root);
                root.addEventListener('click', e => {
                    var _a;
                    const target = e.target;
                    const action = (_a = target.closest('button')) === null || _a === void 0 ? void 0 : _a.dataset.action;
                    if (action === 'accept' || action === 'decline') {
                        finish(action === 'accept');
                    }
                    else if (isCenterModal && overlayEnabled && target === root) {
                        finish(false);
                    }
                });
                if (isCenterModal)
                    (_l = root.querySelector('button[data-action="accept"]')) === null || _l === void 0 ? void 0 : _l.focus({ preventScroll: true });
            });
        }
        warnOnce(message, err) {
            if (this.warned)
                return;
            this.warned = true;
            // Surface ONE visible warning in production so integrators have
            // something to grep when push silently doesn't work.
            // eslint-disable-next-line no-console
            console.warn('[ReachBell]', message, err);
        }
        log(...args) {
            var _a;
            if ((_a = this.config) === null || _a === void 0 ? void 0 : _a.debug) {
                // eslint-disable-next-line no-console
                console.log('[ReachBell]', ...args);
            }
        }
    }
    const ReachBell = new ReachBellClient();
    if (typeof window !== 'undefined') {
        // Don't clobber an existing instance — first SDK load wins. Theme +
        // plugin integrations that both ship the SDK end up sharing one client.
        if (!window.ReachBell) {
            window.ReachBell = ReachBell;
        }
    }

    exports.ReachBell = ReachBell;
    exports.default = ReachBell;
    exports.escapeHtml = escapeHtml;
    exports.normalizeApiUrl = normalizeApiUrl;
    exports.promptCapAllows = promptCapAllows;
    exports.promptFrequencyAllows = promptFrequencyAllows;
    exports.resolvePromptPlacement = resolvePromptPlacement;
    exports.safeBackground = safeBackground;
    exports.safeColor = safeColor;
    exports.safeUrl = safeUrl;
    exports.sameApplicationServerKey = sameApplicationServerKey;
    exports.scrollProgress = scrollProgress;
    exports.urlBase64ToUint8Array = urlBase64ToUint8Array;
    exports.widgetEnabled = widgetEnabled;

    Object.defineProperty(exports, '__esModule', { value: true });

    return exports;

})({});
//# sourceMappingURL=index.iife.js.map
