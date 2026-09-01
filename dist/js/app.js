"use strict";

function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t.return && (u = t.return(), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }
function _regenerator() { /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/babel/babel/blob/main/packages/babel-helpers/LICENSE */ var e, t, r = "function" == typeof Symbol ? Symbol : {}, n = r.iterator || "@@iterator", o = r.toStringTag || "@@toStringTag"; function i(r, n, o, i) { var c = n && n.prototype instanceof Generator ? n : Generator, u = Object.create(c.prototype); return _regeneratorDefine2(u, "_invoke", function (r, n, o) { var i, c, u, f = 0, p = o || [], y = !1, G = { p: 0, n: 0, v: e, a: d, f: d.bind(e, 4), d: function d(t, r) { return i = t, c = 0, u = e, G.n = r, a; } }; function d(r, n) { for (c = r, u = n, t = 0; !y && f && !o && t < p.length; t++) { var o, i = p[t], d = G.p, l = i[2]; r > 3 ? (o = l === n) && (u = i[(c = i[4]) ? 5 : (c = 3, 3)], i[4] = i[5] = e) : i[0] <= d && ((o = r < 2 && d < i[1]) ? (c = 0, G.v = n, G.n = i[1]) : d < l && (o = r < 3 || i[0] > n || n > l) && (i[4] = r, i[5] = n, G.n = l, c = 0)); } if (o || r > 1) return a; throw y = !0, n; } return function (o, p, l) { if (f > 1) throw TypeError("Generator is already running"); for (y && 1 === p && d(p, l), c = p, u = l; (t = c < 2 ? e : u) || !y;) { i || (c ? c < 3 ? (c > 1 && (G.n = -1), d(c, u)) : G.n = u : G.v = u); try { if (f = 2, i) { if (c || (o = "next"), t = i[o]) { if (!(t = t.call(i, u))) throw TypeError("iterator result is not an object"); if (!t.done) return t; u = t.value, c < 2 && (c = 0); } else 1 === c && (t = i.return) && t.call(i), c < 2 && (u = TypeError("The iterator does not provide a '" + o + "' method"), c = 1); i = e; } else if ((t = (y = G.n < 0) ? u : r.call(n, G)) !== a) break; } catch (t) { i = e, c = 1, u = t; } finally { f = 1; } } return { value: t, done: y }; }; }(r, o, i), !0), u; } var a = {}; function Generator() {} function GeneratorFunction() {} function GeneratorFunctionPrototype() {} t = Object.getPrototypeOf; var c = [][n] ? t(t([][n]())) : (_regeneratorDefine2(t = {}, n, function () { return this; }), t), u = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(c); function f(e) { return Object.setPrototypeOf ? Object.setPrototypeOf(e, GeneratorFunctionPrototype) : (e.__proto__ = GeneratorFunctionPrototype, _regeneratorDefine2(e, o, "GeneratorFunction")), e.prototype = Object.create(u), e; } return GeneratorFunction.prototype = GeneratorFunctionPrototype, _regeneratorDefine2(u, "constructor", GeneratorFunctionPrototype), _regeneratorDefine2(GeneratorFunctionPrototype, "constructor", GeneratorFunction), GeneratorFunction.displayName = "GeneratorFunction", _regeneratorDefine2(GeneratorFunctionPrototype, o, "GeneratorFunction"), _regeneratorDefine2(u), _regeneratorDefine2(u, o, "Generator"), _regeneratorDefine2(u, n, function () { return this; }), _regeneratorDefine2(u, "toString", function () { return "[object Generator]"; }), (_regenerator = function _regenerator() { return { w: i, m: f }; })(); }
function _regeneratorDefine2(e, r, n, t) { var i = Object.defineProperty; try { i({}, "", {}); } catch (e) { i = 0; } _regeneratorDefine2 = function _regeneratorDefine(e, r, n, t) { function o(r, n) { _regeneratorDefine2(e, r, function (e) { return this._invoke(r, n, e); }); } r ? i ? i(e, r, { value: n, enumerable: !t, configurable: !t, writable: !t }) : e[r] = n : (o("next", 0), o("throw", 1), o("return", 2)); }, _regeneratorDefine2(e, r, n, t); }
function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }
function _asyncToGenerator(n) { return function () { var t = this, e = arguments; return new Promise(function (r, o) { var a = n.apply(t, e); function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); } function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); } _next(void 0); }); }; }
/* app.js — Live TV: startup, channel selection, and the boot sequence.
 *
 * The page is assembled from several modules, loaded in dependency order by
 * pages/livetv.html:
 *
 *   livetv/state.js      shared state every other module reads
 *   livetv/epg.js        guide data, timeline, programme strips
 *   livetv/channels.js   channel cache, filtering, virtual scroller
 *   livetv/sidebar.js    favourites, groups, categories, dialogs
 *   livetv/pip.js        preview, fullscreen, OSD, multiview entry
 *   livetv/multiview.js  the multi-channel grid
 *   dpad.js              remote control routing
 *   app.js               this file — init and boot
 *
 * Startup takes the cache-first path whenever it can: a cached channel list
 * paints immediately and the network refresh lands underneath it, because a
 * TV app that shows a spinner for four seconds on every launch feels broken
 * even when it is working perfectly.
 */

