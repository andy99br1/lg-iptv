/* player/resilience.js
 *
 * Live-TV resilience layer for LG webOS.
 *
 * This file intentionally patches IPTVPlayer after player/engine.js has loaded,
 * instead of replacing the 1000+ line engine. That keeps the original player
 * behaviour, codecs, audio/subtitle handling and engine selection intact.
 *
 * What it adds for the MAIN Live TV player:
 *   - HLS.js FIRST whenever the original engine offers an HLS attempt
 *   - intentional initial prebuffer on HLS.js
 *   - ~15 s live reserve when the HLS window allows it
 *   - larger single-stream HLS buffer and more tolerant retries
 *   - continuous stall detection after playback has already started
 *   - soft recovery first, then automatic same-engine reconnect
 *
 * Multiview players use opts.lightBuffer and are deliberately left alone so
 * four simultaneous streams do not exhaust TV memory.
 */

(function () {
    'use strict';

    if (typeof IPTVPlayer === 'undefined') {
        return;
    }

    var CFG = {
        safetyDelaySec: 15,
        minimumReserveSec: 10,

        prebufferTargetSec: 15,
        prebufferMaxWaitMs: 8000,
        prebufferCheckMs: 250,

        monitorEveryMs: 1000,
        softStallMs: 4000,
        nudgeStallMs: 6500,
        hardStallMs: 9500,

        reconnectDelayMs: 700,

        maxBufferLength: 42,
        maxMaxBufferLength: 60,
        backBufferLength: 30,

        manifestRetries: 3,
        levelRetries: 4,
        fragmentRetries: 6,

        reserveRecheckMs: 15000
    };

    var P = IPTVPlayer.prototype;


    /* ─────────────────────────────────────────────────────────────
     * Helpers
     * ───────────────────────────────────────────────────────────── */

    function currentAttempt(self) {
        if (
            !self ||
            !self._attempts ||
            self._attemptIdx == null
        ) {
            return null;
        }

        return self._attempts[
            self._attemptIdx
        ] || null;
    }


    function currentUrl(self) {
        var attempt =
            currentAttempt(self);

        return (
            attempt &&
            attempt.url
        ) ||
        (
            self &&
            self.video &&
            self.video.currentSrc
        ) ||
        '';
    }


    function looksLikeHls(self) {
        if (
            self &&
            (
                self.hls ||
                currentKind(self) === 'hls'
            )
        ) {
            return true;
        }

        return /\.m3u8(?:$|[?#])/i.test(
            currentUrl(self)
        );
    }


    function isMainLiveChannel(self) {
        return !!(
            self &&
            !self._lightBuffer &&
            self._contentKey &&
            String(self._contentKey).indexOf('ch:') === 0
        );
    }


    function currentKind(self) {
        var attempt =
            currentAttempt(self);

        return (
            attempt &&
            attempt.kind
        ) || '';
    }


    function rangeContaining(
        ranges,
        time
    ) {
        if (!ranges) {
            return -1;
        }

        for (
            var i = 0;
            i < ranges.length;
            i++
        ) {
            try {
                if (
                    time >=
                        ranges.start(i) - 0.25 &&
                    time <=
                        ranges.end(i) + 0.25
                ) {
                    return i;
                }
            }

            catch (e) {}
        }

        return -1;
    }


    function bufferAhead(self) {
        var v =
            self &&
            self.video;

        if (
            !v ||
            !v.buffered
        ) {
            return 0;
        }

        var t =
            Number(
                v.currentTime
            );

        if (!isFinite(t)) {
            return 0;
        }

        var idx =
            rangeContaining(
                v.buffered,
                t
            );

        if (idx < 0) {
            return 0;
        }

        try {
            return Math.max(
                0,
                v.buffered.end(idx) -
                    t
            );
        }

        catch (e) {
            return 0;
        }
    }


    function seekableWindow(self) {
        var v =
            self &&
            self.video;

        if (
            !v ||
            !v.seekable ||
            !v.seekable.length
        ) {
            return null;
        }

        var idx =
            v.seekable.length -
            1;

        try {
            return {
                start:
                    v.seekable.start(
                        idx
                    ),

                end:
                    v.seekable.end(
                        idx
                    )
            };
        }

        catch (e) {
            return null;
        }
    }


    /* ─────────────────────────────────────────────────────────────
     * Intentional live delay
     * ───────────────────────────────────────────────────────────── */

    P._resApplySafetyDelay =
        function () {
            if (
                this._lightBuffer ||
                !looksLikeHls(this)
            ) {
                return true;
            }

            var v =
                this.video;

            var win =
                seekableWindow(this);

            if (
                !v ||
                !win
            ) {
                return false;
            }

            var now =
                Number(
                    v.currentTime
                );

            if (!isFinite(now)) {
                return false;
            }

            var lag =
                win.end -
                now;

            /*
             * Already at least 8 seconds behind the live edge:
             * do not seek forward just to hit exactly 12 seconds.
             * More reserve is fine.
             */
            if (
                lag >=
                CFG.minimumReserveSec
            ) {
                this._resLastKnownLag =
                    lag;

                return true;
            }

            var target =
                win.end -
                CFG.safetyDelaySec;

            /*
             * The HLS playlist must actually expose enough history.
             * Very short playlists cannot provide a 12 second reserve.
             */
            if (
                target <=
                    win.start + 0.35 ||
                target >=
                    now - 0.35
            ) {
                this._resLastKnownLag =
                    lag;

                return false;
            }

            try {
                v.currentTime =
                    target;

                v.play()
                    .catch(
                        function () {}
                    );

                this._resLastKnownLag =
                    CFG.safetyDelaySec;

                this._resDiag(
                    'safety delay ' +
                    CFG.safetyDelaySec +
                    's'
                );

                return true;
            }

            catch (e) {
                return false;
            }
        };


    P._resScheduleSafetyDelay =
        function () {
            if (
                this._lightBuffer ||
                !looksLikeHls(this)
            ) {
                return;
            }

            if (
                this._resDelayTimer
            ) {
                clearTimeout(
                    this._resDelayTimer
                );
            }

            this._resDelayTries =
                0;

            var self =
                this;

            function tryDelay() {
                if (
                    !self._playingSince ||
                    self._lightBuffer
                ) {
                    return;
                }

                self._resDelayTries++;

                var ok =
                    self._resApplySafetyDelay();

                if (
                    !ok &&
                    self._resDelayTries <
                        8
                ) {
                    self._resDelayTimer =
                        setTimeout(
                            tryDelay,
                            1000
                        );
                }

                else {
                    self._resDelayTimer =
                        null;
                }
            }

            this._resDelayTimer =
                setTimeout(
                    tryDelay,
                    700
                );
        };


    P._resMaintainReserve =
        function () {
            if (
                this._lightBuffer ||
                !looksLikeHls(this)
            ) {
                return;
            }

            var now =
                Date.now();

            if (
                this._resLastReserveCheck &&
                now -
                    this._resLastReserveCheck <
                    CFG.reserveRecheckMs
            ) {
                return;
            }

            this._resLastReserveCheck =
                now;

            var v =
                this.video;

            var win =
                seekableWindow(this);

            if (
                !v ||
                !win
            ) {
                return;
            }

            var lag =
                win.end -
                Number(
                    v.currentTime
                );

            if (isFinite(lag)) {
                this._resLastKnownLag =
                    lag;
            }

            /*
             * Only move backwards when we've crept very close to live.
             * We never jump forward to reduce an existing delay.
             */
            if (
                isFinite(lag) &&
                lag <
                    Math.max(
                        4,
                        CFG.minimumReserveSec -
                        2
                    )
            ) {
                this._resApplySafetyDelay();
            }
        };



    /* ─────────────────────────────────────────────────────────────
     * HLS.js initial prebuffer
     * ───────────────────────────────────────────────────────────── */

    P._resStartPrebuffer =
        function (done) {
            done =
                done ||
                function () {};

            if (
                !isMainLiveChannel(this) ||
                currentKind(this) !== 'hls' ||
                !this.hls ||
                !this.video
            ) {
                done();
                return;
            }

            var key =
                String(this._contentKey) +
                '|' +
                currentUrl(this);

            /*
             * Do this once for each channel/tier start. Reconnects may run it
             * again because rebuilding a reserve after a server hiccup is useful.
             */
            this._resPrebufferKey =
                key;

            var self =
                this;

            var v =
                this.video;

            var started =
                Date.now();

            try {
                v.pause();
            }

            catch (e) {}

            try {
                this._msg(
                    'Building live buffer…'
                );
            }

            catch (e) {}

            this._resDiag(
                'initial HLS prebuffer'
            );

            function finish() {
                if (
                    self._resPrebufferTimer
                ) {
                    clearTimeout(
                        self._resPrebufferTimer
                    );

                    self._resPrebufferTimer =
                        null;
                }

                /*
                 * If a seekable live window exists, use it to make the reserve
                 * deterministic. If not, the pause itself still accumulated
                 * buffered media ahead of currentTime.
                 */
                self._resApplySafetyDelay();

                try {
                    v.play()
                        .catch(
                            function () {}
                        );
                }

                catch (e) {}

                try {
                    self._hideMsg();
                }

                catch (e) {}

                self._playingSince =
                    Date.now();

                done();
            }


            function check() {
                if (
                    !self.video ||
                    !self.hls ||
                    currentKind(self) !== 'hls'
                ) {
                    finish();
                    return;
                }

                var ahead =
                    bufferAhead(self);

                var waited =
                    Date.now() -
                    started;

                if (
                    ahead >=
                        CFG.prebufferTargetSec ||
                    waited >=
                        CFG.prebufferMaxWaitMs
                ) {
                    self._resDiag(
                        'prebuffer ready ' +
                        ahead.toFixed(1) +
                        's'
                    );

                    finish();
                    return;
                }

                self._resPrebufferTimer =
                    setTimeout(
                        check,
                        CFG.prebufferCheckMs
                    );
            }

            this._resPrebufferTimer =
                setTimeout(
                    check,
                    CFG.prebufferCheckMs
                );
        };


    /* ─────────────────────────────────────────────────────────────
     * Continuous stall monitor
     * ───────────────────────────────────────────────────────────── */

    P._resDiag =
        function (text) {
            if (!text) {
                return;
            }

            if (!this._diag) {
                this._diag = [];
            }

            this._diag.push(
                'resilience: ' +
                text
            );

            /*
             * Prevent a very unstable stream from growing diagnostics
             * forever during an all-day viewing session.
             */
            if (
                this._diag.length >
                30
            ) {
                this._diag.splice(
                    0,
                    this._diag.length -
                    30
                );
            }
        };


    P._resStopMonitor =
        function () {
            if (
                this._resMonitor
            ) {
                clearInterval(
                    this._resMonitor
                );

                this._resMonitor =
                    null;
            }

            if (
                this._resDelayTimer
            ) {
                clearTimeout(
                    this._resDelayTimer
                );

                this._resDelayTimer =
                    null;
            }

            if (
                this._resPrebufferTimer
            ) {
                clearTimeout(
                    this._resPrebufferTimer
                );

                this._resPrebufferTimer =
                    null;
            }
        };


    P._resSoftRecover =
        function (stallMs) {
            var v =
                this.video;

            if (!v) {
                return;
            }

            this._resDiag(
                'soft recovery after ' +
                Math.round(
                    stallMs /
                    1000
                ) +
                's stall'
            );

            /*
             * HLS.js may have stopped requesting fragments after a
             * temporary network error. startLoad() is cheap and safe.
             */
            if (this.hls) {
                try {
                    this.hls.startLoad();
                }

                catch (e) {}
            }

            try {
                v.play()
                    .catch(
                        function () {}
                    );
            }

            catch (e) {}
        };


    P._resNudgeDecoder =
        function () {
            var v =
                this.video;

            if (!v) {
                return;
            }

            /*
             * If data is ALREADY buffered ahead but currentTime is frozen,
             * the problem is usually the media pipeline rather than the
             * server. A 150 ms seek is small enough to be invisible but can
             * force webOS to resume decoding.
             */
            var ahead =
                bufferAhead(this);

            if (
                ahead <
                1.5
            ) {
                return;
            }

            try {
                var target =
                    Math.min(
                        v.currentTime +
                            0.15,
                        v.currentTime +
                            ahead -
                            0.5
                    );

                if (
                    target >
                    v.currentTime
                ) {
                    v.currentTime =
                        target;

                    v.play()
                        .catch(
                            function () {}
                        );

                    this._resDiag(
                        'decoder nudge'
                    );
                }
            }

            catch (e) {}
        };


    P._resForceReconnect =
        function (reason) {
            if (
                this._lightBuffer ||
                this._resRecovering
            ) {
                return;
            }

            var gen =
                this._gen;

            if (!gen) {
                return;
            }

            this._resRecovering =
                true;

            this._resStopMonitor();

            this._resDiag(
                reason ||
                'hard reconnect'
            );

            try {
                this._msg(
                    'Reconnecting…'
                );
            }

            catch (e) {}

            /*
             * Keep the SAME attempt / engine. This is important on LG:
             * an engine that decoded correctly before the network hiccup
             * should be given a clean reconnect before trying another tier.
             */
            this._tok++;

            var tok =
                this._tok;

            try {
                this._clearWatchdog();
            }

            catch (e) {}

            try {
                this._resetVideo();
            }

            catch (e) {}

            if (this.video) {
                this.video.style.display =
                    'block';
            }

            var self =
                this;

            setTimeout(
                function () {
                    if (
                        gen !==
                            self._gen ||
                        tok !==
                            self._tok
                    ) {
                        self._resRecovering =
                            false;

                        return;
                    }

                    self._resRecovering =
                        false;

                    self._runAttempt(
                        gen
                    );
                },
                CFG.reconnectDelayMs
            );
        };


    P._resStartMonitor =
        function () {
            if (
                this._lightBuffer
            ) {
                return;
            }

            this._resStopMonitor();

            var self =
                this;

            var v =
                this.video;

            if (!v) {
                return;
            }

            this._resLastTime =
                Number(
                    v.currentTime
                ) || 0;

            this._resLastAdvanceAt =
                Date.now();

            this._resSoftDone =
                false;

            this._resNudgeDone =
                false;

            this._resLastReserveCheck =
                0;

            this._resMonitor =
                setInterval(
                    function () {
                        if (
                            !self.video ||
                            !self._playingSince ||
                            self._resRecovering
                        ) {
                            return;
                        }

                        /*
                         * Do not call a backgrounded/hidden app a stall.
                         */
                        if (
                            typeof document !==
                                'undefined' &&
                            document.hidden
                        ) {
                            self._resLastAdvanceAt =
                                Date.now();

                            self._resLastTime =
                                Number(
                                    self.video.currentTime
                                ) || 0;

                            return;
                        }

                        var video =
                            self.video;

                        if (
                            video.paused ||
                            video.ended
                        ) {
                            self._resLastAdvanceAt =
                                Date.now();

                            self._resLastTime =
                                Number(
                                    video.currentTime
                                ) || 0;

                            return;
                        }

                        var t =
                            Number(
                                video.currentTime
                            );

                        if (!isFinite(t)) {
                            return;
                        }

                        var moved =
                            Math.abs(
                                t -
                                self._resLastTime
                            ) >
                            0.25;

                        if (moved) {
                            self._resLastTime =
                                t;

                            self._resLastAdvanceAt =
                                Date.now();

                            self._resSoftDone =
                                false;

                            self._resNudgeDone =
                                false;

                            self._resMaintainReserve();

                            return;
                        }

                        var stallMs =
                            Date.now() -
                            self._resLastAdvanceAt;

                        if (
                            stallMs >=
                                CFG.softStallMs &&
                            !self._resSoftDone
                        ) {
                            self._resSoftDone =
                                true;

                            self._resSoftRecover(
                                stallMs
                            );
                        }

                        if (
                            stallMs >=
                                CFG.nudgeStallMs &&
                            !self._resNudgeDone
                        ) {
                            self._resNudgeDone =
                                true;

                            self._resNudgeDecoder();
                        }

                        if (
                            stallMs >=
                            CFG.hardStallMs
                        ) {
                            self._resForceReconnect(
                                'reconnect after ' +
                                Math.round(
                                    stallMs /
                                    1000
                                ) +
                                's frozen'
                            );
                        }
                    },
                    CFG.monitorEveryMs
                );
        };



    /* ─────────────────────────────────────────────────────────────
     * Prefer HLS.js whenever the ORIGINAL engine offers HLS
     * ───────────────────────────────────────────────────────────── */

    var originalBuildAttempts =
        P._buildAttempts;

    if (originalBuildAttempts) {
        P._buildAttempts =
            function (urls) {
                var list =
                    originalBuildAttempts.call(
                        this,
                        urls
                    );

                /*
                 * V3:
                 *
                 * Many IPTV servers expose HLS behind URLs that do NOT end in
                 * ".m3u8" (for example /live/user/pass/12345).
                 *
                 * So we no longer inspect the URL extension here.
                 *
                 * If LG-IPTV's ORIGINAL engine already created an attempt whose
                 * kind is "hls", trust that classification and move HLS.js to the
                 * front for the MAIN Live TV player.
                 *
                 * Native stays in the attempt list as automatic fallback if
                 * HLS.js fails because of CORS, codec, MSE or provider behaviour.
                 */
                if (
                    !isMainLiveChannel(this) ||
                    !list ||
                    !list.length
                ) {
                    return list;
                }

                var hlsFirst = [];
                var rest = [];

                for (
                    var i = 0;
                    i < list.length;
                    i++
                ) {
                    var a =
                        list[i];

                    if (
                        a &&
                        a.kind === 'hls'
                    ) {
                        hlsFirst.push(a);
                    }

                    else {
                        rest.push(a);
                    }
                }

                var reordered =
                    hlsFirst.length
                        ? hlsFirst.concat(rest)
                        : list;

                /*
                 * Save exactly what the engine offered after reordering.
                 * The GREEN diagnostics panel will expose this.
                 */
                this._resAttemptSummary =
                    reordered.map(
                        function (a) {
                            return (
                                a &&
                                a.kind
                            ) || '?';
                        }
                    ).join(
                        ' > '
                    );

                return reordered;
            };
    }


    /* ─────────────────────────────────────────────────────────────
     * Patch HLS.js configuration
     * ───────────────────────────────────────────────────────────── */

    var originalAttachHls =
        P._attachHls;

    if (originalAttachHls) {
        P._attachHls =
            function (
                gen,
                tok,
                url
            ) {
                var result =
                    originalAttachHls.call(
                        this,
                        gen,
                        tok,
                        url
                    );

                /*
                 * The original method creates Hls synchronously and only
                 * loads the manifest after MEDIA_ATTACHED, so updating its
                 * config here still happens before network loading begins.
                 */
                if (
                    !this._lightBuffer &&
                    this.hls &&
                    this.hls.config
                ) {
                    var c =
                        this.hls.config;

                    c.maxBufferLength =
                        CFG.maxBufferLength;

                    c.maxMaxBufferLength =
                        CFG.maxMaxBufferLength;

                    c.backBufferLength =
                        CFG.backBufferLength;

                    c.manifestLoadingMaxRetry =
                        CFG.manifestRetries;

                    c.levelLoadingMaxRetry =
                        CFG.levelRetries;

                    c.fragLoadingMaxRetry =
                        CFG.fragmentRetries;

                    /*
                     * These exist on common hls.js versions. Setting them
                     * is harmless on versions that do not actively use them.
                     */
                    c.manifestLoadingRetryDelay =
                        1000;

                    c.levelLoadingRetryDelay =
                        1000;

                    c.fragLoadingRetryDelay =
                        1000;

                    c.highBufferWatchdogPeriod =
                        2;

                    c.nudgeOffset =
                        0.1;

                    c.nudgeMaxRetry =
                        5;

                    /*
                     * Stay several HLS segments behind the live edge. Count-based
                     * values are compatible with old hls.js builds and adapt to
                     * providers whose segment duration is 2, 4, 5 or 6 seconds.
                     */
                    c.liveSyncDurationCount =
                        4;

                    c.liveMaxLatencyDurationCount =
                        9;
                }

                return result;
            };
    }


    /* ─────────────────────────────────────────────────────────────
     * Hook normal engine lifecycle
     * ───────────────────────────────────────────────────────────── */

    var originalOnPlaying =
        P._onPlaying;

    if (originalOnPlaying) {
        P._onPlaying =
            function () {
                var result =
                    originalOnPlaying.apply(
                        this,
                        arguments
                    );

                if (
                    !this._lightBuffer
                ) {
                    var self =
                        this;

                    this._resRecovering =
                        false;

                    if (
                        isMainLiveChannel(this) &&
                        currentKind(this) === 'hls' &&
                        this.hls
                    ) {
                        this._resStartPrebuffer(
                            function () {
                                self._resStartMonitor();
                                self._resScheduleSafetyDelay();
                            }
                        );
                    }

                    else {
                        this._resStartMonitor();
                        this._resScheduleSafetyDelay();
                    }
                }

                return result;
            };
    }


    var originalResetVideo =
        P._resetVideo;

    if (originalResetVideo) {
        P._resetVideo =
            function () {
                this._resStopMonitor();

                return originalResetVideo.apply(
                    this,
                    arguments
                );
            };
    }


    var originalStop =
        P.stop;

    if (originalStop) {
        P.stop =
            function () {
                this._resStopMonitor();
                this._resRecovering =
                    false;

                return originalStop.apply(
                    this,
                    arguments
                );
            };
    }


    var originalDestroy =
        P.destroy;

    if (originalDestroy) {
        P.destroy =
            function () {
                this._resStopMonitor();
                this._resRecovering =
                    false;

                return originalDestroy.apply(
                    this,
                    arguments
                );
            };
    }


    var originalNext =
        P._next;

    if (originalNext) {
        P._next =
            function (
                gen,
                reason
            ) {
                this._resStopMonitor();

                return originalNext.call(
                    this,
                    gen,
                    reason
                );
            };
    }


    /*
     * Extend GREEN diagnostics without replacing the original panel.
     */
    var originalUpdateDiag =
        P._updateDiag;

    if (originalUpdateDiag) {
        P._updateDiag =
            function () {
                var result =
                    originalUpdateDiag.apply(
                        this,
                        arguments
                    );

                if (
                    this._diagEl &&
                    !this._lightBuffer
                ) {
                    var ahead =
                        bufferAhead(this);

                    var lag =
                        Number(
                            this._resLastKnownLag
                        );

                    var selected =
                        currentKind(this) ||
                        (
                            this.hls
                                ? 'hls'
                                : 'native'
                        );

                    var attempts =
                        this._resAttemptSummary ||
                        (
                            this._attempts &&
                            this._attempts.length
                                ? this._attempts.map(
                                    function (a) {
                                        return (
                                            a &&
                                            a.kind
                                        ) || '?';
                                    }
                                ).join(' > ')
                                : '—'
                        );

                    var extra =
                        '\nresilient: ON v3' +
                        '  reserve=' +
                        (
                            isFinite(lag)
                                ? lag.toFixed(1) +
                                  's'
                                : '—'
                        ) +
                        '  ahead=' +
                        ahead.toFixed(1) +
                        's' +
                        '\nattempts: ' +
                        attempts +
                        '  selected=' +
                        selected;

                    this._diagEl.textContent +=
                        extra;
                }

                return result;
            };
    }

}());
