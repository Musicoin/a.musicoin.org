var express = require('express');
var router = express.Router();
const MediaProvider = require('./media/media-provider');
const ConfigUtils = require('./config/config');
var config = ConfigUtils.loadConfig();
const mediaProvider = new MediaProvider(config.ipfs.ipfsHost, config.ipfs.ipfsAddUrl);
router.get('/ipfs/hashes', function (req, res) {
    const since = new Date(parseInt(req.query.since));
    console.log(since);
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const limit = req.query.limit ? Math.min(100, parseInt(req.query.limit)) : 100;
    mediaProvider.getKnownIPFSHashes(since, offset, limit)
        .then(result => {
            res.json(result)
        })
        .catch(function (err) {
            console.error(err.stack);
            res.status(500);
            res.send(err);
        });
});

module.exports.router = router;