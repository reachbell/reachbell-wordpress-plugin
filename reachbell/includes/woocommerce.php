<?php

if (!defined('ABSPATH')) exit;

define('REACHBELL_WC_DEFAULT_CART_DELAY', 60);
define('REACHBELL_WC_PRICE_DROP_COOLDOWN', DAY_IN_SECONDS);

function reachbell_wc_active() {
    return class_exists('WooCommerce');
}

function reachbell_wc_option($name) {
    $defaults = [
        'reachbell_wc_order_updates' => false,
        'reachbell_wc_abandoned_cart' => false,
        'reachbell_wc_cart_delay' => REACHBELL_WC_DEFAULT_CART_DELAY,
        'reachbell_wc_waitlist' => false,
        'reachbell_wc_price_drop' => false,
        'reachbell_wc_events' => true,
    ];
    return get_option($name, isset($defaults[$name]) ? $defaults[$name] : false);
}

function reachbell_wc_register_settings() {
    foreach (['reachbell_wc_order_updates', 'reachbell_wc_abandoned_cart', 'reachbell_wc_waitlist', 'reachbell_wc_price_drop', 'reachbell_wc_events'] as $name) {
        register_setting('reachbell', $name, [
            'type'              => 'boolean',
            'sanitize_callback' => 'rest_sanitize_boolean',
            'default'           => $name === 'reachbell_wc_events',
        ]);
    }
    register_setting('reachbell', 'reachbell_wc_cart_delay', [
        'type'              => 'integer',
        'sanitize_callback' => 'reachbell_wc_sanitize_delay',
        'default'           => REACHBELL_WC_DEFAULT_CART_DELAY,
    ]);
}
add_action('admin_init', 'reachbell_wc_register_settings');

function reachbell_wc_sanitize_delay($value) {
    $value = absint($value);
    if ($value < 15) $value = 15;
    if ($value > 2880) $value = 2880;
    return $value;
}

function reachbell_wc_declare_compat() {
    if (class_exists('\Automattic\WooCommerce\Utilities\FeaturesUtil')) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', REACHBELL_FILE, true);
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('cart_checkout_blocks', REACHBELL_FILE, true);
    }
}
add_action('before_woocommerce_init', 'reachbell_wc_declare_compat');

function reachbell_wc_settings_rows() {
    if (!reachbell_wc_active()) return;
    $rows = [
        'reachbell_wc_order_updates' => [__('Order updates', 'reachbell'), __('Push the shopper when their order status changes (processing, completed, refunded, cancelled and custom statuses).', 'reachbell')],
        'reachbell_wc_abandoned_cart' => [__('Abandoned-cart reminders', 'reachbell'), __('Push a reminder when a subscribed shopper leaves items in their cart without ordering.', 'reachbell')],
        'reachbell_wc_waitlist' => [__('Back-in-stock waitlist', 'reachbell'), __('Show a "Notify me" button on out-of-stock products and push everyone waiting when the product is back in stock.', 'reachbell')],
        'reachbell_wc_price_drop' => [__('Price-drop alerts', 'reachbell'), __('Push shoppers who added a product to their cart when its price goes down (at most once a day per product).', 'reachbell')],
        'reachbell_wc_events' => [__('Send store events', 'reachbell'), __('Send order, cart and stock events to ReachBell so dashboard automations can react to them.', 'reachbell')],
    ];
    ?>
    <tr>
        <th colspan="2"><h2 style="margin:0;"><?php esc_html_e('WooCommerce', 'reachbell'); ?></h2>
            <p class="description" style="font-weight:normal;"><?php esc_html_e('These need the secret key above. Order updates and abandoned-cart reminders use the transactional API, which is on the Starter plan and above.', 'reachbell'); ?></p>
        </th>
    </tr>
    <?php foreach ($rows as $name => $labels) : ?>
        <tr>
            <th><?php echo esc_html($labels[0]); ?></th>
            <td>
                <label>
                    <input type="checkbox" name="<?php echo esc_attr($name); ?>" value="1" <?php checked((bool) reachbell_wc_option($name)); ?> />
                    <span class="description"><?php echo esc_html($labels[1]); ?></span>
                </label>
                <?php if ($name === 'reachbell_wc_abandoned_cart') : ?>
                    <p>
                        <label for="reachbell_wc_cart_delay"><?php esc_html_e('Send after', 'reachbell'); ?></label>
                        <input type="number" min="15" max="2880" step="5" name="reachbell_wc_cart_delay" id="reachbell_wc_cart_delay" value="<?php echo esc_attr((string) reachbell_wc_option('reachbell_wc_cart_delay')); ?>" class="small-text" />
                        <?php esc_html_e('minutes without checkout', 'reachbell'); ?>
                    </p>
                <?php endif; ?>
            </td>
        </tr>
    <?php endforeach; ?>
    <?php $last = get_option('reachbell_wc_last'); ?>
    <?php if (is_array($last) && !empty($last['message'])) : ?>
        <tr>
            <th><?php esc_html_e('Last store message', 'reachbell'); ?></th>
            <td><p class="description">
                <?php
                echo esc_html(sprintf(
                    /* translators: 1: date and time, 2: result message */
                    __('%1$s: %2$s', 'reachbell'),
                    wp_date(get_option('date_format') . ' ' . get_option('time_format'), (int) $last['time']),
                    $last['message']
                ));
                ?>
            </p></td>
        </tr>
    <?php endif; ?>
    <?php
}
add_action('reachbell_settings_rows', 'reachbell_wc_settings_rows');

