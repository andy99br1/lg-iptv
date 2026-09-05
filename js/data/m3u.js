// ── M3U / M3U8 playlist support ───────────────────────────────────────────────
// Parses M3U playlists, separates Live TV / Movies / Series,
// and provides automatic XMLTV EPG support for M3U profiles.

const M3U_CACHE_KEY = "iptv_m3u_v1";
const M3U_TTL_MS = 4 * 60 * 60 * 1000;

function m3uLoadConfig() {
    // Prefer the active profile because it also contains epg_url / epg_match.
    try {
        const profiles = JSON.parse(localStorage.getItem("iptv_profiles") || "[]");
        const activeId = localStorage.getItem("iptv_active_profile");

        if (Array.isArray(profiles) && profiles.length) {
            let active = null;

            if (activeId) {
                active = profiles.find(function (p) {
                    return String(p.id) === String(activeId);
                });
            }

            if (!active) {
                active = profiles.find(function (p) {
                    return p && p.type === "m3u" && p.playlist_url;
                });
            }

            if (active && active.type === "m3u" && active.playlist_url) {
                return Promise.resolve(active);
            }
        }
    } catch (e) {}

    const stored = (() => {
        try {
            return JSON.parse(localStorage.getItem("iptv_m3u_config"));
        } catch (e) {
            return null;
        }
    })();

    if (stored && stored.playlist_url) {
        return Promise.resolve(stored);
    }

    if (
        window.IPTV_M3U_CONFIG &&
        window.IPTV_M3U_CONFIG.playlist_url
    ) {
        return Promise.resolve(
            window.IPTV_M3U_CONFIG
        );
    }

    return Promise.reject(
        new Error("No M3U playlist URL configured")
    );
}


// ── Disk cache: Live only ─────────────────────────────────────────────────────
// We deliberately do not save the huge VOD library in localStorage.

function m3uLoadCache() {
    try {
        const raw = localStorage.getItem(M3U_CACHE_KEY);

        if (!raw) {
            return null;
        }

        const data = JSON.parse(raw);

        if (
            !data ||
            Date.now() - data.ts >
                M3U_TTL_MS
        ) {
            return null;
        }

        return {
            channels:
                data.channels || [],

            categories:
                data.categories || []
        };
    } catch (e) {
        return null;
    }
}

function m3uSaveCache(
    channels,
    categories
) {
    try {
        localStorage.setItem(
            M3U_CACHE_KEY,
            JSON.stringify({
                ts: Date.now(),
                channels: channels,
                categories: categories
            })
        );
    } catch (e) {}
}

function m3uClearCache() {
    try {
        localStorage.removeItem(
            M3U_CACHE_KEY
        );
    } catch (e) {}
}


// ── Parser helpers ─────────────────────────────────────────────────────────────

const _attrReCache = {};

function _parseAttr(
    extinf,
    attr
) {
    let re =
        _attrReCache[attr];

    if (!re) {
        re =
            _attrReCache[attr] =
                new RegExp(
                    attr +
                    '=(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\']*))'
                );
    }

    const m =
        extinf.match(re);

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
    const text =
        String(s || "");

    if (text.normalize) {
        return text
            .normalize("NFD")
            .replace(
                /[\u0300-\u036f]/g,
                ""
            )
            .toLowerCase();
    }

    return text.toLowerCase();
}

