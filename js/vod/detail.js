/* vod/detail.js
 * Tela de detalhes, temporadas/episódios e início de reprodução.
 * Compatível com perfis Xtream e com VOD/Séries extraídos de M3U.
 */

'use strict';

var detailItem = null;
var detailIsSeries = false;
var seasonsData = null;
var activeSeason = null;

var EMPTY_SUBS = {
    files: [],
    embedded: [],
    unknown: 0
};

var PLAYLIST_CAP = 120;
var _navigating = false;


/* ──────────────────────────────────────────────────────────────
 * Helpers da tela
 * ────────────────────────────────────────────────────────────── */

function setText(id, text) {
    var el = document.getElementById(id);

    if (el) {
        el.textContent = text || '';
    }
}


function openDetail(item) {
    if (!item) return;

    detailItem = item;

    detailIsSeries = item.__type
        ? item.__type === 'series'
        : activeType === 'series' || !!item.series_id;

    prevZone = zone;

    var poster = posterOf(item);

    var posterEl = document.getElementById('vod-detail-poster');
    var backdropEl = document.getElementById('vod-detail-backdrop');

    if (posterEl) {
        posterEl.src = poster || '';
    }

    if (backdropEl) {
        backdropEl.style.backgroundImage = poster
            ? 'url("' + poster + '")'
            : 'none';
    }

    setText('vod-detail-title', titleOf(item));
    setText('vod-detail-plot', item.plot || item.description || '');
    setText('vod-detail-cast', item.cast || '');
    setText('vod-detail-director', item.director || '');

    var castRow = document.getElementById('vod-detail-cast-row');
    var directorRow = document.getElementById('vod-detail-director-row');

    if (castRow) {
        castRow.style.display = item.cast ? '' : 'none';
    }

    if (directorRow) {
        directorRow.style.display = item.director ? '' : 'none';
    }

    var meta = [];

    if (yearOf(item)) {
        meta.push(
            '<span class="vod-meta-badge">' +
            escHtml(yearOf(item)) +
            '</span>'
        );
    }

    if (ratingOf(item)) {
        meta.push(
            '<span class="vod-meta-badge gold">★ ' +
            ratingOf(item).toFixed(1) +
            '</span>'
        );
    }

    if (item.genre) {
        meta.push(
            '<span class="vod-meta-badge">' +
            escHtml(item.genre) +
            '</span>'
        );
    }

    if (item.duration) {
        meta.push(
            '<span class="vod-meta-badge">' +
            escHtml(item.duration) +
            '</span>'
        );
    }

    var metaEl = document.getElementById('vod-detail-meta');

    if (metaEl) {
        metaEl.innerHTML = meta.join('');
    }

    updateListBtn();

    elDetail.hidden = false;
    detailFocus = 0;

    var seasonsBox = document.getElementById('vod-seasons');
    var playBtn = document.getElementById('vod-play-btn');

    if (detailIsSeries) {
        if (playBtn) {
            playBtn.style.display = 'none';
        }

        if (seasonsBox) {
            seasonsBox.hidden = false;
        }

        loadSeries(item);
    }

    else {
        if (playBtn) {
            playBtn.style.display = '';
        }

        if (seasonsBox) {
            seasonsBox.hidden = true;
        }

        var progress =
            loadProgress()[
                'm:' + item.stream_id
            ];

        setText(
            'vod-play-label',
            progress && progress.pos > 30
                ? 'Resume'
                : 'Play'
        );

        lazyFetchVodInfo(item);
    }

    focusZone('detail');
    paintDetailFocus();
}


function updateListBtn() {
    if (!detailItem) return;

    var saved =
        inWatchlist(detailItem);

    setText(
        'vod-list-label',
        saved
            ? 'In My List'
            : 'My List'
    );

    var icon =
        document.getElementById(
            'vod-list-icon'
        );

    if (!icon) return;

    icon.innerHTML = saved
        ? '<path d="M3.5 9.5L7 13l7.5-8" />'
        : '<path d="M9 3v12M3 9h12" />';
}