function reachbell_api_request($path, array $payload) {
    $secret_key = get_option('reachbell_secret_key');
    if (!$secret_key) {
        return ['ok' => false, 'code' => 0, 'message' => __('no secret key saved', 'reachbell')];
    }
    $response = wp_remote_post(reachbell_api_url() . $path, [
        'headers' => [
            'Content-Type' => 'application/json',
            'x-api-key'    => $secret_key,
        ],
        'body'    => wp_json_encode($payload),
        'timeout' => 15,
    ]);
    if (is_wp_error($response)) {
        return ['ok' => false, 'code' => 0, 'message' => $response->get_error_message()];
    }
    $code = (int) wp_remote_retrieve_response_code($response);
    $body = json_decode(wp_remote_retrieve_body($response), true);
    $detail = '';
    if (is_array($body) && isset($body['message'])) {
        $detail = is_array($body['message']) ? implode('; ', $body['message']) : (string) $body['message'];
    }
    return ['ok' => $code >= 200 && $code < 300, 'code' => $code, 'message' => $detail, 'body' => $body];
}

function reachbell_send(array $args) {
    $args = wp_parse_args($args, [
        'title'       => '',
        'body'        => '',
        'url'         => '',
        'image'       => '',
        'icon'        => get_site_icon_url(192),
        'external_id' => '',
        'tags'        => [],
        'segment'     => '',
        'name'        => '',
    ]);
    $title = wp_strip_all_tags((string) $args['title']);
    $body  = wp_strip_all_tags((string) $args['body']);
    if ($title === '' || $body === '') {
        return ['ok' => false, 'code' => 0, 'message' => __('title and body are required', 'reachbell')];
    }
    if ($args['external_id'] !== '') {
        $payload = array_filter([
            'externalId' => (string) $args['external_id'],
            'title'      => $title,
            'body'       => $body,
            'url'        => esc_url_raw((string) $args['url']),
            'iconUrl'    => esc_url_raw((string) $args['icon']),
            'imageUrl'   => esc_url_raw((string) $args['image']),
        ]);
        return reachbell_api_request('/transactional/send', $payload);
    }
    $tags = array_values(array_filter(array_map('strval', (array) $args['tags'])));
    if ($args['segment'] !== '') $tags[] = (string) $args['segment'];
    return reachbell_api_request('/campaigns/server', [
        'name'    => $args['name'] !== '' ? (string) $args['name'] : $title,
        'content' => array_filter([
            'title'    => $title,
            'body'     => $body,
            'clickUrl' => esc_url_raw((string) $args['url']),
            'iconUrl'  => esc_url_raw((string) $args['icon']),
            'imageUrl' => esc_url_raw((string) $args['image']),
        ]),
        'segment' => $tags ? ['tags' => $tags] : new stdClass(),
    ]);
}

function reachbell_track($name, $external_id, array $properties = []) {
    if (!reachbell_wc_option('reachbell_wc_events') || !$external_id) return null;
    return reachbell_api_request('/events', [
        'name'       => (string) $name,
        'externalId' => (string) $external_id,
        'properties' => $properties,
    ]);
}

