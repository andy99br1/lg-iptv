/* vod/category.js — every title in one category, as a grid.
 *
 * Reached from the "···" tile that ends a truncated rail.
 * Supports Xtream and M3U VOD libraries.
 */

'use strict';


/* ── Category browser ─────────────────────────────────────────────────────── */

var catItems = [];
var catFocus = 0;
var catReturn = 'rails';


function openCategory(title, type, catId) {

    var ck =
        'vod_content_' +
        Config.scope(cfg) +
        '_' +
        type +
        '_' +
        catId;


    var cached = null;


    /*
     * Xtream uses the normal VOD cache.
     *
     * M3U is deliberately kept in memory by m3u.js,
     * because a large playlist can exceed webOS localStorage.
     */
    if (
        !cfg ||
        cfg.type !== 'm3u'
    ) {
        cached =
            cacheGet(ck);
    }


    catReturn =
        zone;


    elCategory.hidden =
        false;


    document.getElementById(
        'vod-category-title'
    ).textContent =
        title ||
        'Category';


    focusZone(
        'category'
    );


    /*
     * Xtream cache hit.
     */
    if (
        cached &&
        cached.length
    ) {
        renderCategory(
            cached,
            type
        );

        return;
    }


    elCategoryGrid.innerHTML =
        '<div class="vod-cat-loading">Loading…</div>';


    var request;


    /*
     * M3U
     */
    if (
        cfg &&
        cfg.type === 'm3u'
    ) {

        request =
            type === 'series'

                ? m3uGetSeries(
                    cfg,
                    catId
                )

                : m3uGetVodStreams(
                    cfg,
                    catId
                );

    }


    /*
     * Xtream
     */
    else {

        var action =
            type === 'series'
                ? 'get_series'
                : 'get_vod_streams';


        request =
            fetchCached(
                ck,
                apiUrl(
                    'action=' +
                    action +
                    '&category_id=' +
                    encodeURIComponent(
                        catId
                    )
                )
            );

    }


    request

        .then(
            function (data) {

                /*
                 * User already closed
                 * the category page.
                 */
                if (
                    elCategory.hidden
                ) {
                    return;
                }


                renderCategory(
                    Array.isArray(data)
                        ? data
                        : [],
                    type
                );

            }
        )

        .catch(
            function (err) {

                console.error(
                    'Category load failed:',
                    err
                );


                elCategoryGrid.innerHTML =
                    '<div class="vod-cat-loading">Could not load this category.</div>';

            }
        );
}



function renderCategory(
    items,
    type
) {

    catItems =
        items;


    elCategoryGrid.innerHTML =
        '';


    document.getElementById(
        'vod-category-count'
    ).textContent =
        items.length +
        (
            items.length === 1
                ? ' title'
                : ' titles'
        );


    var frag =
        document.createDocumentFragment();


    items.forEach(
        function (m) {

            frag.appendChild(
                makeCard(
                    m,
                    type
                )
            );

        }
    );


    elCategoryGrid.appendChild(
        frag
    );


    catFocus =
        0;


    paintCategoryFocus();
}



function closeCategory() {

    elCategory.hidden =
        true;


    elCategoryGrid.innerHTML =
        '';


    catItems =
        [];


    focusZone(
        catReturn === 'category'
            ? 'rails'
            : catReturn
    );


    if (
        zone === 'rails'
    ) {
        paintRailFocus();
    }

    else {
        paintSidebarFocus();
    }
}



function categoryCards() {

    return Array.prototype.slice.call(
        elCategoryGrid.querySelectorAll(
            '.vod-card'
        )
    );

}


/*
 * Column count is measured from the rendered grid rather than assumed,
 * so the same code works at every interface scale.
 *
 * offsetTop is used instead of getBoundingClientRect because the focus
 * animation scales cards visually without altering their layout position.
 */

function gridCols(cards) {

    if (
        cards.length < 2
    ) {
        return 1;
    }


    var top =
        cards[0].offsetTop;


    var n =
        0;


    for (
        var i = 0;
        i < cards.length;
        i++
    ) {

        if (
            cards[i].offsetTop !==
            top
        ) {
            break;
        }


        n++;

    }


    return n || 1;
}



function categoryCols() {

    return gridCols(
        categoryCards()
    );

}



function paintCategoryFocus() {

    clearRings();


    var cards =
        categoryCards();


    if (
        !cards.length
    ) {

        document.getElementById(
            'vod-category-back'
        ).classList.add(
            'tv-focus-visible'
        );


        return;
    }


    catFocus =
        Math.max(
            0,
            Math.min(
                cards.length - 1,
                catFocus
            )
        );


    cards[
        catFocus
    ].classList.add(
        'tv-focus-visible'
    );


    cards[
        catFocus
    ].scrollIntoView({
        block: 'nearest'
    });

}



function categoryKey(kc) {

    var cards =
        categoryCards();


    var cols =
        categoryCols();


    /*
     * BACK
     */

    if (
        kc === KEY.BACK
    ) {

        closeCategory();

        return;
    }


    /*
     * UP
     */

    if (
        kc === KEY.UP
    ) {

        if (
            catFocus <
            cols
        ) {

            clearRings();


            document.getElementById(
                'vod-category-back'
            ).classList.add(
                'tv-focus-visible'
            );


            catFocus =
                -1;

        }

        else {

            catFocus -=
                cols;


            paintCategoryFocus();

        }

    }


    /*
     * DOWN
     */

    else if (
        kc === KEY.DOWN
    ) {

        if (
            catFocus < 0
        ) {

            catFocus =
                0;


            paintCategoryFocus();

        }

        else {

            catFocus =
                Math.min(
                    cards.length - 1,
                    catFocus +
                    cols
                );


            paintCategoryFocus();

        }

    }


    /*
     * LEFT
     */

    else if (
        kc === KEY.LEFT
    ) {

        if (
            catFocus > 0 &&
            catFocus % cols !== 0
        ) {

            catFocus--;


            paintCategoryFocus();

        }

    }


    /*
     * RIGHT
     */

    else if (
        kc === KEY.RIGHT
    ) {

        if (
            catFocus >= 0 &&
            catFocus <
                cards.length - 1
        ) {

            catFocus++;


            paintCategoryFocus();

        }

    }


    /*
     * ENTER
     */

    else if (
        kc === KEY.ENTER
    ) {

        /*
         * Back button.
         */
        if (
            catFocus < 0
        ) {

            closeCategory();

            return;
        }


        if (
            cards[
                catFocus
            ]
        ) {

            cards[
                catFocus
            ].click();

        }

    }

}
