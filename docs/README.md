# YouTube for Tizen

Ad-free YouTube on a Samsung TV, as an app of its own.

<img src="../icon.png" width="96" align="right">

Modded Cobalt Youtube app on Tizen OS.

- Adverts and sponsor segments gone, on the TV's own YouTube client
- Its own app; the stock YouTube app is left alone
- Tizen 6.5 and up — one bundle, no polyfills
- Updates over the air, digest-verified, with the shipped copy as the floor

**Discord**: https://discord.gg/WjxVnrsV4A

---

## Install

### Tizen Homebrew

The easy one. No computer needed after setup, even for updates.

1. Set up [Tizen Homebrew](https://github.com/SushyDev/tizen-homebrew) once, by its README.
2. Open it on the TV.
3. Pick this app out of the catalogue.

### Apps2Samsung, with a partner certificate

Apps2Samsung is supported, you will need to use the partner certificate.
Please join the discord linked above if you need help

### Building it yourself

For the Homebrew route, if you would rather not use the catalogue:

```sh
npm run package    # release/tube.wgt, for Tizen Homebrew
```

---

Licensed GPL-3.0-only. Derived from
[TizenTube](https://github.com/reisxd/TizenTube) and
[youtube-webos](https://github.com/webosbrew/youtube-webos), and from the people
who worked out what a Samsung TV will and will not allow.