function reachbell_wc_log($label, array $result) {
    $message = $result['ok']
        ? sprintf(
            /* translators: %s is what was sent */
            __('%s sent', 'reachbell'),
            $label
        )
        : sprintf(
            /* translators: 1: what was sent, 2: HTTP status code, 3: error detail */
            __('%1$s failed (HTTP %2$d) %3$s', 'reachbell'),
            $label,
            (int) $result['code'],
            (string) $result['message']
        );
    update_option('reachbell_wc_last', ['time' => time(), 'message' => $message], false);
}

function reachbell_wc_external_id($create = false) {
    $user_id = get_current_user_id();
    if ($user_id) return 'wc_customer_' . $user_id;
    if (!function_exists('WC') || !WC()->session) return '';
    $id = WC()->session->get('reachbell_external_id');
    if (!$id && $create) {
        if (!WC()->session->has_session()) WC()->session->set_customer_session_cookie(true);
        $id = 'wc_guest_' . str_replace('-', '', wp_generate_uuid4());
        WC()->session->set('reachbell_external_id', $id);
    }
    return $id ? (string) $id : '';
}

function reachbell_wc_order_external_id($order) {
    $id = (string) $order->get_meta('_reachbell_external_id');
    if ($id) return $id;
    $customer = (int) $order->get_customer_id();
    return $customer ? 'wc_customer_' . $customer : '';
}

function reachbell_wc_queue_tag($tag) {
    if (!function_exists('WC') || !WC()->session) return;
    $tags = (array) WC()->session->get('reachbell_pending_tags', []);
    $tags[] = (string) $tag;
    WC()->session->set('reachbell_pending_tags', array_values(array_unique($tags)));
}

function reachbell_wc_waitlist_tag($product_id) {
    $generation = (int) get_post_meta($product_id, '_reachbell_waitlist_gen', true);
    return 'wc_waitlist_' . $product_id . '_' . $generation;
}

function reachbell_wc_cart_tag($product_id) {
    return 'wc_cart_' . $product_id;
}

function reachbell_wc_enqueue() {
    // reachbell-sdk is only enqueued with a valid public key.
    if (!reachbell_wc_active() || !wp_script_is('reachbell-sdk', 'enqueued')) return;

    wp_enqueue_script('reachbell-woo', REACHBELL_URL . 'assets/reachbell-woo.js', ['reachbell-sdk'], REACHBELL_VERSION, true);

    $config = [
        'externalId' => reachbell_wc_external_id(false),
        'tags'       => [],
        'waitlist'   => null,
        'cartTags'   => (bool) reachbell_wc_option('reachbell_wc_price_drop'),
        'i18n'       => [
            'notify'    => __('Notify me when it is back', 'reachbell'),
            'subscribed' => __('We will let you know', 'reachbell'),
            'blocked'   => __('Allow notifications in your browser to get the alert', 'reachbell'),
        ],
    ];

    if (function_exists('WC') && WC()->session) {
        $pending = (array) WC()->session->get('reachbell_pending_tags', []);
        if ($pending) {
            $config['tags'] = array_values($pending);
            WC()->session->set('reachbell_pending_tags', []);
        }
    }

    if (reachbell_wc_option('reachbell_wc_waitlist') && is_product()) {
        $product = wc_get_product(get_queried_object_id());
        if ($product && !$product->is_in_stock()) {
            $config['waitlist'] = [
                'productId' => $product->get_id(),
                'tag'       => reachbell_wc_waitlist_tag($product->get_id()),
            ];
        }
    }

    wp_add_inline_script('reachbell-woo', 'window.ReachBellWoo=' . wp_json_encode($config) . ';', 'before');
}
add_action('wp_enqueue_scripts', 'reachbell_wc_enqueue', 20);

function reachbell_wc_on_add_to_cart($cart_item_key, $product_id) {
    if (reachbell_wc_option('reachbell_wc_price_drop')) {
        reachbell_wc_queue_tag(reachbell_wc_cart_tag((int) $product_id));
    }
}
add_action('woocommerce_add_to_cart', 'reachbell_wc_on_add_to_cart', 10, 2);

