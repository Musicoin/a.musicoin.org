"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class JsonPromiseRouter {
    constructor(router, name) {
        this.router = router;
        this.name = name;
        this.promiseHandler = function handleJsonPromise(p, res, next) {
            p.then(function (output) {
                if (!output) {
                    res.status(404);
                    res.end();
                    return;
                }
                res.json(output);
            })
                .catch(function (err) {
                res.status(500);
                res.end();
            });
        };
    }
    post(...args) {
        const routeArgs = [...args].slice(0, args.length - 1);
        const promiseProvider = args[args.length - 1];
        this.router.post(...routeArgs, function (req, res, next) {
            this.promiseHandler(promiseProvider(req, res, next), res, next);
        }.bind(this));
    }
    get(...args) {
        const routeArgs = [...args].slice(0, args.length - 1);
        const promiseProvider = args[args.length - 1];
        this.router.get(...routeArgs, function (req, res, next) {
            console.log(`Calling route: ${routeArgs[0]} in ${this.name} with params: ${JSON.stringify(req.params)}`);
            this.promiseHandler(promiseProvider(req, res, next), res, next);
        }.bind(this));
    }
    delete(...args) {
        const routeArgs = [...args].slice(0, args.length - 1);
        const promiseProvider = args[args.length - 1];
        this.router.delete(...routeArgs, function (req, res, next) {
            console.log(`Calling route: ${routeArgs[0]} in ${this.name} with params: ${JSON.stringify(req.params)}`);
            this.promiseHandler(promiseProvider(req, res, next), res, next);
        }.bind(this));
    }
}
exports.JsonPromiseRouter = JsonPromiseRouter;
//# sourceMappingURL=json-promise-router.js.map