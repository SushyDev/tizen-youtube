# YouTube for Tizen

Ad-free YouTube on a Samsung TV.

<img src="../app/icon.png" width="96" align="right">

- Adverts and sponsor segments gone, on the TV's own YouTube client
- Its own app; the stock YouTube app is left alone
- Tizen 6.5 and up, on sets with Samsung's Cobalt container
- Updates over the air, digest-verified, with the shipped copy as the floor

**Discord**: https://discord.gg/WjxVnrsV4A

---

## Why this one

Recent Samsung TVs already carry Cobalt, the engine YouTube built for televisions: it is what the
stock YouTube app runs in, tuned by Samsung and YouTube for each model. This app runs inside that
same engine, not the TV's web browser. So what you watch is the stock app's own playback, with the
4K, HDR and smooth 60fps your set was made for, and none of the adverts.

The mods are built the same way. Wherever they can, they change what YouTube is told rather than
painting over it, and leave the drawing to YouTube itself. The start page opens the way a YouTube
link would, scroll speed is YouTube's own animation run faster, quality is set per video through
the player's own controls, and every setting is a real row in YouTube's own Settings.

| | This app | [TizenTube](https://github.com/reisxd/TizenTube) | [TizenTube Cobalt](https://github.com/reisxd/TizenTubeCobalt) |
| --- | --- | --- | --- |
| Runs on | Samsung TVs, Tizen 6.5+ | Samsung TVs, Tizen 3+ | Android TV, Google TV, Fire TV |
| Engine | Samsung's own Cobalt, same as stock YouTube | The TV's browser | Its own rebuild of Cobalt, not the official one |
| Updates | Mods over the air, digest-verified | Mods pulled from a public CDN at launch, unchecked; if it's unreachable, the ads are back | App updates itself; mods pulled from the same CDN at launch, unchecked |
| Settings | Real rows in YouTube's own Settings | A separate pop-up menu, behind one Settings entry or the green button | A separate pop-up menu, behind one Settings entry or the green button |
| Ad blocking | ✓ | ✓ | ✓ |
| SponsorBlock bar | Drawn onto YouTube's own chapters, fading with the controls | A fixed-width strip, misaligned on chaptered videos, popping in and out | A fixed-width strip, misaligned on chaptered videos, popping in and out |
| DeArrow | Titles and thumbnails swapped in as the feed arrives | Broken: a bug makes it skip every tile | Broken: a bug makes it skip every tile |
| Preferred quality | Set before each video streams; nearest at or below your pick; previews left alone | Switched after the video starts, so the picture jumps or re-buffers; previews forced up too | Switched after the video starts, so the picture jumps or re-buffers; previews forced up too |
| Start page | Opens first, and after an account switch | Home loads, then it jumps; with none set, Home reloads every launch | Home loads, then it jumps; with none set, Home reloads every launch |
| Who's watching | Hidden, and answered for you if it shows anyway | Only pushes its timer back; no fallback when it shows | Only pushes its timer back; no fallback when it shows |
| Scroll speed | Up to 3× | Stuck at stock speed | Stuck at stock speed |
| Rapid press | Presses kept | Presses dropped while the feed moves | Presses dropped while the feed moves |
| Smoother navigation | ✓ | ✗ | ✗ |
| Hide the Up next card | ✓ | ✗ | ✗ |
| Hide the shopping card | ✓ | ✗ | ✗ |

---

## Install

### Tizen Homebrew

The easy one. No computer needed after setup, even for updates.

1. Set up [Tizen Homebrew](https://github.com/SushyDev/tizen-homebrew) once, by its README.
2. Open it on the TV.
3. Pick this app out of the catalogue.

### Apps2Samsung, with a partner certificate

Apps2Samsung also works, signed with your own Samsung partner certificate.
Please join the Discord linked above if you need help.

### Building it yourself

For the Homebrew route, if you would rather not use the catalogue, with **Node 20+**:

```sh
git clone https://github.com/SushyDev/tizen-youtube.git
cd tizen-youtube
npm install
npm run package    # release/tube.wgt, for Tizen Homebrew
```

Load `release/tube.wgt` through Homebrew's **Upload** tab; [DEVELOP.md](DEVELOP.md) has the other commands.

---

Licensed GPL-3.0-only. Derived from
[TizenTube](https://github.com/reisxd/TizenTube) and
[youtube-webos](https://github.com/webosbrew/youtube-webos), and from the people
who worked out what a Samsung TV will and will not allow.