function closeDetail() {
    elDetail.hidden = true;

    var backdrop =
        document.getElementById(
            'vod-detail-backdrop'
        );

    if (backdrop) {
        backdrop.style.backgroundImage =
            'none';
    }

    detailItem = null;
    seasonsData = null;
    activeSeason = null;

    var back =
        prevZone === 'search' ||
        prevZone === 'category'
            ? prevZone
            : 'rails';

    focusZone(back);

    if (back === 'search') {
        paintSearchFocus();
    }

    else if (back === 'category') {
        paintCategoryFocus();
    }

    else {
        paintRailFocus();
    }
}


/* ──────────────────────────────────────────────────────────────
 * Informações extras e legendas
 * ────────────────────────────────────────────────────────────── */

function lazyFetchVodInfo(item) {
    if (!item) {
        return Promise.resolve(item);
    }

    if (item._infoPromise) {
        return item._infoPromise;
    }

    /*
     * Uma playlist M3U já contém a URL final do conteúdo.
     * Ela não possui o endpoint Xtream get_vod_info.
     */
    if (cfg && cfg.type === 'm3u') {
        item._subs =
            item._subs ||
            EMPTY_SUBS;

        item._infoPromise =
            Promise.resolve(item);

        return item._infoPromise;
    }

    if (!item.stream_id) {
        return Promise.resolve(item);
    }

    item._infoPromise =
        fetchJSON(
            apiUrl(
                'action=get_vod_info&vod_id=' +
                encodeURIComponent(
                    item.stream_id
                )
            )
        )

        .then(
            function (data) {
                item._subs =
                    Subs.fromVodInfo(
                        data,
                        cfg
                    );

                try {
                    Subs.recordDiag(
                        titleOf(item) ||
                            item.name ||
                            '',
                        item._subs,
                        {
                            source:
                                'detail · get_vod_info',
                            panelShape:
                                Subs.describePayload(
                                    data
                                ),
                            panelRaw:
                                Subs.rawSample(
                                    data
                                )
                        }
                    );
                }

                catch (e) {}

                var info =
                    (
                        data &&
                        (
                            data.info ||
                            data.movie_data
                        )
                    ) ||
                    data ||
                    {};

                item.container_extension =
                    item.container_extension ||
                    info.container_extension;

                item._tmdb =
                    info.tmdb_id ||
                    info.tmdb ||
                    '';

                item._imdb =
                    info.imdb_id ||
                    info.imdb ||
                    '';

                item._year =
                    yearOf(info) ||
                    yearOf(item) ||
                    '';

                if (detailItem !== item) {
                    return item;
                }

                if (
                    info.plot ||
                    info.description
                ) {
                    setText(
                        'vod-detail-plot',
                        info.plot ||
                            info.description
                    );
                }

                if (info.cast) {
                    setText(
                        'vod-detail-cast',
                        info.cast
                    );

                    var castRow =
                        document.getElementById(
                            'vod-detail-cast-row'
                        );

                    if (castRow) {
                        castRow.style.display =
                            '';
                    }
                }

                if (info.director) {
                    setText(
                        'vod-detail-director',
                        info.director
                    );

                    var directorRow =
                        document.getElementById(
                            'vod-detail-director-row'
                        );

                    if (directorRow) {
                        directorRow.style.display =
                            '';
                    }
                }

                return item;
            }
        )

        .catch(
            function () {
                item._subs =
                    item._subs ||
                    EMPTY_SUBS;

                return item;
            }
        );

    return item._infoPromise;
}


function withSidecars(
    subs,
    streamUrl
) {
    subs =
        subs ||
        EMPTY_SUBS;

    if (
        subs.files.length ||
        !streamUrl
    ) {
        return Promise.resolve(
            subs
        );
    }

    return Subs
        .probeSidecars(
            streamUrl
        )

        .then(
            function (found) {
                if (!found.length) {
                    return subs;
                }

                return {
                    files: found,
                    embedded:
                        subs.embedded ||
                        [],
                    unknown:
                        subs.unknown ||
                        0
                };
            }
        )

        .catch(
            function () {
                return subs;
            }
        );
}


