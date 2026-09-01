"use strict";

// D-pad / LG TV Remote Navigation
// Requires "disableBackHistoryAPI": true in appinfo.json

var tvFocusZone = "channel-list";
var tvRowIndex = 0;
var tvSidebarIndex = 0;
var tvHeaderIndex = 0; // 0 = home-btn, 1 = settings-btn
var tvRowSubZone = "row";
/* "item" | "star" — a sidebar category row is a name plus a ★ that favourites
   the whole category, exactly like a channel row. RIGHT steps onto the star,
   RIGHT again continues to the channel list, so the rule the user learned in
   the channel list is the same one here. */
var tvSidebarSubZone = "item";
var _fsEnterTimer = null;
var _rowEnterTimer = null;
var _rowEnterSid = null;
var _ctxMenuIndex = 0;
var _assignPanelIndex = 0;

// ── Back button ───────────────────────────────────────────────────────────────
// Central back handler for all pages.
// Call with a URL to navigate there, or with no argument to exit to Home.
// Pages that need back navigation (e.g. settings, catchup) pass their return
// URL; pages at the root of the app (e.g. index) pass nothing to exit.
//
// Usage:
//   tvGoBack();                    // exit app → webOS Home / exit popup
//   tvGoBack("../index.html");     // navigate back to homepage

function tvGoBack(backUrl) {
  if (backUrl) {
    window.location.href = backUrl;
  } else {
    webOS.platformBack();
  }
}

// Call this from any page that uses dpad.js to declare where Back should navigate.
// If not called, Back exits the app via webOS.platformBack().
//
// Usage (at page init):  tvSetBackUrl("../index.html");
function tvSetBackUrl(url) {
  window._tvBackUrl = url;
}
function initTVNavigation() {
  window.addEventListener("keydown", onTVKeyDown, {
    capture: true,
    passive: false
  });
  if (typeof webOSSystem !== "undefined" && typeof webOSSystem.notifyAppLoaded === "function") {
    webOSSystem.notifyAppLoaded();
  }

  // popstate fires when Back is pressed while the assign panel is open
  // (a history entry was pushed in showAssignPanel so that one Back press
  // closes the panel instead of leaving the page).
  window.addEventListener("popstate", function () {
    if (document.querySelector(".assign-panel")) {
      _assignHistoryPushed = false;
      closeAssignPanels();
      tvRowSubZone = "row";
      requestAnimationFrame(function () {
        return tvFocusRow(tvRowIndex);
      });
    }
  });
}
function _restoreZoneFocus() {
  if (tvFocusZone === "sidebar-header") _focusSidebarHeader();else if (tvFocusZone === "sidebar-cats") tvFocusSidebarItem(tvSidebarIndex);else if (tvFocusZone === "channel-list") tvFocusRow(tvRowIndex);else setTVZone(tvFocusZone);
}

/* Delegates to Dom, which also maps named keys (`e.key`) for environments that
   dispatch those with keyCode 0 — the simulator among them. */
function _keyCode(e) {
  return typeof Dom !== "undefined" ? Dom.keyCode(e) : e.keyCode || e.which;
}
function _isBack(e) {
  return _keyCode(e) === 461;
}

