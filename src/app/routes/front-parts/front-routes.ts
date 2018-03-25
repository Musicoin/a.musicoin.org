var express = require('express');
var router = express.Router();

router.get('/', (req, res) => {
    res.render('../overview/index.html', {});
});

router.get('/for-listeners', (req, res) => {
    res.render('../overview/index.html', {});
});

router.get('/how-it-works', (req, res) => {
    res.render('../overview/index.html', {});
});

router.get('/for-musicians', (req, res) => {
    res.render('../overview/index.html', {});
});

router.get('/currency', (req, res) => {
    res.render('../overview/index.html', {});
});

router.get('/faq', (req, res) => {
    res.render('../overview/index.html', {});
});

router.get('/bounty', (req, res) => {
    res.render('../overview/index.html', {});
});

module.exports.router = router;