/* vod.js — VOD startup.
 *
 * The page is assembled from the modules below, loaded in dependency order by
 * pages/vod.html:
 *
 * vod/state.js       shared state, config aliases, DOM refs
 * vod/library.js     Continue Watching + My List
 * vod/cards.js       poster card and "see all" tile
 * vod/rails.js       category rails, section switch
 * vod/detail.js      title overlay, seasons/episodes, playback
 * vod/category.js    full-category grid
 * vod/search.js      library-wide search
 * vod/nav.js         focus model, sidebar, key dispatcher
 * vod.js             this file — boot
 */

'use strict';

(function boot() {

    /* ── Boot ───────────────────────────────────────────────────── */

    if (!cfg) {
        showStatus(
            'No playlist configured — open Settings first.',
            false
        );
        return;
    }


    /*
     * M3U profile:
     * requires playlist_url instead of Xtream server_url.
     */
    if (cfg.type === 'm3u') {

        if (!cfg.playlist_url) {
            showStatus(
                'No M3U playlist configured — open Settings first.',
                false
            );
            return;
        }

    }

    /*
     * Xtream profile:
     * keep the original server validation.
     */
    else {

        if (!cfg.server_url) {
            showStatus(
                'No server configured — open Settings first.',
                false
            );
            return;
        }

    }


    cardIndex = 0;
    railIndex = 0;

    zone = 'rails';

    /*
     * After the first content render,
     * focus the rails automatically.
     */
    _focusRailsAfterRender = true;


    /*
     * Start on Movies.
     *
     * rails.js will decide automatically whether
     * the source is Xtream or M3U.
     */
    loadType('movie');

}());
