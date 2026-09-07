// The shapes YouTube sends, written down.
//
// Nothing imports this for a value — it exists so `tsc --noEmit` can check the descents. These
// objects arrive from the network and are optional the whole way down, which is why the feature
// code is a ladder of `?.`; a typo in the middle of one of those ladders reads as "the tile did
// not have that" and is invisible until a shelf renders wrong on a television.
//
// Only what a mod actually walks is described. This is not a schema for innertube.

/**
 * @typedef {{ url: string, width?: number, height?: number }} Thumbnail
 */

/**
 * @typedef {{ simpleText?: string, runs?: { text: string }[] }} Text
 */

/**
 * @typedef {{
 *   watchEndpoint?: { videoId?: string, playlistId?: string },
 *   reelWatchEndpoint?: { videoId?: string, adClientParams?: { isAd?: boolean } },
 *   customAction?: { action: string, parameters?: any }
 * }} Endpoint
 */

/**
 * @typedef {{
 *   thumbnail?: { thumbnails?: Thumbnail[] },
 *   thumbnailOverlays?: { thumbnailOverlayResumePlaybackRenderer?: { percentDurationWatched?: number } }[]
 * }} TileHeaderRenderer
 */

/**
 * @typedef {{
 *   title?: Text,
 *   lines?: { lineRenderer?: { items?: { lineItemRenderer?: { text?: Text } }[] } }[]
 * }} TileMetadataRenderer
 */

/**
 * One video in a shelf or a grid. `style` is what separates a real video tile from the several
 * other things that arrive in the same array.
 *
 * @typedef {{
 *   contentId?: string,
 *   style?: string,
 *   tvhtml5ShelfRendererType?: string,
 *   onSelectCommand?: Endpoint,
 *   onFocusCommand?: { playbackEndpoint?: any, commandExecutorCommand?: any, startInlinePlaybackCommand?: any },
 *   onLongPressCommand?: { showMenuCommand?: { menu?: { menuRenderer?: { items: any[] } } } },
 *   metadata?: { tileMetadataRenderer?: TileMetadataRenderer },
 *   header?: { tileHeaderRenderer?: TileHeaderRenderer }
 * }} TileRenderer
 */

/**
 * An entry in a tile-bearing array. Exactly one of these keys is usually present, and an advert
 * slot carries no tileRenderer at all — which is what makes the walk's dressers safe to run
 * before its keepers.
 *
 * @typedef {{ tileRenderer?: TileRenderer, adSlotRenderer?: any, feedNudgeRenderer?: any }} FeedItem
 */

/**
 * @typedef {{
 *   shelfRenderer?: {
 *     tvhtml5ShelfRendererType?: string,
 *     content?: { horizontalListRenderer?: { items: FeedItem[] } }
 *   }
 * }} Shelf
 */

/**
 * Where in the response a walk is, handed to every visitor.
 *
 * @typedef {{ surface: string, shelf?: Shelf }} At
 */

export {};