function playWhenSubsReady(
    item,
    build,
    streamUrl
) {
    var finished = false;

    function go(subs) {
        if (finished) return;

        finished = true;

        playItem(
            build(
                subs ||
                EMPTY_SUBS
            )
        );
    }

    if (
        item &&
        item._subs
    ) {
        withSidecars(
            item._subs,
            streamUrl
        ).then(go);

        setTimeout(
            function () {
                go(
                    item._subs
                );
            },
            2500
        );

        return;
    }

    if (
        !item ||
        !item.stream_id
    ) {
        go(EMPTY_SUBS);
        return;
    }

    lazyFetchVodInfo(item)

        .then(
            function () {
                return withSidecars(
                    item._subs ||
                        EMPTY_SUBS,
                    streamUrl
                );
            }
        )

        .then(go);

    setTimeout(
        function () {
            go(
                (
                    item &&
                    item._subs
                ) ||
                EMPTY_SUBS
            );
        },
        2500
    );
}


/* ──────────────────────────────────────────────────────────────
 * Séries
 * ────────────────────────────────────────────────────────────── */

function loadSeries(item) {
    var tabs =
        document.getElementById(
            'vod-season-tabs'
        );

    var list =
        document.getElementById(
            'vod-episode-list'
        );

    if (!tabs || !list) {
        return;
    }

    tabs.innerHTML = '';

    list.innerHTML =
        '<div class="vod-ep-loading">Loading episodes…</div>';

    seasonsData = null;

    var request;

    if (
        cfg &&
        cfg.type === 'm3u'
    ) {
        request =
            m3uGetSeriesInfo(
                cfg,
                item.series_id
            );
    }

    else {
        request =
            fetchJSON(
                apiUrl(
                    'action=get_series_info&series_id=' +
                    encodeURIComponent(
                        item.series_id
                    )
                )
            );
    }

    request

        .then(
            function (data) {
                try {
                    var firstEp = null;
                    var bySeason =
                        (
                            data &&
                            data.episodes
                        ) ||
                        {};

                    for (
                        var seasonKey
                        in bySeason
                    ) {
                        if (
                            Object.prototype
                                .hasOwnProperty
                                .call(
                                    bySeason,
                                    seasonKey
                                ) &&
                            bySeason[
                                seasonKey
                            ] &&
                            bySeason[
                                seasonKey
                            ].length
                        ) {
                            firstEp =
                                bySeason[
                                    seasonKey
                                ][0];

                            break;
                        }
                    }

                    if (firstEp) {
                        Subs.recordDiag(
                            titleOf(item) ||
                                '',
                            Subs.fromEpisode(
                                firstEp,
                                cfg
                            ),
                            {
                                source:
                                    cfg &&
                                    cfg.type ===
                                        'm3u'
                                        ? 'detail · m3u'
                                        : 'detail · get_series_info',

                                panelShape:
                                    Subs.describePayload(
                                        firstEp
                                    ),

                                panelRaw:
                                    Subs.rawSample(
                                        firstEp
                                    )
                            }
                        );
                    }
                }

                catch (e) {}

                if (
                    detailItem !==
                    item
                ) {
                    return;
                }

                var episodes =
                    data &&
                    data.episodes;

                if (!episodes) {
                    list.innerHTML =
                        '<div class="vod-ep-loading">No episodes found.</div>';

                    return;
                }

                seasonsData =
                    episodes;

                var seasons =
                    Object.keys(
                        episodes
                    ).sort(
                        function (
                            a,
                            b
                        ) {
                            return (
                                +a -
                                +b
                            );
                        }
                    );

                tabs.innerHTML =
                    '';

                seasons.forEach(
                    function (
                        season,
                        index
                    ) {
                        var button =
                            document.createElement(
                                'button'
                            );

                        button.className =
                            'vod-season-tab' +
                            (
                                index === 0
                                    ? ' active'
                                    : ''
                            );

                        button.textContent =
                            'S' +
                            season;

                        button.dataset.season =
                            season;

                        button.addEventListener(
                            'click',
                            function () {
                                selectSeason(
                                    season
                                );
                            }
                        );

                        tabs.appendChild(
                            button
                        );
                    }
                );

                if (
                    seasons.length
                ) {
                    selectSeason(
                        seasons[0]
                    );
                }
            }
        )

        .catch(
            function () {
                list.innerHTML =
                    '<div class="vod-ep-loading">Could not load episodes.</div>';
            }
        );
}


