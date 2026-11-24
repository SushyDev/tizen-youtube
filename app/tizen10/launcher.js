const player = '__TUBE_PLAYER_ID__';
const port = '__TUBE_LAUNCHER_PORT__';
const status = document.getElementById('status');
const retry = document.getElementById('retry');
const application = tizen.application;
const currentApp = application.getCurrentApplication();
const serviceId = `${currentApp.appInfo.packageId}.TubeService`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = (task, ms) => Promise.race([task, pause(ms).then(() => null)]);
const message = (error) => error.message || error.name || String(error);

// The TV may stop the service when it collects the object returned by the Web Runtime.
let service;

const readAddress = (property) => new Promise((resolve) => {
    try {
        tizen.systeminfo.getPropertyValue(property, ({ ipAddress }) => resolve(ipAddress), () => resolve(null));
    } catch (error) {
        resolve(null);
    }
});

const address = (value) => value && value !== '0.0.0.0'
    && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);

const readiness = async (host) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    try {
        const response = await fetch(`http://${host}:${port}/__tube/launcher`, {
            cache: 'no-store', signal: controller.signal
        });
        return response.ok ? await response.json() : null;
    } catch (error) {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

const waitForPlayer = async (startFailure) => {
    const deadline = Date.now() + 30000;
    let otherPlayer = false;
    do {
        const lan = await Promise.all(['ETHERNET_NETWORK', 'WIFI_NETWORK']
            .map((property) => timeout(readAddress(property), 900)));
        const hosts = [...new Set(lan.filter(address).concat('127.0.0.1'))];
        const answers = (await Promise.all(hosts.map(readiness))).filter(Boolean);
        const ours = answers.find((answer) => answer.player === player);
        if (ours && ours.error) throw new Error(ours.error);
        if (ours && ours.ready) return;
        otherPlayer = answers.some((answer) => answer.player && answer.player !== player);
        await pause(800);
    } while (Date.now() < deadline);

    if (otherPlayer) throw new Error(`Another YouTube for Tizen service is already using port ${port}.`);
    throw new Error(startFailure() || 'The YouTube service did not respond. Check the TV’s network and try again.');
};

const start = async () => {
    retry.hidden = true;
    status.textContent = 'Starting the YouTube service…';
    let failure = '';

    try {
        application.getAppInfo(player);
    } catch (error) {
        throw new Error('Install the YouTube for Tizen player widget first.');
    }

    // start() can resolve while the service is still preparing its files, or remain pending.
    const startService = async () => {
        if (!service) {
            const wrt = await import('wrt:service');
            const Service = wrt.Service || (wrt.default && wrt.default.Service);
            service = new Service(serviceId);
        }
        await service.start();
    };
    startService().catch((error) => { failure = `The YouTube service could not start. ${message(error)}`; });

    await waitForPlayer(() => failure);
    status.textContent = 'Opening YouTube…';
    await new Promise((resolve, reject) => application.launch(player, resolve, reject));
    setTimeout(() => currentApp.exit(), 5000);
};

const launch = () => start().catch((error) => {
    status.textContent = message(error);
    retry.hidden = false;
    retry.focus();
});

retry.addEventListener('click', launch);
launch();
