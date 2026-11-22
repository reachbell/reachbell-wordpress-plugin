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
function update_option($name, $value) { $GLOBALS['rb_options'][$name] = $value; return true; }
function delete_option($name) { unset($GLOBALS['rb_options'][$name]); return true; }
function add_settings_error($setting, $code, $message) { $GLOBALS['rb_errors'][] = $code; }
function sanitize_text_field($s) { return trim(preg_replace('/[\r\n\t]+/', ' ', strip_tags((string) $s))); }
function __($s, $d = null) { return $s; }
function esc_html__($s, $d = null) { return $s; }
function current_user_can($cap) { return $GLOBALS['rb_caps']; }
function plugin_dir_path($f) { return dirname($f) . '/'; }
function plugin_dir_url($f) { return 'https://example.test/wp-content/plugins/reachbell/'; }
function untrailingslashit($s) { return rtrim($s, '/\\'); }
function __return_true() { return true; }
function wp_unslash($s) { return stripslashes($s); }
function esc_url($s) { return htmlspecialchars((string) $s, ENT_QUOTES); }
function admin_url($p = '') { return 'https://example.test/wp-admin/' . $p; }
function wp_nonce_url($url, $action) { return $url . '&_wpnonce=nonce-' . $action; }
function check_admin_referer($action) { $GLOBALS['rb_referer_checked'] = $action; return true; }
function wp_die($m = '') { throw new RuntimeException('wp_die'); }
// Anything else WordPress-shaped called at load time is a no-op.
foreach (['add_action', 'add_filter', 'register_activation_hook', 'register_deactivation_hook',
          'register_uninstall_hook', 'load_plugin_textdomain'] as $fn) {
    if (!function_exists($fn)) eval("function $fn() {}");
}

require __DIR__ . '/../reachbell/reachbell.php';

$failures = 0;
const LIVE = 'rb_live_0123456789abcdef0123456789abcdef';
const LIVE_OLD = 'rb_live_ffffffffffffffffffffffffffffffff';
function check($label, $actual, $expected) {
    global $failures;
    if ($actual === $expected) { echo "ok   $label\n"; return; }
    $failures++;
    echo "FAIL $label\n     expected " . var_export($expected, true) . ", got " . var_export($actual, true) . "\n";
}
function reset_state(array $options = [], array $post = []) {
    $GLOBALS['rb_options'] = $options;
    $GLOBALS['rb_errors'] = [];
    $GLOBALS['rb_caps'] = true;
    $_POST = $post;
}

// Saving the public key
reset_state();
check('accepts a publishable key', reachbell_sanitize_public_key('  ' . LIVE . ' '), LIVE);
check('no error for a publishable key', $GLOBALS['rb_errors'], []);

reset_state();
check('accepts an empty value', reachbell_sanitize_public_key(''), '');

reset_state(['reachbell_api_key' => LIVE_OLD, 'reachbell_secret_key' => 'rb_secret_saved']);
check('refuses a secret key and keeps the old one', reachbell_sanitize_public_key('rb_secret_xyz'), LIVE_OLD);
check('reports the secret key error', $GLOBALS['rb_errors'], ['reachbell_api_key_invalid']);
check('keeps the saved secret when one exists', get_option('reachbell_secret_key'), 'rb_secret_saved');

reset_state(['reachbell_api_key' => LIVE_OLD]);
reachbell_sanitize_public_key('rb_secret_pasted');
check('a secret pasted in the public field becomes the secret key', get_option('reachbell_secret_key'), 'rb_secret_pasted');

reset_state(['reachbell_api_key' => LIVE_OLD]);
check('refuses an unknown key shape', reachbell_sanitize_public_key('sk_live_123'), LIVE_OLD);
check('refuses a bare prefix', reachbell_sanitize_public_key('rb_live_'), LIVE_OLD);
check('refuses a truncated key', reachbell_sanitize_public_key(substr(LIVE, 0, 20)), LIVE_OLD);

