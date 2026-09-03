# Getting media this app can serve

The enhanced player replaces YouTube's MediaSource pipeline with a DASH stream served from
localhost, because the same media through MediaSource drops frames at 2160p60 on this
hardware and from a plain URL drops none. That only works if YouTube gives us media we can
describe and serve. Increasingly it does not, and this is what has been measured about why.

## What YouTube answers with

A **signed-in** TVHTML5 request is answered with an encrypted, index-less ladder — Widevine
and PlayReady, every format `FORMAT_STREAM_TYPE_OTF`, transcoded as it is served. Nothing
here can serve that twice over: there is no `sidx` to write a manifest from, and a video
element fed a plain URL cannot decrypt it.

The **same request without the account's bearer token** also comes back with the ordinary
ladder. That was the first thing found and it is a red herring — removing `deviceMake`
reaches the same ladder without costing the account, which is what this app does.

```
signed   → 19–33 formats, all OTF, all DRM
unsigned → 32–58 formats, none OTF, none DRM, abr offered
```

This is not our device or our account being unusual. It is [an experiment YouTube has been
running since 2025](https://github.com/yt-dlp/yt-dlp/issues/12563) that applies DRM to all
videos on the `tv` client, confirmed by others across PS3, Apple TV and youtube.com/tv.

Stock YouTube plays these same streams, and shows the same artifacting on panning shots,
because a single-pass live transcode cannot allocate bits the way the offline encode does.
Matching stock is therefore not the goal — beating it is, and we have: the enhanced player
has run 2160p60 VP9 with zero dropped frames, and put the panel into genuine HDR on a video
where stock would not.

## Why not to stop signing in

Stripping the bearer token also produces the good ladder, and much of this file was written
while doing it. **Do not.** It makes the app believe nobody is signed in: it reaches guest
mode and an account-picker loop with no way out, and the account has to be signed in again
to recover. `TUBE_ANON_PLAYER=1` still builds it that way, for measurement only.

Removing `deviceMake` gets the same ladder with the account intact, so there is no reason
to touch authentication at all.

## PO tokens

Media fetched from the good ladder is refused `403` without a Google Video Server proof-of-
origin token. One can be minted here, and this works:

1. `POST /youtubei/v1/att/get` with `engagementType: "ENGAGEMENT_TYPE_UNBOUND"`. The answer's
   `bgChallenge` carries a `program` and a `globalName` — `trayride`, which the page has
   already loaded, so no interpreter needs fetching.
2. `trayride.a(program, cb, true, undefined, function () {}, [[], []])`. The callback is
   handed a snapshot function.
3. Call it as `snapshot(resolve, [undefined, undefined, signalArray, false])`. It returns a
   ~1.1KB attestation response.
4. `POST https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT` with
   `content-type: application/json+protobuf`, `x-goog-api-key: AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw`,
   `x-user-agent: grpc-web-javascript/0.1`, body `["O43z0dpjhgX20SCx4KAo", response]`.

The answer is `[null, 43200, null, "<102 characters>"]`. **The token is at index 3**, and it
lives twelve hours. It is the same length and shape as the `pot=` on the page's own working
media URLs.

It does not satisfy the player call. This page's BotGuard is the attestation-only flavour:
its callback receives one function of arity one, where the web-PO flow expects four and a
signal array populated during the snapshot. No content-bound token can be minted from it as
things stand.

## Dead ends, measured

| Route | Result |
|---|---|
| `android_vr`, `ios` | `LOGIN_REQUIRED` — bot-gated |
| `web_embedded` | `ERROR` — video unavailable |
| `tv_simply` | `ERROR` — "YouTube is no longer supported" |
| Fresh visitor id | No change; not visitor-scoped |
| Page's PO token on our URLs | `403`, in the query and in the request body |
| `n` removed, `sabr` removed, every header combination | `403` |

yt-dlp's guidance that `tv` and `android_vr` need no GVS token is stale for 2026.

## What the enrolment is actually keyed to

Measured directly, on one television, within minutes of each other:

| Varied | Result |
|---|---|
| **A second Google account**, same TV, same IP, same build | **ordinary ladder** — the enhanced player worked immediately |
| Client version — asked as a year-old `7.20250901.15.00`, bearer intact | encrypted ladder, unchanged |
| Fresh `visitorData` | no change |
| The same account on a phone or a desktop browser | ordinary quality |

So it is **the account, on the `tv` client**. Not the device, not the address, not the
client version, and not anything this app does. The same account is served properly
everywhere else in the same minute.

That also means there is nothing to escape by randomising identifiers. Churning device or
visitor identity does not change who is asking, and it is the single strongest way to
attract the bot check — an evening of it got every path on this address answered
`LOGIN_REQUIRED`.

## Why no PO token can be minted for this client

The attestation flow works: challenge, snapshot, `GenerateIT`, a real 102-character token.
But the token is session-bound and does not satisfy a player call.

Minting a **content-bound** token needs `webPoSignalOutput` — an array BotGuard populates
during the snapshot with a minter function, which is then called with the video id. On this
device it stays empty. Checked thoroughly:

- called with BgUtils' full nine-argument form, taking `?.[0]` from the return value
- with a **fresh interpreter** fetched from the challenge's own `interpreterUrl` and run in
  its own iframe, rather than the `trayride` the page had already loaded

Both give a callback receiving **one** function where BgUtils expects four, and an empty
signal array. The program the `tv` client is served simply has no web-PO minter in it —
consistent with yt-dlp's guide, which lists the `tv` client as requiring no PO token because
it authenticates with cookies instead.

`mweb` is bot-gated even on an account that gets the ordinary ladder, so the other clients
are not a way round this either.

## Rate limiting is real, and it lasts

After an evening of automated anonymous player requests, *every* anonymous path returned
`LOGIN_REQUIRED, "Sign in to confirm you're not a bot"` — including ones that had worked an
hour earlier, and including a cookieless request from a different machine on the same public
IP. Probing deepens it.

**Do not conclude a path is closed while the address is flagged.** Leave it and retest.

## Seeking, and the measurements it ruined

A stream that begins partway through re-sends the file's header, which is already on disk
and has to be skipped or every segment after it lands at the wrong offset. Recognising it
read MP4 boxes **whatever the container was**. Given WebM, it took the EBML signature for a
box length, found no boxes, and returned — so a seek into a WebM stream downloaded for ever
and never cut a single segment.

Every part-watched video on VP9 was silently broken this way: it would open, seek, and sit
on a still frame. And because AV1 is MP4 and VP9 is WebM, any comparison between the two on
a resumed video was really a comparison between working and broken seeking. Three
conclusions rested on that and all three were wrong:

- that ten-bit AV1 stalls at 2160p60 and drops throughout — it holds zero dropped frames
- that VP9 profile 2 was the better HDR format — the A/B was never about codecs
- that HDR could not be triggered through this pipeline at all

The second half of a resume is that the player asks for one segment at a time, so moving the
picture says nothing about the sound. The other track has to be brought to the same moment
or it grinds forward from the start while the player waits for audio it will not have for
minutes.

## HDR

**AV1 is what puts this panel into HDR.** VP9 profile 2 decodes perfectly and the set stays
in standard range; ten-bit AV1 with BT.2020 and the PQ curve switches it. The manifest has
to say so as well — colour stated as CICP code points, and only when it is not ordinary
video, because saying BT.709 changes nothing.

Do not gate this on `(video-dynamic-range: high)`. That reports the mode the display is in
at that moment, not what it can do, and it is only in standard because nothing has asked it
to change — so gating on it never asks, and it never switches.

The set's own YouTube app cannot do HDR here at all, because the encrypted ladder it is
served contains no HDR encodes: `558:2160:BT709` and `557:1440:BT709`, nothing else.

## Codecs, for this panel

Measured on a QE65S93DATXXN, Tizen 9:

| Format | Result |
|---|---|
| VP9 8-bit 2160p60 (`315`, `558`) | zero dropped frames |
| VP9 Profile 2 HDR 2160p60 (`337`) | zero dropped frames, but the panel stays SDR |
| AV1 8-bit 2160p60 (`401`) | zero dropped frames |
| AV1 10-bit HDR 2160p60 (`701`) | zero dropped frames, and the panel switches to HDR |

At 2160p60 the MP4 ladder offers only AV1, and on many videos only ten-bit — which is why
WebM is read for its cue index alongside MP4's `sidx`, since VP9 exists nowhere else and is
the only eight-bit picture at that size on some ladders.

The picker takes the tallest, then the fastest, then the wider colour where the video is
graded for it, then eight bits on a tie, then MP4 on a tie. Nothing is refused for its depth.

## Reading the numbers

**Nothing counts frames on the enhanced player, and there is no source we are missing.**

YouTube's own TV player was pulled apart to check. `tv-player-ias-tcl.js` does exactly two
things and then gives up:

```js
G.getVideoPlaybackQuality = function () {
    if (window.HTMLVideoElement && this.D instanceof window.HTMLVideoElement
        && this.D.getVideoPlaybackQuality) return this.D.getVideoPlaybackQuality();
    if (this.D) {
        var v = this.D, q = v.webkitDroppedFrameCount;
        if (v = v.webkitDecodedFrameCount) return { droppedVideoFrames: q || 0, totalVideoFrames: v };
    }
    return {};
};
```

and the panel row is built from it directly:

```js
l = "-";
J.totalVideoFrames && (l = (J.droppedVideoFrames || 0) + " dropped of " + J.totalVideoFrames);
```

Measured on the set while the enhanced player was playing: `getVideoPlaybackQuality()` gives
`{total: 0, dropped: 0, corrupted: 0}`, `webkitDecodedFrameCount` and
`webkitDroppedFrameCount` are `0`, `webkitVideoDecodedByteCount` is `0`, and
`requestVideoFrameCallback` exists but never fires — zero callbacks in five seconds of
playing video. Stock YouTube would print a dash here for the same reason we do: the media
never passes through the web engine's decoder, so the web engine has nothing to count.

### Why nothing can count on the enhanced path

Every instrument was tried, on the set, while a 2160p60 stream played from our own address:

| Asked | Answer |
|---|---|
| `getVideoPlaybackQuality()` | `{total: 0, dropped: 0, corrupted: 0}` |
| `webkitDecodedFrameCount` / `webkitDroppedFrameCount` | `0` |
| `webkitVideoDecodedByteCount` | `0` |
| `requestVideoFrameCallback` | exists, fires zero times in five seconds |
| canvas `drawImage` + `getImageData` | readable with `crossOrigin`, and every pixel black |
| `captureStream()` | **hangs the page**; readings stop and only a restart recovers it |
| `webapis` | one key, the ad framework — `$WEBAPIS/…/webapis.js` cannot resolve from an http origin |
| every vendor-prefixed member of the element | nothing but the two zeroed counters above |
| `use.game.mode` | counts for real, and stops the platform playing a URL at all |

They all fail for one reason. On this path the picture never enters the web engine: the
platform decodes to a hardware overlay and scans it out to the panel. There are no frames
in the engine to count, no pixels for a canvas to read, and no callback to fire.

The canvas is the proof, and it took two attempts to read correctly. Against the enhanced
player it is first refused as cross-origin data — on a stream served from
`http://localhost:8099` to a page on `http://localhost:8099`, which is not how CORS works
and should have been the clue. Asking for it with `crossOrigin="anonymous"` clears the
refusal: the canvas can be read. It comes back black. A probe playing the same stream,
decoding, at 5.15 seconds, sampled two hundred and thirty-five times across four seconds:
every pixel zero, not one frame different from the last.

So it is not permission and never was. The frames are not in the engine to be read — the
picture goes decoder, hardware overlay, panel, and the compositor never hands it to the
page. Which is the same reason it is smooth, and the same reason nothing counts it. The
same probe against the *default* player, where MediaSource makes the engine do the
decoding, captures happily at 60.2 Hz.

So on the enhanced path there is no count to be had from inside the page, and the honest
instruments are the media clock — which cannot see a dropped frame, since the clock does not
stop for one — and a person watching. That is not a gap to be closed by trying harder; it
is what the hardware path costs.

### Game mode counts, and turns the enhanced player off

`use.game.mode="true"` in config.xml does make the renderer count, and the counts are real:
sixty frames a second decoded, drops that arrive in bursts, all of it moving on its own.

It also stops the platform playing a URL. Handed our manifest the element takes the `src`
and then does nothing at all: `readyState 0`, `networkState 0` — *empty*, not "no source"
and not an error — so nothing ever loads and nothing ever fails. After twenty-five seconds
of being asked again the page gives up and plays the video its own way.

Three cold starts each way, same code, same video, minutes apart:

| Package | Pipeline it reached | Frames counted |
|---|---|---|
| with `use.game.mode` | default, all three times | real |
| without it | enhanced, all three times | none |

So the two cannot be had together. The key is not in config.xml, and a package built with
it is for measuring, never for watching:

```
TUBE_GAME_MODE=1 npm run package -- --unsigned
```

which adds the key to the staged copy only, so the file in the repository stays the file
that ships.

### What the measuring build was able to prove

Four minutes of 2160p60 through the player's own MediaSource pipeline, with the renderer
counting for real:

```
590 dropped of 14386 decoded    4.10% dropped, 60.23 fps
66 of 195 seconds lost none     worst second lost 38 frames
media clock lost nothing        240.00s advanced over 238.8s of wall time
```

Two things follow, and they matter more than the percentage.

The first is that **the premise this whole app rests on is now measured rather than
inferred**: MediaSource really does drop frames at 2160p60 on this hardware, four per
hundred, in bursts, continuously.

The second is that **lost time is not a frame count and must never be shown as one**. Over
those same four minutes the time-based figure read `0.000s`. It was not wrong — the clock
genuinely kept perfect time — it simply cannot see this. A dropped frame is one the decoder
never presents; the clock does not stop for it, and no arithmetic over the clock will find
it. So what the panel says is time, in the units it was measured in, and the frames row is
left saying whatever the renderer knows, which here is nothing.

### How the numbers used to mislead

`playbackStats` used to answer `getVideoPlaybackQuality` itself, deriving `dropped = lost ×
fps`. Two mistakes were made getting there and both looked convincing:

- charging each 250 ms sample's shortfall as it happened. Sampling jitter is zero-mean, so
  summing the shortfalls of a signal whose total shortfall is zero gave a large positive
  number — 0.694s over thirty seconds of playback where the media clock kept up *exactly*.
  The deficit of the totals is the honest measure, and it cancels.
- reporting it cumulatively. A startup stall then haunts the whole video: six hundred
  "dropped frames" displayed for four minutes while nothing at all was being lost.

A viewer watching a clean picture while a number climbs is right to stop believing the
number, and did. Nothing is substituted now.

The buffer figure came from `getStatsForNerds`, which is the *player's* buffer — a buffer
nothing plays from once this app feeds the element. It read `0.00 s` for half a minute
while the video played on. It comes from the element now. The codecs and colour rows had
the same fault and are corrected from what is actually being served: left alone the panel
said `opus (251)` through four minutes of AAC.

## Startup

About **3.8 seconds** to the first frame at 2160p60 HDR, measured end to end: the request
goes out, first bytes arrive in ~50 ms, and video segment one — roughly eighteen megabytes,
five seconds of a 26–30 Mbit/s stream — lands 3.8 s later at about 38 Mbit/s.

The download is not slow; the segment is big. Serving it progressively as it arrives would
buy almost nothing, because the wait is the download and not the local read. The set's own
app appears faster because it starts on a low rung and climbs, where this commits to the
top rung immediately. Closing that gap means offering more than one representation and
letting the platform adapt, which is a real feature rather than a tuning change.

## Three ways to describe the same stream

The same segments, described three ways, all handed over as a plain URL and all played by
the set's own pipeline rather than through MediaSource. Judged on the television:

| | Startup, cold | Watching it | Seeking |
|---|---|---|---|
| DASH | 7.1 s | **judders** | ~20 s, recovers |
| HLS | **0.8 s** warm | judders, dropping frames | untested |
| Plain file | 9.0 s | **smooth and judder free** | exact, instant |

All three serve byte-identical segments, so the difference is entirely in what the set does
with the description. Judged by eye on the judder test, the plain file is the only one of
the three that plays it cleanly — which is the whole reason it exists.

HLS commits far faster — a VOD playlist can be read end to end, where an MPD leaves the set
working out what it has — and it presents worse.

The plain file has no description at all: no manifest, no playlist, nothing for the set to
parse and decide about. It is handed bytes and plays them, and it is the only one of the
three that plays the judder test cleanly. Its cost is about two seconds more to start,
because the muxer must have both tracks' initialisation segments *and* the first fragments,
in order, before a byte goes out, where a manifest lets the set fetch them in parallel.

### What the plain file can and cannot carry

Measured by bisection, opening the same videos at different rungs:

```
plays:  63MB · 205MB · 221MB · 385MB · 553MB
fails:  684MB · 971MB · 1135MB
```

Over roughly six hundred megabytes the set asks for the first chunk, the service delivers
it, and the element consumes nothing and reports nothing — no error, no retry, no picture.
Fragment size is not what decides it: one file plays with 9.0MB fragments and another fails
with 9.6MB and three times the total. Neither is HDR: an HDR video plays as a plain file at
1080p and at 1440p, and fails at 2160p, where the same video is 926MB.

Retested after the file was made to read in time order, the chunking removed and the
pre-seek corrected — all of which were candidates for it. It is none of them: a
nine-hundred-megabyte file still asks for itself over and over and never plays. The limit
is the set's, and it stands.

That is what keeps 2160p60 HDR off the smooth path, since those are the largest files there
are. The same video at 1440p is 553MB and plays as a plain file; at 2160p it is 926MB and
does not.

So the page works the size out from the `contentLength` the player response already carries
and asks for a manifest instead when a plain file would be too large. It has to be decided
there: the element asks for an address the moment the response lands, before the service has
been told anything, and answering the address with a redirect to the manifest does not work
— the set commits to reading an MP4 from the address it was given and will not take a
manifest in its place.

Two things about HLS confuse a measurement taken on it. It reports the whole remaining
playlist as buffered — two hundred seconds at the start of a five-minute video — so the
buffer figure is not comparable with DASH's. And `video.buffered` on the DASH path is not
trustworthy either: it read dry, and negative, through forty seconds a viewer called
perfectly smooth. Neither figure survives contact with what is actually on screen.

## Two ways the enhanced player was being lost

Both were found while trying to measure it, and both made it fall back silently — which
looks from the sofa like the app simply not working as well as it did yesterday.

**A cold start took the encrypted ladder.** Opening a video as the first thing a session
does takes the streams embedded in the watch-next payload, which are the encrypted set on
every video. Removing them is what sends the app back to the player endpoint, where the
ordinary ladder is — but that removal was guarded by having already served something, a
condition a cold start cannot meet. So the first video of every session played through the
default player, and the enhanced one only ever appeared after something else had already
worked. Measured: hash-routed straight to a watch page, `21 otf, drm formats`, default
player, buffer at zero and a hundred and fifty frames dropped in twenty seconds. It is a
budget of two asks per video now, so the first video gets the same chance as the second.

**The resume position was told to the element and not to the service.** A part-watched
video is handed `manifest.mpd#t=180`, and a fragment is the one part of a URL a server
never sees. The download therefore ran from the beginning while the element asked for a
segment three minutes in; serving that means abandoning the download and starting another
one there, which at 2160p60 is an eighteen-megabyte segment and was measured at ten seconds
from the ask to the bytes. The television's player gives up well before then — it went to
`readyState 4` on a buffer that ended at 47s with the clock parked at 180, and stayed there.
The position is sent with the open request now, so the restart is already under way while
the element is still fetching the manifest.

Seeking during playback still costs about twenty seconds to settle at 2160p60, for the same
reason: one segment is large and the stream has to be restarted to reach it. It recovers
rather than wedging, which it did not before, but it is not yet good.

## What a release build does not carry

Everything written for reading it back is development tooling, and none of it belongs on a
television somebody is watching. It was all shipping: the bridge polling the service five
times a second and pushing a reading every second, a port open on every interface that
evaluates whatever is posted to it, a probe reading apart every player request and every
response naming formats, and a line built once per video naming the bearer token and every
cookie the request carried.

`TUBE_DEV=1` bakes a constant into the userscript and everything hangs off that rather than
off a setting, so a minifier drops it rather than skipping it:

```
with the tooling    118.7 kB
without it           98.9 kB     no reference left to any dev endpoint
```

So there is nothing to fork. The same commit builds either, and the one to hand somebody is
the one built without the flag:

```
npm run package -- --unsigned          for a tester, through Tizen Homebrew
TUBE_DEV=1 npm run package -- --unsigned   to keep the bridge and drive it from .dev/
```

Checked by grepping the built bundle for `__tube/dev/commands`, `__tube/dev/report`,
`__tube/dev/log`, `playerProbe` and the debug token: none of them appear in a build made
without the flag.

The service half follows: its journal is written only while the bridge is open, and the
bridge opens only when the page asks for it — which a build without the tooling never does,
so the port stays closed and the journal stays empty.

Two things follow for anyone debugging. A release build cannot be driven from `.dev/`, so
build one with `TUBE_DEV=1 npm run package -- --unsigned` when you need to. And a release
build cannot be inspected from another machine at all: its loopback is inside the app
sandbox, and Tizen Homebrew's own service — which can be evaluated in remotely — cannot
reach it either. What it can answer is whether the app and the service are running, which
is `tizen.application.getAppsContext` filtered to the package id.

## Starting up

The shell that opens is not YouTube: it is a page that waits for the service and then goes
somewhere. Where it goes decides what the whole app costs afterwards.

**The proxy path** navigates the same app instance to `localhost:8099/tv`, where the HTML is
rewritten to carry the userscript. One navigation, no restart. The cost is that the proxy
stands between the page and youtube.com for everything that is not media — media never
touches it, since the service fetches googlevideo directly and serves `/dash/` locally.

**The debugger path** relaunches the app in debug mode and attaches to it, so the page is a
real `https://www.youtube.com` with no proxy in the request path at all. Relaunching means
the open window has to close first, which is why the shell calls `application.exit()`. That
exit is the restart, and it is paid *before* anything is known — the window must be gone for
the relaunch to replace it, so a set where attaching does not work pays the whole cost and
lands on the proxy anyway.

Which is this one: it reports a reachable daemon, exits, never attaches, and comes back on
the proxy. So the debugger is not offered, and a launch is one navigation. `OFFER_DEBUGGER`
in the service turns it back on for developing against a real origin.

## The video is fetched twice

Measured from the page, which records every request it makes, while the enhanced player
played a sixty-three megabyte video from this app's own address:

```
proxy → elsewhere    12 requests   20.7 s   53.09 MB    videoplayback
proxy → youtube      20 requests   22.4 s    0.37 MB    innertube
service → ours      119 requests   15.6 s    0.04 MB    the diagnostics bridge
```

Those fifty-three megabytes are the same video, fetched by the page's own player, into a
source buffer that discards everything appended to it. With the sixty-three the service
fetched to serve it, a sixty-three megabyte video moved about a hundred and sixteen — and
the half nobody would ever see was competing for the line with the half on screen. That is
the likeliest reason the buffer runs thin on the videos that show frame drops.

It is not simply waste to be switched off. A player that has appended nothing decides its
pipeline has died and reloads the whole video every fifteen seconds, so it has to keep
receiving something. Two ways of making what it receives cheaper have been tried:

- **Truncating the media response.** Passing on the first sixty-four kilobytes and dropping
  the rest wedged the page: playback continued, because the picture comes from the platform
  and not from page script, but the script thread stopped answering entirely and only a
  reload recovered it. A SABR response is a framed protocol and a cut-off one is not
  something its reader survives.
- **Reporting a healthy buffer instead of the element's.** Recorded earlier in this file:
  the player does stop fetching, and then reloads every fifteen seconds for the reason
  above.

What has not been tried is making the page's own player fetch a *small* rung — it keeps
appending, so the watchdog stays quiet, and 144p against 2160p is some forty times less to
throw away. Nothing in what this app serves depends on that choice: the picture is picked
by height and the sound by the tags the page asks for, and neither reads the player's own
selection. What it would cost is the quality menu, which shows what the player selected and
would then show the wrong thing.

## What order the fragments go in

A muxed file is read from its beginning, so what is written where is what the decoder gets
when. YouTube's audio fragments here are longer than its video ones — ten seconds against
six — and the two boundaries do not line up.

Writing each video segment's audio in front of it seems right: a reader that has got that
far then has both. It is not. An audio fragment that merely *begins* inside a video
segment's span can cover the whole of the next one, and where it begins near the end of
that span the reader is handed ten seconds of sound it has no picture for. On the judder
test the audio beginning at 39.94 was written ahead of the picture covering 34.03 to 40.04
— a tenth of a second before it ends, the largest such jump in the file:

```
v2 ends 11.01, audio at  9.98    1.03 s ahead
v4 ends 22.02, audio at 19.97    2.05 s ahead
v6 ends 34.03, audio at 29.95    4.08 s ahead
v7 ends 40.04, audio at 39.94    0.10 s ahead   ← the hiccup, at 34.03
```

A viewer saw a hiccup at exactly 34, on every pass, while the media clock lost nothing at
all. Frames rather than a stall — which is the one thing no instrument on this hardware can
see, and why it took an eye to find and arithmetic to explain.

Written in the order the moments happen, it reads as it plays. Sound still goes first where
the two begin together, which is where it is wanted.

## The picture and the count cannot be had together

Feeding a MediaSource from this app was the last idea left for counting frames. It works —
the engine decodes, so every counter reports — and what it reports settles the question.

```
YouTube's own MediaSource     590 dropped of 14386     4.10%
this app feeding one itself    27 dropped of   664     4.07%
```

The same, within noise. Whole segments appended into a twenty-second buffer, no format
change, no adaptive logic, no eviction ahead of the player — none of it mattered. So the
four per cent was never YouTube's handling of MediaSource. It is the engine's decode path,
and there is nothing to tune out of it.

Which makes the trade a fixed one rather than a bug still to be found:

| | Picture | Frames counted |
|---|---|---|
| a URL, played by the platform | smooth | never — they are not in the engine |
| MediaSource, whoever feeds it | ~4% dropped | exactly |

Both halves have one cause. The platform decodes a URL to a hardware overlay and scans it
to the panel, which is why it is smooth and why nothing in the page can see it. Ask the
engine to decode instead and every counter works, because now the frames are its own — and
it drops one in twenty-five.

So a counter reading zero on the enhanced player is not a gap in the instruments. It is the
signature of the frames going where they should. The honest reading of that line is
"nothing here is counting, and that is why it looks like that" — and the only instrument
left for the smooth path is a person watching it.

Getting the count at all needed two things that had never been put together: `use.game.mode`
makes the renderer count and stops the platform playing a *URL* — and a MediaSource is not
a URL. Available as Playback › Stream description › "Fed by the app", in a build made with
`TUBE_GAME_MODE=1`. For measuring. Not for watching.

### And the platform does not report it either

The page cannot see the frames, but the platform might have been able to. It is worth
saying that this was searched properly rather than assumed.

`webapis` is empty on the proxy origin because `$WEBAPIS` is a path the webview resolves
internally — there is no file on disk to serve, so it cannot be proxied in. The app's own
boot page runs on the app origin, where it does resolve, and there the platform offers
**forty-seven modules**: `adinfo, airplay, aisound, allshare, appcommon, audiocapture,
avinfo, avplay, avplaystore, billing, bixby, broadcast, …`.

Every member of every one of them, prototype chains included, was matched against
`frame|drop|render|decod|statistic|perf`. Two hits:

```
systeminfo.ndecoder      names a decoder
unipicture.useSWDecoder  turns software decoding on
```

Neither counts anything. `avplay` reports on its own playback and nothing else, and it is
not what plays here.

So there is no instrument, at any level of this television, that will say how many frames a
natively-played URL dropped. The clock and the buffer are what can be measured, and neither
can see a dropped frame; the only thing that can is a person watching.

