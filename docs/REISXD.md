**timeline**
- sep 6 17:53: my cobalt branch goes public ([PR #16](<https://github.com/SushyDev/tizen-youtube/pull/16>)), #26/#27 follow at 18:55
- sep 11 11:50: [e63455e](<https://github.com/reisxd/TizenTube/commit/e63455e>) "feat: tizentube cobalt for samsung tvs". one 1300 line commit, no earlier cobalt work in the repo
- sep 11 18:06: i merge to main

you've known about the 1 minute playback cutoff since july ([#555](<https://github.com/reisxd/TizenTube/issues/555>)). then this shows up less than 5 days after my branches went up

**1. 127.0.0.2**
tizen blocks apps from reaching each other on 127.0.0.1 but the rest of 127.x goes through. as far as i can tell that's not documented anywhere, i found it by probing addresses and wrote it up in [c7b5f43](<https://github.com/SushyDev/tizen-youtube/commit/c7b5f43>). their existing service is on 127.0.0.1, the new cobalt proxy listens on 127.0.0.2 and nothing else

**2. onStop**
tizen's docs say the service callbacks are onStart/onRequest/onExit. i export onStart/onRequest/onStop as empty functions ([da3b238](<https://github.com/SushyDev/tizen-youtube/commit/da3b238>)). they export the exact same three in the same order. need to double check what the tv's service_runner.js actually calls, but if it's onExit that's basically a copied typo

**3. cert hash code**
node-forge has no subject hash function so this had to be handwritten. reis's has an `outerSequence` flag that toggles exactly the trap my comment warns about ("there is no outer SEQUENCE"), the helper is also called `hashName`, and the name cleanup is identical down to the character: `.replace(/\s+/g, ' ').trim().toLowerCase()`

Part 2
**4. the cobalt switches**
mine: `--base_url=https://www.youtube.com/tv --proxy=http://127.0.0.2:8099 --content=/home/owner/share/tube/cobalt-content --dial_name=Tube --use_eden`
yours: `--base_url=https://www.youtube.com/tv --proxy=http://127.0.0.2:8101 --content=/home/owner/share/tizentube-content --dial_name=TizenTube --use_eden`
same 5 switches in the same order, and both drop the `--start_frag=#start` that samsung's own youtube app passes

**5. 397 day cert**
local CAs usually get up to 825 days. cobalt refuses anything over 398 because it treats every cert in its store as a public root, which i worked out in [e12d4a0](<https://github.com/SushyDev/tizen-youtube/commit/e12d4a0>). yours is 397 too

all of this was written out in my commit messages, config.xml comments and docs on sep 6. the overlap is exactly the cobalt and cert stuff that was new to them.

you published this work in a single commit message without any evidence of real development, debugging sessions and making break through findings that actually make it work, just a single commit with these fingerprints derived from my works and it all just suddenly works, not to mention you have continously said something like this was possible even up until very recently. very suspicious.