reset_state(['reachbell_api_key' => 'rb_secret_leaked']);
check('never keeps a secret that was saved earlier', reachbell_sanitize_public_key('garbage'), '');

// What the front end may print
reset_state(['reachbell_api_key' => LIVE]);
check('public key returned when publishable', reachbell_public_key(), LIVE);
reset_state(['reachbell_api_key' => 'rb_secret_abc']);
check('public key empty for a secret', reachbell_public_key(), '');
check('secret detected', reachbell_public_key_is_secret(), true);
reset_state(['reachbell_api_key' => "  rb_secret_abc\n"]);
check('secret detected with surrounding whitespace', reachbell_public_key_is_secret(), true);
reset_state(['reachbell_api_key' => 'rb_live_short']);
check('public key empty for a malformed key', reachbell_public_key(), '');
reset_state();
check('public key empty when unset', reachbell_public_key(), '');

// Moving a secret that an earlier version saved in the public field
reset_state(['reachbell_api_key' => ' rb_secret_old ']);
reachbell_move_misplaced_secret();
check('misplaced secret leaves the public option', get_option('reachbell_api_key'), '');
check('misplaced secret becomes the secret key', get_option('reachbell_secret_key'), 'rb_secret_old');
check('leak is remembered', get_option('reachbell_leaked_secret'), hash('sha256', 'rb_secret_old'));

reset_state(['reachbell_api_key' => 'rb_secret_old', 'reachbell_secret_key' => 'rb_secret_current']);
reachbell_move_misplaced_secret();
check('an existing secret key is not overwritten', get_option('reachbell_secret_key'), 'rb_secret_current');
check('the misplaced secret is still removed', get_option('reachbell_api_key'), '');

reset_state(['reachbell_api_key' => LIVE]);
reachbell_move_misplaced_secret();
check('a valid public key is left alone', get_option('reachbell_api_key'), LIVE);
check('no leak recorded for a valid key', get_option('reachbell_leaked_secret'), false);

// The rotate notice
reset_state(['reachbell_leaked_secret' => hash('sha256', 'rb_secret_old')]);
ob_start(); reachbell_secret_in_public_field_notice(); $out = ob_get_clean();
check('notice shown after a leak', strpos($out, 'Rotate it') !== false, true);
$GLOBALS['rb_caps'] = false;
ob_start(); reachbell_secret_in_public_field_notice(); $out = ob_get_clean();
check('notice hidden from non-admins', $out, '');
$GLOBALS['rb_caps'] = true;
reset_state();
ob_start(); reachbell_secret_in_public_field_notice(); $out = ob_get_clean();
check('no notice without a leak', $out, '');

reset_state(['reachbell_leaked_secret' => hash('sha256', 'rb_secret_old'), 'reachbell_secret_key' => 'rb_secret_old']);
reachbell_sanitize_secret_key('rb_secret_old');
check('re-saving the leaked secret keeps the notice', (bool) get_option('reachbell_leaked_secret'), true);
reachbell_sanitize_secret_key('rb_secret_rotated');
check('saving a rotated secret clears the notice', get_option('reachbell_leaked_secret'), false);

reset_state(['reachbell_leaked_secret' => hash('sha256', 'rb_secret_old'), 'reachbell_secret_key' => 'rb_secret_current']);
reachbell_sanitize_secret_key('rb_secret_current');
check('re-entering the secret that was already saved keeps the notice', (bool) get_option('reachbell_leaked_secret'), true);
reachbell_sanitize_secret_key('rb_secret_old');
check('re-entering the leaked secret keeps the notice', (bool) get_option('reachbell_leaked_secret'), true);
reachbell_sanitize_secret_key('rb_secret_new');
check('a secret new to this site clears the notice', get_option('reachbell_leaked_secret'), false);

reset_state(['reachbell_leaked_secret' => hash('sha256', 'rb_secret_old'), 'reachbell_secret_key' => 'rb_secret_old']);
reachbell_sanitize_secret_key('');
check('leaving the secret field blank keeps the notice', (bool) get_option('reachbell_leaked_secret'), true);

