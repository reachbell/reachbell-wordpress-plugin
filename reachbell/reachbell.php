<?php
/**
 * Plugin Name: ReachBell
 * Plugin URI:  https://reachbell.com/wordpress
 * Description: Send push notifications and email campaigns to your WordPress visitors via ReachBell.
 * Version:     1.0.1
 * Author:      DotSpheres Technologies Pvt Ltd
 * Author URI:  https://reachbell.com
 * License:     GPL-2.0+
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: reachbell
 * Domain Path: /languages
 * Requires at least: 5.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

define('REACHBELL_VERSION', '1.0.1');
define('REACHBELL_PATH', plugin_dir_path(__FILE__));
define('REACHBELL_URL',  plugin_dir_url(__FILE__));
define('REACHBELL_SW_QUERY_VAR', 'reachbell_sw');

/* ─── i18n ─────────────────────────────────────────────────────── */

function reachbell_load_textdomain() {
    load_plugin_textdomain('reachbell', false, dirname(plugin_basename(__FILE__)) . '/languages');
}
add_action('plugins_loaded', 'reachbell_load_textdomain');

/* ─── Settings page ────────────────────────────────────────────── */

function reachbell_admin_menu() {
    add_options_page(
        __('ReachBell', 'reachbell'),
        __('ReachBell', 'reachbell'),
        'manage_options',
        'reachbell',
        'reachbell_settings_page'
    );
}
add_action('admin_menu', 'reachbell_admin_menu');

function reachbell_register_settings() {
    // Each option gets an explicit sanitize_callback — required by the
    // WordPress.org plugin review and a defense-in-depth measure so that
    // even a compromised wp-admin session can't store unsafe values that
    // later flow into wp_enqueue_script() or wp_remote_post().
    register_setting('reachbell', 'reachbell_api_key', [
        'type'              => 'string',
        'sanitize_callback' => 'sanitize_text_field',
        'default'           => '',
    ]);
    register_setting('reachbell', 'reachbell_api_url', [
        'type'              => 'string',
        'sanitize_callback' => 'esc_url_raw', // strips javascript:, data:, etc.
        'default'           => 'https://api.reachbell.com',
    ]);
    register_setting('reachbell', 'reachbell_auto_prompt', [
        'type'              => 'boolean',
        'sanitize_callback' => 'rest_sanitize_boolean',
        'default'           => false,
    ]);
    register_setting('reachbell', 'reachbell_notify_on_publish', [
        'type'              => 'boolean',
        'sanitize_callback' => 'rest_sanitize_boolean',
        'default'           => false,
    ]);
}
add_action('admin_init', 'reachbell_register_settings');

function reachbell_settings_page() {
    ?>
    <div class="wrap">
        <h1><?php esc_html_e('ReachBell Settings', 'reachbell'); ?></h1>
        <form method="post" action="options.php">
            <?php settings_fields('reachbell'); ?>
            <table class="form-table">
                <tr>
                    <th><label for="reachbell_api_key"><?php esc_html_e('API Key', 'reachbell'); ?></label></th>
                    <td>
                        <input type="text" name="reachbell_api_key" id="reachbell_api_key"
                            value="<?php echo esc_attr(get_option('reachbell_api_key')); ?>"
                            class="regular-text" placeholder="rb_live_…" />
                        <p class="description">
                            <?php esc_html_e('Find this in your ReachBell dashboard → Settings → API key.', 'reachbell'); ?>
                        </p>
                    </td>
                </tr>
                <tr>
                    <th><label for="reachbell_api_url"><?php esc_html_e('API URL', 'reachbell'); ?></label></th>
                    <td>
                        <input type="text" name="reachbell_api_url" id="reachbell_api_url"
                            value="<?php echo esc_attr(get_option('reachbell_api_url', 'https://api.reachbell.com')); ?>"
                            class="regular-text" />
                    </td>
                </tr>
                <tr>
                    <th><?php esc_html_e('Auto-show opt-in prompt', 'reachbell'); ?></th>
                    <td>
                        <label>
                            <input type="checkbox" name="reachbell_auto_prompt" value="1"
                                <?php checked(get_option('reachbell_auto_prompt'), 1); ?> />
                            <span class="description">
                                <?php esc_html_e('Use the prompt configured in your ReachBell dashboard.', 'reachbell'); ?>
                            </span>
                        </label>
                    </td>
                </tr>
                <tr>
                    <th><?php esc_html_e('Notify subscribers on publish', 'reachbell'); ?></th>
                    <td>
                        <label>
                            <input type="checkbox" name="reachbell_notify_on_publish" value="1"
                                <?php checked(get_option('reachbell_notify_on_publish'), 1); ?> />
                            <span class="description">
                                <?php esc_html_e('Send a push notification when a new post goes live.', 'reachbell'); ?>
                            </span>
                        </label>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>
    </div>
    <?php
}

/* ─── Service-worker route ─────────────────────────────────────── */

/**
 * Browser service workers can only control URLs under their served path
 * (e.g. an SW served from /wp-content/plugins/reachbell/assets/ can only
 * control /wp-content/plugins/reachbell/assets/*). For ReachBell to
 * receive pushes site-wide we MUST serve the SW from the site root with
 * a `Service-Worker-Allowed: /` header — which is what this rewrite +
 * template_redirect handler does.
 *
 * Rewrites are flushed on activation; if you ever change this regex you
 * must bump REACHBELL_VERSION and re-flush via a one-off migration.
 */
function reachbell_register_sw_route() {
    add_rewrite_rule('^reachbell-sw\.js$', 'index.php?' . REACHBELL_SW_QUERY_VAR . '=1', 'top');
}
add_action('init', 'reachbell_register_sw_route');