// webOS TV remote key codes
// CH_UP/CH_DN come in two flavours — see the note on Dom.KEY. Both are handled.
var _KEY = {
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  ENTER: 13,
  CH_UP: 427,
  CH_DN: 428,
  CH_UP_ALT: 33,
  CH_DN_ALT: 34
};
function onTVKeyDown(e) {
  var kc = _keyCode(e);

  // Multiview owns the whole remote while it's open — it's a separate screen,
  // not an overlay on this one, so nothing below should see these presses.
  if (typeof Multiview !== "undefined" && Multiview.isOpen()) {
    Multiview.handleKey(e);
    return;
  }
  // BLUE opens the grid. RED/GREEN/YELLOW are already taken by the player
  // (cycle engine / diagnostics / lowest quality), so BLUE is the one colour
  // button free to mean something at the page level.
  if (kc === 406 /* BLUE */ || kc === 77 /* 'm' — desktop testing */) {
    e.preventDefault();
    if (typeof openMultiview === "function") openMultiview();
    return;
  }
  var modal = document.querySelector(".modal-overlay");
  var assignPanel = document.querySelector(".assign-panel");
  var ctxMenu = document.querySelector(".ctx-menu");
  if (modal) {
    _handleModalKey(e, modal);
    return;
  }
  if (assignPanel) {
    _handleAssignPanelKey(e, assignPanel);
    return;
  }
  if (ctxMenu) {
    _handleCtxMenuKey(e, ctxMenu);
    return;
  }

  // If an input/select is focused (on-screen keyboard open), only handle Back
  // to dismiss — all other keys go to the input as normal.
  var focused = document.activeElement;
  var tag = focused === null || focused === void 0 ? void 0 : focused.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    if (_isBack(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      focused.blur();
      _restoreZoneFocus();
    }
    return;
  }
  var isFs = typeof isFullscreen === "function" ? isFullscreen() : false;

  /* Typing a channel number. Offered before the switch below so digits — and
     the OK/BACK that finish or abandon a half-typed number — are claimed
     first; it declines anything it isn't using, so nothing else is shadowed.
     Works the same in the list and in fullscreen, which is the whole point:
     fullscreen otherwise has no way to reach a channel by name or position. */
  if (typeof ChannelNumbers !== "undefined" && ChannelNumbers.handleKey(e, _liveChannelTarget())) {
    e.preventDefault();
    return;
  }
  switch (kc) {
    case _KEY.UP:
    case _KEY.DOWN:
      {
        e.preventDefault();
        var d = kc === _KEY.UP ? -1 : 1;
        if (isFs) {
          channelStep(d);
          showOSD();
          return;
        }
        if (tvFocusZone === "channel-list") {
          if (tvRowSubZone === "reorder-up" && d > 0) {
            tvRowSubZone = "reorder-down";
            tvFocusRowButtons();
            return;
          }
          if (tvRowSubZone === "reorder-down" && d < 0) {
            tvRowSubZone = "reorder-up";
            tvFocusRowButtons();
            return;
          }
          tvRowSubZone = "row";
          tvRowIndex = Math.max(0, Math.min(_vsChannels.length - 1, tvRowIndex + d));
          tvFocusRow(tvRowIndex);
        } else if (tvFocusZone === "sidebar-cats") {
          var items = getSidebarFocusables();
          if (d < 0 && tvSidebarIndex === 0) setTVZone("search");else {
            tvSidebarIndex = Math.max(0, Math.min(items.length - 1, tvSidebarIndex + d));
            // Rows without a star can't hold the star sub-zone.
            if (!_sidebarStarFor(tvSidebarIndex)) tvSidebarSubZone = "item";
            tvFocusSidebarItem(tvSidebarIndex);
          }
        } else if (tvFocusZone === "sidebar-header") {
          if (d > 0) setTVZone("search");
        } else if (tvFocusZone === "search") {
          if (d < 0) setTVZone("sidebar-header");else setTVZone("sidebar-cats");
        } else if (tvFocusZone === "tl-nav") {
          if (d < 0) setTVZone("channel-list");
        }
        return;
      }
    case _KEY.LEFT:
      {
        e.preventDefault();
        if (isFs) {
          showOSD();
          return;
        }
        if (tvFocusZone === "sidebar-header") {
          if (tvHeaderIndex > 0) {
            tvHeaderIndex--;
            _focusSidebarHeader();
          }
          return;
        }
        if (tvFocusZone === "sidebar-cats") {
          if (tvSidebarSubZone === "star") {
            tvSidebarSubZone = "item";
            tvFocusSidebarItem(tvSidebarIndex);
          }
          return;
        }
        if (tvFocusZone === "channel-list") {
          if (tvRowSubZone === "reorder-down") {
            tvRowSubZone = "reorder-up";
            tvFocusRowButtons();
          } else if (tvRowSubZone === "reorder-up") {
            var _en$col;
            var en = _vsChannels[tvRowIndex] ? rowCache.get(String(_vsChannels[tvRowIndex].stream_id)) : null;
            tvRowSubZone = (en === null || en === void 0 || (_en$col = en.col3) === null || _en$col === void 0 || (_en$col = _en$col.style) === null || _en$col === void 0 ? void 0 : _en$col.display) !== "none" ? "assign" : "fav";
            tvFocusRowButtons();
          } else if (tvRowSubZone === "assign") {
            tvRowSubZone = "fav";
            tvFocusRowButtons();
          } else if (tvRowSubZone === "fav") {
            tvRowSubZone = "row";
            tvFocusRow(tvRowIndex);
          } else {
            setTVZone("sidebar-cats");
          }
        } else if (tvFocusZone === "tl-nav") {
          setTVZone("channel-list");
        }
        return;
      }
    case _KEY.RIGHT:
      {
        e.preventDefault();
        if (isFs) {
          showOSD();
          return;
        }
        if (tvFocusZone === "sidebar-header") {
          if (tvHeaderIndex < 1) {
            tvHeaderIndex++;
            _focusSidebarHeader();
          }
          return;
        }
        if (tvFocusZone === "sidebar-cats") {
          // Step onto the row's ★ first, if it has one.
          if (tvSidebarSubZone !== "star" && _sidebarStarFor(tvSidebarIndex)) {
            tvSidebarSubZone = "star";
            tvFocusSidebarItem(tvSidebarIndex);
          } else {
            tvSidebarSubZone = "item";
            setTVZone("channel-list");
          }
        } else if (tvFocusZone === "channel-list") {
          var ch = _vsChannels[tvRowIndex];
          var entry = ch ? rowCache.get(String(ch.stream_id)) : null;
          if (tvRowSubZone === "row") {
            tvRowSubZone = "fav";
            tvFocusRowButtons();
          } else if (tvRowSubZone === "fav") {
            var _entry$col, _entry$col2;
            if ((entry === null || entry === void 0 || (_entry$col = entry.col3) === null || _entry$col === void 0 || (_entry$col = _entry$col.style) === null || _entry$col === void 0 ? void 0 : _entry$col.display) !== "none") {
              tvRowSubZone = "assign";
              tvFocusRowButtons();
            } else if ((entry === null || entry === void 0 || (_entry$col2 = entry.col4) === null || _entry$col2 === void 0 || (_entry$col2 = _entry$col2.style) === null || _entry$col2 === void 0 ? void 0 : _entry$col2.display) !== "none") {
              tvRowSubZone = "reorder-up";
              tvFocusRowButtons();
            } else setTVZone("tl-nav");
          } else if (tvRowSubZone === "assign") {
            var _entry$col3;
            if ((entry === null || entry === void 0 || (_entry$col3 = entry.col4) === null || _entry$col3 === void 0 || (_entry$col3 = _entry$col3.style) === null || _entry$col3 === void 0 ? void 0 : _entry$col3.display) !== "none") {
              tvRowSubZone = "reorder-up";
              tvFocusRowButtons();
            } else setTVZone("tl-nav");
          } else if (tvRowSubZone === "reorder-up") {
            tvRowSubZone = "reorder-down";
            tvFocusRowButtons();
          } else setTVZone("tl-nav");
        }
        return;
      }
    case _KEY.ENTER:
      {
        e.preventDefault();
        if (tvFocusZone === "sidebar-header") {
          var _hBtns$tvHeaderIndex;
          var _hBtns = [document.getElementById("home-btn"), document.getElementById("settings-btn")];
          (_hBtns$tvHeaderIndex = _hBtns[tvHeaderIndex]) === null || _hBtns$tvHeaderIndex === void 0 || _hBtns$tvHeaderIndex.click();
          return;
        }
        if (isFs) {
          if (_fsEnterTimer) {
            clearTimeout(_fsEnterTimer);
            _fsEnterTimer = null;
            toggleFullscreen();
          } else {
            showOSD();
            _fsEnterTimer = setTimeout(function () {
              _fsEnterTimer = null;
            }, 500);
          }
          return;
        }
        if (tvFocusZone === "channel-list") {
          var _ch = _vsChannels[tvRowIndex];
          if (!_ch) return;
          if (tvRowSubZone === "fav") {
            toggleFav(String(_ch.stream_id));
            var _en = rowCache.get(String(_ch.stream_id));
            if (_en) _en.favBtn.classList.toggle("active", isFav(String(_ch.stream_id)));
            if (activeCategory === "favs") applyFilters();
          } else if (tvRowSubZone === "assign") {
            var _rowCache$get;
            (_rowCache$get = rowCache.get(String(_ch.stream_id))) === null || _rowCache$get === void 0 || (_rowCache$get = _rowCache$get.assignBtn) === null || _rowCache$get === void 0 || _rowCache$get.click();
          } else if (tvRowSubZone === "reorder-up") {
            _reorderAndRefocus(String(_ch.stream_id), -1, "reorder-up");
          } else if (tvRowSubZone === "reorder-down") {
            _reorderAndRefocus(String(_ch.stream_id), 1, "reorder-down");
          } else {
            var sid = String(_ch.stream_id);
            var alreadyPlaying = currentChannel && String(currentChannel.stream_id) === sid;
            if (_rowEnterTimer && _rowEnterSid === sid) {
              // Double press — go fullscreen (select first if not already playing)
              clearTimeout(_rowEnterTimer);
              _rowEnterTimer = null;
              _rowEnterSid = null;
              if (!alreadyPlaying) selectChannel(_ch);
              toggleFullscreen();
            } else if (alreadyPlaying) {
              // Single press on active channel — fullscreen immediately, no restart
              clearTimeout(_rowEnterTimer);
              _rowEnterTimer = null;
              _rowEnterSid = null;
              toggleFullscreen();
            } else {
              // Single press on a different channel — select/play
              clearTimeout(_rowEnterTimer);
              _rowEnterSid = sid;
              _rowEnterTimer = setTimeout(function () {
                _rowEnterTimer = null;
                _rowEnterSid = null;
              }, 400);
              selectChannel(_ch);
            }
          }
        } else if (tvFocusZone === "search") {
          var el = document.getElementById("search");
          if (el) {
            el.focus();
            try {
              el.setSelectionRange(el.value.length, el.value.length);
            } catch (_) {}
          }
        } else if (tvFocusZone === "sidebar-cats") {
          if (tvSidebarSubZone === "star") {
            var _sidebarStarFor2;
            // Favouriting a category re-renders the sidebar, so re-paint
            // the ring rather than leaving it on a discarded node.
            (_sidebarStarFor2 = _sidebarStarFor(tvSidebarIndex)) === null || _sidebarStarFor2 === void 0 || _sidebarStarFor2.click();
            requestAnimationFrame(function () {
              return tvFocusSidebarItem(tvSidebarIndex);
            });
          } else {
            var _getSidebarFocusables;
            (_getSidebarFocusables = getSidebarFocusables()[tvSidebarIndex]) === null || _getSidebarFocusables === void 0 || _getSidebarFocusables.click();
          }
        } else if (tvFocusZone === "tl-nav") {
          var _document$querySelect;
          (_document$querySelect = document.querySelector(".tl-nav-btn.tv-focus-visible")) === null || _document$querySelect === void 0 || _document$querySelect.click();
        }
        return;
      }
    case 461:
      {
        // Back (webOS)
        e.preventDefault();
        e.stopImmediatePropagation();
        if (isFs) {
          toggleFullscreen();
          return;
        }
        tvGoBack(window._tvBackUrl);
        return;
      }
    /* The channel rocker works everywhere on this page, fullscreen included
       — that is the whole point of it, and it is the only way to change
       channel in fullscreen without opening the list back up. Direction
       matches the arrow keys: CH+ moves UP the list, the same way UP does,
       so the two can never disagree about which way "up" is. */
    case _KEY.CH_UP_ALT:
    case _KEY.CH_UP:
      e.preventDefault();
      channelStep(-1);
      if (isFs) showOSD();
      return;
    case _KEY.CH_DN_ALT:
    case _KEY.CH_DN:
      e.preventDefault();
      channelStep(1);
      if (isFs) showOSD();
      return;
    default:
      _noteUnhandledKey(kc);
      return;
  }
}