function reachbell_wc_on_cart_updated() {
    if (!reachbell_wc_option('reachbell_wc_abandoned_cart') && !reachbell_wc_option('reachbell_wc_events')) return;
    if (!function_exists('WC') || !WC()->cart || WC()->cart->is_empty()) return;
    $external_id = reachbell_wc_external_id(true);
    if (!$external_id) return;

    $stamp = time();
    $items = [];
    foreach (WC()->cart->get_cart() as $item) {
        if (empty($item['data']) || !is_object($item['data'])) continue;
        $items[] = [
            'id'    => (int) $item['product_id'],
            'name'  => $item['data']->get_name(),
            'qty'   => (int) $item['quantity'],
            'image' => wp_get_attachment_image_url($item['data']->get_image_id(), 'woocommerce_single') ?: '',
        ];
        if (count($items) >= 10) break;
    }
    set_transient('reachbell_cart_' . md5($external_id), [
        'stamp' => $stamp,
        'items' => $items,
        'total' => (float) WC()->cart->get_total('edit'),
        'currency' => get_woocommerce_currency(),
    ], 3 * DAY_IN_SECONDS);

    $delay = (int) reachbell_wc_option('reachbell_wc_cart_delay') * MINUTE_IN_SECONDS;
    wp_schedule_single_event($stamp + $delay, 'reachbell_wc_check_cart', [$external_id, $stamp]);
}
add_action('woocommerce_cart_updated', 'reachbell_wc_on_cart_updated');

function reachbell_wc_clear_cart_state() {
    $external_id = reachbell_wc_external_id(false);
    if ($external_id) delete_transient('reachbell_cart_' . md5($external_id));
}
add_action('woocommerce_cart_emptied', 'reachbell_wc_clear_cart_state');

function reachbell_wc_check_cart($external_id, $stamp) {
    $state = get_transient('reachbell_cart_' . md5($external_id));
    if (!is_array($state) || (int) $state['stamp'] !== (int) $stamp || empty($state['items'])) return;
    delete_transient('reachbell_cart_' . md5($external_id));

    $first = $state['items'][0];
    $count = array_sum(array_column($state['items'], 'qty'));
    reachbell_track('woo_cart_abandoned', $external_id, [
        'items'    => $state['items'],
        'total'    => $state['total'],
        'currency' => $state['currency'],
    ]);
    if (!reachbell_wc_option('reachbell_wc_abandoned_cart')) return;

    $result = reachbell_send([
        'external_id' => $external_id,
        'title'       => __('You left something in your cart', 'reachbell'),
        'body'        => $count > 1
            ? sprintf(
                /* translators: 1: product name, 2: number of other items */
                _n('%1$s and %2$d more item are waiting for you.', '%1$s and %2$d more items are waiting for you.', $count - 1, 'reachbell'),
                $first['name'],
                $count - 1
            )
            : sprintf(
                /* translators: %s is the product name */
                __('%s is still waiting for you.', 'reachbell'),
                $first['name']
            ),
        'url'         => wc_get_cart_url(),
        'image'       => $first['image'],
    ]);
    reachbell_wc_log(__('Abandoned-cart reminder', 'reachbell'), $result);
}
add_action('reachbell_wc_check_cart', 'reachbell_wc_check_cart', 10, 2);

function reachbell_wc_on_order_created($order) {
    if (is_numeric($order)) $order = wc_get_order($order);
    if (!$order) return;
    $external_id = reachbell_wc_external_id(false);
    if ($external_id && !$order->get_meta('_reachbell_external_id')) {
        $order->update_meta_data('_reachbell_external_id', $external_id);
        $order->save();
    }
    if ($external_id) delete_transient('reachbell_cart_' . md5($external_id));
    $id = reachbell_wc_order_external_id($order);
    if ($id) {
        wp_schedule_single_event(time(), 'reachbell_wc_track_event', ['woo_order_placed', $id, [
            'orderId'  => $order->get_id(),
            'number'   => $order->get_order_number(),
            'total'    => (float) $order->get_total(),
            'currency' => $order->get_currency(),
        ]]);
    }
}
add_action('woocommerce_checkout_order_created', 'reachbell_wc_on_order_created');
add_action('woocommerce_store_api_checkout_order_processed', 'reachbell_wc_on_order_created');

function reachbell_wc_track_event($name, $external_id, $properties) {
    reachbell_track($name, $external_id, (array) $properties);
}
add_action('reachbell_wc_track_event', 'reachbell_wc_track_event', 10, 3);

