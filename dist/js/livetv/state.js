"use strict";

/* livetv/state.js — the Live TV page's shared state.
 *
 * Live TV is one screen made of several cooperating modules (channels, epg,
 * sidebar, pip, app), and they genuinely share state: which category is
 * selected changes what the channel list renders, what the EPG loader fetches,
 * and which sidebar entry is lit. Rather than thread that through every call,
 * it lives here as a small set of named globals — the same arrangement the page
 * has always had, now written down in one place instead of at the top of a
 * 1300-line file.
 *
 * Loaded FIRST of the livetv modules: the initialisers below run at load time.
 */

// ── Local storage ─────────────────────────────────────────────────────────────
// Thin delegates to core/store.js. Kept as free functions because they are used
// on nearly every line of this page and `Store.get` reads worse at that density.

function load(key, fallback) {
  return Store.get(key, fallback);
}
function save(key, val) {
  return Store.set(key, val);
}
var cfg = null;
var allChannels = [];
var activeCategory = "favs";
/* Which slice of Favourites is showing. One of:
     "all"        every favourite — starred channels, then starred categories
     "<groupId>"  one named group
     "cat:<id>"   one starred category                                        */
var activeFavGroup = "all";
var epgCache = {};
var currentChannel = null;
var epgLoadAbortKey = 0;
var epgBlocked = false; // set true on first 403 — stops all further EPG requests
var _hiddenCatsLive = new Set((load("iptv_hidden_cats_live", []) || []).map(String));
var _keepScrollOnApply = false;
var TIMELINE_HOURS = 3;
var timelineOffset = 0;
var rowCache = new Map();

// ── Settings stub (safe no-op if settings.js is removed) ─────────────────────
if (typeof setSettingsStatus === "undefined") {
  window.setSettingsStatus = function () {};
}