"use strict";

/* livetv/pip.js — the preview window, fullscreen, the on-screen display, and
 * the entry point into Multiview.
 *
 * Fullscreen is a pure-CSS overlay rather than the native Fullscreen API, for
 * reasons documented at length in assets/player.css: the native API mis-renders
 * on webOS 5.40 and its UA stylesheet forces `transform: none` on the
 * fullscreened element, which rebuilds the video's compositing layer mid-play
 * and resets the TV's decoder. Everything here changes position and size only.
 *
 * Requires: livetv/state.js, player.js, livetv/multiview.js.
 */

// ── Fullscreen / PiP / OSD ────────────────────────────────────────────────────

var _osdTimer = null;
function setupPip() {
  var _document$getElementB;
  document.getElementById("pip-fullscreen-btn").addEventListener("click", function (e) {
    e.stopPropagation();
    toggleFullscreen();
  });
  (_document$getElementB = document.getElementById("pip-multiview-btn")) === null || _document$getElementB === void 0 || _document$getElementB.addEventListener("click", function (e) {
    e.stopPropagation();
    openMultiview();
  });
  var osd = document.createElement("div");
  osd.id = "fs-osd";
  osd.innerHTML = "\n        <div id=\"fs-osd-top\">\n            <div id=\"fs-osd-channel\"></div>\n            <div id=\"fs-osd-top-right\">\n                <span id=\"fs-osd-quality\" hidden></span>\n                <span id=\"fs-osd-ch-num\" hidden></span>\n            </div>\n        </div>\n        <div id=\"fs-osd-bottom\">\n            <div id=\"fs-osd-epg-row\">\n                <span class=\"fs-osd-badge now\">NOW</span>\n                <span id=\"fs-osd-now-title\"></span>\n                <span id=\"fs-osd-now-time\"></span>\n            </div>\n            <div id=\"fs-osd-epg-row2\">\n                <span class=\"fs-osd-badge next\">NEXT</span>\n                <span id=\"fs-osd-next-title\"></span>\n                <span id=\"fs-osd-next-time\"></span>\n            </div>\n            <div id=\"fs-osd-bar-wrap\"><div id=\"fs-osd-bar-fill\"></div></div>\n        </div>";
  document.getElementById("pip-wrap").appendChild(osd);
}

// Fullscreen — ONE implementation for every webOS version: a pure-CSS overlay.
// body.livetv-fs stretches #pip-wrap over the viewport and hides the GUI panels
// (all siblings — never an ancestor of the video, so the video is never
// unrendered). The SAME <video>/stream is kept — no second connection — so
// single-stream accounts are unaffected.
//
// The native Fullscreen API is deliberately not used anywhere:
//   • webOS 5.40 mis-renders element fullscreen (video fills only the top half,
//     GUI stays visible) while still REPORTING fullscreen geometry — so it
//     can't be feature-detected or geometry-checked away.
//   • Chromium's :fullscreen UA stylesheet applies `transform: none !important`
//     to the fullscreened element, overriding #pip-wrap's constant
//     translateZ(0). That rebuilds the video's compositing layer mid-play and
//     resets the hardware decoder on webOS (plays ~10s → "can't play").
// The CSS overlay changes only position/size/z-index — the transform is
// identical in both states, so the video layer is never rebuilt. #pip-wrap has
// no ancestor with transform/filter/contain (verified), so position:fixed is
// truly viewport-relative on every Chromium back to 38.
var _fsActive = false;
function isFullscreen() {
  return _fsActive;
}
function toggleFullscreen() {
  _fsActive = !_fsActive;
  document.body.classList.toggle("livetv-fs", _fsActive);
  var btn = document.getElementById("pip-fullscreen-btn");
  if (btn) btn.title = _fsActive ? "Exit fullscreen" : "Fullscreen";
  if (_fsActive) {
    if (currentChannel) showOSD();
  } else {
    setTVZone("channel-list");
  }
}

// ── Multiview ─────────────────────────────────────────────────────────────────
// The grid inherits whatever list is on screen, so opening it inside a category
// or inside Favourites shows those channels rather than always starting from
// the top of everything.