function reachbell_wc_on_status_changed($order_id, $from, $to) {
    if (!reachbell_wc_option('reachbell_wc_order_updates') && !reachbell_wc_option('reachbell_wc_events')) return;
    if (in_array($to, ['pending', 'checkout-draft'], true)) return;
    wp_schedule_single_event(time(), 'reachbell_wc_send_order_update', [(int) $order_id, (string) $to]);
}
add_action('woocommerce_order_status_changed', 'reachbell_wc_on_status_changed', 10, 3);

function reachbell_wc_order_message($order, $status) {
    $number = $order->get_order_number();
    $messages = [
        'processing' => [__('Order confirmed', 'reachbell'), sprintf(
            /* translators: %s is the order number */
            __('Thanks! Order #%s is confirmed and being prepared.', 'reachbell'),
            $number
        )],
        'completed'  => [__('Order complete', 'reachbell'), sprintf(
            /* translators: %s is the order number */
            __('Order #%s is complete. Thanks for shopping with us!', 'reachbell'),
            $number
        )],
        'on-hold'    => [__('Order on hold', 'reachbell'), sprintf(
            /* translators: %s is the order number */
            __('Order #%s is on hold while we confirm your payment.', 'reachbell'),
            $number
        )],
        'refunded'   => [__('Refund issued', 'reachbell'), sprintf(
            /* translators: %s is the order number */
            __('Your refund for order #%s has been issued.', 'reachbell'),
            $number
        )],
        'cancelled'  => [__('Order cancelled', 'reachbell'), sprintf(
            /* translators: %s is the order number */
            __('Order #%s has been cancelled.', 'reachbell'),
            $number
        )],
        'failed'     => [__('Payment failed', 'reachbell'), sprintf(
            /* translators: %s is the order number */
            __('Payment for order #%s did not go through. Tap to try again.', 'reachbell'),
            $number
        )],
    ];
    if (isset($messages[$status])) {
        $message = $messages[$status];
    } else {
        $message = [__('Order update', 'reachbell'), sprintf(
            /* translators: 1: order number, 2: status name */
            __('Order #%1$s is now %2$s.', 'reachbell'),
            $number,
            wc_get_order_status_name($status)
        )];
    }
    return apply_filters('reachbell_wc_order_message', $message, $order, $status);
}

function reachbell_wc_send_order_update($order_id, $status) {
    $order = wc_get_order($order_id);
    if (!$order) return;
    $external_id = reachbell_wc_order_external_id($order);
    if (!$external_id) return;

    reachbell_track('woo_order_' . str_replace('-', '_', $status), $external_id, [
        'orderId'  => $order->get_id(),
        'number'   => $order->get_order_number(),
        'total'    => (float) $order->get_total(),
        'currency' => $order->get_currency(),
    ]);
    if (!reachbell_wc_option('reachbell_wc_order_updates')) return;

    list($title, $body) = reachbell_wc_order_message($order, $status);
    $url = $status === 'failed' ? $order->get_checkout_payment_url() : $order->get_view_order_url();
    $result = reachbell_send([
        'external_id' => $external_id,
        'title'       => $title,
        'body'        => $body,
        'url'         => $url,
    ]);
    reachbell_wc_log(sprintf(
        /* translators: %s is the order number */
        __('Order #%s update', 'reachbell'),
        $order->get_order_number()
    ), $result);
}
add_action('reachbell_wc_send_order_update', 'reachbell_wc_send_order_update', 10, 2);

function reachbell_wc_on_stock_status($product_id, $status) {
    if ($status !== 'instock' || !reachbell_wc_option('reachbell_wc_waitlist')) return;
    $product = wc_get_product($product_id);
    if ($product && $product->get_parent_id()) $product_id = $product->get_parent_id();
    wp_schedule_single_event(time(), 'reachbell_wc_send_back_in_stock', [(int) $product_id]);
}
add_action('woocommerce_product_set_stock_status', 'reachbell_wc_on_stock_status', 10, 2);
add_action('woocommerce_variation_set_stock_status', 'reachbell_wc_on_stock_status', 10, 2);