function buildPlaylist(
    episodes
) {
    return episodes
        .slice(
            0,
            PLAYLIST_CAP
        )

        .map(
            function (ep) {
                var number =
                    ep.episode_num != null
                        ? ep.episode_num
                        : '';

                return {
                    id: ep.id,

                    ext:
                        ep.container_extension ||
                        (
                            ep.info &&
                            ep.info
                                .container_extension
                        ) ||
                        'mp4',

                    num: number,

                    title:
                        ep.title ||
                        (
                            'Episode ' +
                            number
                        ),

                    subs:
                        Subs.fromEpisode(
                            ep,
                            cfg
                        )
                };
            }
        );
}


function selectSeason(
    season
) {
    activeSeason =
        season;

    var tabs =
        document.querySelectorAll(
            '#vod-season-tabs .vod-season-tab'
        );

    Array.prototype
        .forEach
        .call(
            tabs,
            function (tab) {
                tab.classList.toggle(
                    'active',
                    tab.dataset.season ===
                        String(
                            season
                        )
                );
            }
        );

    var list =
        document.getElementById(
            'vod-episode-list'
        );

    if (!list) {
        return;
    }

    list.innerHTML =
        '';

    var episodes =
        (
            seasonsData &&
            seasonsData[
                season
            ]
        ) ||
        [];

    var playlist =
        buildPlaylist(
            episodes
        );

    var seriesName =
        detailItem
            ? titleOf(
                detailItem
            )
            : '';

    playlist.forEach(
        function (
            item,
            index
        ) {
            var row =
                document.createElement(
                    'button'
                );

            row.className =
                'vod-ep-row';

            row.innerHTML =
                '<span class="vod-ep-num">' +
                escHtml(
                    item.num
                ) +
                '</span>' +
                '<span class="vod-ep-name">' +
                escHtml(
                    item.title
                ) +
                '</span>' +
                '<span class="vod-ep-play">▶</span>';

            row.addEventListener(
                'click',
                function () {
                    playEpisode(
                        playlist,
                        index,
                        season,
                        seriesName
                    );
                }
            );

            list.appendChild(
                row
            );
        }
    );

    paintDetailFocus();
}


function playEpisode(
    playlist,
    index,
    season,
    seriesName
) {
    var item =
        playlist[index];

    if (!item) return;

    var meta = {
        type: 'episode',
        id: item.id,
        ext: item.ext,

        name:
            (
                seriesName
                    ? seriesName +
                      ' · '
                    : ''
            ) +
            item.title,

        icon:
            posterOf(
                detailItem ||
                {}
            ),

        series_id:
            detailItem &&
            detailItem.series_id,

        season:
            season,

        episode:
            item.num,

        subs:
            item.subs ||
            EMPTY_SUBS,

        series_name:
            seriesName,

        playlist:
            playlist,

        playlist_index:
            index,

        search_name:
            seriesName,

        tmdb_id:
            (
                detailItem &&
                detailItem._tmdb
            ) ||
            '',

        imdb_id:
            (
                detailItem &&
                detailItem._imdb
            ) ||
            ''
    };

    if (
        meta.subs.files &&
        meta.subs.files.length
    ) {
        playItem(meta);
        return;
    }

    var started = false;

    function go(subs) {
        if (started) return;

        started = true;

        meta.subs =
            subs ||
            EMPTY_SUBS;

        playItem(meta);
    }

    withSidecars(
        meta.subs,
        buildEpisodeUrl(
            item.id,
            item.ext
        )
    ).then(go);

    setTimeout(
        function () {
            go(
                meta.subs
            );
        },
        2000
    );
}


/* ──────────────────────────────────────────────────────────────
 * Player
 * ────────────────────────────────────────────────────────────── */

