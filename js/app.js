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

async function initApp() {
    const status = document.getElementById("status");
    const setStatus = (msg, err) => {
        status.textContent = msg;
        status.style.color = err ? "#ff5555" : "";
    };

    epgCache = loadEpgDiskCache();

    if (getSourceType() === "m3u") {
        await _initAppM3U(setStatus);
    } else {
        await _initAppXtream(setStatus);
    }
}

async function _initAppM3U(setStatus) {
    let m3uCfg;
    try { m3uCfg = await m3uLoadConfig(); }
    catch (err) { setStatus("ERR: " + err.message, true); return; }

    // Try disk cache first
    const cached = m3uLoadCache();
    if (cached) {
        allChannels = cached.channels;
        setStatus(`${allChannels.length} channels (cached)`);
        _bootUI(cached.categories);
        // Refresh in background
        m3uFetchPlaylist(m3uCfg.playlist_url).then(({ channels, categories }) => {
            allChannels = channels;
            setStatus(`${allChannels.length} channels`);
            m3uSaveCache(channels, categories);
            renderCategories(categories);
            applyFilters();
        }).catch(() => {});
        return;
    }

    try {
        setStatus("Loading playlist…");
        const { channels, categories } = await m3uGetChannelsAndCategories(m3uCfg);
        if (!channels.length) { setStatus("ERR: 0 channels in playlist", true); return; }
        allChannels = channels;
        setStatus(`${allChannels.length} channels`);
        m3uSaveCache(channels, categories);
        _bootUI(categories);
    } catch (err) { setStatus("ERR: " + err.message, true); }
}

async function _initAppXtream(setStatus) {
    setStatus("Loading config…");
    try { cfg = await xtreamLoadConfig(); }
    catch (err) { setStatus("ERR: " + err.message, true); return; }

    if (!cfg?.server_url) {
        setStatus("No server configured — redirecting to Settings…", false);
        setTimeout(() => { window.location.href = "../pages/settings.html"; }, 1800);
        return;
    }

    const cachedCh  = loadChannelCache();
    const cachedCat = loadCatCache();
    let categories  = cachedCat || [];

    if (cachedCh) {
        allChannels = cachedCh;
        setStatus(`${allChannels.length} channels (cached)`);
        _bootUI(categories);

        /* Background refresh. Both guards on `.length` are load-bearing:
           xtreamGet* swallow their errors and return [], so a failed refresh
           arrives as an empty array rather than a rejection. Without the guard
           the category list was wiped from the screen AND written back to the
           cache as empty on every launch where the panel was briefly
           unreachable — leaving the sidebar with no categories until a later
           launch happened to succeed. */
        xtreamGetLiveChannels(cfg).then(fresh => {
            if (!fresh.length) return;
            allChannels = fresh;
            setStatus(`${allChannels.length} channels`);
            saveChannelCache(fresh, categories);
            applyFilters();
        }).catch(() => {});
        xtreamGetCategories(cfg).then(freshCat => {
            if (!freshCat.length) return;
            categories = freshCat;
            saveChannelCache(allChannels, freshCat);
            renderCategories(freshCat);
            updateSidebarActive();
        }).catch(() => {});
        return;
    }

    setStatus("Logging in…");
    try {
        const login = await xtreamLogin(cfg);
        /* Three outcomes, not two: authenticated, the panel answered and said
           no (bad password / expired line), or nothing answered at all. The
           middle one used to fall through as a success and reappear later as
           "0 channels returned". */
        if (login && login.authFailed) { setStatus("ERR: " + login.message, true); return; }
        if (!login) { setStatus("ERR: Could not reach any server for this profile", true); return; }
        // Update cfg with the resolved server_url (the URL that actually worked)
        cfg = login.cfg;
    } catch (err) { setStatus("ERR: " + err.message, true); return; }

    try {
        setStatus("Fetching channels…");
        const [channels, cats] = await Promise.all([xtreamGetLiveChannels(cfg), xtreamGetCategories(cfg)]);
        if (!channels.length) { setStatus("ERR: 0 channels returned", true); return; }
        allChannels = channels; categories = cats;
        setStatus(`${allChannels.length} channels`);
        saveChannelCache(channels, categories);
        _bootUI(categories);
    } catch (err) { setStatus("ERR: " + err.message, true); }
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
        const sec = document.getElementById("cat-section-favs");
        if (sec) sec.classList.add("open");
    }
    renderFavSectionList();
    updateSidebarActive();
    applyFilters();

    tvRowIndex = 0;
    setTVZone("channel-list");
}


