=== ReachBell ===
Contributors: dotspheres
Tags: push notifications, web push, notifications, marketing, email
Requires at least: 5.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 1.0.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Send web push notifications and email campaigns to your WordPress visitors with ReachBell.

== Description ==

ReachBell lets you re-engage your visitors with real-time push notifications and
beautifully designed email campaigns — directly from your ReachBell dashboard.

Install the plugin, paste your API key, and you're done. Every new post can
automatically send a push to subscribers.

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
   served at `/reachbell-sw.js` with `Service-Worker-Allowed: /` so push
   notifications can target the whole site.

If you've changed your permalink structure and the SW URL returns 404, visit
Settings → Permalinks and click "Save Changes" once to refresh rewrite rules.

== Frequently Asked Questions ==

= Does this plugin work on multisite? =

Yes for single-site activations. Network-wide activation is on the roadmap.

= Can I keep my API key when I uninstall? =

No — uninstall removes all plugin options (including the API key) per
WordPress.org guidelines. Deactivating instead of uninstalling preserves
your settings.

== Changelog ==

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
