(function () {
  var cfg = window.ReachBellWoo || {};
  var RETRY = { no_subscription: 1, sdk_not_initialized: 1, timed_out: 1, network_error: 1 };

  function withSdk(run, tries, wait) {
    var count = 0;
    function go() {
      var sdk = window.ReachBell;
      if (!sdk) {
        if (++count < tries) setTimeout(go, 1000);
        return;
      }
      Promise.resolve(run(sdk))
        .then(function (res) {
          if (res && res.ok === false && RETRY[res.reason] && ++count < tries) setTimeout(go, wait);
        })
        .catch(function () {});
    }
    go();
  }

  function identify() {
    if (!cfg.externalId) return;
    withSdk(function (sdk) { return sdk.identify(cfg.externalId); }, 20, 3000);
  }

  function flushTags() {
    if (!cfg.tags || !cfg.tags.length) return;
    var tags = cfg.tags.slice();
    withSdk(function (sdk) { return sdk.tag(tags); }, 20, 3000);
  }

  function waitlist() {
    var button = document.querySelector('[data-reachbell-waitlist]');
    if (!button || !cfg.waitlist) return;
    var note = button.parentNode.querySelector('.reachbell-waitlist-note');
    function say(text) { if (note) note.textContent = text; }
    button.addEventListener('click', function () {
      var sdk = window.ReachBell;
      if (!sdk) return;
      button.disabled = true;
      sdk.prompt()
        .then(function (res) {
          if (!res || !res.success) {
            button.disabled = false;
            say(cfg.i18n.blocked);
            return null;
          }
          if (cfg.externalId) sdk.identify(cfg.externalId);
          return sdk.tag([cfg.waitlist.tag]).then(function (tagged) {
            if (tagged && tagged.ok) {
              button.textContent = cfg.i18n.subscribed;
              say('');
            } else {
              button.disabled = false;
            }
          });
        })
        .catch(function () { button.disabled = false; });
    });
  }

  function start() {
    identify();
    flushTags();
    waitlist();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
