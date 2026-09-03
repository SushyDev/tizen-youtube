function redirectUrl(originalUrl) {
    if (!originalUrl) return originalUrl;

    try {
        if (typeof originalUrl === 'string' && originalUrl.startsWith('//')) originalUrl = originalUrl.replace('//', 'https://')
        const url = new URL(originalUrl, window.location.origin);
        const hostname = url.hostname;

        if (hostname === 'youtube.com' || hostname === 'www.youtube.com') {
            // Wherever this page came from is where the service is; assuming localhost broke the
            // moment the proxy ran anywhere but the set itself.
            url.protocol = window.location.protocol;
            url.host = window.location.host;
            return url.toString();
        }

        if (hostname.endsWith('googlevideo.com') || hostname.endsWith('youtube.com')
            || hostname.endsWith('gstatic.com') || hostname.endsWith('.google.com')
            || hostname.endsWith('.googleapis.com') || hostname.endsWith('googleusercontent.com')
            || hostname.endsWith('.ggpht.com')) {
            return `${window.location.origin}/cors-bypass/${url.toString()}`;
        }
    } catch (e) {
        console.error('Failed to parse URL during interception:', e);
    }

    return originalUrl;
}

export default function installProxyPatches() {
    const originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = function (input, init) {
            let targetUrl = '';
            let isRequestObject = false;

            if (typeof input === 'string') {
                targetUrl = redirectUrl(input);
            } else if (input instanceof URL) {
                targetUrl = redirectUrl(input.toString());
                input = new URL(targetUrl);
            } else if (input instanceof Request) {
                isRequestObject = true;
                targetUrl = redirectUrl(input.url);
            }

            if (isRequestObject) {
                if (input.method === 'POST' && targetUrl.indexOf('localhost') !== -1) {
                    const modifiedOptions = {
                        method: input.method,
                        headers: new Headers(input.headers),
                        mode: input.mode,
                        credentials: input.credentials,
                    };

                    if (input.body && !input.bodyUsed) {
                        return input.clone().arrayBuffer().then(function (buffer) {
                            modifiedOptions.body = buffer;

                            return originalFetch(targetUrl, modifiedOptions);
                        });
                    }

                    return originalFetch(targetUrl, modifiedOptions);
                }

                input = new Request(targetUrl, input);
            }

            return originalFetch.apply(this, [targetUrl, init]);
        };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
        const redirectedUrl = redirectUrl(url);
        if (redirectedUrl !== url) {
            async = true;
        }

        if (async === undefined) {
            async = true;
        }

        return originalOpen.apply(this, [method, redirectedUrl, async, user, password]);
    };

    if (navigator.sendBeacon) {
        const originalSendBeacon = navigator.sendBeacon;
        navigator.sendBeacon = function (url, data) {
            console.log("Beacon data:", data);
            return originalSendBeacon.apply(this, [redirectUrl(url), data]);
        };
    }

    Object.defineProperty(HTMLImageElement.prototype, 'src', {
        set: function(value) {
            const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'setAttribute');
            descriptor.value.call(this, 'src', redirectUrl(value));
        }
    });
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
        set: function(value) {
            const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'setAttribute');
            descriptor.value.call(this, 'src', redirectUrl(value));
        }
    });
}
// Self-installing on import. ES module imports are hoisted, so the reference's
// `if (...) initPatches()` in the entry file ran after every other module's top-level
// code, and anything capturing window.fetch got the unpatched original.
if (typeof window !== 'undefined' && window.location.protocol === 'http:') {
    installProxyPatches();
}
