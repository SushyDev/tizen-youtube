'use strict';

const handed = [];

global.webapis = {
    preview: { setPreviewData: (json, done) => { handed.push(JSON.parse(json)); done(); } }
};

const preview = require('../lib/preview.js');

const results = [];

const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const item = (id, title, creator, images) => ({
    title,
    creator,
    uri: `https://www.youtube.com/watch?v=${id}&launch=launcher`,
    images,
    shelfItemType: 'LONG_FORM_VIDEO',
    contentId: id
});

const feed = (browseId, items) => ({
    responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK', params: [{ key: 'browse_id', value: browseId }] }] },
    contents: { mediaActionsRenderer: { shelves: [{ shelfItems: items }] } }
});

const PICTURES = [
    { uri: 'https://i.ytimg.com/vi/videoAAAAAA/small.jpg', width: 320, height: 180 },
    { uri: 'https://i.ytimg.com/vi/videoAAAAAA/hq720.jpg', width: 640, height: 360 }
];

const launcher = feed('FElauncher_recommendations', [
    item('videoAAAAAA', 'First', 'Channel One', PICTURES),
    item('videoBBBBBB', 'Second', 'Channel Two', []),
    item('videoAAAAAA', 'First again', 'Channel One', PICTURES),
    { title: 'no id' }
]);

const found = preview.videosIn(launcher);

check('every video is found once, an item without an id not at all',
    found.map((video) => video.id).join() === 'videoAAAAAA,videoBBBBBB', JSON.stringify(found));
check('the title and the channel are read from the item',
    found[0].title === 'First' && found[0].channel === 'Channel One', JSON.stringify(found[0]));
check('the largest image is used, YouTube\'s own where the item has none',
    found[0].image === PICTURES[1].uri && found[1].image === 'https://i.ytimg.com/vi/videoBBBBBB/mqdefault.jpg',
    `${found[0].image} | ${found[1].image}`);
check('the feed is named by its browse_id',
    preview.browseIdOf(launcher) === 'FElauncher_recommendations', preview.browseIdOf(launcher));

// Another feed that merely mentions the launcher's id must not replace the row.
preview.heard(JSON.stringify(Object.assign(feed('FEwhat_to_watch', [item('videoCCCCCC', 'Home', 'C', [])]),
    { note: 'FElauncher_recommendations' })));
preview.heard('not json FElauncher_recommendations');
preview.heard(JSON.stringify(launcher));

setTimeout(() => {
    check('only the launcher\'s recommendations are handed over, once', handed.length === 1, `${handed.length} handed`);

    const tiles = handed[0] ? handed[0].sections[0].tiles : [];
    check('a tile opens its video by the built-in app\'s deep link',
        tiles.length === 2 && tiles[0].action_data === '#play?v=videoAAAAAA' && tiles[0].image_ratio === '16by9'
        && tiles[1].subtitle === 'Channel Two',
        JSON.stringify(tiles[0]));

    preview.heard(JSON.stringify(feed('FElauncher_recommendations', [item('videoDDDDDD', 'Later', 'D', [])])));

    setTimeout(() => {
        check('a second row within ten minutes waits its turn', handed.length === 1, `${handed.length} handed`);

        const failed = results.filter((ok) => !ok).length;
        console.log(`\n${results.length - failed}/${results.length} checks passed.`);
        process.exit(failed ? 1 : 0);
    }, 50);
}, 50);
