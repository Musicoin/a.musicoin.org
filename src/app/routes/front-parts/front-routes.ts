import * as express from 'express';

const router = express.Router();
export class FrontRouter {
    constructor() {

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
    }
    getRouter() {
        return router;
    }
}

