<?php
/**
 * Plugin Name: ReachBell
 * Plugin URI:  https://reachbell.com/wordpress
 * Description: Send push notifications and email campaigns to your WordPress visitors via ReachBell.
 * Version:     1.0.3
 * Author:      DotSpheres Technologies Pvt Ltd
 * Author URI:  https://reachbell.com
 * License:     GPL-2.0+
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: reachbell
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) exit;

define('REACHBELL_VERSION', '1.0.3');
define('REACHBELL_SW_RULE', '^reachbell-sw\\.js$');
define('REACHBELL_PATH', plugin_dir_path(__FILE__));
define('REACHBELL_URL',  plugin_dir_url(__FILE__));
define('REACHBELL_SW_QUERY_VAR', 'reachbell_sw');
define('REACHBELL_DEFAULT_API_URL', 'https://api.reachbell.com');

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
    register_setting('reachbell', 'reachbell_auto_prompt', [
        'type'              => 'boolean',
        'sanitize_callback' => 'rest_sanitize_boolean',
        'default'           => false,
    ]);
    register_setting('reachbell', 'reachbell_secret_key', [
        'type'              => 'string',
        'sanitize_callback' => 'reachbell_sanitize_secret_key',
        'default'           => '',
    ]);
    register_setting('reachbell', 'reachbell_notify_on_publish', [
        'type'              => 'boolean',
        'sanitize_callback' => 'rest_sanitize_boolean',
        'default'           => false,
    ]);
}
add_action('admin_init', 'reachbell_register_settings');

function reachbell_api_url() {
    $url = defined('REACHBELL_API_URL') ? (string) REACHBELL_API_URL : REACHBELL_DEFAULT_API_URL;
    $url = esc_url_raw($url, ['https', 'http']);
    return untrailingslashit($url ? $url : REACHBELL_DEFAULT_API_URL);
}

function reachbell_sanitize_secret_key($value) {
    $value = trim(sanitize_text_field((string) $value));
    if ($value === '') {
        return get_option('reachbell_secret_key', '');
    }
    if (strpos($value, 'rb_secret_') !== 0) {
        add_settings_error(
            'reachbell_secret_key',
            'reachbell_secret_key_invalid',
            __('The secret key must start with rb_secret_. The previous key was kept.', 'reachbell')
        );
        return get_option('reachbell_secret_key', '');
    }
    return $value;
}

function reachbell_clear_secret_key() {
    if (!current_user_can('manage_options')) {
        wp_die(esc_html__('You are not allowed to do this.', 'reachbell'));
    }
    check_admin_referer('reachbell_clear_secret_key');
    delete_option('reachbell_secret_key');
    wp_safe_redirect(admin_url('options-general.php?page=reachbell'));
    exit;
}
add_action('admin_post_reachbell_clear_secret_key', 'reachbell_clear_secret_key');

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
                    <th><label for="reachbell_secret_key"><?php esc_html_e('Secret key', 'reachbell'); ?></label></th>
                    <td>
                        <?php $reachbell_has_secret = (bool) get_option('reachbell_secret_key'); ?>
                        <input type="password" name="reachbell_secret_key" id="reachbell_secret_key"
                            value="" autocomplete="new-password" class="regular-text"
                            placeholder="<?php echo esc_attr($reachbell_has_secret ? __('Saved — leave blank to keep it', 'reachbell') : 'rb_secret_…'); ?>" />
                        <p class="description">
                            <?php esc_html_e('Needed only for "Notify subscribers on publish". Find it in your ReachBell dashboard → Settings → API keys. It stays on this server and is never added to your pages.', 'reachbell'); ?>
                        </p>
                        <?php if ($reachbell_has_secret) : ?>
                            <p>
                                <a href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=reachbell_clear_secret_key'), 'reachbell_clear_secret_key')); ?>">
                                    <?php esc_html_e('Remove saved secret key', 'reachbell'); ?>
                                </a>
                            </p>
                        <?php endif; ?>
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
                        <?php if (get_option('reachbell_notify_on_publish') && !get_option('reachbell_secret_key')) : ?>
                            <p class="description" style="color:#b32d2e;">
                                <?php esc_html_e('Add your secret key above — notifications are not sent without it.', 'reachbell'); ?>
                            </p>
                        <?php endif; ?>
                        <?php $reachbell_last = get_option('reachbell_last_notify'); ?>
                        <?php if (is_array($reachbell_last) && !empty($reachbell_last['message'])) : ?>
                            <p class="description">
                                <?php
                                echo esc_html(sprintf(
                                    /* translators: 1: date and time, 2: result message */
                                    __('Last notification (%1$s): %2$s', 'reachbell'),
                                    wp_date(get_option('date_format') . ' ' . get_option('time_format'), (int) $reachbell_last['time']),
                                    $reachbell_last['message']
                                ));
                                ?>
                            </p>
                        <?php endif; ?>
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
    add_rewrite_rule(REACHBELL_SW_RULE, 'index.php?' . REACHBELL_SW_QUERY_VAR . '=1', 'top');
}
add_action('init', 'reachbell_register_sw_route');

