<?php
/**
 * Plain-PHP checks for the public key rules. No WordPress needed:
 *   php tests/key-validation-test.php
 * Stubs the handful of WP functions reachbell.php touches at load and in
 * the functions under test.
 */

define('ABSPATH', __DIR__ . '/');
define('MINUTE_IN_SECONDS', 60);
define('HOUR_IN_SECONDS', 3600);
define('DAY_IN_SECONDS', 86400);
define('WEEK_IN_SECONDS', 604800);

$GLOBALS['rb_options'] = [];
$GLOBALS['rb_errors'] = [];
$GLOBALS['rb_caps'] = true;

function get_option($name, $default = false) { return $GLOBALS['rb_options'][$name] ?? $default; }
function add_settings_error($setting, $code, $message) { $GLOBALS['rb_errors'][] = $code; }
function sanitize_text_field($s) { return trim(preg_replace('/[\r\n\t]+/', ' ', strip_tags((string) $s))); }
function __($s, $d = null) { return $s; }
function esc_html__($s, $d = null) { return $s; }
function current_user_can($cap) { return $GLOBALS['rb_caps']; }
function plugin_dir_path($f) { return dirname($f) . '/'; }
function plugin_dir_url($f) { return 'https://example.test/wp-content/plugins/reachbell/'; }
function untrailingslashit($s) { return rtrim($s, '/\\'); }
function __return_true() { return true; }
// Anything else WordPress-shaped called at load time is a no-op.
foreach (['add_action', 'add_filter', 'register_activation_hook', 'register_deactivation_hook',
          'register_uninstall_hook', 'load_plugin_textdomain'] as $fn) {
    if (!function_exists($fn)) eval("function $fn() {}");
}

require __DIR__ . '/../reachbell/reachbell.php';

$failures = 0;
function check($label, $actual, $expected) {
    global $failures;
    if ($actual === $expected) { echo "ok   $label\n"; return; }
    $failures++;
    echo "FAIL $label\n     expected " . var_export($expected, true) . ", got " . var_export($actual, true) . "\n";
}
function reset_state(array $options = []) {
    $GLOBALS['rb_options'] = $options;
    $GLOBALS['rb_errors'] = [];
}

// Saving the public key
reset_state();
check('accepts a publishable key', reachbell_sanitize_public_key('  rb_live_abc123 '), 'rb_live_abc123');
check('no error for a publishable key', $GLOBALS['rb_errors'], []);

reset_state();
check('accepts an empty value', reachbell_sanitize_public_key(''), '');

reset_state(['reachbell_api_key' => 'rb_live_old']);
check('refuses a secret key and keeps the old one', reachbell_sanitize_public_key('rb_secret_xyz'), 'rb_live_old');
check('reports the secret key error', $GLOBALS['rb_errors'], ['reachbell_api_key_invalid']);

reset_state(['reachbell_api_key' => 'rb_live_old']);
check('refuses an unknown key shape', reachbell_sanitize_public_key('sk_live_123'), 'rb_live_old');

reset_state(['reachbell_api_key' => 'rb_secret_leaked']);
check('never keeps a secret that was saved earlier', reachbell_sanitize_public_key('garbage'), '');

// What the front end may print
reset_state(['reachbell_api_key' => 'rb_live_abc']);
check('public key returned when publishable', reachbell_public_key(), 'rb_live_abc');
reset_state(['reachbell_api_key' => 'rb_secret_abc']);
check('public key empty for a secret', reachbell_public_key(), '');
check('secret detected', reachbell_public_key_is_secret(), true);
reset_state(['reachbell_api_key' => 'mistyped']);
check('public key empty for any other value', reachbell_public_key(), '');
reset_state();
check('public key empty when unset', reachbell_public_key(), '');

echo $failures ? "\n$failures failing\n" : "\nall passed\n";
exit($failures ? 1 : 0);