function _m3uNormChannelName(s) {
    return _m3uNorm(s)
        .replace(
            /\b(uhd|fhd|full\s*hd|hd|sd|4k|8k|h\.?265|hevc)\b/g,
            " "
        )
        .replace(
            /\b(?:br|brasil|brazil)\b/g,
            " "
        )
        .replace(
            /[^a-z0-9]+/g,
            " "
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();
}


// ── EPG URL from M3U header ───────────────────────────────────────────────────

function _m3uExtractHeaderEpgUrl(text) {
    const firstLine =
        String(text || "")
            .replace(/\r\n?/g, "\n")
            .split("\n")[0] || "";

    const attrs = [
        "x-tvg-url",
        "url-tvg",
        "tvg-url",
        "epg-url",
        "x-tvg"
    ];

    for (
        let i = 0;
        i < attrs.length;
        i++
    ) {
        const value =
            _parseAttr(
                firstLine,
                attrs[i]
            );

        if (value) {
            // Some playlists advertise more than one EPG separated by commas.
            // Use the first one; it is normally the primary guide.
            return value
                .split(",")[0]
                .trim();
        }
    }

    return "";
}

function _m3uResolveRelativeUrl(
    value,
    playlistUrl
) {
    if (!value) {
        return "";
    }

    try {
        return new URL(
            value,
            playlistUrl
        ).href;
    } catch (e) {
        return value;
    }
}


// ── Detect content type ────────────────────────────────────────────────────────

function _m3uLooksSeries(
    group,
    name,
    url
) {
    const g =
        _m3uNorm(group);

    const n =
        _m3uNorm(name);

    const u =
        _m3uNorm(url);

    if (/\/series\//.test(u)) {
        return true;
    }

    if (
        /\bs\d{1,2}\s*e\d{1,3}\b/i.test(
            name
        )
    ) {
        return true;
    }

    if (
        /\b\d{1,2}x\d{1,3}\b/i.test(
            name
        )
    ) {
        return true;
    }

    if (
        /\b(?:t|temp|temporada)\s*\d{1,2}\s*(?:e|ep|episodio)\s*\d{1,3}\b/i.test(
            n
        )
    ) {
        return true;
    }

    return /\b(series|seriados|novelas|animes)\b/.test(
        g
    );
}

function _m3uLooksMovie(
    group,
    name,
    url
) {
    const g =
        _m3uNorm(group);

    const u =
        _m3uNorm(url);

    if (/\/movie\//.test(u)) {
        return true;
    }

    if (
        /\.(mp4|mkv|avi|mov|m4v|webm)(?:$|\?)/.test(
            u
        )
    ) {
        return true;
    }

    return /\b(filmes|filme|movies|movie|vod|lancamentos|netflix|prime video|amazon prime|disney plus|disney\+|globoplay|paramount plus|paramount\+)\b/.test(
        g
    );
}


// ── Extract season / episode ──────────────────────────────────────────────────

function _m3uEpisodeInfo(
    name
) {
    const raw =
        String(name || "");

    let m =
        raw.match(
            /\bS(\d{1,2})\s*E(\d{1,3})\b/i
        );

    if (!m) {
        m =
            raw.match(
                /\b(\d{1,2})x(\d{1,3})\b/i
            );
    }

    if (!m) {
        m =
            raw.match(
                /\b(?:T|TEMP|TEMPORADA)\s*(\d{1,2})\s*(?:E|EP|EPISODIO)\s*(\d{1,3})\b/i
            );
    }

    if (!m) {
        return {
            season: 1,
            episode: 1,
            seriesName:
                raw.trim() ||
                "Series"
        };
    }

    const season =
        parseInt(
            m[1],
            10
        ) || 1;

    const episode =
        parseInt(
            m[2],
            10
        ) || 1;

    let seriesName =
        raw
            .slice(
                0,
                m.index
            )
            .replace(
                /[\s._\-|:]+$/g,
                ""
            )
            .trim();

    if (!seriesName) {
        seriesName =
            raw
                .replace(
                    m[0],
                    ""
                )
                .replace(
                    /^[\s._\-|:]+|[\s._\-|:]+$/g,
                    ""
                )
                .trim();
    }

    if (!seriesName) {
        seriesName =
            raw.trim() ||
            "Series";
    }

    return {
        season: season,
        episode: episode,
        seriesName: seriesName
    };
}

function _m3uExt(url) {
    const m =
        String(url || "")
            .match(
                /\.([a-z0-9]{2,5})(?:$|\?)/i
            );

    return m
        ? m[1].toLowerCase()
        : "mp4";
}

function _m3uCatId(
    map,
    group,
    prefix
) {
    if (!map.has(group)) {
        map.set(
            group,
            prefix +
            String(
                map.size + 1
            )
        );
    }

    return map.get(group);
}

function _m3uCats(map) {
    return Array.from(
        map.entries()
    ).map(
        function (entry) {
            return {
                category_id:
                    entry[1],

                category_name:
                    entry[0]
            };
        }
    );
}


// ── Full M3U parser ────────────────────────────────────────────────────────────

function m3uParse(text) {
    const lines =
        text
            .replace(/\r\n?/g, "\n")
            .split("\n");

    const channels = [];
    const movies = [];

    const seriesMap =
        new Map();

    const seriesInfo = {};
    const urlById = {};
    const channelById = {};

    const liveCats =
        new Map();

    const movieCats =
        new Map();

    const seriesCats =
        new Map();

    const epgUrl =
        _m3uExtractHeaderEpgUrl(
            text
        );

    let extinf = null;
    let itemNo = 1;
    let seriesNo = 1;

    for (
        let i = 0;
        i < lines.length;
        i++
    ) {
        const line =
            lines[i].trim();

        if (!line) {
            continue;
        }

        if (
            line.startsWith(
                "#EXTINF"
            )
        ) {
            extinf = line;

            continue;
        }

        if (
            line.startsWith("#")
        ) {
            continue;
        }

        if (!extinf) {
            continue;
        }

        const name =
            extinf
                .replace(
                    /^#EXTINF[^,]*,/,
                    ""
                )
                .trim();

        const tvgId =
            _parseAttr(
                extinf,
                "tvg-id"
            ) ||
            _parseAttr(
                extinf,
                "tvg-name"
            ) ||
            name;

        const logo =
            _parseAttr(
                extinf,
                "tvg-logo"
            );

        const group =
            _parseAttr(
                extinf,
                "group-title"
            ) ||
            "Uncategorised";

        const idNum =
            itemNo++;

        const isSeries =
            _m3uLooksSeries(
                group,
                name,
                line
            );

        const isMovie =
            !isSeries &&
            _m3uLooksMovie(
                group,
                name,
                line
            );


        // ─────────────────────────────────────────────────────────────
        // SERIES
        // ─────────────────────────────────────────────────────────────

        if (isSeries) {
            const ep =
                _m3uEpisodeInfo(
                    name
                );

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
                seriesMap.get(
                    seriesKey
                );

            if (!series) {
                const seriesId =
                    "m3u-s-" +
                    seriesNo++;

                series = {
                    series_id:
                        seriesId,

                    name:
                        ep.seriesName,

                    cover:
                        logo,

                    category_id:
                        catId,

                    _source:
                        "m3u"
                };

                seriesMap.set(
                    seriesKey,
                    series
                );

                seriesInfo[
                    seriesId
                ] = {
                    episodes: {}
                };
            }

            else if (
                !series.cover &&
                logo
            ) {
                series.cover =
                    logo;
            }

            const episodeId =
                "m3u-e-" +
                idNum;

            const ext =
                _m3uExt(line);

            const seasonKey =
                String(
                    ep.season
                );

            if (
                !seriesInfo[
                    series.series_id
                ].episodes[
                    seasonKey
                ]
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
                id:
                    episodeId,

                episode_num:
                    ep.episode,

                title:
                    name,

                container_extension:
                    ext,

                stream_url:
                    line,

                _source:
                    "m3u"
            });

            urlById[
                episodeId
            ] = line;
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
                stream_id:
                    movieId,

                name:
                    name,

                stream_icon:
                    logo,

                category_id:
                    catId,

                container_extension:
                    _m3uExt(
                        line
                    ),

                stream_url:
                    line,

                _source:
                    "m3u"
            });

            urlById[
                movieId
            ] = line;
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

            const channel = {
                stream_id:
                    liveId,

                name:
                    name,

                stream_icon:
                    logo,

                epg_channel_id:
                    tvgId,

                category_id:
                    catId,

                stream_url:
                    line,

                _source:
                    "m3u"
            };

            channels.push(
                channel
            );

            channelById[
                liveId
            ] = channel;

            urlById[
                liveId
            ] = line;
        }

        extinf = null;
    }


    // Sort series episodes numerically.

    Object.keys(
        seriesInfo
    ).forEach(
        function (seriesId) {
            const bySeason =
                seriesInfo[
                    seriesId
                ].episodes;

            Object.keys(
                bySeason
            ).forEach(
                function (sn) {
                    bySeason[
                        sn
                    ].sort(
                        function (a, b) {
                            return (
                                (+a.episode_num || 0) -
                                (+b.episode_num || 0)
                            );
                        }
                    );
                }
            );
        }
    );

    return {
        // Live
        channels:
            channels,

        categories:
            _m3uCats(
                liveCats
            ),

        // Movies
        movies:
            movies,

        movieCategories:
            _m3uCats(
                movieCats
            ),

        // Series
        series:
            Array.from(
                seriesMap.values()
            ),

        seriesCategories:
            _m3uCats(
                seriesCats
            ),

        seriesInfo:
            seriesInfo,

        // Playback
        urlById:
            urlById,

        channelById:
            channelById,

        // EPG advertised by #EXTM3U
        epgUrl:
            epgUrl,

        epgMatch:
            "tvg-id"
    };
}


