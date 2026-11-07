'use strict';

// Serialized into the PoC page; use only the supplied window and config, with no module dependencies.
const start = (page, config) => {
    const doc = page.document;
    const api = page.tizen && page.tizen.application;
    const status = doc.getElementById('status');
    const log = doc.getElementById('log');
    const retry = doc.getElementById('retry');
    const kill = doc.getElementById('kill');
    const close = doc.getElementById('exit');
    const diagnose = doc.getElementById('diagnose');
    const serviceOnly = doc.getElementById('service-only');
    const actions = [kill];
    const buttons = [retry, serviceOnly, kill, diagnose, close];
    const state = { generation: 0, busy: false, ready: false, opened: false, timer: null, deadline: null,
        xhr: null, observeHidden: false, expiresAt: 0, killTarget: null, attempts: 0, serviceUntil: 0, kills: 0, serviceStarted: false, serviceReady: false, serviceOnly: false };

    try { log.textContent = page.localStorage.getItem('tube.startPoc.log') || ''; } catch (error) { }
    const say = (text) => {
        log.textContent += `${new Date().toISOString().slice(11, 19)} ${text}\n`;
        log.textContent = log.textContent.slice(-24000);
        log.scrollTop = log.scrollHeight;
        try { page.localStorage.setItem('tube.startPoc.log', log.textContent); } catch (error) { }
    };
    const describe = (error) => `${error && error.name || 'Error'}: ${error && error.message || error}`
        + (error && error.code !== undefined ? ` (code=${error.code})` : '');
    const visible = () => !doc.hidden && doc.visibilityState !== 'hidden';
    const current = (generation) => {
        if (!state.busy || generation !== state.generation) return false;
        if (Date.now() >= state.expiresAt) {
            finish(false, 'FEHLER: 30-s-Zeitfenster abgelaufen; keine weitere Aktion.');
            return false;
        }
        return visible() || state.observeHidden;
    };
    const disarmKill = () => { state.killTarget = null; kill.textContent = 'Blockierenden Cobalt-Kontext bereinigen'; };
    const finish = (ready, text) => {
        state.busy = false;
        state.ready = ready;
        page.clearTimeout(state.timer);
        page.clearTimeout(state.deadline);
        if (state.xhr) state.xhr.abort();
        state.xhr = null;
        retry.disabled = false;
        serviceOnly.disabled = false;
        actions.forEach((button) => { button.disabled = !ready || state.kills >= 1; });
        status.textContent = text;
        say(text);
        if (state.kills >= 1) say('Kill-Budget dieses Benutzeraufrufs verbraucht (1/1); kein weiterer Kill.');
        if (visible() && doc.activeElement && doc.activeElement.disabled) retry.focus();
        // End the hidden launcher after bounded observation, so the next Hub opening is a fresh run.
        if (!visible() && state.observeHidden && state.attempts) {
            say('Hintergrundbeobachtung beendet; Starter schließen.');
            try { api.getCurrentApplication().exit(); } catch (error) { say(describe(error)); }
        }
    };
    const begin = () => {
        disarmKill();
        state.generation += 1;
        state.busy = true;
        state.ready = false;
        state.observeHidden = false;
        state.expiresAt = Date.now() + 30000;
        retry.disabled = true;
        serviceOnly.disabled = true;
        actions.forEach((button) => { button.disabled = true; });
        const generation = state.generation;
        state.deadline = page.setTimeout(() => {
            if (state.busy && generation === state.generation) finish(false, 'FEHLER: Nach 30 s kein vollständiger Erfolgsnachweis.');
        }, 30000);
        return generation;
    };

    // Log every snapshot/callback, including late replies, but authorize actions only in this attempt.
    const contexts = (label, generation, done) => {
        if (!current(generation)) return;
        say(`getAppsContext: ${label}`);
        const failed = (error) => {
            say(`getAppsContext Fehler (${label}): ${describe(error)}`);
            if (current(generation)) finish(false, 'Kontextprüfung fehlgeschlagen; keine weitere Aktion.');
        };
        try {
            api.getAppsContext((found) => {
                if (!Array.isArray(found)) return failed(new Error('Ungültige Kontextliste'));
                say(`Kontexte (${label}): ${JSON.stringify(found.map((one) => ({ appId: one.appId, id: one.id })))}`);
                if (current(generation)) done(found);
            }, failed);
        } catch (error) { failed(error); }
    };
    const nativeContexts = (found) => found.filter((one) => one.appId === 'com.samsung.tv.cobalt-yt');
    const ping = (done) => {
        const xhr = new page.XMLHttpRequest();
        const settled = { yes: false };
        const answer = (ok, detail) => {
            if (settled.yes) return;
            settled.yes = true;
            if (state.xhr === xhr) state.xhr = null;
            done(ok, detail);
        };
        state.xhr = xhr;
        try {
            xhr.open('GET', `${config.ping}?poc=${Date.now()}`, true);
            xhr.timeout = 1500;
            xhr.onload = () => answer(xhr.status === 204, `HTTP ${xhr.status}`);
            xhr.onerror = () => answer(false, 'Netzwerkfehler / Zugriff verweigert');
            xhr.ontimeout = () => answer(false, 'Ping-Timeout');
            xhr.onabort = () => answer(false, 'Ping abgebrochen');
            xhr.send();
        } catch (error) {
            answer(false, describe(error));
        }
    };

    // Continue the same start operation: service readiness never resets its deadline or launch budget.
    const validateHandoff = () => {
        status.textContent = 'Dienst bereit. Prüfe Cobalt und starte YouTube …';
        try {
            const installed = api.getAppInfo(config.handoffId);
            if (installed.packageId !== config.handoffPackageId) throw new Error('Falsches Handoff-Paket.');
            const metadata = api.getAppMetaData(config.handoffId);
            Object.keys(config.nativeMetadata).forEach((key) => {
                const found = metadata.find((entry) => entry.key === key);
                if (!found || found.value !== config.nativeMetadata[key]) throw new Error(`Handoff-Metadaten passen nicht: ${key}`);
            });
            say(`Handoff-Metadaten geprüft: ${config.handoffId}`);
            say(`native.userdata: ${config.nativeMetadata['http://samsung.com/tv/metadata/native.userdata']}`);
            return true;
        } catch (error) {
            finish(false, `Handoff nicht bereit — ${describe(error)}`);
            return false;
        }
    };
    const startCobalt = (generation) => {
        const conflictHint = () => state.kills < 1 ? 'Bei Blockade Bereinigung manuell wählen.'
            : 'Bei Blockade „YouTube erneut starten“ wählen; Kill-Budget verbraucht.';
        const attempt = (previous) => {
            if (!current(generation)) return;
            if (state.attempts >= 2) return finish(false, 'Versuchsgrenze erreicht; kein weiterer Handoff.');
            ping((ok, detail) => {
                if (!current(generation)) return;
                say(`Unmittelbar vor Handoff: ${detail}`);
                if (!ok) return finish(false, 'Handoff gesperrt: Dienst antwortet nicht mehr mit HTTP 204.');
                state.attempts += 1;
                const number = state.attempts;
                // A deliberate app opening authorizes this bounded handoff, even if it hides the starter.
                state.observeHidden = true;
                say(`launch('${config.handoffId}') → ${config.nativeId}, Versuch ${number}/2`);
                const outcome = { done: false };
                const settled = (error) => {
                    say(error ? `Handoff ${number} Fehlercallback/Exception: ${describe(error)}`
                        : `Handoff akzeptiert: Erfolgscallback ${number}.`);
                    if (outcome.done || !current(generation)) return;
                    outcome.done = true;
                    contexts(`nach Handoff ${number} Callback`, generation, () => {
                        state.timer = page.setTimeout(() => contexts(`nach Handoff ${number} +3s`, generation, (after) => {
                            const remaining = nativeContexts(after);
                            const gone = previous.filter((one) => !remaining.some((next) => next.id === one.id));
                            say(`Verschwundene Cobalt-Kontexte: ${JSON.stringify(gone)}`);
                            if (number === 1 && previous.length && !remaining.length) {
                                say('Bisheriger Cobalt-Kontext verschwunden; höchstens ein Folgeversuch nach 1,2 s.');
                                state.timer = page.setTimeout(() => contexts('vor Handoff 2', generation, (again) => {
                                    if (nativeContexts(again).length) return finish(true,
                                        `Cobalt wieder vorhanden; kein Folgeversuch. ${conflictHint()}`);
                                    attempt([]);
                                }), 1200);
                            } else finish(remaining.length > 0,
                                (error ? 'Handoff-Fehler protokolliert. ' : 'Handoff akzeptiert. ') + (remaining.length
                                    ? `Cobalt-Kontext vorhanden. Wiedergabe am TV prüfen. ${conflictHint()}`
                                    : 'Kein Cobalt-Kontext nachweisbar. Start beendet; bei Bedarf erneut starten.'));
                        }), 3000);
                    });
                };
                try { api.launch(config.handoffId, () => settled(null), settled); }
                catch (error) { settled(error); }
            });
        };
        contexts('vor Handoff 1', generation, (before) => attempt(nativeContexts(before)));
    };
    // Shared by the explicit-start cleanup and the separately confirmed manual cleanup.
    // A failed kill also consumes the single attempt: permission errors never trigger retries.
    const killSelected = (generation, target, automatic, done) => {
        if (!current(generation)) return;
        if (state.kills >= 1 || (automatic && (!state.serviceStarted || !state.serviceReady))) {
            finish(false, 'Bereinigung gesperrt: Kill-Budget oder Service-Startnachweis fehlt.');
            return;
        }
        contexts(automatic ? 'unmittelbar vor automatischem Kill' : 'vor bestätigtem Kill', generation, (found) => {
            const candidates = nativeContexts(found);
            if (target.appId !== 'com.samsung.tv.cobalt-yt' || candidates.length !== 1
                || typeof target.id !== 'string' || !target.id || candidates[0].id !== target.id
                || found.some((one) => one.id === target.id && one.appId !== target.appId)) {
                say('Kill-Ziel hat sich geändert oder ist mehrdeutig; keine App beendet.');
                done(false, true);
                return;
            }
            state.kills += 1;
            say(`kill('${target.id}'), ausschließlich App-ID=${target.appId}; ${automatic ? 'automatisch nach explizitem Service-Start + HTTP 204' : 'manuell bestätigt'}; Kill 1/1`);
            const outcome = { done: false };
            const failed = (error) => {
                say(`Kill Fehlercallback/Exception: ${describe(error)}`);
                if (outcome.done || !current(generation)) return;
                outcome.done = true;
                contexts('nach Kill Fehler', generation, () => finish(false,
                    'Kill abgelehnt. Kein Handoff und kein erneuter Kill; Fehler im Protokoll.'));
            };
            try {
                api.kill(target.id, () => {
                    say(`Kill Erfolgscallback: App-ID=${target.appId}, Context-ID=${target.id}`);
                    if (outcome.done || !current(generation)) return;
                    outcome.done = true;
                    contexts('nach Kill Callback', generation, () => {
                        state.timer = page.setTimeout(() => contexts('nach Kill +1,2s', generation, (after) => {
                            // Any entry reusing the old ID makes absence uncertain, including a foreign app.
                            const stillThere = after.some((one) => one.id === target.id);
                            say(`Bereinigung geprüft: App-ID=${target.appId}, Context-ID=${target.id}; ${stillThere ? 'weiterhin vorhanden' : 'verschwunden'}`);
                            if (stillThere) return finish(false, 'Zielkontext weiterhin vorhanden. Kein Handoff und kein weiterer Kill.');
                            done(true, false);
                        }), 1200);
                    });
                }, failed);
            } catch (error) { failed(error); }
        });
    };
    const afterServiceReady = (generation) => {
        if (!current(generation)) return;
        state.serviceReady = true;
        if (state.serviceOnly) {
            finish(false, 'DIENST OK: aktueller Ping HTTP 204. Isolierter Diensttest ohne Cobalt-Start oder Kill.');
            return;
        }
        if (!validateHandoff()) return;
        if (!state.serviceStarted) {
            say('Fall A: Service bereits bereit; keine automatische Bereinigung.');
            startCobalt(generation);
            return;
        }
        say('Fall B: Service-Launch in diesem Benutzeraufruf akzeptiert und HTTP 204 bestätigt; kein Beweis eines Prozess-Neustarts.');
        contexts('nach Bereitschaft / automatische Kill-Auswahl', generation, (found) => {
            const candidates = nativeContexts(found);
            if (candidates.length !== 1 || typeof candidates[0].id !== 'string' || !candidates[0].id) {
                say(candidates.length ? 'Keine eindeutige gültige Cobalt-Instanz; kein automatischer Kill, normaler Handoff.'
                    : 'Kein Cobalt-Kontext; direkt zum Handoff.');
                startCobalt(generation);
                return;
            }
            const target = { appId: candidates[0].appId, id: candidates[0].id };
            status.textContent = `Bereinige Cobalt nach Service-Start: ${target.id} …`;
            killSelected(generation, target, true, (gone, skipped) => {
                if (skipped) say('Automatische Bereinigung ausgelassen; normaler Handoff ohne Kill.');
                startCobalt(generation);
            });
        });
    };
    const testService = (onlyService = false) => {
        if (state.busy || !visible()) return;
        const generation = begin();
        state.serviceOnly = onlyService;
        state.attempts = 0;
        state.kills = 0;
        state.serviceStarted = false;
        state.serviceReady = false;
        state.serviceUntil = Date.now() + 20000;
        say(`START ${generation}: ${onlyService ? 'isolierter Diensttest ohne Handoff/Kill' : 'neuer Startvorgang'}; höchstens zwei Handoffs und ein gezielter Kill; automatische Bereinigung nur nach eigenem Service-Launch + HTTP 204.`);
        status.textContent = 'Prüfe lokalen TubeService …';
        try {
            if (!api) throw new Error('Tizen Application API fehlt; als installierte TV-App öffnen.');
            const info = api.getCurrentApplication().appInfo;
            say(`Web-App: ${info.id}; Paket: ${info.packageId}`);
            if (info.id !== config.appId || info.packageId !== config.packageId) {
                throw new Error('Falscher Aufrufer: Dienststart muss im ursprünglichen Paket laufen.');
            }
        } catch (error) {
            finish(false, describe(error));
            return;
        }
        ping((alreadyUp, before) => {
            if (!current(generation)) return;
            say(`Dienstprüfung: ${before}`);
            if (alreadyUp) {
                say('TubeService bereits bereit; kein Service-Launch erforderlich.');
                afterServiceReady(generation);
                return;
            }
            contexts('vor Service-Start', generation, () => {
                say(`launch('${config.serviceId}')`);
                const outcome = { done: false };
                const failed = (error) => {
                    say(`Service-Launch Fehlercallback/Exception: ${describe(error)}`);
                    if (outcome.done || !current(generation)) return;
                    outcome.done = true;
                    contexts('nach Service-Start Fehler', generation, () => finish(false, 'Service-Launch abgelehnt.'));
                };
                try {
                    api.launch(config.serviceId, () => {
                        say('Service-Launch: Erfolgscallback.');
                        if (outcome.done || !current(generation)) return;
                        outcome.done = true;
                        state.serviceStarted = true;
                        const poll = () => {
                            if (!current(generation)) return;
                            if (Date.now() >= state.serviceUntil) return finish(false, 'TubeService nach 20 s nicht bereit.');
                            ping((ok, detail) => {
                                if (!current(generation)) return;
                                say(`Ping: ${detail}`);
                                if (Date.now() >= state.serviceUntil) return finish(false, 'TubeService nach 20 s nicht bereit.');
                                if (ok) contexts('nach Service-Start', generation, () => afterServiceReady(generation));
                                else state.timer = page.setTimeout(poll, 500);
                            });
                        };
                        poll();
                    }, failed);
                } catch (error) { failed(error); }
            });
        });
    };
    const testKill = () => {
        if (!state.ready || state.busy || !visible() || state.kills >= 1) return;
        const selected = state.killTarget;
        const generation = begin();
        if (selected) {
            killSelected(generation, selected, false, (gone, skipped) => finish(skipped,
                gone ? 'Zielkontext verschwunden. Jetzt „YouTube erneut starten“ wählen.'
                    : 'Kill-Ziel hat sich geändert; erneut auswählen. Keine App beendet.'));
            return;
        }
        contexts('Kill-Auswahl', generation, (found) => {
            const candidates = nativeContexts(found);
            if (candidates.length !== 1 || typeof candidates[0].id !== 'string' || !candidates[0].id) {
                finish(true, 'Kill gesperrt: genau eine gültige Cobalt-Instanz erforderlich.');
                return;
            }
            const target = { appId: candidates[0].appId, id: candidates[0].id };
            finish(true, `Bereinigung beendet auch eine laufende YouTube-Wiedergabe. App-ID=${target.appId}, Context-ID=${target.id}. Erneut OK zum Bestätigen.`);
            state.killTarget = target;
            kill.textContent = 'Beenden bestätigen (OK)';
        });
    };
    const exit = () => {
        disarmKill();
        state.observeHidden = false;
        finish(false, 'Starter geschlossen.');
        try { api.getCurrentApplication().exit(); } catch (error) { say(describe(error)); }
    };
    retry.onclick = () => testService();
    serviceOnly.onclick = () => testService(true);
    diagnose.onclick = () => {
        disarmKill();
        state.observeHidden = false;
        finish(false, 'Diagnoseansicht: Start angehalten. Für einen neuen Versuch „YouTube erneut starten“ wählen.');
    };
    kill.onclick = testKill;
    close.onclick = exit;
    doc.addEventListener('keydown', (event) => {
        const code = event.keyCode;
        if ([13, 37, 38, 39, 40, 10009].indexOf(code) === -1) return;
        event.preventDefault();
        if (event.repeat) return;
        if (code === 10009) return exit();
        if (code === 38 || code === 40) {
            log.scrollTop += code === 38 ? -120 : 120;
            return;
        }
        const enabled = buttons.filter((button) => !button.disabled);
        const index = enabled.indexOf(doc.activeElement);
        if (code === 13) {
            if (index !== -1) enabled[index].click();
        } else enabled[(index + (code === 37 ? enabled.length - 1 : 1)) % enabled.length].focus();
    });
    const onVisible = () => {
        if (!visible()) {
            disarmKill();
            if (state.busy && state.observeHidden) say('App ausgeblendet; nur bewusster Handoff wird zeitlich begrenzt beobachtet.');
            else {
                if (state.busy) finish(false, 'App ausgeblendet; laufender Test abgebrochen.');
                state.ready = false;
                actions.forEach((button) => { button.disabled = true; });
            }
        } else if (!state.opened) {
            state.opened = true;
            testService();
        }
    };
    doc.addEventListener('visibilitychange', onVisible);
    say(`=== Neuer Starter-Aufruf ${new Date().toISOString()} === Dienst: ${config.serviceId}`);
    say(`Ping: ${config.ping}`);
    say('Aktuelle Pings und Kontexte prüfen den Start; alte Bootmeldungen sind kein Sitzungsnachweis.');
    diagnose.focus();
    onVisible();
};

module.exports = start;
