// ── M3U / M3U8 playlist support ───────────────────────────────────────────────
// Parses M3U playlists and separates Live TV, Movies and Series.

const M3U_CACHE_KEY = "iptv_m3u_v1";
const M3U_TTL_MS = 4 * 60 * 60 * 1000;

function m3uLoadConfig() {
    const stored = (() => {
        try {
            return JSON.parse(localStorage.getItem("iptv_m3u_config"));
        } catch {
            return null;
        }
    })();

    if (stored?.playlist_url) return Promise.resolve(stored);
    if (window.IPTV_M3U_CONFIG?.playlist_url) {
        return Promise.resolve(window.IPTV_M3U_CONFIG);
    }

    return Promise.reject(new Error("No M3U playlist URL configured"));
}


// ── Disk cache: Live only ─────────────────────────────────────────────────────
// We deliberately do not save the huge VOD library in localStorage.

function m3uLoadCache() {
    try {
        const raw = localStorage.getItem(M3U_CACHE_KEY);
        if (!raw) return null;

        const { ts, channels, categories } = JSON.parse(raw);

        if (Date.now() - ts > M3U_TTL_MS) return null;

        return { channels, categories };
    } catch {
        return null;
    }
}

function m3uSaveCache(channels, categories) {
    try {
        localStorage.setItem(
            M3U_CACHE_KEY,
            JSON.stringify({
                ts: Date.now(),
                channels,
                categories
            })
        );
    } catch {}
}

function m3uClearCache() {
    try {
        localStorage.removeItem(M3U_CACHE_KEY);
    } catch {}
}


// ── Parser helpers ─────────────────────────────────────────────────────────────

const _attrReCache = {};

function _parseAttr(extinf, attr) {
    let re = _attrReCache[attr];

    if (!re) {
        re = _attrReCache[attr] = new RegExp(
            attr + '=(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\']*))'
        );
    }

    const m = extinf.match(re);

    return m
        ? (
            m[1] !== undefined
                ? m[1]
                : m[2] !== undefined
                    ? m[2]
                    : m[3] || ""
        ).trim()
        : "";
}


function _m3uNorm(s) {
    const text = String(s || "");

    if (text.normalize) {
        return text
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
    }

    return text.toLowerCase();
}


// ── Detect content type ────────────────────────────────────────────────────────

