<?php
/**
 * ReachBell — uninstall handler.
 *
 * Runs when the user picks "Delete" in the Plugins list (NOT on
 * deactivation — that's reversible). WordPress.org plugin review
 * requires every option this plugin wrote to be cleaned up here, so a
 * later wp_load_alloptions() doesn't drag stale credentials along
 * forever via the autoload cache.
 */
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('reachbell_api_key');
delete_option('reachbell_api_url');
delete_option('reachbell_auto_prompt');
delete_option('reachbell_notify_on_publish');
delete_option('reachbell_secret_key');
delete_option('reachbell_last_notify');

// Drop any scheduled push-on-publish events from previous activations.
wp_clear_scheduled_hook('reachbell_send_post_notification');

foreach ([
    'reachbell_wc_order_updates',
    'reachbell_wc_abandoned_cart',
    'reachbell_wc_cart_delay',
    'reachbell_wc_waitlist',
    'reachbell_wc_price_drop',
    'reachbell_wc_events',
    'reachbell_wc_last',
] as $reachbell_option) {
    delete_option($reachbell_option);
}

foreach (['reachbell_wc_check_cart', 'reachbell_wc_send_order_update', 'reachbell_wc_send_back_in_stock', 'reachbell_wc_send_price_drop', 'reachbell_wc_track_event'] as $reachbell_hook) {
    wp_unschedule_hook($reachbell_hook);
}

delete_post_meta_by_key('_reachbell_waitlist_gen');
delete_post_meta_by_key('_reachbell_last_price');
delete_post_meta_by_key('_reachbell_price_drop_sent');
