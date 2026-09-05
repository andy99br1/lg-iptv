/* vod/rails.js
 * Rails de filmes e séries.
 * Suporta Xtream e bibliotecas VOD extraídas de playlists M3U.
 */

'use strict';


/* ──────────────────────────────────────────────────────────────
 * Carregamento de dados
 * ────────────────────────────────────────────────────────────── */

function vodLoadItems(type, categoryId) {

    /* M3U */
    if (cfg && cfg.type === 'm3u') {

        if (type === 'series') {
            return m3uGetSeries(
                cfg,
                categoryId
            );
        }

        return m3uGetVodStreams(
            cfg,
            categoryId
        );
    }


    /* Xtream */
    var action =
        type === 'series'
            ? 'get_series'
            : 'get_vod_streams';


    var cacheKey =
        'vod_content_' +
        Config.scope(cfg) +
        '_' +
        type +
        '_' +
        categoryId;


    var url =
        apiUrl(
            'action=' +
            action +
            '&category_id=' +
            encodeURIComponent(categoryId)
        );


    return fetchCached(
        cacheKey,
        url
    );
}



function vodLoadCategories(type) {

    /* M3U */
    if (cfg && cfg.type === 'm3u') {

        if (type === 'series') {
            return m3uGetSeriesCategories(cfg);
        }

        return m3uGetVodCategories(cfg);
    }


    /* Xtream */
    var action =
        type === 'series'
            ? 'get_series_categories'
            : 'get_vod_categories';


    var cacheKey =
        (
            type === 'series'
                ? 'vod_cats_series_'
                : 'vod_cats_movie_'
        ) +
        Config.scope(cfg);


    return fetchCached(
        cacheKey,
        apiUrl(
            'action=' + action
        )
    );
}



/* ──────────────────────────────────────────────────────────────
 * Rail recycling
 * ────────────────────────────────────────────────────────────── */

var railObserver =
    ('IntersectionObserver' in window)

        ? new IntersectionObserver(
            function (entries) {

                entries.forEach(
                    function (entry) {

                        if (entry.isIntersecting) {
                            ensureRailLoaded(
                                entry.target
                            );
                        }

                        else {
                            unloadRail(
                                entry.target
                            );
                        }

                    }
                );

            },

            {
                root: elRails,
                rootMargin: '900px 0px'
            }
        )

        : null;



function unloadRail(rail) {

    if (!rail) {
        return;
    }


    if (rail.dataset.loaded !== '1') {
        return;
    }


    if (rail.dataset.keep === '1') {
        return;
    }


    var rails =
        railEls();


    if (rails[railIndex] === rail) {
        return;
    }


    var track =
        rail.querySelector(
            '.vod-rail-track'
        );


    if (track) {

        if (imgObserver) {

            var images =
                track.querySelectorAll(
                    'img[data-src]'
                );


            Array.prototype.forEach.call(
                images,
                function (img) {
                    imgObserver.unobserve(img);
                }
            );
        }


        track.innerHTML = '';
    }


    rail.dataset.loaded = '0';
}



/* ──────────────────────────────────────────────────────────────
 * Criação do rail
 * ────────────────────────────────────────────────────────────── */

function makeRail(
    titleText,
    type,
    categoryId
) {

    var rail =
        document.createElement(
            'section'
        );


    rail.className =
        'vod-rail';


    rail.dataset.type =
        type || '';


    rail.dataset.catId =
        categoryId == null
            ? ''
            : categoryId;


    rail.dataset.loaded =
        '0';



    var title =
        document.createElement(
            'h2'
        );


    title.className =
        'vod-rail-title';


    title.textContent =
        titleText;


    rail.appendChild(
        title
    );



    var track =
        document.createElement(
            'div'
        );


    track.className =
        'vod-rail-track';


    rail.appendChild(
        track
    );


    return rail;
}



/* ──────────────────────────────────────────────────────────────
 * Skeleton
 * ────────────────────────────────────────────────────────────── */

function vodRailSkeleton(track) {

    for (var i = 0; i < 6; i++) {

        var skeleton =
            document.createElement(
                'div'
            );


        skeleton.className =
            'vod-card vod-skeleton';


        track.appendChild(
            skeleton
        );
    }
}



/* ──────────────────────────────────────────────────────────────
 * Carregar conteúdo de um rail
 * ────────────────────────────────────────────────────────────── */

function fillRail(rail) {

    if (!rail) {
        return;
    }


    if (rail.dataset.loaded !== '0') {
        return;
    }


    rail.dataset.loaded = '1';



    var type =
        rail.dataset.type;


    var categoryId =
        rail.dataset.catId;


    var track =
        rail.querySelector(
            '.vod-rail-track'
        );


    if (!track) {
        return;
    }



    vodRailSkeleton(
        track
    );



    vodLoadItems(
        type,
        categoryId
    )

        .then(
            function (data) {

                track.innerHTML =
                    '';


                var items =
                    Array.isArray(data)
                        ? data
                        : [];


                if (!items.length) {

                    if (rail.parentNode) {
                        rail.parentNode.removeChild(
                            rail
                        );
                    }

                    return;
                }



                var amount =
                    Math.min(
                        items.length,
                        RAIL_CAP
                    );


                var fragment =
                    document.createDocumentFragment();



                for (
                    var i = 0;
                    i < amount;
                    i++
                ) {

                    fragment.appendChild(
                        makeCard(
                            items[i],
                            type
                        )
                    );
                }



                if (
                    items.length >
                    amount
                ) {

                    var title =
                        rail.querySelector(
                            '.vod-rail-title'
                        );


                    fragment.appendChild(
                        makeMoreCard(
                            title
                                ? title.textContent
                                : '',
                            type,
                            categoryId,
                            items.length
                        )
                    );
                }



                track.appendChild(
                    fragment
                );



                var rails =
                    railEls();


                if (
                    zone === 'rails' &&
                    rails[railIndex] === rail
                ) {
                    paintRailFocus();
                }

            }
        )

        .catch(
            function (err) {

                console.error(
                    'VOD rail load failed:',
                    err
                );


                if (rail.parentNode) {
                    rail.parentNode.removeChild(
                        rail
                    );
                }

            }
        );
}



