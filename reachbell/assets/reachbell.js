var ReachBellBundle = (function (exports) {
    'use strict';

    /**
     * ReachBell official SDK.
     *
     *   import { ReachBell } from '@reachbell/sdk';
     *   ReachBell.init({ apiKey: 'rb_live_…', apiUrl: 'https://api.reachbell.com' });
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
    const TOKEN_KEY = 'reachbell_token';
    const DEFAULT_API_URL = 'https://api.reachbell.com';
    const DEFAULT_SW_PATH = '/reachbell-sw.js';
    const DEFAULT_TIMEOUT_MS = 10000;
    const DEFAULT_ACCENT = '#6366f1';
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
    /* ─── Client ──────────────────────────────────────────────────── */
    class ReachBellClient {
        constructor() {
            this.config = null;
            this.promptConfig = null;
            this.serverContext = null;
            this.swReg = null;
            this.bootstrapping = null;
            this.warned = false;
            /**
             * In-memory mirror of the subscription token. Used as a fallback when
             * localStorage throws (Safari private mode, quota exceeded) so the very
             * next identify()/tag() call doesn't see no_subscription right after a
             * successful subscribe() in the same session.
             */
            this.token = null;
        }
        init(config) {
            if (this.config && !config.force) {
                this.log('init() called twice — ignoring. Pass force:true to override.');
                return;
            }
            this.config = {
                apiUrl: DEFAULT_API_URL,
                swPath: DEFAULT_SW_PATH,
                autoPrompt: false,
                debug: false,
                ...config,
            };
            this.log('Initialized', this.config);
            this.bootstrapping = this.bootstrap();
            void this.bootstrapping;
        }
        /** Resolves once the boot chain (context + SW registration) has settled. */
        get ready() {
            var _a;
            return (_a = this.bootstrapping) !== null && _a !== void 0 ? _a : Promise.reject(new Error('Call ReachBell.init() first'));
        }
        async bootstrap() {
            var _a, _b, _c;
            try {
                const ctx = await this.fetchContext();
                this.serverContext = ctx;
                this.promptConfig = (_a = ctx.promptConfig) !== null && _a !== void 0 ? _a : null;
                await this.registerServiceWorker();
                if (((_b = this.config) === null || _b === void 0 ? void 0 : _b.autoPrompt) && ((_c = this.promptConfig) === null || _c === void 0 ? void 0 : _c.enabled)) {
                    // Chrome ≥80 requires a user gesture for Notification.requestPermission().
                    // Bootstrap runs in a microtask after page load — no gesture in flight —
                    // so we arm a one-shot listener that fires the prompt on first click /
                    // key / tap instead of immediately.
                    this.armAutoPromptOnGesture();
                }
            }
            catch (e) {
                this.warnOnce('Bootstrap failed — push notifications will not work on this page', e);
                this.log('Bootstrap failed', e);
            }
        }
        armAutoPromptOnGesture() {
            if (typeof document === 'undefined')
                return;
            const events = ['click', 'keydown', 'touchstart'];
            const fire = () => {
                events.forEach(ev => document.removeEventListener(ev, fire));
                void this.prompt();
            };
            events.forEach(ev => document.addEventListener(ev, fire, { once: true, passive: true }));
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
            if (!('serviceWorker' in navigator)) {
                this.log('Service workers not supported');
                return;
            }
            this.swReg = await navigator.serviceWorker.register(this.config.swPath);
            this.log('SW registered', this.swReg);
        }
        async prompt() {
            var _a, _b;
            if (!this.config)
                return { success: false, reason: 'sdk_not_initialized' };
            // Wait for the in-flight bootstrap so prompt() called immediately after
            // init() doesn't race a missing serverContext / swReg.
            if (this.bootstrapping) {
                try {
                    await this.bootstrapping;
                }
                catch ( /* already warned */_c) { /* already warned */ }
            }
            if (!('PushManager' in window))
                return { success: false, reason: 'push_not_supported' };
            if (!this.swReg) {
                try {
                    await this.registerServiceWorker();
                }
                catch (e) {
                    return { success: false, reason: `sw_register_failed_${(_a = e === null || e === void 0 ? void 0 : e.name) !== null && _a !== void 0 ? _a : 'unknown'}` };
                }
            }
            if (((_b = this.promptConfig) === null || _b === void 0 ? void 0 : _b.enabled) && this.promptConfig.type !== 'native') {
                const accepted = await this.showCustomPrompt(this.promptConfig);
                if (!accepted)
                    return { success: false, reason: 'user_declined_soft_prompt' };
            }
            const permission = await Notification.requestPermission();
            if (permission !== 'granted')
                return { success: false, reason: 'permission_denied' };
            return this.subscribe();
        }
        async subscribe() {
            var _a, _b;
            if (!this.swReg || !this.serverContext)
                return { success: false, reason: 'not_ready' };
            let sub;
            try {
                sub = await this.swReg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(this.serverContext.vapidKeys.public),
                });
            }
            catch (e) {
                // NotAllowedError, AbortError, InvalidStateError, InvalidAccessError,
                // and missing/malformed VAPID keys all land here. Map to a specific
                // reason so the integrator can branch on what failed.
                return { success: false, reason: `push_subscribe_failed_${(_a = e === null || e === void 0 ? void 0 : e.name) !== null && _a !== void 0 ? _a : 'unknown'}` };
            }
            try {
                const res = await this.request('/subscribers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // `subscription` is the canonical structured shape. `token` is kept
                    // as the legacy double-stringified form so an older API stays
                    // compatible during rollout — remove from the wire format in v2.
                    body: JSON.stringify({
                        subscription: sub.toJSON(),
                        token: JSON.stringify(sub),
                        tokenType: 'vapid',
                    }),
                });
                if (!res.ok)
                    return { success: false, reason: `subscribe_failed_${res.status}` };
                const data = await res.json();
                const t = (_b = data.token) !== null && _b !== void 0 ? _b : null;
                this.token = t;
                // Safari private mode + quota-exceeded both throw here. The in-memory
                // mirror above keeps identify()/tag() working for the session anyway.
                try {
                    if (t)
                        localStorage.setItem(TOKEN_KEY, t);
                }
                catch ( /* fall back to memory */_c) { /* fall back to memory */ }
                return { success: true, token: t !== null && t !== void 0 ? t : undefined };
            }
            catch (e) {
                return { success: false, reason: (e === null || e === void 0 ? void 0 : e.name) === 'AbortError' ? 'timed_out' : 'network_error' };
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
        /** Read order: in-memory mirror → localStorage. Survives Safari private mode. */
        readToken() {
            if (this.token)
                return this.token;
            try {
                const t = localStorage.getItem(TOKEN_KEY);
                if (t)
                    this.token = t;
                return t;
            }
            catch (_a) {
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
                var _a, _b, _c, _d, _e;
                const accent = safeColor(cfg.accentColor, DEFAULT_ACCENT);
                const root = document.createElement('div');
                Object.assign(root.style, {
                    position: 'fixed',
                    zIndex: '2147483647',
                    fontFamily: 'system-ui,-apple-system,sans-serif',
                });
                const pos = (_a = cfg.position) !== null && _a !== void 0 ? _a : 'bottom-center';
                if (pos.startsWith('bottom'))
                    root.style.bottom = '20px';
                if (pos.startsWith('top'))
                    root.style.top = '20px';
                if (pos.endsWith('center')) {
                    root.style.left = '50%';
                    root.style.transform = 'translateX(-50%)';
                }
                if (pos.endsWith('left'))
                    root.style.left = '20px';
                if (pos.endsWith('right'))
                    root.style.right = '20px';
                const card = document.createElement('div');
                Object.assign(card.style, {
                    background: '#fff',
                    borderRadius: '14px',
                    boxShadow: '0 18px 50px rgba(15,23,42,.16)',
                    padding: '18px',
                    width: '320px',
                    maxWidth: 'calc(100vw - 40px)',
                });
                root.appendChild(card);
                const row = document.createElement('div');
                Object.assign(row.style, { display: 'flex', gap: '12px', alignItems: 'flex-start' });
                card.appendChild(row);
                const iconBox = document.createElement('div');
                Object.assign(iconBox.style, {
                    width: '38px', height: '38px', borderRadius: '10px',
                    background: accent,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
                });
                // SVG carries no style attributes, so innerHTML here is CSP-safe.
                iconBox.innerHTML =
                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5">' +
                        '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>' +
                        '<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>' +
                        '</svg>';
                row.appendChild(iconBox);
                const textCol = document.createElement('div');
                Object.assign(textCol.style, { flex: '1', minWidth: '0' });
                row.appendChild(textCol);
                const titleEl = document.createElement('div');
                Object.assign(titleEl.style, {
                    fontWeight: '800', color: '#0f172a', fontSize: '14px', lineHeight: '1.3',
                });
                titleEl.textContent = (_b = cfg.title) !== null && _b !== void 0 ? _b : DEFAULT_TITLE;
                textCol.appendChild(titleEl);
                const bodyEl = document.createElement('div');
                Object.assign(bodyEl.style, {
                    color: '#64748b', fontSize: '12px', lineHeight: '1.5', marginTop: '4px',
                });
                bodyEl.textContent = (_c = cfg.body) !== null && _c !== void 0 ? _c : '';
                textCol.appendChild(bodyEl);
                const buttons = document.createElement('div');
                Object.assign(buttons.style, { display: 'flex', gap: '8px', marginTop: '14px' });
                card.appendChild(buttons);
                const acceptBtn = document.createElement('button');
                acceptBtn.dataset.action = 'accept';
                Object.assign(acceptBtn.style, {
                    flex: '1', border: '0', padding: '9px 12px', borderRadius: '10px',
                    background: accent, color: '#fff', fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                });
                acceptBtn.textContent = (_d = cfg.acceptText) !== null && _d !== void 0 ? _d : DEFAULT_ACCEPT;
                buttons.appendChild(acceptBtn);
                const declineBtn = document.createElement('button');
                declineBtn.dataset.action = 'decline';
                Object.assign(declineBtn.style, {
                    flex: '1', border: '0', padding: '9px 12px', borderRadius: '10px',
                    background: '#f1f5f9', color: '#475569', fontWeight: '700', fontSize: '13px', cursor: 'pointer',
                });
                declineBtn.textContent = (_e = cfg.declineText) !== null && _e !== void 0 ? _e : DEFAULT_DECLINE;
                buttons.appendChild(declineBtn);
                document.body.appendChild(root);
                root.addEventListener('click', e => {
                    var _a;
                    const action = (_a = e.target.closest('button')) === null || _a === void 0 ? void 0 : _a.dataset.action;
                    if (action !== 'accept' && action !== 'decline')
                        return;
                    root.remove();
                    resolve(action === 'accept');
                });
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
    exports.safeColor = safeColor;
    exports.urlBase64ToUint8Array = urlBase64ToUint8Array;

    Object.defineProperty(exports, '__esModule', { value: true });

    return exports;

})({});
//# sourceMappingURL=index.iife.js.map
