=== ReachBell ===
Contributors: reachbell
Tags: push notifications, web push, woocommerce, abandoned cart, back in stock
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Web push for WordPress and WooCommerce: new-post alerts, order updates, abandoned-cart reminders and back-in-stock alerts.

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

WooCommerce (when WooCommerce is active; each feature is off until you turn it on):

* Order updates — push the shopper when their order is confirmed, completed,
  refunded, cancelled, put on hold, or moves to a custom status
* Abandoned-cart reminders — push a subscribed shopper who leaves items in
  their cart, after a delay you choose (15 minutes to 2 days)
* Back-in-stock waitlist — a "Notify me" button on out-of-stock products;
  everyone who tapped it gets a push when the product is back
* Price-drop alerts — push shoppers who added a product to their cart when
  its price goes down (at most once a day per product)
* Store events — order, cart and stock events are sent to ReachBell so
  dashboard automations can react to them
* `reachbell_send()` helper for developers who want to send their own pushes
* Compatible with High-Performance Order Storage and the block-based cart
  and checkout
* Powered by [reachbell.com](https://reachbell.com)

== External services ==

This plugin connects to the ReachBell service (https://reachbell.com), which
is required for it to work. ReachBell is provided by DotSpheres Technologies
Pvt Ltd.

* **Browser SDK (every page, once an API key is saved).** The bundled SDK
  loads your project settings from `https://api.reachbell.com/projects/context`
  using your public API key. When a visitor agrees to notifications, their
  browser's push subscription (push endpoint and encryption keys) is sent to
  `https://api.reachbell.com/subscribers`. Nothing is sent before the visitor
  allows notifications, apart from loading the settings.
* **Service worker (after a visitor subscribes).** When a notification is
  shown or clicked, the campaign ID and subscriber ID are sent to
  `https://api.reachbell.com/campaigns/analytics/` so you can see delivery and
  click counts.
* **Notify on publish (only if enabled and a secret key is saved).** When a
  post is published, its title, a short excerpt, its URL, the site icon URL
  and the featured image URL are sent to `https://api.reachbell.com/campaigns/server`
  with your secret key, from your server via wp-cron.

* **WooCommerce features (only if WooCommerce is active, a secret key is
  saved and the feature is turned on).** From your server via wp-cron:
  order updates send the order number, status message and order link to
  `https://api.reachbell.com/transactional/send`; abandoned-cart reminders
  send the first product's name and image and the cart link to the same
  endpoint; back-in-stock and price-drop alerts send the product name, price,
  link and image to `https://api.reachbell.com/campaigns/server`. With "Send
  store events" on, order and cart events (order number, total, currency and
  cart product names and quantities) go to `https://api.reachbell.com/events`.
  Shoppers are identified to ReachBell by an ID the plugin creates
  (`wc_customer_<user ID>` or a random `wc_guest_…` ID), never by email
  address. In the browser, the bundled SDK sends that ID and product tags
  (`wc_cart_<product ID>`, `wc_waitlist_<product ID>_<n>`) to
  `https://api.reachbell.com/subscribers/identify` and
  `https://api.reachbell.com/subscribers/tag`, only for visitors who have
  allowed notifications.

No other address is contacted, unless a developer points the plugin at a
different ReachBell API with the `REACHBELL_API_URL` constant (see the FAQ).

ReachBell terms of service: https://reachbell.com/terms
ReachBell privacy policy: https://reachbell.com/privacy

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

= Do I need a separate plugin for WooCommerce? =

No. With WooCommerce active, Settings → ReachBell shows a WooCommerce
section. Add your secret key, tick the features you want, and save.

= Which plan do the WooCommerce features need? =

Back-in-stock and price-drop alerts and store events work on every plan.
Order updates and abandoned-cart reminders use the transactional API, which
is on the Starter plan and above. The settings page shows the result of the
last store message, so a plan error is visible there.

= How does the plugin know which shopper to notify? =

Logged-in customers are identified as `wc_customer_<user ID>`. Guests get a
random ID stored in their WooCommerce session, which is linked to their
order at checkout. Only shoppers who have allowed notifications can be
reached.

= Can I change the order update wording? =

Yes. Use the `reachbell_wc_order_message` filter, which receives
`[ $title, $body ]`, the order and the new status.

= Can I point the plugin at a staging API? =

Yes, for testing. Add `define('REACHBELL_API_URL', 'https://staging-api.example.com');`
to `wp-config.php`. Without it the plugin always uses `https://api.reachbell.com`,
so most sites never need this.

= Does this plugin work on multisite? =

Yes for single-site activations. Network-wide activation is on the roadmap.

= Can I keep my API key when I uninstall? =

No — uninstall removes all plugin options (including the API key) per
WordPress.org guidelines. Deactivating instead of uninstalling preserves
your settings.

== Changelog ==

= 1.1.0 =
* New WooCommerce section in Settings → ReachBell: order updates,
  abandoned-cart reminders, a back-in-stock waitlist, price-drop alerts and
  store events for dashboard automations.
* New `reachbell_send()` helper and `reachbell_wc_order_message` filter.
* Declares compatibility with WooCommerce High-Performance Order Storage and
  the block-based cart and checkout.

= 1.0.4 =
* Bundle ReachBell SDK 1.0.12: in Chrome and Edge the browser's native
  permission prompt now appears once the dashboard delay has passed, instead
  of waiting for the visitor's next click or page. Safari and Firefox still
  need a click, so there it appears on the first click after the delay.

= 1.0.3 =
* "Notify subscribers on publish" now works: add your project secret key in
  Settings → ReachBell. Posts are sent through ReachBell's secret-key
  campaign endpoint, and the settings page shows the last result.
* Fix: `/reachbell-sw.js` was redirected to `/reachbell-sw.js/` on sites
  with pretty permalinks, so browsers could not register the service worker.
* Requires WordPress 6.0 or later; tested up to 7.1.
* Removed the API URL setting: the plugin always uses `https://api.reachbell.com`.
  Developers can still override it with the `REACHBELL_API_URL` constant.

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

== Credits ==

Bundles the ReachBell browser SDK (`assets/reachbell.js`, MIT licence,
source at https://github.com/reachbell/reachbell-sdk).
