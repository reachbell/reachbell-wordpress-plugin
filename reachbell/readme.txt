=== ReachBell ===
Contributors: dotspheres
Tags: push notifications, web push, notifications, marketing, email
Requires at least: 5.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.3
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Send web push notifications and email campaigns to your WordPress visitors with ReachBell.

== Description ==

ReachBell lets you re-engage your visitors with real-time push notifications and
beautifully designed email campaigns — directly from your ReachBell dashboard.

Install the plugin, paste your API key, and you're done. Add your secret key
too and every new post can automatically send a push to subscribers.

Features:

* One-line install — no code changes required
* Visual opt-in prompt designer (configure from the dashboard)
* Auto-notify on new post publish (runs asynchronously — never blocks the editor)
* User identification & segmentation
* Powered by [reachbell.com](https://reachbell.com)

== Installation ==

1. Upload `reachbell` folder to `/wp-content/plugins/`
2. Activate the plugin in WordPress
3. Go to Settings → ReachBell, paste your API key from the [dashboard](https://app.reachbell.com)
4. Save — the SDK loads automatically on every page, and a service worker is
   served from your site's home path (`/reachbell-sw.js`, or
   `/blog/reachbell-sw.js` when WordPress lives in a subfolder) so push
   notifications can target the whole site. With plain permalinks the plugin
   serves it from `/?reachbell_sw=1` instead.

If the service worker URL returns 404 after changing permalinks, visit
Settings → Permalinks and click "Save Changes" once to refresh rewrite rules.

== Frequently Asked Questions ==

= Why does "Notify subscribers on publish" need a secret key? =

Sending a campaign is a server-only action, so ReachBell requires your
project's secret key (`rb_secret_…`) for it. The plugin keeps the secret key
in your WordPress database, uses it only from wp-cron, and never adds it to
your pages. The public key (`rb_live_…`) stays in the API Key field and is
only used by the browser SDK. The settings page shows the result of the last
notification.

= Does this plugin work on multisite? =

Yes for single-site activations. Network-wide activation is on the roadmap.

= Can I keep my API key when I uninstall? =

No — uninstall removes all plugin options (including the API key) per
WordPress.org guidelines. Deactivating instead of uninstalling preserves
your settings.

== Changelog ==

= 1.0.3 =
* "Notify subscribers on publish" now works: add your project secret key in
  Settings → ReachBell. Posts are sent through ReachBell's secret-key
  campaign endpoint, and the settings page shows the last result.

= 1.0.2 =
* Bundle ReachBell SDK 1.0.10: the opt-in prompt now stays on screen in every
  position, honours the dashboard's frequency, delay and scroll settings, and
  waits for a click before showing the browser's native prompt.
* In-page widgets only appear when they are switched on in the dashboard.
* Returning subscribers are re-synced automatically after a key change.
* Delivery and click analytics now reach the ReachBell API.
* The service worker works on subfolder installs and with plain permalinks.
* Deactivating the plugin removes its rewrite rule.

= 1.0.1 =
* Bundle the ReachBell SDK inside the plugin (previously enqueued from a
  non-existent CDN URL — the integration was silently broken).
* Serve `reachbell-sw.js` from the site root via rewrite rule + the
  required `Service-Worker-Allowed: /` header.
* Auto-notify on publish runs asynchronously via wp-cron — no more
  blocking the editor for up to 10s on slow API responses.
* Notification body now renders shortcodes and strips Gutenberg block
  delimiters before trimming to 22 words.
* Full i18n wiring — every user-facing string is translatable via the
  `reachbell` text domain.
* Clean uninstall — all plugin options + scheduled events removed.

= 1.0.0 =
* Initial release.