/* What a typed channel number means on the Live TV page: pick that row out of
   the list currently on screen, play it, and move the focus ring to it so the
   list agrees with what is playing. */
function _liveChannelTarget() {
  return {
    total: function total() {
      return _vsChannels.length;
    },
    nameAt: function nameAt(i) {
      return _vsChannels[i] && _vsChannels[i].name || "";
    },
    pick: function pick(i) {
      var ch = _vsChannels[i];
      if (!ch) return;
      tvRowIndex = i;
      selectChannel(ch);
      // In fullscreen there is no list to move a ring on — show the
      // banner instead, so the switch is acknowledged either way.
      if (typeof isFullscreen === "function" && isFullscreen()) showOSD();else tvFocusRow(i);
    }
  };
}

/* ── Unknown remote buttons ───────────────────────────────────────────────────
   A retail TV has no console, so when a button "does nothing" there is no way
   to discover what code it actually sent — which is exactly how the channel
   rocker sat broken behind the wrong key codes. Remember the distinct codes
   that reached us and did nothing; Settings → Diagnostics lists them, so the
   next mystery button takes one look instead of a guess. */
var _UNHANDLED_KEYS_KEY = "iptv_unhandled_keys";
function _noteUnhandledKey(kc) {
  if (!kc || typeof Store === "undefined") return;
  var seen = Store.get(_UNHANDLED_KEYS_KEY, []) || [];
  if (seen.indexOf(kc) !== -1) return; // only ever the distinct set
  seen.unshift(kc);
  Store.set(_UNHANDLED_KEYS_KEY, seen.slice(0, 10));
}

