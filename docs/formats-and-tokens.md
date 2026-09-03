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

**Nothing counts frames on the enhanced player.** Verified by calling the pristine
`getVideoPlaybackQuality` — taken from a fresh iframe our patch never touched — on a video
playing at 264 seconds: `totalVideoFrames 0, droppedVideoFrames 0`. The platform pipeline
decodes and the browser counts nothing, so every figure in the panel is ours, fed back into
YouTube's own row. `use.game.mode="true"` in config.xml would make the renderer count, and
is deliberately absent because it *causes* dropped frames.

So what is reported is **time the picture was trying to advance and did not**, over the last
thirty seconds. Two mistakes were made getting there and both looked convincing:

- charging each 250 ms sample's shortfall as it happened. Sampling jitter is zero-mean, so
  summing the shortfalls of a signal whose total shortfall is zero gave a large positive
  number — 0.694s over thirty seconds of playback where the media clock kept up *exactly*.
  The deficit of the totals is the honest measure, and it cancels.
- reporting it cumulatively. A startup stall then haunts the whole video: six hundred
  "dropped frames" displayed for four minutes while nothing at all was being lost.

A viewer watching a clean picture while a number climbs is right to stop believing the
number, and did.

The buffer figure came from `getStatsForNerds`, which is the *player's* buffer — a buffer
nothing plays from once this app feeds the element. It read `0.00 s` for half a minute
while the video played on. It comes from the element now.

## Startup

About **3.8 seconds** to the first frame at 2160p60 HDR, measured end to end: the request
goes out, first bytes arrive in ~50 ms, and video segment one — roughly eighteen megabytes,
five seconds of a 26–30 Mbit/s stream — lands 3.8 s later at about 38 Mbit/s.

The download is not slow; the segment is big. Serving it progressively as it arrives would
buy almost nothing, because the wait is the download and not the local read. The set's own
app appears faster because it starts on a low rung and climbs, where this commits to the
top rung immediately. Closing that gap means offering more than one representation and
letting the platform adapt, which is a real feature rather than a tuning change.

## How the numbers used to mislead

`playbackStats` derives its counts when the renderer reports none: `dropped = lost × fps`.
A stall therefore prints as hundreds of dropped frames. A drop count also says nothing about
how the picture *looks* — a stream can hold zero drops and still artifact badly.

Stats-for-nerds reports the codecs, colour and protection of what the *player* selected,
which stops being what reaches the decoder the moment we take over. Those rows are rewritten
to the truth; without that, every measurement read off the panel has to be thrown away.
