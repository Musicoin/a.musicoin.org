import * as express from 'express';

const router = express.Router();
export class FrontRouter {
    constructor() {

        router.get('/', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/musicians', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/how-it-works', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/resources', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/resources/faq', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/gettingstarted', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/gettingstarted/wallet', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/gettingstarted/mycrypto', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/gettingstarted/coinomi', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/gettingstarted/exchange', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/developers', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/developers/api', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/developers/bounty', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/privacy', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/legal/legal', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/legal/tos', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/legal/artist-policy', (req, res) => {
            res.render('../overview/index.html', {});
        });

        router.get('/legal/copyright', (req, res) => {
            res.render('../overview/index.html', {});
        });
    }
    getRouter() {
        return router;
    }
}
