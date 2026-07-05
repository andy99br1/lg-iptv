"use strict";

// prewarm.js — silently refreshes the channel cache while the user is on the
// homepage so Live TV opens instantly without a loading spinner.
// Only runs for Xtream sources (M3U playlists can be large and are best
// fetched on demand). Requires iptv-core.js, loaded before this on index.html.

(function () {
  var CHANNEL_CACHE_KEY = "iptv_ch_v2";
  var CAT_CACHE_KEY = "iptv_cat_v2";
  var CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — matches app.js

  function save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {}
  }
  function cacheIsValid() {
    try {
      var raw = localStorage.getItem(CHANNEL_CACHE_KEY);
      if (!raw) return false;
      return Date.now() - JSON.parse(raw).ts < CACHE_TTL_MS;
    } catch (e) {
      return false;
    }
  }
  function fetchJSON(url) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () {
      ctrl.abort();
    }, 20000);
    return fetch(url, {
      signal: ctrl.signal
    }).then(function (r) {
      clearTimeout(tid);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).catch(function (e) {
      clearTimeout(tid);
      throw e;
    });
  }
  function run() {
    if (IPTVCore.load("iptv_source_type", "xtream") !== "xtream") return;
    if (cacheIsValid()) return;
    var cfg = IPTVCore.resolveConfig();
    if (!cfg || cfg.type === "m3u" || !cfg.server_url) return;
    Promise.all([fetchJSON(IPTVCore.apiUrl(cfg, "action=get_live_streams")), fetchJSON(IPTVCore.apiUrl(cfg, "action=get_live_categories"))]).then(function (results) {
      var channels = results[0];
      var categories = results[1];
      if (!Array.isArray(channels) || !channels.length) return;
      if (!Array.isArray(categories)) categories = [];

      // Slim channels to match what app.js stores (keeps localStorage small)
      var slim = channels.map(function (ch) {
        return {
          stream_id: ch.stream_id,
          name: ch.name,
          category_id: ch.category_id,
          stream_icon: ch.stream_icon || "",
          epg_channel_id: ch.epg_channel_id || ""
        };
      });
      save(CHANNEL_CACHE_KEY, {
        ts: Date.now(),
        data: slim
      });
      save(CAT_CACHE_KEY, {
        ts: Date.now(),
        data: categories
      });
    }).catch(function () {});
  }

  // Delay 4 s — lets the page render and the update check finish first
  setTimeout(run, 4000);
})();