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