function _m3uLooksSeries(group, name, url) {
    const g = _m3uNorm(group);
    const n = _m3uNorm(name);
    const u = _m3uNorm(url);

    // Xtream-style series URL
    if (/\/series\//.test(u)) return true;

    // Ex: S01E02
    if (/\bs\d{1,2}\s*e\d{1,3}\b/i.test(name)) return true;

    // Ex: 1x02
    if (/\b\d{1,2}x\d{1,3}\b/i.test(name)) return true;

    // Ex: T1 E2 / Temporada 1 Episodio 2
    if (
        /\b(?:t|temp|temporada)\s*\d{1,2}\s*(?:e|ep|episodio)\s*\d{1,3}\b/i.test(n)
    ) {
        return true;
    }

    // Category names
    return /\b(series|seriados|novelas|animes)\b/.test(g);
}


function _m3uLooksMovie(group, name, url) {
    const g = _m3uNorm(group);
    const u = _m3uNorm(url);

    // Xtream-style movie URL
    if (/\/movie\//.test(u)) return true;

    // Normal VOD file
    if (/\.(mp4|mkv|avi|mov|m4v|webm)(?:$|\?)/.test(u)) {
        return true;
    }

    // Common VOD category names
    return /\b(filmes|filme|movies|movie|vod|lancamentos|netflix|prime video|amazon prime|disney plus|disney\+|globoplay|paramount plus|paramount\+)\b/.test(g);
}


// ── Extract season / episode ──────────────────────────────────────────────────

function _m3uEpisodeInfo(name) {
    const raw = String(name || "");

    let m = raw.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);

    if (!m) {
        m = raw.match(/\b(\d{1,2})x(\d{1,3})\b/i);
    }

    if (!m) {
        m = raw.match(
            /\b(?:T|TEMP|TEMPORADA)\s*(\d{1,2})\s*(?:E|EP|EPISODIO)\s*(\d{1,3})\b/i
        );
    }

    // Series category but no recognisable episode numbering.
    if (!m) {
        return {
            season: 1,
            episode: 1,
            seriesName: raw.trim() || "Series"
        };
    }

    const season = parseInt(m[1], 10) || 1;
    const episode = parseInt(m[2], 10) || 1;

    let seriesName = raw
        .slice(0, m.index)
        .replace(/[\s._\-|:]+$/g, "")
        .trim();

    if (!seriesName) {
        seriesName = raw
            .replace(m[0], "")
            .replace(/^[\s._\-|:]+|[\s._\-|:]+$/g, "")
            .trim();
    }

    if (!seriesName) {
        seriesName = raw.trim() || "Series";
    }

    return {
        season,
        episode,
        seriesName
    };
}


function _m3uExt(url) {
    const m = String(url || "").match(
        /\.([a-z0-9]{2,5})(?:$|\?)/i
    );

    return m ? m[1].toLowerCase() : "mp4";
}


function _m3uCatId(map, group, prefix) {
    if (!map.has(group)) {
        map.set(
            group,
            prefix + String(map.size + 1)
        );
    }

    return map.get(group);
}


function _m3uCats(map) {
    return Array.from(map.entries()).map(([name, id]) => ({
        category_id: id,
        category_name: name
    }));
}


// ── Full M3U parser ────────────────────────────────────────────────────────────

function m3uParse(text) {
    const lines = text
        .replace(/\r\n?/g, "\n")
        .split("\n");

    const channels = [];
    const movies = [];

    const seriesMap = new Map();
    const seriesInfo = {};

    const urlById = {};

    const liveCats = new Map();
    const movieCats = new Map();
    const seriesCats = new Map();

    let extinf = null;

    let itemNo = 1;
    let seriesNo = 1;


    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line) continue;


        if (line.startsWith("#EXTINF")) {
            extinf = line;
            continue;
        }


        if (line.startsWith("#")) {
            continue;
        }


        if (!extinf) {
            continue;
        }


        const name = extinf
            .replace(/^#EXTINF[^,]*,/, "")
            .trim();

        const tvgId =
            _parseAttr(extinf, "tvg-id") ||
            _parseAttr(extinf, "tvg-name") ||
            name;

        const logo =
            _parseAttr(extinf, "tvg-logo");

        const group =
            _parseAttr(extinf, "group-title") ||
            "Uncategorised";


        const idNum = itemNo++;


        const isSeries =
            _m3uLooksSeries(group, name, line);

        const isMovie =
            !isSeries &&
            _m3uLooksMovie(group, name, line);


        // ─────────────────────────────────────────────────────────────
        // SERIES
        // ─────────────────────────────────────────────────────────────

        if (isSeries) {
            const ep = _m3uEpisodeInfo(name);

            const catId =
                _m3uCatId(
                    seriesCats,
                    group,
                    "s"
                );

            const seriesKey =
                _m3uNorm(
                    group +
                    "||" +
                    ep.seriesName
                );


            let series =
                seriesMap.get(seriesKey);


            if (!series) {
                const seriesId =
                    "m3u-s-" +
                    seriesNo++;


                series = {
                    series_id: seriesId,
                    name: ep.seriesName,
                    cover: logo,
                    category_id: catId,
                    _source: "m3u"
                };


                seriesMap.set(
                    seriesKey,
                    series
                );


                seriesInfo[seriesId] = {
                    episodes: {}
                };
            }


            else if (!series.cover && logo) {
                series.cover = logo;
            }


            const episodeId =
                "m3u-e-" +
                idNum;


            const ext =
                _m3uExt(line);


            const seasonKey =
                String(ep.season);


            if (
                !seriesInfo[series.series_id]
                    .episodes[seasonKey]
            ) {
                seriesInfo[
                    series.series_id
                ].episodes[
                    seasonKey
                ] = [];
            }


            seriesInfo[
                series.series_id
            ].episodes[
                seasonKey
            ].push({
                id: episodeId,
                episode_num: ep.episode,
                title: name,
                container_extension: ext,
                stream_url: line,
                _source: "m3u"
            });


            urlById[episodeId] =
                line;
        }


        // ─────────────────────────────────────────────────────────────
        // MOVIES
        // ─────────────────────────────────────────────────────────────

        else if (isMovie) {
            const movieId =
                "m3u-m-" +
                idNum;


            const catId =
                _m3uCatId(
                    movieCats,
                    group,
                    "m"
                );


            movies.push({
                stream_id: movieId,
                name,
                stream_icon: logo,
                category_id: catId,
                container_extension: _m3uExt(line),
                stream_url: line,
                _source: "m3u"
            });


            urlById[movieId] =
                line;
        }


        // ─────────────────────────────────────────────────────────────
        // LIVE TV
        // ─────────────────────────────────────────────────────────────

        else {
            const liveId =
                "m3u-l-" +
                idNum;


            const catId =
                _m3uCatId(
                    liveCats,
                    group,
                    "l"
                );


            channels.push({
                stream_id: liveId,
                name,
                stream_icon: logo,
                epg_channel_id: tvgId,
                category_id: catId,
                stream_url: line,
                _source: "m3u"
            });


            urlById[liveId] =
                line;
        }


        extinf = null;
    }


    // Sort series episodes numerically

    Object.keys(seriesInfo).forEach(
        (seriesId) => {

            const bySeason =
                seriesInfo[
                    seriesId
                ].episodes;


            Object.keys(bySeason).forEach(
                (sn) => {

                    bySeason[sn].sort(
                        (a, b) =>
                            (+a.episode_num || 0) -
                            (+b.episode_num || 0)
                    );

                }
            );

        }
    );


    return {

        // Live
        channels,
        categories:
            _m3uCats(liveCats),

        // Movies
        movies,
        movieCategories:
            _m3uCats(movieCats),

        // Series
        series:
            Array.from(
                seriesMap.values()
            ),

        seriesCategories:
            _m3uCats(seriesCats),

        seriesInfo,

        // Playback URLs
        urlById
    };
}