// ── Download playlist ──────────────────────────────────────────────────────────

async function m3uFetchPlaylist(url) {
    const ctrl =
        new AbortController();

    const tid =
        setTimeout(
            function () {
                ctrl.abort();
            },
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

        const lib =
            m3uParse(text);

        if (lib.epgUrl) {
            lib.epgUrl =
                _m3uResolveRelativeUrl(
                    lib.epgUrl,
                    url
                );
        }

        // Useful even when app.js calls m3uFetchPlaylist() directly
        // during its background refresh.
        _m3uLastLibrary =
            lib;

        return lib;
    }

    catch (err) {
        clearTimeout(tid);

        throw err;
    }
}


// ── Memory cache ───────────────────────────────────────────────────────────────
//
// The playlist is huge. Once downloaded, all VOD/category/EPG requests
// reuse this in-memory copy instead of downloading the M3U repeatedly.

let _m3uMemoryUrl = "";
let _m3uMemoryPromise = null;
let _m3uLastLibrary = null;

function m3uGetLibrary(
    m3uCfg
) {
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
        _m3uMemoryUrl ===
            url
    ) {
        return _m3uMemoryPromise;
    }

    _m3uMemoryUrl =
        url;

    _m3uMemoryPromise =
        m3uFetchPlaylist(
            url
        )
            .then(
                function (lib) {
                    // A profile-level EPG URL overrides the playlist header.
                    if (
                        m3uCfg.epg_url
                    ) {
                        lib.epgUrl =
                            _m3uResolveRelativeUrl(
                                m3uCfg.epg_url,
                                url
                            );
                    }

                    lib.epgMatch =
                        m3uCfg.epg_match ||
                        lib.epgMatch ||
                        "tvg-id";

                    _m3uLastLibrary =
                        lib;

                    return lib;
                }
            )
            .catch(
                function (err) {
                    _m3uMemoryPromise =
                        null;

                    _m3uMemoryUrl =
                        "";

                    throw err;
                }
            );

    return _m3uMemoryPromise;
}


