// Served by the service this page came from, so it opens on every widget; #launcher keeps auto-launch from leaving again.
const launcherUrl = (location) => `/tube/boot.html${location.search || ''}#launcher`;

const openLauncher = () => window.location.replace(launcherUrl(window.location));

export { launcherUrl, openLauncher };