function playItem(meta) {
    if (_navigating) {
        return;
    }

    var url =
        meta.type ===
        'episode'
            ? buildEpisodeUrl(
                meta.id,
                meta.ext
            )
            : buildMovieUrl(
                meta.id,
                meta.ext
            );

    if (!url) {
        console.error(
            'VOD stream URL could not be resolved:',
            meta
        );

        return;
    }

    _navigating = true;

    var key =
        (
            meta.type ===
            'episode'
                ? 'e:'
                : 'm:'
        ) +
        meta.id;

    var subs =
        meta.subs ||
        EMPTY_SUBS;

    try {
        Subs.recordDiag(
            meta.name ||
                '',
            subs,
            {
                source:
                    meta.type
            }
        );
    }

    catch (e) {}

    var token =
        Date.now()
            .toString(36) +
        Math.random()
            .toString(36)
            .slice(
                2,
                7
            );

    var payload = {
        url: url,
        token: token,

        key: key,
        type: meta.type,
        id: meta.id,
        ext: meta.ext,

        name:
            meta.name ||
            '',

        icon:
            meta.icon ||
            '',

        series_id:
            meta.series_id ||
            '',

        season:
            meta.season ||
            '',

        episode:
            meta.episode ||
            '',

        resume:
            meta.resume ||
            0,

        subs:
            subs.files ||
            [],

        subs_embedded:
            subs.embedded ||
            [],

        subs_unknown:
            subs.unknown ||
            0,

        series_name:
            meta.series_name ||
            '',

        playlist:
            meta.playlist ||
            null,

        playlist_index:
            typeof meta.playlist_index ===
            'number'
                ? meta.playlist_index
                : -1,

        search_name:
            meta.search_name ||
            meta.name ||
            '',

        year:
            meta.year ||
            '',

        tmdb_id:
            meta.tmdb_id ||
            '',

        imdb_id:
            meta.imdb_id ||
            ''
    };

    Store.setRaw(
        'iptv_play_url',
        url
    );

    Store.setRaw(
        'iptv_play_title',
        meta.name ||
        ''
    );

    if (
        !Store.set(
            'iptv_play_meta',
            payload
        )
    ) {
        payload.playlist =
            null;

        payload.playlist_index =
            -1;

        Store.set(
            'iptv_play_meta',
            payload
        );
    }

    window.location.href =
        '../pages/player.html?t=' +
        encodeURIComponent(
            token
        ) +
        '&url=' +
        encodeURIComponent(
            url
        ) +
        '&title=' +
        encodeURIComponent(
            meta.name ||
            ''
        );
}


function playCurrentMovie() {
    if (!detailItem) {
        return;
    }

    var item =
        detailItem;

    var progress =
        loadProgress()[
            'm:' +
            item.stream_id
        ];

    var extension =
        item.container_extension ||
        'mp4';

    var streamUrl =
        buildMovieUrl(
            item.stream_id,
            extension
        );

    playWhenSubsReady(
        item,

        function (subs) {
            return {
                type:
                    'movie',

                id:
                    item.stream_id,

                ext:
                    extension,

                name:
                    titleOf(item),

                icon:
                    posterOf(item),

                resume:
                    progress &&
                    progress.pos > 30
                        ? progress.pos
                        : 0,

                subs:
                    subs,

                search_name:
                    titleOf(item),

                year:
                    item._year ||
                    yearOf(item) ||
                    '',

                tmdb_id:
                    item._tmdb ||
                    '',

                imdb_id:
                    item._imdb ||
                    ''
            };
        },

        streamUrl
    );
}


/* ──────────────────────────────────────────────────────────────
 * Continue Watching
 * ────────────────────────────────────────────────────────────── */

function resumePlay(entry) {
    if (!entry) {
        return;
    }

    var isEpisode =
        entry.type ===
        'episode';

    function build(
        subs,
        extra
    ) {
        var meta = {
            type:
                isEpisode
                    ? 'episode'
                    : 'movie',

            id:
                entry.id,

            ext:
                entry.ext,

            name:
                entry.name,

            icon:
                entry.icon,

            series_id:
                entry.series_id,

            season:
                entry.season,

            episode:
                entry.episode,

            resume:
                entry.pos ||
                0,

            subs:
                subs ||
                EMPTY_SUBS
        };

        if (extra) {
            for (
                var key
                in extra
            ) {
                if (
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            extra,
                            key
                        )
                ) {
                    meta[key] =
                        extra[key];
                }
            }
        }

        return meta;
    }

    if (isEpisode) {
        resumeEpisode(
            entry,
            build
        );

        return;
    }

    playWhenSubsReady(
        {
            stream_id:
                entry.id
        },

        build,

        buildMovieUrl(
            entry.id,
            entry.ext
        )
    );
}