// ── Public API: Live / VOD / Series ───────────────────────────────────────────

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

async function m3uGetVodCategories(
    m3uCfg
) {
    const lib =
        await m3uGetLibrary(
            m3uCfg
        );

    return lib.movieCategories;
}

async function m3uGetVodStreams(
    m3uCfg,
    categoryId
) {
    const lib =
        await m3uGetLibrary(
            m3uCfg
        );

    return lib.movies.filter(
        function (item) {
            return (
                String(
                    item.category_id
                ) ===
                String(
                    categoryId
                )
            );
        }
    );
}

async function m3uGetSeriesCategories(
    m3uCfg
) {
    const lib =
        await m3uGetLibrary(
            m3uCfg
        );

    return lib.seriesCategories;
}

async function m3uGetSeries(
    m3uCfg,
    categoryId
) {
    const lib =
        await m3uGetLibrary(
            m3uCfg
        );

    return lib.series.filter(
        function (item) {
            return (
                String(
                    item.category_id
                ) ===
                String(
                    categoryId
                )
            );
        }
    );
}

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
            String(
                seriesId
            )
        ] ||
        {
            episodes: {}
        }
    );
}

function m3uResolveStreamUrl(id) {
    return (
        _m3uLastLibrary &&
        _m3uLastLibrary
            .urlById[
                String(id)
            ]
    ) || "";
}

function m3uBuildLiveURL(channel) {
    return (
        channel &&
        channel.stream_url
    ) || "";
}


// ── Automatic XMLTV EPG for M3U ───────────────────────────────────────────────
//
// Priority:
//   1. epg_url saved in the active profile
//   2. x-tvg-url / url-tvg / tvg-url / epg-url from #EXTM3U
//
// The XMLTV file is downloaded only once per session and reused for every
// channel. It is refreshed after the TTL below.

const M3U_EPG_TTL_MS =
    6 * 60 * 60 * 1000;

let _m3uEpgUrl = "";
let _m3uEpgPromise = null;
let _m3uEpgData = null;
let _m3uEpgFetchedAt = 0;

