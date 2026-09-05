/* player/resilience.js
 *
 * Live-TV resilience layer for LG webOS.
 *
 * This file intentionally patches IPTVPlayer after player/engine.js has loaded,
 * instead of replacing the 1000+ line engine. That keeps the original player
 * behaviour, codecs, audio/subtitle handling and engine selection intact.
 *
 * What it adds for the MAIN Live TV player:
 *   - keep the original engine choice (Native first when the app prefers it)
 *   - intentional initial prebuffer on HLS.js
 *   - ~15 s live reserve when the HLS window allows it
 *   - larger single-stream HLS buffer and more tolerant retries
 *   - continuous stall detection after playback has already started
 *   - direct zero-buffer watchdog plus automatic same-engine reconnect
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

        prebufferTargetSec: 12,
        prebufferMinimumSec: 6,
        prebufferMaxWaitMs: 12000,
        prebufferCheckMs: 250,

        monitorEveryMs: 500,

        /*
         * Direct buffer-starvation watchdog.
         *
         * V6 deliberately does NOT depend on video.paused or _playingSince.
         * Some webOS builds flip paused=true and clear internal playing state
         * when the network buffer reaches zero.
         */
        starvationThresholdSec: 0.35,
        starvationResetSec: 1.25,
        starvationSoftMs: 800,
        starvationReconnectMs: 2200,

        /*
         * Some IPTV endpoints are exposed by webOS Native as tiny finite media
         * objects (e.g. currentTime 4.5 / duration 4.5). For Live TV, reaching
         * the end is never a legitimate final state: reload automatically.
         */
        liveEndedReconnectMs: 350,
        finiteEndToleranceSec: 0.18,

        /*
         * V8 restores the intentional startup reserve for Native.
         * Native does not give us a reliable live-edge/seekable position on
         * this provider, so instead of seeking 10-15 s behind live, we briefly
         * PAUSE after first playback and let the browser accumulate data ahead.
         *
         * If the stream can build 10 s quickly, playback starts immediately
         * when that target is reached. Otherwise we wait at most 7 s and use
         * whatever reserve the provider actually allowed us to accumulate.
         */
        nativePrebufferTargetSec: 10,
        nativePrebufferMaxWaitMs: 7000,
        nativePrebufferCheckMs: 250,
        nativePrebufferMinUsefulSec: 1.0,

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
                    CFG.prebufferTargetSec
                ) {
                    self._resDiag(
                        'prebuffer ready ' +
                        ahead.toFixed(1) +
                        's'
                    );

                    finish();
                    return;
                }

                if (
                    waited >=
                    CFG.prebufferMaxWaitMs
                ) {
                    self._resDiag(
                        'prebuffer max wait ' +
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
     * V8 Native startup prebuffer
     * ───────────────────────────────────────────────────────────── */

    P._resStopNativePrebuffer =
        function () {
            if (
                this._resNativePrebufferTimer
            ) {
                clearTimeout(
                    this._resNativePrebufferTimer
                );

                this._resNativePrebufferTimer =
                    null;
            }

            this._resIntentionalPrebuffer =
                false;
        };


    P._resStartNativePrebuffer =
        function () {
            if (
                !isMainLiveChannel(this) ||
                this._lightBuffer ||
                currentKind(this) === 'hls' ||
                !this.video
            ) {
                return;
            }

            /*
             * _onPlaying fires again when the intentional pause finishes.
             * Prebuffer only once per engine attempt.
             */
            var attemptKey =
                String(this._gen) +
                ':' +
                String(this._attemptIdx);

            if (
                this._resNativePrebufferDoneKey ===
                attemptKey
            ) {
                return;
            }

            this._resNativePrebufferDoneKey =
                attemptKey;

            this._resStopNativePrebuffer();

            var self =
                this;

            var v =
                this.video;

            var started =
                Date.now();

            this._resIntentionalPrebuffer =
                true;

            this._resDiag(
                'native startup prebuffer'
            );

            try {
                this._msg(
                    'Building live buffer…'
                );
            }

            catch (e) {}

            try {
                v.pause();
            }

            catch (e) {}


            function finish(reason) {
                self._resStopNativePrebuffer();

                var ahead =
                    bufferAhead(
                        self
                    );

                self._resLastNativePrebuffer =
                    ahead;

                self._resDiag(
                    'native prebuffer ' +
                    ahead.toFixed(1) +
                    's ' +
                    reason
                );

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

                /*
                 * Reset starvation clocks so the intentional pause is never
                 * mistaken for a real outage when playback resumes.
                 */
                self._resStarvedAt =
                    0;

                self._resStarvationSoftDone =
                    false;

                self._resLastAdvanceAt =
                    Date.now();

                self._resLastTime =
                    Number(
                        v.currentTime
                    ) || 0;
            }


            function check() {
                if (
                    !self.video ||
                    self._resRecovering ||
                    !isMainLiveChannel(self)
                ) {
                    self._resStopNativePrebuffer();
                    return;
                }

                var ahead =
                    bufferAhead(
                        self
                    );

                var waited =
                    Date.now() -
                    started;

                if (
                    ahead >=
                    CFG.nativePrebufferTargetSec
                ) {
                    finish(
                        'target'
                    );

                    return;
                }

                if (
                    waited >=
                    CFG.nativePrebufferMaxWaitMs
                ) {
                    /*
                     * Even if the provider only exposed 3-5 seconds, keeping
                     * that small reserve is still better than starting at 0.
                     */
                    finish(
                        ahead >=
                            CFG.nativePrebufferMinUsefulSec
                                ? 'max-wait'
                                : 'provider-limited'
                    );

                    return;
                }

                self._resNativePrebufferTimer =
                    setTimeout(
                        check,
                        CFG.nativePrebufferCheckMs
                    );
            }


            this._resNativePrebufferTimer =
                setTimeout(
                    check,
                    CFG.nativePrebufferCheckMs
                );
        };


    /* ─────────────────────────────────────────────────────────────
     * Live end / native underrun events
     * ───────────────────────────────────────────────────────────── */

    P._resIsAtFiniteEnd =
        function () {
            var v =
                this.video;

            if (!v) {
                return false;
            }

            var duration =
                Number(
                    v.duration
                );

            var current =
                Number(
                    v.currentTime
                );

            if (
                !isFinite(duration) ||
                !isFinite(current) ||
                duration <= 0
            ) {
                return false;
            }

            return (
                duration -
                current
            ) <=
            CFG.finiteEndToleranceSec;
        };


    P._resUnbindVideoEvents =
        function () {
            var v =
                this.video;

            var h =
                this._resVideoHandlers;

            if (
                !v ||
                !h
            ) {
                this._resVideoHandlers =
                    null;

                return;
            }

            try {
                v.removeEventListener(
                    'ended',
                    h.ended
                );

                v.removeEventListener(
                    'emptied',
                    h.emptied
                );

                v.removeEventListener(
                    'stalled',
                    h.stalled
                );

                v.removeEventListener(
                    'waiting',
                    h.waiting
                );
            }

            catch (e) {}

            this._resVideoHandlers =
                null;
        };


    P._resBindVideoEvents =
        function () {
            var self =
                this;

            var v =
                this.video;

            if (
                !v ||
                this._lightBuffer
            ) {
                return;
            }

            this._resUnbindVideoEvents();

            function liveStillActive() {
                return !!(
                    isMainLiveChannel(self) &&
                    !self._resRecovering &&
                    !self._resIntentionalPrebuffer &&
                    typeof document !== 'undefined' &&
                    !document.hidden
                );
            }


            function ended() {
                if (
                    !liveStillActive()
                ) {
                    return;
                }

                self._resDiag(
                    'live media ended'
                );

                setTimeout(
                    function () {
                        if (
                            liveStillActive() &&
                            (
                                self.video.ended ||
                                self._resIsAtFiniteEnd()
                            )
                        ) {
                            self._resForceReconnect(
                                'live media ended'
                            );
                        }
                    },
                    CFG.liveEndedReconnectMs
                );
            }


            function emptyish(name) {
                if (
                    !liveStillActive()
                ) {
                    return;
                }

                var ahead =
                    bufferAhead(
                        self
                    );

                self._resDiag(
                    name +
                    ' ahead=' +
                    ahead.toFixed(1)
                );

                /*
                 * Do not reconnect immediately on a single waiting event.
                 * The interval watchdog will give the server ~2.2 s to recover.
                 */
                if (
                    ahead <=
                    CFG.starvationThresholdSec &&
                    !self._resStarvedAt
                ) {
                    self._resStarvedAt =
                        Date.now();

                    self._resStarvationSoftDone =
                        false;
                }
            }


            var handlers = {
                ended:
                    ended,

                emptied:
                    function () {
                        emptyish(
                            'emptied'
                        );
                    },

                stalled:
                    function () {
                        emptyish(
                            'stalled'
                        );
                    },

                waiting:
                    function () {
                        emptyish(
                            'waiting'
                        );
                    }
            };

            this._resVideoHandlers =
                handlers;

            try {
                v.addEventListener(
                    'ended',
                    handlers.ended
                );

                v.addEventListener(
                    'emptied',
                    handlers.emptied
                );

                v.addEventListener(
                    'stalled',
                    handlers.stalled
                );

                v.addEventListener(
                    'waiting',
                    handlers.waiting
                );
            }

            catch (e) {}
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

            if (
                this._resHlsProbeTimer
            ) {
                clearTimeout(
                    this._resHlsProbeTimer
                );

                this._resHlsProbeTimer =
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


    P._resHandleStarvation =
        function (reason) {
            /*
             * V7: reconnect the CURRENT chosen engine.
             *
             * We no longer force synthetic HLS, so there is no artificial
             * HLS->Native branch here. Native gets a clean same-stream reload.
             */
            this._resForceReconnect(
                reason
            );
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

            this._resStarvedAt =
                0;

            this._resStarvationSoftDone =
                false;

            this._resMonitor =
                setInterval(
                    function () {
                        if (
                            !self.video ||
                            !self._resEverPlayed ||
                            self._resRecovering
                        ) {
                            return;
                        }

                        if (
                            self._resIntentionalPrebuffer
                        ) {
                            self._resLastAdvanceAt =
                                Date.now();

                            self._resLastTime =
                                Number(
                                    self.video.currentTime
                                ) || 0;

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

                        /*
                         * V7: a Live TV stream that reaches a finite "end"
                         * (for example 4.5 / 4.5 seconds) must reconnect.
                         * Previously video.ended was excluded from starvation
                         * recovery, which exactly matches the 1080p freeze seen
                         * in testing.
                         */
                        if (
                            video.ended ||
                            self._resIsAtFiniteEnd()
                        ) {
                            self._resForceReconnect(
                                'live stream reached finite end'
                            );

                            return;
                        }

                        /*
                         * Buffer starvation is checked BEFORE video.paused.
                         *
                         * On LG webOS Native, a network underrun may flip
                         * video.paused to true even though the user never paused.
                         * V4 returned immediately in that state, so ahead=0.0s
                         * could remain frozen forever.
                         */
                        var aheadNow =
                            bufferAhead(
                                self
                            );

                        if (
                            aheadNow <=
                                CFG.starvationThresholdSec
                        ) {
                            if (
                                !self._resStarvedAt
                            ) {
                                self._resStarvedAt =
                                    Date.now();

                                self._resStarvationSoftDone =
                                    false;

                                self._resDiag(
                                    'buffer empty'
                                );
                            }

                            var starvationMs =
                                Date.now() -
                                self._resStarvedAt;

                            if (
                                starvationMs >=
                                    CFG.starvationSoftMs &&
                                !self._resStarvationSoftDone
                            ) {
                                self._resStarvationSoftDone =
                                    true;

                                self._resSoftRecover(
                                    starvationMs
                                );
                            }

                            if (
                                starvationMs >=
                                CFG.starvationReconnectMs
                            ) {
                                self._resHandleStarvation(
                                    'buffer empty ' +
                                    Math.round(
                                        starvationMs /
                                        1000
                                    ) +
                                    's'
                                );

                                return;
                            }
                        }

                        else if (
                            aheadNow >=
                                CFG.starvationResetSec
                        ) {
                            self._resStarvedAt =
                                0;

                            self._resStarvationSoftDone =
                                false;
                        }

                        /*
                         * A real pause with healthy buffered media should not
                         * trigger the normal frozen-currentTime watchdog.
                         * Buffer-empty pause was already handled above.
                         */
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

                            if (
                                aheadNow >=
                                    CFG.starvationResetSec
                            ) {
                                self._resStarvedAt =
                                    0;

                                self._resStarvationSoftDone =
                                    false;
                            }

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
     * V7: preserve the ORIGINAL engine ordering
     * ───────────────────────────────────────────────────────────── */

    function _resAttemptLabel(a) {
        if (!a) {
            return '?';
        }

        return a.kind || '?';
    }


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
                 * Real-world test on this provider:
                 *
                 * Native  -> commonly held ~10 s ahead
                 * forced synthetic HLS -> often only ~0–2 s ahead
                 *
                 * So V7 stops forcing HLS. We keep the engine's original
                 * ordering and concentrate on making Native recover reliably.
                 *
                 * If the original engine itself offers/chooses HLS for a stream,
                 * the HLS buffer/retry patches later in this file still apply.
                 */
                if (
                    isMainLiveChannel(this) &&
                    list &&
                    list.length
                ) {
                    this._resAttemptSummary =
                        list.map(
                            _resAttemptLabel
                        ).join(
                            ' > '
                        );
                }

                this._resSyntheticHlsOffered =
                    false;

                return list;
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

                var activeAttempt =
                    currentAttempt(this);

                var isSyntheticProbe =
                    !!(
                        activeAttempt &&
                        activeAttempt.kind === 'hls' &&
                        activeAttempt._resSyntheticHls
                    );

                if (
                    isSyntheticProbe &&
                    !this._lightBuffer
                ) {
                    if (
                        this._resHlsProbeTimer
                    ) {
                        clearTimeout(
                            this._resHlsProbeTimer
                        );
                    }

                    var self =
                        this;

                    var probeGen =
                        gen;

                    var probeTok =
                        tok;

                    /*
                     * Do not let a raw-TS/non-HLS endpoint add a long delay to
                     * channel zapping. If HLS.js has not reached playing within
                     * ~4.5 s, advance to the original Native attempt.
                     */
                    this._resHlsProbeTimer =
                        setTimeout(
                            function () {
                                self._resHlsProbeTimer =
                                    null;

                                if (
                                    probeGen !== self._gen ||
                                    probeTok !== self._tok ||
                                    self._playingSince
                                ) {
                                    return;
                                }

                                var still =
                                    currentAttempt(
                                        self
                                    );

                                if (
                                    !still ||
                                    !still._resSyntheticHls
                                ) {
                                    return;
                                }

                                self._resDiag(
                                    'synthetic HLS probe timeout'
                                );

                                try {
                                    self._next(
                                        probeGen,
                                        'HLS probe timeout'
                                    );
                                }

                                catch (e) {}
                            },
                            4500
                        );
                }

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

                this._resEverPlayed =
                    true;

                this._resAttemptStartedAt =
                    Date.now();

                if (
                    this._resHlsProbeTimer
                ) {
                    clearTimeout(
                        this._resHlsProbeTimer
                    );

                    this._resHlsProbeTimer =
                        null;
                }

                if (
                    !this._lightBuffer
                ) {
                    this._resRecovering =
                        false;

                    /*
                     * Start protection immediately. Do NOT wait for any HLS
                     * prebuffer callback before the watchdog exists.
                     */
                    this._resBindVideoEvents();
                    this._resStartMonitor();

                    /*
                     * HLS can still use the live-edge safety delay when the
                     * browser exposes it. Native instead gets a real startup
                     * prebuffer by pausing briefly and accumulating ahead.
                     */
                    if (
                        isMainLiveChannel(this) &&
                        currentKind(this) === 'hls' &&
                        this.hls
                    ) {
                        this._resScheduleSafetyDelay();
                    }

                    else if (
                        isMainLiveChannel(this)
                    ) {
                        this._resStartNativePrebuffer();
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
                this._resUnbindVideoEvents();
                this._resStopNativePrebuffer();

                this._resNativePrebufferDoneKey =
                    '';

                this._resEverPlayed =
                    false;

                this._resAttemptStartedAt =
                    0;

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
                this._resUnbindVideoEvents();
                this._resStopNativePrebuffer();
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
                this._resUnbindVideoEvents();
                this._resStopNativePrebuffer();
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
                        '\nresilient: ON v8' +
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
                        selected +
                        (
                            this._resSyntheticHlsOffered
                                ? '  synthetic=yes'
                                : '  synthetic=no'
                        ) +
                        (
                            this._resStarvedAt
                                ? '  starved=' +
                                  (
                                      (
                                          Date.now() -
                                          this._resStarvedAt
                                      ) /
                                      1000
                                  ).toFixed(1) +
                                  's'
                                : ''
                        ) +
                        (
                            this._resIsAtFiniteEnd()
                                ? '  liveEnd=yes'
                                : ''
                        ) +
                        (
                            isFinite(
                                Number(
                                    this._resLastNativePrebuffer
                                )
                            )
                                ? '  startup=' +
                                  Number(
                                      this._resLastNativePrebuffer
                                  ).toFixed(1) +
                                  's'
                                : ''
                        );

                    this._diagEl.textContent +=
                        extra;
                }

                return result;
            };
    }

}());