function openMultiview() {
  if (typeof Multiview === "undefined" || Multiview.isOpen()) return;
  var channels = _vsChannels;
  if (!channels.length) return;

  // Leave fullscreen first: its overlay and the grid would otherwise both be
  // claiming the screen, and exiting one would reveal the other.
  if (isFullscreen()) toggleFullscreen();

  // Free the preview's decoder before asking for up to four more.
  try {
    player.stop();
  } catch (_) {}
  var startIdx = currentChannel ? channels.findIndex(function (ch) {
    return String(ch.stream_id) === String(currentChannel.stream_id);
  }) : tvRowIndex;
  if (startIdx < 0) startIdx = Math.max(0, tvRowIndex);
  var opened = Multiview.open(channels, startIdx, {
    buildUrl: function buildUrl(ch) {
      return ch._source === "m3u" ? m3uBuildLiveURL(ch) : xtreamBuildLiveURL(cfg, ch.stream_id);
    },
    onExit: function onExit(ch) {
      // Come back to the channel the user left the grid on, and restart
      // the preview — the main player was stopped on the way in.
      if (ch) {
        var idx = _vsChannels.findIndex(function (c) {
          return String(c.stream_id) === String(ch.stream_id);
        });
        if (idx >= 0) tvRowIndex = idx;
        selectChannel(ch);
      } else if (currentChannel) {
        selectChannel(currentChannel);
      }
      setTVZone("channel-list");
    }
  });

  // The preview's decoder was already released above, so if the grid declined
  // to open there is nothing playing and nothing on screen to explain it.
  // Put the channel back rather than leaving a dead preview box.
  if (!opened && currentChannel) selectChannel(currentChannel);
}
function showOSD() {
  var _currentChannel;
  var osd = document.getElementById("fs-osd");
  if (!osd) return;
  document.getElementById("fs-osd-channel").textContent = ((_currentChannel = currentChannel) === null || _currentChannel === void 0 ? void 0 : _currentChannel.name) || "";

  // ── Channel number badge ──────────────────────────────────────────────────
  var chNumEl = document.getElementById("fs-osd-ch-num");
  if (chNumEl) {
    var chIdx = currentChannel ? _vsChannels.findIndex(function (ch) {
      return String(ch.stream_id) === String(currentChannel.stream_id);
    }) : -1;
    if (chIdx >= 0) {
      chNumEl.textContent = "CH " + (chIdx + 1);
      chNumEl.removeAttribute("hidden");
    } else {
      chNumEl.setAttribute("hidden", "");
    }
  }

  // ── Stream quality badge ──────────────────────────────────────────────────
  var qualEl = document.getElementById("fs-osd-quality");
  if (qualEl) {
    var _player$video, _player$video2;
    var w = ((_player$video = player.video) === null || _player$video === void 0 ? void 0 : _player$video.videoWidth) || 0;
    var h = ((_player$video2 = player.video) === null || _player$video2 === void 0 ? void 0 : _player$video2.videoHeight) || 0;
    if (w > 0 && h > 0) {
      var cls = "";
      if (w >= 3840 || h >= 2160) cls = "quality-4k";else if (w >= 1920 || h >= 1080) cls = "quality-fhd";else if (w >= 1280 || h >= 720) cls = "quality-hd";
      qualEl.textContent = w + "×" + h;
      qualEl.className = cls;
      qualEl.removeAttribute("hidden");
    } else {
      qualEl.setAttribute("hidden", "");
    }
  }

  // ── EPG data ──────────────────────────────────────────────────────────────
  var listings = currentChannel ? epgCache[currentChannel.stream_id] : null;
  var nowTitle = "",
    nowTime = "",
    nextTitle = "",
    nextTime = "",
    progress = 0;
  if (listings && listings.length) {
    var _findNowNext2 = _findNowNext(listings),
      cur = _findNowNext2.cur,
      next = _findNowNext2.next;
    if (cur) {
      nowTitle = xtreamDecodeEPG(cur.title);
      nowTime = formatTimeRange(cur);
      progress = calcProgress(cur);
    }
    if (next) {
      nextTitle = xtreamDecodeEPG(next.title);
      nextTime = formatTimeRange(next);
    }
  }
  document.getElementById("fs-osd-now-title").textContent = nowTitle || "—";
  document.getElementById("fs-osd-now-time").textContent = nowTime || "";
  document.getElementById("fs-osd-next-title").textContent = nextTitle || "—";
  document.getElementById("fs-osd-next-time").textContent = nextTime || "";
  document.getElementById("fs-osd-bar-fill").style.width = progress + "%";
  osd.classList.remove("osd-hidden");
  osd.classList.add("osd-visible");
  clearTimeout(_osdTimer);
  _osdTimer = setTimeout(function () {
    osd.classList.remove("osd-visible");
    osd.classList.add("osd-hidden");
  }, 5000);
}