// ── Download playlist ──────────────────────────────────────────────────────────

async function m3uFetchPlaylist(url) {

    const ctrl =
        new AbortController();

    const tid =
        setTimeout(
            () => ctrl.abort(),
            30000
        );


    try {

        const res =
            await fetch(
                url,
                {
                    signal:
                        ctrl.signal
                }
            );


        if (!res.ok) {
            throw new Error(
                "HTTP " +
                res.status
            );
        }


        const text =
            await res.text();


        clearTimeout(tid);


        if (
            !text.includes(
                "#EXTM3U"
            )
        ) {
            throw new Error(
                "Not a valid M3U playlist"
            );
        }


        return m3uParse(text);

    }

    catch (err) {

        clearTimeout(tid);

        throw err;

    }
}


// ── Memory cache ───────────────────────────────────────────────────────────────
//
// The playlist is huge. Once the VOD page downloads it, all category requests
// use this in-memory copy instead of downloading the M3U over and over.

let _m3uMemoryUrl = "";
let _m3uMemoryPromise = null;
let _m3uLastLibrary = null;


function m3uGetLibrary(m3uCfg) {

    const url =
        m3uCfg &&
        m3uCfg.playlist_url;


    if (!url) {
        return Promise.reject(
            new Error(
                "No M3U playlist URL configured"
            )
        );
    }


    if (
        _m3uMemoryPromise &&
        _m3uMemoryUrl === url
    ) {
        return _m3uMemoryPromise;
    }


    _m3uMemoryUrl =
        url;


    _m3uMemoryPromise =
        m3uFetchPlaylist(url)

            .then(
                (lib) => {

                    _m3uLastLibrary =
                        lib;

                    return lib;

                }
            )

            .catch(
                (err) => {

                    _m3uMemoryPromise =
                        null;

                    _m3uMemoryUrl =
                        "";

                    throw err;

                }
            );


    return _m3uMemoryPromise;
}


// ── Public API ─────────────────────────────────────────────────────────────────


// Live TV

async function m3uGetChannelsAndCategories(
    m3uCfg
) {

    const lib =
        await m3uGetLibrary(
            m3uCfg
        );


    return {
        channels:
            lib.channels,

        categories:
            lib.categories
    };
}


// Movie categories

async function m3uGetVodCategories(
    m3uCfg
) {

    const lib =
        await m3uGetLibrary(
            m3uCfg
        );


    return lib.movieCategories;
}


// Movies inside a category

async function m3uGetVodStreams(
    m3uCfg,
    categoryId
) {

    const lib =
        await m3uGetLibrary(
            m3uCfg
        );


    return lib.movies.filter(
        (item) =>
            String(
                item.category_id
            ) ===
            String(
                categoryId
            )
    );
}


// Series categories

async function m3uGetSeriesCategories(
    m3uCfg
) {

    const lib =
        await m3uGetLibrary(
            m3uCfg
        );


    return lib.seriesCategories;
}


// Series inside a category

async function m3uGetSeries(
    m3uCfg,
    categoryId
) {

    const lib =
        await m3uGetLibrary(
            m3uCfg
        );


    return lib.series.filter(
        (item) =>
            String(
                item.category_id
            ) ===
            String(
                categoryId
            )
    );
}


// Seasons and episodes

async function m3uGetSeriesInfo(
    m3uCfg,
    seriesId
) {

    const lib =
        await m3uGetLibrary(
            m3uCfg
        );


    return (
        lib.seriesInfo[
            String(seriesId)
        ] ||
        {
            episodes: {}
        }
    );
}


// Find the original M3U URL using our generated stream ID

function m3uResolveStreamUrl(id) {

    return (
        _m3uLastLibrary &&
        _m3uLastLibrary
            .urlById[
                String(id)
            ]
    ) || "";
}


// M3U has no Xtream EPG API

function m3uGetEPG() {
    return Promise.resolve([]);
}


// Live stream URL is already inside the playlist

function m3uBuildLiveURL(channel) {
    return channel.stream_url || "";
}