function reachbell_query_vars($vars) {
    $vars[] = REACHBELL_SW_QUERY_VAR;
    return $vars;
}
add_filter('query_vars', 'reachbell_query_vars');

function reachbell_sw_path() {
    $url = get_option('permalink_structure')
        ? home_url('/reachbell-sw.js')
        : add_query_arg(REACHBELL_SW_QUERY_VAR, '1', home_url('/'));
    return wp_make_link_relative($url);
}

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
    $home_path = wp_parse_url(home_url('/'), PHP_URL_PATH);
    header('Service-Worker-Allowed: ' . ($home_path ? $home_path : '/'));
    // 1 day cache — the SW updates itself via the standard browser
    // update-check on next page load when this file's bytes change.
    header('Cache-Control: public, max-age=86400');
    global $wp_filesystem;
    if (!function_exists('WP_Filesystem')) {
        require_once ABSPATH . 'wp-admin/includes/file.php';
    }
    WP_Filesystem();
    echo $wp_filesystem->get_contents($file); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
    exit;
}
add_action('template_redirect', 'reachbell_serve_sw', 0);

/* ─── SDK enqueue ──────────────────────────────────────────────── */

/**
 * The SDK ships INSIDE the plugin (assets/reachbell.js, an IIFE bundle
 * of @reachbell/sdk). Loading it from a CDN or the API server would 404
 * and break the integration — both of which were the previous shape.
 */
function reachbell_enqueue_sdk() {
    $api_key = get_option('reachbell_api_key');
    if (!$api_key) return;

    wp_enqueue_script(
        'reachbell-sdk',
        REACHBELL_URL . 'assets/reachbell.js',
        [],
        REACHBELL_VERSION,
        true
    );

    $config = [
        'apiKey'     => (string) $api_key,
        'swPath'     => reachbell_sw_path(),
        'autoPrompt' => (bool) get_option('reachbell_auto_prompt'),
    ];
    if (defined('REACHBELL_API_URL')) {
        $config['apiUrl'] = reachbell_api_url();
    }
    wp_add_inline_script(
        'reachbell-sdk',
        'if(window.ReachBell){window.ReachBell.init(' . wp_json_encode($config) . ');}'
    );
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
    if (!get_option('reachbell_secret_key')) return;

    // Cron the send onto the next request — non-blocking, auto-retried by
    // WP's cron infrastructure if the next request doesn't fire it.
    wp_schedule_single_event(time(), 'reachbell_send_post_notification', [$post->ID]);
}
add_action('transition_post_status', 'reachbell_notify_on_publish', 10, 3);

/**
 * Cron handler — sends the post to the secret-key campaign endpoint and
 * stores the outcome so the settings page can show the last result.
 */
function reachbell_send_post_notification($post_id) {
    $post = get_post($post_id);
    if (!$post || $post->post_status !== 'publish') return;

    $secret_key = get_option('reachbell_secret_key');
    $api_url    = reachbell_api_url();
    if (!$secret_key) return;

    $title = wp_strip_all_tags($post->post_title);
    // Render shortcodes + strip block delimiters so the push body reads as
    // prose, not as `<!-- wp:paragraph --> Hello [gallery] world`.
    $rendered = apply_filters('the_content', $post->post_content); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedHooknameFound
    $plain    = wp_strip_all_tags(strip_shortcodes($rendered));
    $body     = wp_trim_words($plain, 22, '…');
    $url      = get_permalink($post);

    $response = wp_remote_post($api_url . '/campaigns/server', [
        'headers' => [
            'Content-Type' => 'application/json',
            'x-api-key'    => $secret_key,
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
        'timeout'  => 15,
    ]);

    if (is_wp_error($response)) {
        $message = $response->get_error_message();
    } else {
        $code    = (int) wp_remote_retrieve_response_code($response);
        $payload = json_decode(wp_remote_retrieve_body($response), true);
        if ($code >= 200 && $code < 300) {
            $message = sprintf(
                /* translators: %s is the post title */
                __('sent for "%s"', 'reachbell'),
                $title
            );
        } else {
            $detail  = is_array($payload) && isset($payload['message'])
                ? (is_array($payload['message']) ? implode('; ', $payload['message']) : (string) $payload['message'])
                : '';
            $message = sprintf(
                /* translators: 1: HTTP status code, 2: error detail */
                __('failed (HTTP %1$d) %2$s', 'reachbell'),
                $code,
                $detail
            );
        }
    }
    update_option('reachbell_last_notify', ['time' => time(), 'message' => $message], false);
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
    global $wp_rewrite;
    if (isset($wp_rewrite->extra_rules_top[REACHBELL_SW_RULE])) {
        unset($wp_rewrite->extra_rules_top[REACHBELL_SW_RULE]);
    }
    flush_rewrite_rules();
    wp_clear_scheduled_hook('reachbell_send_post_notification');
}
register_deactivation_hook(__FILE__, 'reachbell_deactivate');