function _m3uParseXMLTVDate(str) {
    if (!str) {
        return 0;
    }

    const m =
        String(str).match(
            /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/
        );

    if (!m) {
        return 0;
    }

    const yr =
        m[1];

    const mo =
        m[2];

    const dy =
        m[3];

    const hh =
        m[4];

    const mm =
        m[5];

    const ss =
        m[6] || "00";

    const tz =
        m[7];

    const tzStr =
        tz
            ? (
                tz.slice(0, 3) +
                ":" +
                tz.slice(3)
            )
            : "+00:00";

    const ms =
        new Date(
            yr +
            "-" +
            mo +
            "-" +
            dy +
            "T" +
            hh +
            ":" +
            mm +
            ":" +
            ss +
            tzStr
        ).getTime();

    return isNaN(ms)
        ? 0
        : ms;
}

function _m3uToEpgTimeStr(ms) {
    return new Date(ms)
        .toISOString()
        .replace(
            "T",
            " "
        )
        .replace(
            /\.\d+Z$/,
            ""
        );
}

async function _m3uFetchXMLTV(url) {
    const ctrl =
        new AbortController();

    const tid =
        setTimeout(
            function () {
                ctrl.abort();
            },
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
                "EPG HTTP " +
                res.status
            );
        }

        const text =
            await res.text();

        clearTimeout(tid);

        const parser =
            new DOMParser();

        const doc =
            parser.parseFromString(
                text,
                "application/xml"
            );

        if (
            doc.querySelector(
                "parsererror"
            )
        ) {
            throw new Error(
                "Invalid XMLTV XML"
            );
        }

        const channelNames = {};
        const nameToId = {};
        const programmes = {};

        const xmlChannels =
            doc.querySelectorAll(
                "channel"
            );

        for (
            let i = 0;
            i < xmlChannels.length;
            i++
        ) {
            const ch =
                xmlChannels[i];

            const id =
                ch.getAttribute(
                    "id"
                ) || "";

            const display =
                ch.querySelector(
                    "display-name"
                );

            const name =
                (
                    display &&
                    display.textContent
                        ? display.textContent.trim()
                        : ""
                ) ||
                id;

            if (!id) {
                continue;
            }

            channelNames[
                id
            ] = name;

            const normalized =
                _m3uNormChannelName(
                    name
                );

            if (
                normalized &&
                !nameToId[
                    normalized
                ]
            ) {
                nameToId[
                    normalized
                ] = id;
            }
        }

        const xmlProgrammes =
            doc.querySelectorAll(
                "programme"
            );

        for (
            let i = 0;
            i < xmlProgrammes.length;
            i++
        ) {
            const prog =
                xmlProgrammes[i];

            const chId =
                prog.getAttribute(
                    "channel"
                ) || "";

            if (!chId) {
                continue;
            }

            const startMs =
                _m3uParseXMLTVDate(
                    prog.getAttribute(
                        "start"
                    )
                );

            const stopMs =
                _m3uParseXMLTVDate(
                    prog.getAttribute(
                        "stop"
                    )
                );

            if (
                !startMs ||
                !stopMs
            ) {
                continue;
            }

            const titleEl =
                prog.querySelector(
                    "title"
                );

            const descEl =
                prog.querySelector(
                    "desc"
                );

            const title =
                titleEl &&
                titleEl.textContent
                    ? titleEl.textContent.trim()
                    : "";

            const desc =
                descEl &&
                descEl.textContent
                    ? descEl.textContent.trim()
                    : "";

            if (
                !programmes[
                    chId
                ]
            ) {
                programmes[
                    chId
                ] = [];
            }

            programmes[
                chId
            ].push({
                title:
                    title,

                description:
                    desc,

                desc:
                    desc,

                start:
                    _m3uToEpgTimeStr(
                        startMs
                    ),

                end:
                    _m3uToEpgTimeStr(
                        stopMs
                    ),

                start_timestamp:
                    Math.floor(
                        startMs /
                        1000
                    ),

                stop_timestamp:
                    Math.floor(
                        stopMs /
                        1000
                    )
            });
        }

        Object.keys(
            programmes
        ).forEach(
            function (id) {
                programmes[
                    id
                ].sort(
                    function (a, b) {
                        return (
                            Number(
                                a.start_timestamp
                            ) -
                            Number(
                                b.start_timestamp
                            )
                        );
                    }
                );
            }
        );

        return {
            programmes:
                programmes,

            channelNames:
                channelNames,

            nameToId:
                nameToId
        };
    }

    catch (err) {
        clearTimeout(tid);

        throw err;
    }
}

