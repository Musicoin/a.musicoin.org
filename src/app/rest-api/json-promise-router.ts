import {Promise} from 'bluebird';
export class JsonPromiseRouter {
  promiseHandler: any;
  constructor(public router: any, public name: string){
    this.promiseHandler = function handleJsonPromise(p, res) {
      p.then(function (output) {
        if (!output) return res.write(404).send("Not found");
        res.json(output);
      })
        .catch(function (err) {
          console.log(`Request failed in ${name}: ${err}`);
          res.status(500);
          res.send(err);
        });
    };
  }

  post(...args: any[]): void{
    const routeArgs = [...args].slice(0, args.length-1);
    const promiseProvider = args[args.length-1];
    this.router.post(...routeArgs, function(req, res, next) {
      this.promiseHandler(promiseProvider(req, res, next), res, next);
    }.bind(this))
  }

  get(...args: any[]) : void {
    const routeArgs = [...args].slice(0, args.length-1);
    const promiseProvider = args[args.length-1];
    this.router.get(...routeArgs, function(req, res, next) {
      console.log(`Calling route: ${routeArgs[0]} in ${this.name} with params: ${JSON.stringify(req.params)}`);
      this.promiseHandler(promiseProvider(req, res, next), res, next);
    }.bind(this))
  }
}