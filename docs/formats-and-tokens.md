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

The **same request without the account's bearer token** comes back with the ordinary ladder:
indexed, unencrypted, server-side ABR offered. Reproduced many times, same video, same
second, request body and headers otherwise identical.

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

## Why we cannot simply stop signing in

Stripping the bearer token from the page's own player calls does produce the good ladder,
and it is how every enhanced-player measurement in this repository was taken. It also makes
the app believe nobody is signed in: it reaches guest mode and an account-picker loop with
no way out. It is off by default. Build with `TUBE_ANON_PLAYER=1` to measure with it on.

Every "anonymous" request tested so far was issued from the page and therefore carried the
page's cookies — signed-in cookies with no bearer, an inconsistent state that invites a bot
check. **A request made by the service, with no cookies at all, is a different thing and has
never been evaluated.** That is the first thing to try.

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

## Codecs, for this panel

Measured on a QE65S93DATXXN, Tizen 9:

| Format | Result |
|---|---|
| VP9 8-bit 2160p60 (`315`, `558`) | zero dropped frames |
| VP9 Profile 2 HDR 2160p60 (`337`) | zero dropped frames |
| AV1 8-bit 2160p60 (`401`) | clean once settled |
| AV1 10-bit 2160p60 (`701`) | stalls for seconds, drops throughout |

At 2160p60 the MP4 ladder offers only AV1, and above 30fps only ten-bit on many videos —
which is why WebM is read for its cue index alongside MP4's `sidx`. VP9 exists nowhere else.

The picker takes the tallest, then the fastest, then the wider colour where the video is
graded for it, and refuses ten-bit AV1 above thirty frames a second unless nothing else will
do.

## Reading the numbers

`playbackStats` derives its counts when the renderer reports none: `dropped = lost × fps`.
A stall therefore prints as hundreds of dropped frames. A drop count also says nothing about
how the picture *looks* — a stream can hold zero drops and still artifact badly.

Stats-for-nerds reports the codecs, colour and protection of what the *player* selected,
which stops being what reaches the decoder the moment we take over. Those rows are rewritten
to the truth; without that, every measurement read off the panel has to be thrown away.