// ── Zone management ───────────────────────────────────────────────────────────

function setTVZone(zone) {
  tvFocusZone = zone;
  tvRowSubZone = "row";
  tvSidebarSubZone = "item";
  document.querySelectorAll(".tv-focus-visible").forEach(function (el) {
    return el.classList.remove("tv-focus-visible");
  });
  document.querySelectorAll(".tv-row-active").forEach(function (el) {
    return el.classList.remove("tv-row-active");
  });
  if (zone === "sidebar-header") {
    tvHeaderIndex = 0;
    _focusSidebarHeader();
  } else if (zone === "sidebar-cats") {
    tvSidebarIndex = Math.max(0, Math.min(getSidebarFocusables().length - 1, tvSidebarIndex));
    tvFocusSidebarItem(tvSidebarIndex);
  } else if (zone === "channel-list") {
    tvRowIndex = Math.max(0, Math.min(_vsChannels.length - 1, tvRowIndex));
    tvFocusRow(tvRowIndex);
  } else if (zone === "tl-nav") {
    var _document$getElementB;
    (_document$getElementB = document.getElementById("tl-now")) === null || _document$getElementB === void 0 || _document$getElementB.classList.add("tv-focus-visible");
  } else if (zone === "search") {
    var _document$getElementB2;
    (_document$getElementB2 = document.getElementById("search")) === null || _document$getElementB2 === void 0 || _document$getElementB2.classList.add("tv-focus-visible");
  }
}
function _focusSidebarHeader() {
  _clearFocus();
  var btns = [document.getElementById("home-btn"), document.getElementById("settings-btn")];
  var el = btns[tvHeaderIndex];
  if (el) {
    el.classList.add("tv-focus-visible");
  }
}