/* ──────────────────────────────────────────────────────────────
 * Renderizar rails
 * ────────────────────────────────────────────────────────────── */

function renderRails() {

    elRails.innerHTML =
        '';


    railIndex =
        0;


    cardIndex =
        0;



    /* Continue Watching */

    var watching =
        continueWatching();


    if (watching.length) {

        var continueRail =
            makeRail(
                'Continue Watching',
                '',
                ''
            );


        continueRail.dataset.loaded =
            '1';


        continueRail.dataset.keep =
            '1';


        var continueTrack =
            continueRail.querySelector(
                '.vod-rail-track'
            );


        watching.forEach(
            function (entry) {

                continueTrack.appendChild(
                    makeCard(
                        entry,
                        'progress'
                    )
                );

            }
        );


        elRails.appendChild(
            continueRail
        );
    }



    /* My List */

    var watchlist =
        loadWatchlist();


    if (watchlist.length) {

        var listRail =
            makeRail(
                'My List',
                '',
                ''
            );


        listRail.dataset.loaded =
            '1';


        listRail.dataset.keep =
            '1';


        var listTrack =
            listRail.querySelector(
                '.vod-rail-track'
            );


        watchlist.forEach(
            function (entry) {

                listTrack.appendChild(
                    makeCard(
                        entry,
                        entry.__type
                    )
                );

            }
        );


        elRails.appendChild(
            listRail
        );
    }



    /* Categorias */

    var allCategories =
        cats[activeType] || [];


    var visible =
        allCategories.filter(
            function (category) {

                return !hidden[
                    activeType
                ].has(
                    String(
                        category.category_id
                    )
                );

            }
        );



    /* Favoritas primeiro */

    var favouriteIds =
        Favourites.categories(
            activeType
        );


    var ordered =
        visible
            .slice()
            .sort(
                function (a, b) {

                    var aIndex =
                        favouriteIds.indexOf(
                            String(
                                a.category_id
                            )
                        );


                    var bIndex =
                        favouriteIds.indexOf(
                            String(
                                b.category_id
                            )
                        );


                    if (
                        aIndex ===
                        bIndex
                    ) {
                        return 0;
                    }


                    if (aIndex === -1) {
                        return 1;
                    }


                    if (bIndex === -1) {
                        return -1;
                    }


                    return (
                        aIndex -
                        bIndex
                    );
                }
            );



    ordered.forEach(
        function (category, index) {

            var favourite =
                Favourites.isCategory(
                    activeType,
                    category.category_id
                );


            var categoryName =
                category.category_name ||
                'Unnamed';


            if (favourite) {
                categoryName =
                    '★  ' +
                    categoryName;
            }



            var rail =
                makeRail(
                    categoryName,
                    activeType,
                    category.category_id
                );


            elRails.appendChild(
                rail
            );



            if (railObserver) {

                railObserver.observe(
                    rail
                );


                /*
                 * Carrega imediatamente
                 * as duas primeiras categorias.
                 */

                if (index < 2) {
                    fillRail(
                        rail
                    );
                }
            }

            else {

                /*
                 * TVs antigas sem
                 * IntersectionObserver.
                 */

                fillRail(
                    rail
                );
            }

        }
    );



    if (
        !ordered.length &&
        !watching.length
    ) {

        showStatus(
            'Nothing here yet.',
            false
        );
    }

    else {
        hideStatus();
    }



    renderSidebarCats();



    if (
        _focusRailsAfterRender
    ) {

        _focusRailsAfterRender =
            false;


        focusZone(
            'rails'
        );


        paintRailFocus();
    }
}



/* ──────────────────────────────────────────────────────────────
 * Trocar Movies / Series
 * ────────────────────────────────────────────────────────────── */

function loadType(type) {

    activeType =
        type;



    var navigation =
        document.querySelectorAll(
            '.vod-nav-item'
        );


    Array.prototype.forEach.call(
        navigation,
        function (item) {

            if (
                item.dataset.action === 'movie' ||
                item.dataset.action === 'series'
            ) {

                item.classList.toggle(
                    'active',
                    item.dataset.action === type
                );
            }

        }
    );



    /*
     * Se já carregamos as categorias,
     * apenas redesenha a tela.
     */

    if (cats[type]) {

        renderRails();

        return;
    }



    showStatus(
        'Loading…',
        true
    );



    vodLoadCategories(
        type
    )

        .then(
            function (data) {

                cats[type] =
                    Array.isArray(data)
                        ? data
                        : [];


                renderRails();

            }
        )

        .catch(
            function (err) {

                console.error(
                    'VOD category load failed:',
                    err
                );


                cats[type] =
                    [];


                showStatus(
                    'Could not load categories.',
                    false
                );

            }
        );
}
