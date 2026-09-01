# LG-IPTV
A fast, lightweight IPTV player built for webOS TVs by LG.

## Features
- Fast and lightweight IPTV client for webOS
- Supports M3U playlists and Xtream Codes API
- Live TV with EPG timeline, favourites, favourite whole categories, and catch-up
- Multiview — up to four live channels at once, one audio (BLUE button)
- VOD and series browser with resume, search and OpenSubtitles lookup
- Clean and remote-friendly UI
- No ads, no bundled channels
- Auto-update support via Homebrew
- Manual Dev Mode sideloading supported

## Installation

### Option 1 — Install via Homebrew (Recommended)

Add the repository:
```
https://raw.githubusercontent.com/sharktie/lg-iptv/main/webosbrew/index.json
```
Install the app


---

### Option 2 — Manual Installation (Dev Mode)

1. Download the latest `.ipk` file:  
   https://github.com/sharktie/lg-iptv/releases/latest
2. Enable Developer Mode on your LG TV.
3. Install webOS Dev Manager on your computer:  
   https://github.com/webosbrew/dev-manager-desktop
4. Connect to your TV via Dev Manager.
5. Click “Install App” and select the `.ipk` file.

---

## How to Enable Developer Mode on Your LG TV

1. Open LG Content Store → install **Developer Mode** app.  
2. Sign in with your LG Developer account:  
   https://webostv.developer.lge.com/
3. Open the app → enable **Developer Mode** → TV reboots.
4. Reopen Developer Mode → note your TV’s IP.
5. Open Dev Manager → add your TV using that IP.
6. You can now sideload apps.

---

## Configuration
1. Launch LG-IPTV.
2. Enter your M3U URL or Xtream login.
3. Channels load automatically.

(No IPTV service included — you must provide your own.)

---

## Supported IPTV Formats
- M3U / M3U8
- Xtream Codes API

---

## Development

Source lives in `js/`; Babel transpiles it to `dist/js/` (target: Chrome 38 —
webOS 3.0). The pages load `dist/`, never `js/`.

```bash
npm ci
npm run build      # babel js --out-dir dist/js, preserving the folder layout
```

### Layout

| Path | What lives there |
| --- | --- |
| `assets/boot.js` | Blocking, in every page's `<head>`. Detects the TV's video pipeline and applies the interface scale *before first paint* — both are wrong if they happen a frame late. Not part of the Babel build. |
| `js/polyfills.js` | Feature-detected shims for webOS 3/4/5 (fetch, AbortController, `Array.from`, `Element.closest`, …). Loads first on every page. |
| `js/core/` | `store` (all localStorage), `net` (all HTTP), `dom` (elements, focus ring, key codes), `config` (profiles + every Xtream URL). |
| `js/data/` | Provider clients and data shaping: `xtream`, `m3u`, `subtitles`, `favourites`. |
| `js/player/` | `codecs` (naming + error text), `preferences` (which engine to try first), `engine` (the tiered `IPTVPlayer`). |
| `js/livetv/` | `state`, `epg`, `channels`, `sidebar`, `pip`, `multiview`. |
| `js/app.js` | Live TV startup and boot. Other pages have one file each: `vod`, `catchup`, `settings`, `home`. |

Script order in each page is a dependency chain, not a preference — the
comments in the HTML say which.

### Notes for webOS

- **Never use the native Fullscreen API.** webOS 5.40 mis-renders it, and
  Chromium's `:fullscreen` UA style forces `transform: none`, which rebuilds the
  video's compositing layer mid-play and resets the TV's decoder. Fullscreen is
  a CSS overlay that changes position and size only.
- **On Chromium ≤ 68 the video is a hardware overlay plane**, not composited
  content. It cannot be rounded, clipped, or pulled into an ancestor's layer —
  do any of those and it silently shows nothing while the audio plays.
  `assets/boot.js` stamps `html.plat-video-plane` for this; see the video-plane
  block in `assets/player.css`.
- **There is no console on a retail TV.** Anything worth debugging is reported
  in Settings → Diagnostics instead.

## Repository
https://github.com/sharktie/lg-iptv

## Community / Support
Discord: https://discord.gg/2UmPGtWcMX