// ── Channel selection ─────────────────────────────────────────────────────────

async function selectChannel(ch) {
    currentChannel = ch;
    const _selSid = String(ch.stream_id);
    rowCache.forEach((entry, sid) => entry.row.classList.toggle("selected", sid === _selSid));
    document.getElementById("preview-channel-name").textContent = ch.name || "Unknown";
    document.getElementById("pip-channel-name").textContent     = ch.name || "Unknown";
    const playUrl = ch._source === "m3u" ? m3uBuildLiveURL(ch) : xtreamBuildLiveURL(cfg, ch.stream_id);
    // The key lets the player remember which engine actually worked for THIS
    // channel, so a 4K/HEVC channel that only plays on HLS starts there.
    player.play(playUrl, { key: "ch:" + ch.stream_id });
    setEPG("now", "Loading…", "", ""); setEPG("next", "—", "", "");
    document.getElementById("epg-bar-fill").style.width = "0%";
    showPreviewInfo();
    showOSD();  // immediate banner on channel switch — EPG data populated below

    let listings = epgCache[ch.stream_id];
    if (!listings && !epgBlocked) {
        epgCache[ch.stream_id] = null;
        try {
            listings = ch._source === "m3u"
                ? await m3uGetEPG(ch.stream_id)
                : await xtreamGetEPG(cfg, ch.stream_id);
        } catch (err) {
            if (Net.isHttpError(err, 403) || Net.isHttpError(err, 401)) epgBlocked = true;
            listings = [];
        }
        epgCache[ch.stream_id] = listings;
        patchEpgStrip(ch.stream_id); scheduleEpgSave();
    }
    if (!listings?.length) { setEPG("now", "No EPG data", "", ""); showOSD(); return; }

    const { cur, next } = _findNowNext(listings);
    setEPG("now", xtreamDecodeEPG(cur.title), formatTimeRange(cur), xtreamDecodeEPG(cur.description));
    document.getElementById("epg-bar-fill").style.width = calcProgress(cur) + "%";
    if (next) setEPG("next", xtreamDecodeEPG(next.title), formatTimeRange(next), "");
    showOSD();
}

function updateOSDIfFullscreen() {
    if (isFullscreen()) showOSD();
}

function setEPG(slot, title, time, desc) {
    document.getElementById(`epg-${slot}-title`).textContent = title || "—";
    document.getElementById(`epg-${slot}-time`).textContent  = time  || "";
    const el = document.getElementById(`epg-${slot}-desc`);
    if (el) el.textContent = desc || "";
}

function showPreviewInfo() {
    document.getElementById("preview-info")?.classList.add("preview-visible");
}

function channelStep(delta) {
    if (!_vsChannels.length) return;
    let idx = currentChannel
        ? _vsChannels.findIndex(ch => String(ch.stream_id) === String(currentChannel.stream_id))
        : -1;
    if (idx < 0) idx = delta > 0 ? -1 : _vsChannels.length;
    idx = Math.max(0, Math.min(_vsChannels.length - 1, idx + delta));
    tvRowIndex = idx;
    const ch = _vsChannels[idx];
    if (ch) { selectChannel(ch); tvFocusRow(idx); }
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
        const active = Config.resolve();
        if (active && active.type !== "m3u" && active.server_url) window.IPTV_CONFIG = active;
    } catch (_) {}

    loadXMLTVFromCache();

    measureRowHeight();
    initVirtualScroll();
    initTVNavigation();
    if (typeof tvSetBackUrl === "function") tvSetBackUrl("../index.html");
    initApp();

    if (load("iptv_custom_epg_url", "")) {
        setTimeout(() => mergeXMLTVIntoEpgCache(), 2000);
    }
}());