function resumeEpisode(
    entry,
    build
) {
    var episodeUrl =
        buildEpisodeUrl(
            entry.id,
            entry.ext
        );

    var started = false;

    function go(
        subs,
        extra
    ) {
        if (started) {
            return;
        }

        started = true;

        playItem(
            build(
                subs ||
                EMPTY_SUBS,
                extra
            )
        );
    }

    if (!entry.series_id) {
        withSidecars(
            EMPTY_SUBS,
            episodeUrl
        ).then(
            function (subs) {
                go(subs);
            }
        );

        setTimeout(
            function () {
                go(
                    EMPTY_SUBS
                );
            },
            2000
        );

        return;
    }

    var request;

    if (
        cfg &&
        cfg.type ===
        'm3u'
    ) {
        request =
            m3uGetSeriesInfo(
                cfg,
                entry.series_id
            );
    }

    else {
        request =
            fetchJSON(
                apiUrl(
                    'action=get_series_info&series_id=' +
                    encodeURIComponent(
                        entry.series_id
                    )
                )
            );
    }

    request

        .then(
            function (data) {
                var episodes =
                    (
                        data &&
                        data.episodes
                    ) ||
                    {};

                var season =
                    String(
                        entry.season
                    );

                var list =
                    episodes[
                        season
                    ] ||
                    episodes[
                        Number(
                            season
                        )
                    ] ||
                    null;

                if (!list) {
                    for (
                        var seasonKey
                        in episodes
                    ) {
                        if (
                            !Object.prototype
                                .hasOwnProperty
                                .call(
                                    episodes,
                                    seasonKey
                                )
                        ) {
                            continue;
                        }

                        for (
                            var i = 0;
                            i <
                            episodes[
                                seasonKey
                            ].length;
                            i++
                        ) {
                            if (
                                String(
                                    episodes[
                                        seasonKey
                                    ][i].id
                                ) ===
                                String(
                                    entry.id
                                )
                            ) {
                                list =
                                    episodes[
                                        seasonKey
                                    ];

                                season =
                                    seasonKey;

                                break;
                            }
                        }

                        if (list) {
                            break;
                        }
                    }
                }

                if (!list) {
                    go(
                        EMPTY_SUBS
                    );

                    return;
                }

                var playlist =
                    buildPlaylist(
                        list
                    );

                var index =
                    -1;

                for (
                    var j = 0;
                    j <
                    playlist.length;
                    j++
                ) {
                    if (
                        String(
                            playlist[j].id
                        ) ===
                        String(
                            entry.id
                        )
                    ) {
                        index =
                            j;

                        break;
                    }
                }

                if (
                    index <
                    0
                ) {
                    go(
                        EMPTY_SUBS
                    );

                    return;
                }

                var seriesName =
                    (
                        entry.name ||
                        ''
                    )
                        .split(
                            ' · '
                        )[0] ||
                    '';

                go(
                    playlist[
                        index
                    ].subs,

                    {
                        series_name:
                            seriesName,

                        playlist:
                            playlist,

                        playlist_index:
                            index,

                        search_name:
                            seriesName,

                        season:
                            season
                    }
                );
            }
        )

        .catch(
            function () {
                go(
                    EMPTY_SUBS
                );
            }
        );

    setTimeout(
        function () {
            go(
                EMPTY_SUBS
            );
        },
        2500
    );
}


/* ──────────────────────────────────────────────────────────────
 * Botões
 * ────────────────────────────────────────────────────────────── */

var playButton =
    document.getElementById(
        'vod-play-btn'
    );

if (playButton) {
    playButton.addEventListener(
        'click',
        playCurrentMovie
    );
}


var listButton =
    document.getElementById(
        'vod-list-btn'
    );

if (listButton) {
    listButton.addEventListener(
        'click',
        function () {
            if (!detailItem) {
                return;
            }

            toggleWatchlist(
                detailItem
            );

            updateListBtn();
        }
    );
}