// ── Focus helpers ─────────────────────────────────────────────────────────────

function getSidebarFocusables() {
  var panel = document.querySelector(".sidebar-panel.active");
  if (!panel) return [];
  return Array.from(panel.querySelectorAll(".cat-btn, .cat-section-hdr, .cat-sub-btn, .cat-add-grp-btn")).filter(function (el) {
    return el.offsetParent !== null;
  });
}
function _clearFocus() {
  document.querySelectorAll(".tv-focus-visible").forEach(function (el) {
    return el.classList.remove("tv-focus-visible");
  });
}

/* The ★ belonging to a sidebar row, or null when that row has none (the All
   button, section headers, "+ New Group"). */
function _sidebarStarFor(idx) {
  var _el$closest;
  var el = getSidebarFocusables()[idx];
  var row = el === null || el === void 0 || (_el$closest = el.closest) === null || _el$closest === void 0 ? void 0 : _el$closest.call(el, ".cat-row");
  return row ? row.querySelector(".cat-star-btn") : null;
}
function tvFocusSidebarItem(idx) {
  _clearFocus();
  var el = getSidebarFocusables()[idx];
  if (!el) return;
  var star = tvSidebarSubZone === "star" ? _sidebarStarFor(idx) : null;
  (star || el).classList.add("tv-focus-visible");
  el.scrollIntoView({
    block: "nearest"
  });
}
function tvFocusRow(idx) {
  _clearFocus();
  document.querySelectorAll(".tv-row-active").forEach(function (el) {
    return el.classList.remove("tv-row-active");
  });
  var ch = _vsChannels[idx];
  if (!ch) return;
  scrollTVRowIntoView(idx);
  requestAnimationFrame(function () {
    var entry = rowCache.get(String(ch.stream_id));
    if (entry) {
      entry.col1.classList.add("tv-focus-visible");
      entry.row.focus({
        preventScroll: true
      });
    }
  });
}
function tvFocusRowButtons() {
  _clearFocus();
  var ch = _vsChannels[tvRowIndex];
  if (!ch) return;
  /* Scroll (and render) BEFORE looking the row up — reading rowCache first
     returned nothing for a row that had scrolled out, and the early return
     left the buttons unfocusable. */
  scrollTVRowIntoView(tvRowIndex);
  var entry = rowCache.get(String(ch.stream_id));
  if (!entry) return;
  requestAnimationFrame(function () {
    var _entry$col4;
    document.querySelectorAll(".tv-row-active").forEach(function (el) {
      return el.classList.remove("tv-row-active");
    });
    entry.row.classList.add("tv-row-active");
    if (tvRowSubZone === "fav") entry.col2.classList.add("tv-focus-visible");else if (tvRowSubZone === "reorder-up" && entry.upBtn) entry.upBtn.classList.add("tv-focus-visible");else if (tvRowSubZone === "reorder-down" && entry.dnBtn) entry.dnBtn.classList.add("tv-focus-visible");else if (tvRowSubZone === "assign" && ((_entry$col4 = entry.col3) === null || _entry$col4 === void 0 || (_entry$col4 = _entry$col4.style) === null || _entry$col4 === void 0 ? void 0 : _entry$col4.display) !== "none") entry.col3.classList.add("tv-focus-visible");
  });
}