// Dismissing the rotate notice
reset_state(['reachbell_leaked_secret' => hash('sha256', 'rb_secret_old')]);
ob_start(); reachbell_secret_in_public_field_notice(); $out = ob_get_clean();
check('notice has a nonced dismiss link', strpos($out, 'action=reachbell_dismiss_leaked_secret&amp;_wpnonce=nonce-reachbell_dismiss_leaked_secret') !== false, true);
$GLOBALS['rb_caps'] = false;
$denied = false;
try { reachbell_dismiss_leaked_secret(); } catch (RuntimeException $e) { $denied = true; }
check('non-admins cannot dismiss', $denied, true);
check('a refused dismiss keeps the notice', (bool) get_option('reachbell_leaked_secret'), true);

// Secret pasted in the public field while the Secret field is also filled
reset_state(['reachbell_api_key' => LIVE_OLD], ['reachbell_secret_key' => 'rb_secret_typed']);
check('secret in public field with a typed secret keeps the old public key', reachbell_sanitize_public_key('rb_secret_pasted'), LIVE_OLD);
check('the pasted secret is not adopted', get_option('reachbell_secret_key'), false);
check('the typed secret is what gets saved', reachbell_sanitize_secret_key($_POST['reachbell_secret_key']), 'rb_secret_typed');

reset_state(['reachbell_api_key' => LIVE_OLD], ['reachbell_secret_key' => '  ']);
reachbell_sanitize_public_key('rb_secret_pasted');
check('a blank Secret field still lets the pasted secret be adopted', get_option('reachbell_secret_key'), 'rb_secret_pasted');

reset_state(['reachbell_api_key' => LIVE_OLD, 'reachbell_secret_key' => 'rb_secret_saved'], ['reachbell_secret_key' => 'not-a-secret']);
check('secret in public field with an invalid Secret field keeps the old public key', reachbell_sanitize_public_key('rb_secret_pasted'), LIVE_OLD);
check('the invalid Secret field leaves the saved secret alone', reachbell_sanitize_secret_key($_POST['reachbell_secret_key']), 'rb_secret_saved');
check('both fields report an error', $GLOBALS['rb_errors'], ['reachbell_api_key_invalid', 'reachbell_secret_key_invalid']);

reset_state(['reachbell_api_key' => LIVE_OLD], ['reachbell_secret_key' => ['rb_secret_array']]);
reachbell_sanitize_public_key('rb_secret_pasted');
check('an array in the Secret field counts as blank', get_option('reachbell_secret_key'), 'rb_secret_pasted');
check('the array Secret field keeps the adopted secret', reachbell_sanitize_secret_key($_POST['reachbell_secret_key']), 'rb_secret_pasted');
check('only the public field reports, no contradictory Secret error', $GLOBALS['rb_errors'], ['reachbell_api_key_invalid']);

reset_state(['reachbell_secret_key' => 'rb_secret_saved']);
check('an array secret keeps the saved secret', reachbell_sanitize_secret_key(['rb_secret_x']), 'rb_secret_saved');
check('an array secret adds no error', $GLOBALS['rb_errors'], []);
reset_state();
check('an array secret with none saved stays blank', reachbell_sanitize_secret_key(['x']), '');

// A saved public key that isn't valid (e.g. truncated by an older version)
reset_state(['reachbell_api_key' => substr(LIVE, 0, 20)]);
check('invalid saved key detected', reachbell_public_key_is_invalid(), true);
check('invalid saved key is replaced by empty, not kept', reachbell_sanitize_public_key('still-wrong'), '');
reset_state(['reachbell_api_key' => LIVE]);
check('valid saved key is not flagged', reachbell_public_key_is_invalid(), false);
reset_state(['reachbell_api_key' => 'rb_secret_abc']);
check('a saved secret is not flagged as an invalid public key', reachbell_public_key_is_invalid(), false);
reset_state();
check('no saved key is not flagged', reachbell_public_key_is_invalid(), false);

echo $failures ? "\n$failures failing\n" : "\nall passed\n";
exit($failures ? 1 : 0);