// ── App init ──────────────────────────────────────────────────────────────────

// ── Source type ───────────────────────────────────────────────────────────────

function getSourceType() {
  return load("iptv_source_type", "xtream");
}
function initApp() {
  return _initApp.apply(this, arguments);
}
function _initApp() {
  _initApp = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee() {
    var status, setStatus;
    return _regenerator().w(function (_context) {
      while (1) switch (_context.n) {
        case 0:
          status = document.getElementById("status");
          setStatus = function setStatus(msg, err) {
            status.textContent = msg;
            status.style.color = err ? "#ff5555" : "";
          };
          epgCache = loadEpgDiskCache();
          if (!(getSourceType() === "m3u")) {
            _context.n = 2;
            break;
          }
          _context.n = 1;
          return _initAppM3U(setStatus);
        case 1:
          _context.n = 3;
          break;
        case 2:
          _context.n = 3;
          return _initAppXtream(setStatus);
        case 3:
          return _context.a(2);
      }
    }, _callee);
  }));
  return _initApp.apply(this, arguments);
}
function _initAppM3U(_x) {
  return _initAppM3U2.apply(this, arguments);
}
function _initAppM3U2() {
  _initAppM3U2 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee2(setStatus) {
    var m3uCfg, cached, _yield$m3uGetChannels, channels, categories, _t, _t2;
    return _regenerator().w(function (_context2) {
      while (1) switch (_context2.p = _context2.n) {
        case 0:
          _context2.p = 0;
          _context2.n = 1;
          return m3uLoadConfig();
        case 1:
          m3uCfg = _context2.v;
          _context2.n = 3;
          break;
        case 2:
          _context2.p = 2;
          _t = _context2.v;
          setStatus("ERR: " + _t.message, true);
          return _context2.a(2);
        case 3:
          // Try disk cache first
          cached = m3uLoadCache();
          if (!cached) {
            _context2.n = 4;
            break;
          }
          allChannels = cached.channels;
          setStatus("".concat(allChannels.length, " channels (cached)"));
          _bootUI(cached.categories);
          // Refresh in background
          m3uFetchPlaylist(m3uCfg.playlist_url).then(function (_ref) {
            var channels = _ref.channels,
              categories = _ref.categories;
            allChannels = channels;
            setStatus("".concat(allChannels.length, " channels"));
            m3uSaveCache(channels, categories);
            renderCategories(categories);
            applyFilters();
          }).catch(function () {});
          return _context2.a(2);
        case 4:
          _context2.p = 4;
          setStatus("Loading playlist…");
          _context2.n = 5;
          return m3uGetChannelsAndCategories(m3uCfg);
        case 5:
          _yield$m3uGetChannels = _context2.v;
          channels = _yield$m3uGetChannels.channels;
          categories = _yield$m3uGetChannels.categories;
          if (channels.length) {
            _context2.n = 6;
            break;
          }
          setStatus("ERR: 0 channels in playlist", true);
          return _context2.a(2);
        case 6:
          allChannels = channels;
          setStatus("".concat(allChannels.length, " channels"));
          m3uSaveCache(channels, categories);
          _bootUI(categories);
          _context2.n = 8;
          break;
        case 7:
          _context2.p = 7;
          _t2 = _context2.v;
          setStatus("ERR: " + _t2.message, true);
        case 8:
          return _context2.a(2);
      }
    }, _callee2, null, [[4, 7], [0, 2]]);
  }));
  return _initAppM3U2.apply(this, arguments);
}
function _initAppXtream(_x2) {
  return _initAppXtream2.apply(this, arguments);
}
function _initAppXtream2() {
  _initAppXtream2 = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee3(setStatus) {
    var _cfg;
    var cachedCh, cachedCat, categories, login, _yield$Promise$all, _yield$Promise$all2, channels, cats, _t3, _t4, _t5;
    return _regenerator().w(function (_context3) {
      while (1) switch (_context3.p = _context3.n) {
        case 0:
          setStatus("Loading config…");
          _context3.p = 1;
          _context3.n = 2;
          return xtreamLoadConfig();
        case 2:
          cfg = _context3.v;
          _context3.n = 4;
          break;
        case 3:
          _context3.p = 3;
          _t3 = _context3.v;
          setStatus("ERR: " + _t3.message, true);
          return _context3.a(2);
        case 4:
          if ((_cfg = cfg) !== null && _cfg !== void 0 && _cfg.server_url) {
            _context3.n = 5;
            break;
          }
          setStatus("No server configured — redirecting to Settings…", false);
          setTimeout(function () {
            window.location.href = "../pages/settings.html";
          }, 1800);
          return _context3.a(2);
        case 5:
          cachedCh = loadChannelCache();
          cachedCat = loadCatCache();
          categories = cachedCat || [];
          if (!cachedCh) {
            _context3.n = 6;
            break;
          }
          allChannels = cachedCh;
          setStatus("".concat(allChannels.length, " channels (cached)"));
          _bootUI(categories);

          /* Background refresh. Both guards on `.length` are load-bearing:
             xtreamGet* swallow their errors and return [], so a failed refresh
             arrives as an empty array rather than a rejection. Without the guard
             the category list was wiped from the screen AND written back to the
             cache as empty on every launch where the panel was briefly
             unreachable — leaving the sidebar with no categories until a later
             launch happened to succeed. */
          xtreamGetLiveChannels(cfg).then(function (fresh) {
            if (!fresh.length) return;
            allChannels = fresh;
            setStatus("".concat(allChannels.length, " channels"));
            saveChannelCache(fresh, categories);
            applyFilters();
          }).catch(function () {});
          xtreamGetCategories(cfg).then(function (freshCat) {
            if (!freshCat.length) return;
            categories = freshCat;
            saveChannelCache(allChannels, freshCat);
            renderCategories(freshCat);
            updateSidebarActive();
          }).catch(function () {});
          return _context3.a(2);
        case 6:
          setStatus("Logging in…");
          _context3.p = 7;
          _context3.n = 8;
          return xtreamLogin(cfg);
        case 8:
          login = _context3.v;
          if (!(login && login.authFailed)) {
            _context3.n = 9;
            break;
          }
          setStatus("ERR: " + login.message, true);
          return _context3.a(2);
        case 9:
          if (login) {
            _context3.n = 10;
            break;
          }
          setStatus("ERR: Could not reach any server for this profile", true);
          return _context3.a(2);
        case 10:
          // Update cfg with the resolved server_url (the URL that actually worked)
          cfg = login.cfg;
          _context3.n = 12;
          break;
        case 11:
          _context3.p = 11;
          _t4 = _context3.v;
          setStatus("ERR: " + _t4.message, true);
          return _context3.a(2);
        case 12:
          _context3.p = 12;
          setStatus("Fetching channels…");
          _context3.n = 13;
          return Promise.all([xtreamGetLiveChannels(cfg), xtreamGetCategories(cfg)]);
        case 13:
          _yield$Promise$all = _context3.v;
          _yield$Promise$all2 = _slicedToArray(_yield$Promise$all, 2);
          channels = _yield$Promise$all2[0];
          cats = _yield$Promise$all2[1];
          if (channels.length) {
            _context3.n = 14;
            break;
          }
          setStatus("ERR: 0 channels returned", true);
          return _context3.a(2);
        case 14:
          allChannels = channels;
          categories = cats;
          setStatus("".concat(allChannels.length, " channels"));
          saveChannelCache(channels, categories);
          _bootUI(categories);
          _context3.n = 16;
          break;
        case 15:
          _context3.p = 15;
          _t5 = _context3.v;
          setStatus("ERR: " + _t5.message, true);
        case 16:
          return _context3.a(2);
      }
    }, _callee3, null, [[12, 15], [7, 11], [1, 3]]);
  }));
  return _initAppXtream2.apply(this, arguments);
}
function _bootUI(categories) {
  renderCategories(categories);
  setupSearch();
  setupPip();
  setupTimelineNav();
  if (xmltvCache && xmltvCache.programmes) mergeXMLTVIntoEpgCache();
  activeCategory = Favourites.isEmpty() ? "all" : "favs";
  activeFavGroup = "all";
  if (activeCategory === "favs") {
    var sec = document.getElementById("cat-section-favs");
    if (sec) sec.classList.add("open");
  }
  renderFavSectionList();
  updateSidebarActive();
  applyFilters();
  tvRowIndex = 0;
  setTVZone("channel-list");
}

