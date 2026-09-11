# YouTube for Tizen

Ad-free YouTube on a Samsung TV, as an app of its own.

<img src="../app/icon.png" width="96" align="right">

- Adverts and sponsor segments gone, on the TV's own YouTube client
- Its own app; the stock YouTube app is left alone
- Tizen 6.5 and up, on sets with Samsung's Cobalt container — a Smart Monitor has none
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