function reachbell_query_vars($vars) {
    $vars[] = REACHBELL_SW_QUERY_VAR;
    return $vars;
}
add_filter('query_vars', 'reachbell_query_vars');

function reachbell_serve_sw() {
    if (!get_query_var(REACHBELL_SW_QUERY_VAR)) return;

    $file = REACHBELL_PATH . 'assets/reachbell-sw.js';
    if (!file_exists($file)) {
        status_header(404);
        exit;
    }
    // Required so the SW can claim site-root scope despite being served
    // from a plugin path internally.
    header('Content-Type: application/javascript; charset=utf-8');
    header('Service-Worker-Allowed: /');
    // 1 day cache — the SW updates itself via the standard browser
    // update-check on next page load when this file's bytes change.
    header('Cache-Control: public, max-age=86400');
    readfile($file);
    exit;
}
add_action('template_redirect', 'reachbell_serve_sw');

/* ─── SDK enqueue ──────────────────────────────────────────────── */

/**
 * The SDK ships INSIDE the plugin (assets/reachbell.js, an IIFE bundle
 * of @reachbell/sdk). Loading it from a CDN or the API server would 404
 * and break the integration — both of which were the previous shape.
 */
function reachbell_enqueue_sdk() {
    $api_key = get_option('reachbell_api_key');
    if (!$api_key) return;

    $api_url     = esc_url(get_option('reachbell_api_url', 'https://api.reachbell.com'));
    $auto_prompt = get_option('reachbell_auto_prompt') ? 'true' : 'false';

    wp_enqueue_script(
        'reachbell-sdk',
        REACHBELL_URL . 'assets/reachbell.js',
        [],
        REACHBELL_VERSION,
        true
    );

    $inline = sprintf(
        "(function(){if(!window.ReachBell)return;window.ReachBell.init({apiKey:'%s',apiUrl:'%s',autoPrompt:%s});})();",
        esc_js($api_key),
        esc_js($api_url),
        $auto_prompt
    );
    wp_add_inline_script('reachbell-sdk', $inline);
}
add_action('wp_enqueue_scripts', 'reachbell_enqueue_sdk');

/* ─── Auto-notify on publish ──────────────────────────────────── */

/**
 * Schedule a push send when a post moves from any non-published state to
 * 'publish'. The actual HTTP request runs from the cron handler so the
 * editor's publish click returns instantly instead of waiting up to 10s
 * on the API. (Previous shape was a blocking wp_remote_post on the
 * request path, which made every publish stall on slow API moments.)
 */
function reachbell_notify_on_publish($new_status, $old_status, $post) {
    if (!get_option('reachbell_notify_on_publish')) return;
    if ($new_status !== 'publish' || $old_status === 'publish') return;
    if ($post->post_type !== 'post') return;
    // Defense in depth — transition_post_status already filters revisions
    // out via post_type, but be explicit.
    if (wp_is_post_revision($post->ID) || wp_is_post_autosave($post->ID)) return;
    if (!get_option('reachbell_api_key')) return;

    // Cron the send onto the next request — non-blocking, auto-retried by
    // WP's cron infrastructure if the next request doesn't fire it.
    wp_schedule_single_event(time(), 'reachbell_send_post_notification', [$post->ID]);
}
add_action('transition_post_status', 'reachbell_notify_on_publish', 10, 3);

/**
 * Cron handler — fires the API request asynchronously. Falls back to a
 * non-blocking wp_remote_post if for any reason this runs in a request
 * context (it shouldn't; cron handles that for us).
 */
function reachbell_send_post_notification($post_id) {
    $post = get_post($post_id);
    if (!$post || $post->post_status !== 'publish') return;

    $api_key = get_option('reachbell_api_key');
    $api_url = get_option('reachbell_api_url', 'https://api.reachbell.com');
    if (!$api_key) return;

    $title = wp_strip_all_tags($post->post_title);
    // Render shortcodes + strip block delimiters so the push body reads as
    // prose, not as `<!-- wp:paragraph --> Hello [gallery] world`.
    $rendered = apply_filters('the_content', $post->post_content);
    $plain    = wp_strip_all_tags(strip_shortcodes($rendered));
    $body     = wp_trim_words($plain, 22, '…');
    $url      = get_permalink($post);

    wp_remote_post($api_url . '/campaigns', [
        'headers' => [
            'Content-Type' => 'application/json',
            'x-api-key'    => $api_key,
        ],
        'body'    => wp_json_encode([
            'name'    => sprintf(
                /* translators: %s is the post title */
                __('WP Post: %s', 'reachbell'),
                $title
            ),
            'content' => [
                'title'    => $title,
                'body'     => $body,
                'clickUrl' => $url,
                'iconUrl'  => get_site_icon_url(192),
                'imageUrl' => has_post_thumbnail($post) ? get_the_post_thumbnail_url($post, 'large') : '',
            ],
            'segment' => new stdClass(),
        ]),
        'timeout'  => 5,
        // Even in the cron context, don't make the cron request stall on
        // API latency. The response shape is informational only.
        'blocking' => false,
    ]);
}
add_action('reachbell_send_post_notification', 'reachbell_send_post_notification', 10, 1);

/* ─── Activation / deactivation ───────────────────────────────── */

function reachbell_activate() {
    // Register the rewrite for /reachbell-sw.js and flush so it takes
    // effect without the operator manually re-saving permalinks.
    reachbell_register_sw_route();
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'reachbell_activate');

function reachbell_deactivate() {
    // Drop the SW rewrite and clear any queued push-on-publish events
    // so a deactivated plugin doesn't keep firing API calls.
    flush_rewrite_rules();
    wp_clear_scheduled_hook('reachbell_send_post_notification');
}
register_deactivation_hook(__FILE__, 'reachbell_deactivate');