function reachbell_wc_send_back_in_stock($product_id) {
    $product = wc_get_product($product_id);
    if (!$product || !$product->is_in_stock()) return;
    $tag = reachbell_wc_waitlist_tag($product_id);
    update_post_meta($product_id, '_reachbell_waitlist_gen', (int) get_post_meta($product_id, '_reachbell_waitlist_gen', true) + 1);

    $result = reachbell_send([
        'name'  => sprintf(
            /* translators: %s is the product name */
            __('Back in stock: %s', 'reachbell'),
            $product->get_name()
        ),
        'title' => sprintf(
            /* translators: %s is the product name */
            __('Back in stock: %s', 'reachbell'),
            $product->get_name()
        ),
        'body'  => __('The item you were waiting for is available again. Tap to grab yours.', 'reachbell'),
        'url'   => get_permalink($product_id),
        'image' => wp_get_attachment_image_url($product->get_image_id(), 'woocommerce_single') ?: '',
        'tags'  => [$tag],
    ]);
    reachbell_wc_log(sprintf(
        /* translators: %s is the product name */
        __('Back-in-stock alert for %s', 'reachbell'),
        $product->get_name()
    ), $result);
}
add_action('reachbell_wc_send_back_in_stock', 'reachbell_wc_send_back_in_stock', 10, 1);

function reachbell_wc_on_product_saved($product_id) {
    if (!reachbell_wc_option('reachbell_wc_price_drop')) return;
    $product = wc_get_product($product_id);
    if (!$product || $product->is_type('variation')) return;
    $price = (float) $product->get_price('edit');
    if ($product->is_type('variable')) $price = (float) $product->get_variation_price('min');
    $last = get_post_meta($product_id, '_reachbell_last_price', true);
    update_post_meta($product_id, '_reachbell_last_price', $price);
    if ($last === '' || $price <= 0 || $price >= (float) $last) return;
    $sent = (int) get_post_meta($product_id, '_reachbell_price_drop_sent', true);
    if ($sent && time() - $sent < REACHBELL_WC_PRICE_DROP_COOLDOWN) return;
    update_post_meta($product_id, '_reachbell_price_drop_sent', time());
    wp_schedule_single_event(time(), 'reachbell_wc_send_price_drop', [(int) $product_id, (float) $last, $price]);
}
add_action('woocommerce_update_product', 'reachbell_wc_on_product_saved');
add_action('woocommerce_new_product', 'reachbell_wc_on_product_saved');

function reachbell_wc_send_price_drop($product_id, $old_price, $new_price) {
    $product = wc_get_product($product_id);
    if (!$product || !$product->is_in_stock()) return;
    $result = reachbell_send([
        'name'  => sprintf(
            /* translators: %s is the product name */
            __('Price drop: %s', 'reachbell'),
            $product->get_name()
        ),
        'title' => sprintf(
            /* translators: %s is the product name */
            __('Price drop: %s', 'reachbell'),
            $product->get_name()
        ),
        'body'  => sprintf(
            /* translators: 1: new price, 2: old price */
            __('Now %1$s (was %2$s). Tap to take a look.', 'reachbell'),
            html_entity_decode(wp_strip_all_tags(wc_price($new_price))),
            html_entity_decode(wp_strip_all_tags(wc_price($old_price)))
        ),
        'url'   => get_permalink($product_id),
        'image' => wp_get_attachment_image_url($product->get_image_id(), 'woocommerce_single') ?: '',
        'tags'  => [reachbell_wc_cart_tag($product_id)],
    ]);
    reachbell_wc_log(sprintf(
        /* translators: %s is the product name */
        __('Price-drop alert for %s', 'reachbell'),
        $product->get_name()
    ), $result);
}
add_action('reachbell_wc_send_price_drop', 'reachbell_wc_send_price_drop', 10, 3);

function reachbell_wc_deactivate() {
    foreach (['reachbell_wc_check_cart', 'reachbell_wc_send_order_update', 'reachbell_wc_send_back_in_stock', 'reachbell_wc_send_price_drop', 'reachbell_wc_track_event'] as $hook) {
        wp_unschedule_hook($hook);
    }
}

function reachbell_wc_render_waitlist() {
    if (!reachbell_wc_option('reachbell_wc_waitlist') || reachbell_public_key() === '') return;
    global $product;
    if (!$product || $product->is_in_stock()) return;
    ?>
    <div class="reachbell-waitlist" style="margin:1em 0;">
        <button type="button" class="button alt" data-reachbell-waitlist="<?php echo esc_attr((string) $product->get_id()); ?>">
            <?php esc_html_e('Notify me when it is back', 'reachbell'); ?>
        </button>
        <p class="reachbell-waitlist-note" style="margin:.5em 0 0;font-size:.9em;" aria-live="polite"></p>
    </div>
    <?php
}
add_action('woocommerce_single_product_summary', 'reachbell_wc_render_waitlist', 31);