// ── Channel selection ─────────────────────────────────────────────────────────
function selectChannel(_x3) {
  return _selectChannel.apply(this, arguments);
}
function _selectChannel() {
  _selectChannel = _asyncToGenerator(/*#__PURE__*/_regenerator().m(function _callee4(ch) {
    var _listings;
    var _selSid, playUrl, listings, _findNowNext2, cur, next, _t6, _t7;
    return _regenerator().w(function (_context4) {
      while (1) switch (_context4.p = _context4.n) {
        case 0:
          currentChannel = ch;
          _selSid = String(ch.stream_id);
          rowCache.forEach(function (entry, sid) {
            return entry.row.classList.toggle("selected", sid === _selSid);
          });
          document.getElementById("preview-channel-name").textContent = ch.name || "Unknown";
          document.getElementById("pip-channel-name").textContent = ch.name || "Unknown";
          playUrl = ch._source === "m3u" ? m3uBuildLiveURL(ch) : xtreamBuildLiveURL(cfg, ch.stream_id); // The key lets the player remember which engine actually worked for THIS
          // channel, so a 4K/HEVC channel that only plays on HLS starts there.
          player.play(playUrl, {
            key: "ch:" + ch.stream_id
          });
          setEPG("now", "Loading…", "", "");
          setEPG("next", "—", "", "");
          document.getElementById("epg-bar-fill").style.width = "0%";
          showPreviewInfo();
          showOSD(); // immediate banner on channel switch — EPG data populated below
          listings = epgCache[ch.stream_id];
          if (!(!listings && !epgBlocked)) {
            _context4.n = 8;
            break;
          }
          epgCache[ch.stream_id] = null;
          _context4.p = 1;
          if (!(ch._source === "m3u")) {
            _context4.n = 3;
            break;
          }
          _context4.n = 2;
          return m3uGetEPG(ch.stream_id);
        case 2:
          _t6 = _context4.v;
          _context4.n = 5;
          break;
        case 3:
          _context4.n = 4;
          return xtreamGetEPG(cfg, ch.stream_id);
        case 4:
          _t6 = _context4.v;
        case 5:
          listings = _t6;
          _context4.n = 7;
          break;
        case 6:
          _context4.p = 6;
          _t7 = _context4.v;
          if (Net.isHttpError(_t7, 403) || Net.isHttpError(_t7, 401)) epgBlocked = true;
          listings = [];
        case 7:
          epgCache[ch.stream_id] = listings;
          patchEpgStrip(ch.stream_id);
          scheduleEpgSave();
        case 8:
          if ((_listings = listings) !== null && _listings !== void 0 && _listings.length) {
            _context4.n = 9;
            break;
          }
          setEPG("now", "No EPG data", "", "");
          showOSD();
          return _context4.a(2);
        case 9:
          _findNowNext2 = _findNowNext(listings), cur = _findNowNext2.cur, next = _findNowNext2.next;
          setEPG("now", xtreamDecodeEPG(cur.title), formatTimeRange(cur), xtreamDecodeEPG(cur.description));
          document.getElementById("epg-bar-fill").style.width = calcProgress(cur) + "%";
          if (next) setEPG("next", xtreamDecodeEPG(next.title), formatTimeRange(next), "");
          showOSD();
        case 10:
          return _context4.a(2);
      }
    }, _callee4, null, [[1, 6]]);
  }));
  return _selectChannel.apply(this, arguments);
}
function updateOSDIfFullscreen() {
  if (isFullscreen()) showOSD();
}
function setEPG(slot, title, time, desc) {
  document.getElementById("epg-".concat(slot, "-title")).textContent = title || "—";
  document.getElementById("epg-".concat(slot, "-time")).textContent = time || "";
  var el = document.getElementById("epg-".concat(slot, "-desc"));
  if (el) el.textContent = desc || "";
}
function showPreviewInfo() {
  var _document$getElementB;
  (_document$getElementB = document.getElementById("preview-info")) === null || _document$getElementB === void 0 || _document$getElementB.classList.add("preview-visible");
}
function channelStep(delta) {
  if (!_vsChannels.length) return;
  var idx = currentChannel ? _vsChannels.findIndex(function (ch) {
    return String(ch.stream_id) === String(currentChannel.stream_id);
  }) : -1;
  if (idx < 0) idx = delta > 0 ? -1 : _vsChannels.length;
  idx = Math.max(0, Math.min(_vsChannels.length - 1, idx + delta));
  tvRowIndex = idx;
  var ch = _vsChannels[idx];
  if (ch) {
    selectChannel(ch);
    tvFocusRow(idx);
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

// Run immediately: this script is loaded with `defer`, so the DOM is already
// parsed here. Waiting for window.onload (all CSS/images fetched) only delayed
// the first paint of the channel list on slow TVs.
(function boot() {
  // Publish the active Xtream profile as IPTV_CONFIG, which is what
  // data/xtream.js reads. M3U profiles take their own path via
  // iptv_m3u_config / iptv_source_type.
  try {
    var active = Config.resolve();
    if (active && active.type !== "m3u" && active.server_url) window.IPTV_CONFIG = active;
  } catch (_) {}
  loadXMLTVFromCache();
  measureRowHeight();
  initVirtualScroll();
  initTVNavigation();
  if (typeof tvSetBackUrl === "function") tvSetBackUrl("../index.html");
  initApp();
  if (load("iptv_custom_epg_url", "")) {
    setTimeout(function () {
      return mergeXMLTVIntoEpgCache();
    }, 2000);
  }
})();