// The page's own globals, and ours.
//
// Everything here is something YouTube's app or this userscript parks on `window`. It is declared
// rather than cast at each use so that a typo in a property name is an error instead of `any`.

interface QueuedVideos {
    videos: any[];
    lastVideoId: string | null;
}

interface SponsorBlockState {
    segments?: { category: string, segment: number[] }[];
    videoID?: string | null;
    init?: () => void;
    destroy?: () => void;
}

interface Window {
    /** YouTube's module registry: some 3116 entries, and the only way into its internals. */
    _yttv?: Record<string, any>;

    /** kabuki's resolved feature switches and client data. */
    tectonicConfig?: { featureSwitches?: Record<string, any>, clientData?: Record<string, any> };

    yt?: { config_?: Record<string, any> };

    /** Set by the proxy before our script runs; false means it patched the page itself. */
    __TUBE_NATIVE_PROXY_PATCHES__?: boolean;

    /** Ours. */
    queuedVideos: QueuedVideos;
    sponsorblock?: SponsorBlockState;
    isPipPlaying?: boolean;
    tubeRemote?: (code: number) => void;
    __tubeAsked?: string | null;
}

// YouTube's player is an ordinary element carrying an API, and its custom elements carry a
// `__instance` back-reference. Declared on Element rather than cast at each of the forty-odd
// call sites: this is a userscript reaching into someone else's page, and the alternative is a
// cast that documents nothing.
interface Element {
    __instance?: any;
    nonce?: string;
    style?: CSSStyleDeclaration;
    focus?(): void;

    getStatsForNerds?(): Record<string, any>;
    getVideoData?(): Record<string, any>;
    getPlaybackQuality?(): string;
    getAvailableQualityData?(): { qualityLabel?: string }[];
    getPlayerStateObject?(): Record<string, any>;
    getVideoStats?(): Record<string, any>;
    setPlaybackQualityRange?(...args: any[]): void;
}

// Imported as strings by rollup-plugin-string, which is why they have no types of their own.
declare module '*.css' {
    const contents: string;
    export default contents;
}
