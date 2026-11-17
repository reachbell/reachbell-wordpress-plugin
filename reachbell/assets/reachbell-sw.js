/**
 * ReachBell Service Worker  v2.0.0
 * ─────────────────────────────────────────────────────────────────
 * Handles incoming push events and notification click tracking.
 * This file MUST be served from the root of your domain (e.g. /reachbell-sw.js).
 *
 * The API URL is persisted via the Cache API so it survives SW restarts.
 * ─────────────────────────────────────────────────────────────────
 */

var REACHBELL_API_URL = self.location.origin; // in-memory fallback
var RB_CACHE_KEY = 'reachbell-config-v1';

/* ── Persist/Load API URL via Cache API ──────────────────────── */
async function saveApiUrl(url) {
  try {
    var cache = await caches.open(RB_CACHE_KEY);
    var response = new Response(JSON.stringify({ apiUrl: url }));
    await cache.put('/reachbell-config', response);
  } catch (e) { /* cache write is best-effort */ }
}

async function loadApiUrl() {
  try {
    var cache = await caches.open(RB_CACHE_KEY);
    var response = await cache.match('/reachbell-config');
    if (response) {
      var data = await response.json();
      if (data.apiUrl) {
        REACHBELL_API_URL = data.apiUrl;
      }
    }
  } catch (e) { /* cache read is best-effort */ }
  return REACHBELL_API_URL;
}

/* ── Lifecycle ────────────────────────────────────────────────── */
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    loadApiUrl().then(function () { return self.clients.claim(); })
  );
});

/* ── Config message from the main page ───────────────────────── */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'REACHBELL_CONFIG') {
    REACHBELL_API_URL = (event.data.apiUrl || REACHBELL_API_URL).replace(/\/$/, '');
    saveApiUrl(REACHBELL_API_URL);
  }
});

/* ── Push event ───────────────────────────────────────────────── */
self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    console.error('[ReachBell SW] Failed to parse push payload:', err);
    return;
  }

  var notifActions = [];
  if (data.actions && data.actions.length > 0) {
    data.actions.forEach(function (a) {
      notifActions.push({
        action: a.action || 'action',
        title:  a.title || 'Open',
      });
    });
  }

  var options = {
    body:  data.body    || '',
    icon:  data.iconUrl || '/favicon.ico',
    image: data.imageUrl,
    badge: data.badge,
    data:  {
      clickUrl:     data.clickUrl,
      campaignId:   data.campaignId,
      subscriberId: data.subscriberId,
      actions:      data.actions || [],
      analyticsUrl: data.analyticsUrl || '',
      token:        data.token || '',
    },
    requireInteraction: notifActions.length > 0,
    actions: notifActions,
  };

  Object.keys(options).forEach(function (k) {
    if (options[k] === undefined || options[k] === null || options[k] === '') {
      delete options[k];
    }
  });

  event.waitUntil(
    self.registration.showNotification(data.title || 'New Message', options)
      .then(function () {
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
          list.forEach(function (client) {
            client.postMessage({
              type: 'REACHBELL_NOTIFICATION',
              notification: {
                id: data.campaignId ? 'nh_' + data.campaignId : undefined,
                title: data.title || 'New Message',
                body: data.body || '',
                url: data.clickUrl || data.url || '',
                icon: data.iconUrl || '',
              },
            });
          });
        }).catch(function () {});
        // Fire-and-forget impression ping AFTER the OS has rendered.
        if (!data.campaignId || !data.subscriberId) return;
        return loadApiUrl().then(function (apiUrl) {
          var url = (apiUrl || self.location.origin).replace(/\/$/, '') +
                    '/campaigns/analytics/delivered';
          return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaignId: data.campaignId,
              subscriberId: data.subscriberId,
              token: data.token || '',
            }),
            keepalive: true,
          }).catch(function () { /* best-effort */ });
        });
      })
  );
});

/* ── Notification click ───────────────────────────────────────── */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  var clickData    = event.notification.data || {};
  var campaignId   = clickData.campaignId;
  var subscriberId = clickData.subscriberId;
  var clickUrl     = clickData.clickUrl;

  if (event.action && clickData.actions && clickData.actions.length > 0) {
    for (var i = 0; i < clickData.actions.length; i++) {
      if (clickData.actions[i].action === event.action && clickData.actions[i].url) {
        clickUrl = clickData.actions[i].url;
        break;
      }
    }
  }

  if (campaignId && subscriberId) {
    var analyticsEndpoint = clickData.analyticsUrl || '';

    event.waitUntil(
      (analyticsEndpoint
        ? Promise.resolve(analyticsEndpoint)
        : loadApiUrl().then(function (apiUrl) { return apiUrl + '/campaigns/analytics/click'; })
      ).then(function (url) {
        return fetch(url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ campaignId: campaignId, subscriberId: subscriberId, token: clickData.token || '', action: event.action || 'main' }),
          keepalive: true,
        });
      }).catch(function (err) {
        console.error('[ReachBell SW] Click analytics failed:', err);
      })
    );
  }

  if (clickUrl) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url === clickUrl && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(clickUrl);
      })
    );
  }
});

/* ── Notification close ───────────────────────────────────────── */
self.addEventListener('notificationclose', function (event) {
  // Optional: track dismiss events here in a future release
});