/* Scrolls the row into view AND makes sure it exists in the DOM before
   returning. The render is driven by the wrap's scroll event, which queues its
   own rAF a frame later than the caller's — so for any row outside the current
   window (the numpad's jump-to-channel is the one that reaches far) the focus
   lookup ran against a row that had not been built yet, found nothing, and
   silently drew no ring at all. Syncing _vsScrollTop and rendering here closes
   that window; the later scroll-driven render is then a no-op repaint. */
function scrollTVRowIntoView(idx) {
  var wrap = document.getElementById("channel-list-wrap");
  if (!wrap) return;
  var top = idx * VS_ROW_H,
    bot = top + VS_ROW_H;
  if (top < wrap.scrollTop) wrap.scrollTop = top - VS_ROW_H;else if (bot > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = bot - wrap.clientHeight + VS_ROW_H;
  if (typeof _vsSyncScroll === "function") _vsSyncScroll();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function _handleModalKey(e, modal) {
  if (_isBack(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    modal.remove();
    requestAnimationFrame(function () {
      return tvFocusSidebarItem(tvSidebarIndex);
    });
    return;
  }
  var kc = _keyCode(e);
  var inp = modal.querySelector(".modal-input");
  var okBtn = modal.querySelector(".modal-btn-ok");
  var cancelBtn = modal.querySelector(".modal-btn:not(.modal-btn-ok)");
  var focused = modal.querySelector(".modal-btn.tv-focus-visible");
  if (document.activeElement === inp) {
    if (kc === _KEY.ENTER) {
      e.preventDefault();
      inp.blur();
      _setModalFocus(modal, okBtn);
    }
    return;
  }
  e.preventDefault();
  if (kc === _KEY.UP || kc === _KEY.DOWN || kc === _KEY.LEFT || kc === _KEY.RIGHT) {
    _setModalFocus(modal, focused === okBtn ? cancelBtn : focused === cancelBtn ? okBtn : inp);
    return;
  }
  if (kc === _KEY.ENTER) {
    if (focused) {
      focused.click();
      return;
    }
    inp === null || inp === void 0 || inp.focus();
    return;
  }
}
function _setModalFocus(modal, el) {
  modal.querySelectorAll(".tv-focus-visible").forEach(function (x) {
    return x.classList.remove("tv-focus-visible");
  });
  if (el) {
    el.classList.add("tv-focus-visible");
    if (el.tagName === "INPUT") el.focus();
  }
}

// ── Assign panel ──────────────────────────────────────────────────────────────

function _handleAssignPanelKey(e, panel) {
  if (_isBack(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    history.back();
    return;
  }
  var kc = _keyCode(e);
  var items = Array.from(panel.querySelectorAll(".assign-row, .assign-new-btn"));
  if (!items.length) {
    e.preventDefault();
    return;
  }
  if (kc === _KEY.UP || kc === _KEY.DOWN) {
    e.preventDefault();
    _assignPanelIndex = Math.max(0, Math.min(items.length - 1, _assignPanelIndex + (kc === _KEY.DOWN ? 1 : -1)));
    _focusAssignItem(panel, items);
    return;
  }
  if (kc === _KEY.ENTER) {
    e.preventDefault();
    var el = items[_assignPanelIndex];
    if (!el) return;
    if (el.classList.contains("assign-new-btn")) {
      el.click();
      return;
    }
    var cb = el.querySelector("input[type='checkbox']");
    if (cb) {
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change"));
    }
    _focusAssignItem(panel, items);
    return;
  }
  e.preventDefault();
}
function _focusAssignItem(panel, items) {
  panel.querySelectorAll(".tv-focus-visible").forEach(function (el) {
    return el.classList.remove("tv-focus-visible");
  });
  var el = items[_assignPanelIndex];
  if (el) {
    el.classList.add("tv-focus-visible");
    el.scrollIntoView({
      block: "nearest"
    });
  }
}

// ── Context menu ──────────────────────────────────────────────────────────────

function _handleCtxMenuKey(e, menu) {
  if (_isBack(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeContextMenus();
    requestAnimationFrame(function () {
      return tvFocusSidebarItem(tvSidebarIndex);
    });
    return;
  }
  var kc = _keyCode(e);
  var items = Array.from(menu.querySelectorAll(".ctx-item"));
  if (!items.length) {
    e.preventDefault();
    return;
  }
  if (kc === _KEY.UP || kc === _KEY.DOWN) {
    e.preventDefault();
    _ctxMenuIndex = Math.max(0, Math.min(items.length - 1, _ctxMenuIndex + (kc === _KEY.DOWN ? 1 : -1)));
    _focusCtxItem(menu, items);
    return;
  }
  if (kc === _KEY.ENTER) {
    var _items$_ctxMenuIndex;
    e.preventDefault();
    (_items$_ctxMenuIndex = items[_ctxMenuIndex]) === null || _items$_ctxMenuIndex === void 0 || _items$_ctxMenuIndex.click();
    return;
  }
  e.preventDefault();
}
function _focusCtxItem(menu, items) {
  menu.querySelectorAll(".tv-focus-visible").forEach(function (el) {
    return el.classList.remove("tv-focus-visible");
  });
  var el = items[_ctxMenuIndex];
  if (el) {
    el.classList.add("tv-focus-visible");
    el.scrollIntoView({
      block: "nearest"
    });
  }
}