function _m3uEnsureEpgLoaded(
    url
) {
    if (!url) {
        return Promise.resolve(
            null
        );
    }

    const fresh =
        _m3uEpgData &&
        _m3uEpgUrl === url &&
        (
            Date.now() -
            _m3uEpgFetchedAt
        ) <
        M3U_EPG_TTL_MS;

    if (fresh) {
        return Promise.resolve(
            _m3uEpgData
        );
    }

    if (
        _m3uEpgPromise &&
        _m3uEpgUrl === url
    ) {
        return _m3uEpgPromise;
    }

    _m3uEpgUrl =
        url;

    _m3uEpgPromise =
        _m3uFetchXMLTV(
            url
        )
            .then(
                function (data) {
                    _m3uEpgData =
                        data;

                    _m3uEpgFetchedAt =
                        Date.now();

                    _m3uEpgPromise =
                        null;

                    return data;
                }
            )
            .catch(
                function (err) {
                    _m3uEpgPromise =
                        null;

                    _m3uEpgData =
                        null;

                    _m3uEpgFetchedAt =
                        0;

                    throw err;
                }
            );

    return _m3uEpgPromise;
}

async function _m3uEnsureLibraryForEpg() {
    let cfg = null;

    try {
        cfg =
            await m3uLoadConfig();
    } catch (e) {}

    let lib =
        _m3uLastLibrary;

    if (
        !lib &&
        cfg &&
        cfg.playlist_url
    ) {
        lib =
            await m3uGetLibrary(
                cfg
            );
    }

    if (!lib) {
        return {
            cfg: cfg,
            lib: null
        };
    }

    // When Live TV booted from disk cache, the background refresh may have
    // created the library without applying the profile-level EPG override.
    if (
        cfg &&
        cfg.epg_url
    ) {
        lib.epgUrl =
            _m3uResolveRelativeUrl(
                cfg.epg_url,
                cfg.playlist_url
            );
    }

    if (cfg) {
        lib.epgMatch =
            cfg.epg_match ||
            lib.epgMatch ||
            "tvg-id";
    }

    return {
        cfg: cfg,
        lib: lib
    };
}

async function m3uGetEPG(
    streamId
) {
    try {
        const ready =
            await _m3uEnsureLibraryForEpg();

        const lib =
            ready.lib;

        if (!lib) {
            return [];
        }

        const epgUrl =
            lib.epgUrl || "";

        if (!epgUrl) {
            // This is expected for playlists that do not advertise XMLTV
            // and whose profile has no manual EPG URL.
            return [];
        }

        const epg =
            await _m3uEnsureEpgLoaded(
                epgUrl
            );

        if (
            !epg ||
            !epg.programmes
        ) {
            return [];
        }

        const sid =
            String(
                streamId
            );

        let channel =
            lib.channelById &&
            lib.channelById[
                sid
            ];

        if (!channel) {
            for (
                let i = 0;
                i < lib.channels.length;
                i++
            ) {
                if (
                    String(
                        lib.channels[i]
                            .stream_id
                    ) === sid
                ) {
                    channel =
                        lib.channels[i];

                    break;
                }
            }
        }

        if (!channel) {
            return [];
        }

        const matchField =
            lib.epgMatch ||
            "tvg-id";

        let listings = null;

        if (
            matchField ===
            "tvg-id"
        ) {
            const epgId =
                channel.epg_channel_id ||
                "";

            if (epgId) {
                listings =
                    epg.programmes[
                        epgId
                    ] ||
                    null;
            }
        }

        // Fallback by channel name. This also helps when tvg-id is absent
        // or when the M3U and XMLTV use slightly different quality suffixes.
        if (!listings) {
            const normalized =
                _m3uNormChannelName(
                    channel.name
                );

            const xmlId =
                normalized &&
                epg.nameToId[
                    normalized
                ];

            if (xmlId) {
                listings =
                    epg.programmes[
                        xmlId
                    ] ||
                    null;
            }
        }

        return listings || [];
    }

    catch (err) {
        try {
            console.warn(
                "M3U EPG:",
                err
            );
        } catch (e) {}

        return [];
    }
}
