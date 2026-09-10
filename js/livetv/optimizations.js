/* livetv/optimizations.js
 *
 * Small compatibility/performance patches loaded after epg.js + channels.js.
 *
 * 1) Paint channel rows FIRST, then start EPG work shortly afterwards.
 *    This makes a large playlist feel immediate even when the XMLTV file is big.
 *
 * 2) Fix corrupted-looking EPG text. The original xtreamDecodeEPG() tried
 *    atob() on every title. Plain XMLTV words that happened to look like Base64
 *    could therefore be "decoded" into garbage. This version decodes only when
 *    the result is valid human-readable UTF-8/ASCII text.
 */

(function () {
    'use strict';


    /* ─────────────────────────────────────────────────────────────
     * Safe EPG text decoding
     * ───────────────────────────────────────────────────────────── */

    function _epgDecodeUtf8Binary(bin) {
        try {
            /*
             * escape() exists on the old Chromium versions targeted by this
             * project and is a practical bridge from atob's byte string to UTF-8.
             */
            return decodeURIComponent(
                escape(bin)
            );
        }

        catch (e) {
            /*
             * A genuine Base64 ASCII string does not need UTF-8 conversion.
             * If high bytes are present and UTF-8 failed, however, this is much
             * more likely to be an ordinary title accidentally interpreted as
             * Base64. Reject it.
             */
            for (
                var i = 0;
                i < bin.length;
                i++
            ) {
                if (
                    bin.charCodeAt(i) >
                    127
                ) {
                    return null;
                }
            }

            return bin;
        }
    }


    function _epgLooksReadable(text) {
        if (
            text === null ||
            text === undefined
        ) {
            return false;
        }

        text =
            String(text);

        if (!text.length) {
            return true;
        }

        var controls = 0;
        var visible = 0;

        for (
            var i = 0;
            i < text.length;
            i++
        ) {
            var c =
                text.charCodeAt(i);

            if (
                c === 9 ||
                c === 10 ||
                c === 13
            ) {
                continue;
            }

            /*
             * C0 controls and C1 controls are a very strong sign that a normal
             * word was accidentally fed through atob().
             */
            if (
                c < 32 ||
                (
                    c >= 127 &&
                    c <= 159
                )
            ) {
                controls++;
            }

            else {
                visible++;
            }
        }

        if (controls) {
            return false;
        }

        return visible > 0;
    }


    function _epgSafeDecode(value) {
        if (
            value === null ||
            value === undefined
        ) {
            return '';
        }

        var original =
            String(value);

        var s =
            original.trim();

        /*
         * Very short strings have a high false-positive rate and real Xtream
         * Base64 programme titles are normally longer than this.
         */
        if (
            s.length < 8 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(s)
        ) {
            return original;
        }

        /*
         * Base64 length modulo 4 may be 0, 2 or 3. Modulo 1 is impossible.
         */
        if (
            s.length % 4 === 1
        ) {
            return original;
        }

        while (
            s.length % 4
        ) {
            s += '=';
        }

        var bin;

        try {
            bin =
                atob(s);
        }

        catch (e) {
            return original;
        }

        var decoded =
            _epgDecodeUtf8Binary(
                bin
            );

        if (
            !_epgLooksReadable(
                decoded
            )
        ) {
            return original;
        }

        return decoded;
    }


    /*
     * epg.js calls xtreamDecodeEPG() for BOTH Xtream EPG and the XMLTV-derived
     * M3U entries, so patching it here fixes both paths without touching epg.js.
     */
    if (
        typeof xtreamDecodeEPG ===
        'function'
    ) {
        xtreamDecodeEPG =
            _epgSafeDecode;

        try {
            window.xtreamDecodeEPG =
                _epgSafeDecode;
        }

        catch (e) {}
    }


    /* ─────────────────────────────────────────────────────────────
     * Channels first, EPG afterwards
     * ───────────────────────────────────────────────────────────── */

    if (
        typeof loadEPGForCurrentCategory ===
        'function'
    ) {
        var _originalLoadEPGForCurrentCategory =
            loadEPGForCurrentCategory;

        var _epgDeferredSeq =
            0;

        var _epgDeferredTimer =
            null;


        function _afterTwoPaints(fn) {
            var raf =
                window.requestAnimationFrame ||
                function (cb) {
                    return setTimeout(
                        cb,
                        16
                    );
                };

            raf(
                function () {
                    raf(
                        function () {
                            fn();
                        }
                    );
                }
            );
        }


        loadEPGForCurrentCategory =
            function () {
                var self =
                    this;

                var args =
                    arguments;

                var mySeq =
                    ++_epgDeferredSeq;

                if (
                    _epgDeferredTimer
                ) {
                    clearTimeout(
                        _epgDeferredTimer
                    );

                    _epgDeferredTimer =
                        null;
                }

                /*
                 * Two animation frames guarantee that the virtual channel rows
                 * can reach the screen first. The short timer then gives the TV
                 * a moment to become responsive before a large XMLTV DOMParser
                 * job begins.
                 */
                _afterTwoPaints(
                    function () {
                        if (
                            mySeq !==
                            _epgDeferredSeq
                        ) {
                            return;
                        }

                        _epgDeferredTimer =
                            setTimeout(
                                function () {
                                    _epgDeferredTimer =
                                        null;

                                    if (
                                        mySeq !==
                                        _epgDeferredSeq
                                    ) {
                                        return;
                                    }

                                    try {
                                        var result =
                                            _originalLoadEPGForCurrentCategory
                                                .apply(
                                                    self,
                                                    args
                                                );

                                        /*
                                         * Avoid unhandled rejections on providers
                                         * whose EPG endpoint is temporarily down.
                                         */
                                        if (
                                            result &&
                                            typeof result.catch ===
                                                'function'
                                        ) {
                                            result.catch(
                                                function () {}
                                            );
                                        }
                                    }

                                    catch (e) {}
                                },
                                350
                            );
                    }
                );

                return Promise.resolve();
            };

        try {
            window.loadEPGForCurrentCategory =
                loadEPGForCurrentCategory;
        }

        catch (e) {}
    }

}());
