if(process.env.NODE_ENV === 'production') {
  require('newrelic');
}

import * as express from 'express';
import * as cors from 'cors';
import * as gettext from 'express-gettext';
import * as path from 'path';
import * as ExpressPinoLogger from 'express-pino-logger';
import * as bodyParser from 'body-parser';
import * as logging  from './app/logging';
import * as routes from "./app/routes";
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
import * as passport from 'passport';
import * as passportConfigurer from './config/passport';
import * as helmet from 'helmet';
import * as expectCt from 'expect-ct'
import {MusicoinAPI} from './app/musicoin-api';
import { getLogger, getMethodEndLogger } from './logger';
import * as redis from './redis';

const logger = getLogger('Server');
const RedisStore = require('connect-redis')(session);
const app = express();
const flash = require('connect-flash');
import favicon = require('serve-favicon');
const ConfigUtils = require('./config/config');
const MediaProvider = require('./media/media-provider');

ConfigUtils.loadConfig()
  .then(config => {

    const db = require('./db').initialize(app, config);
    redis.initialize(config);

    const musicoinApi = new MusicoinAPI(config.musicoinApi);
    const mediaProvider = new MediaProvider(config.ipfs.ipfsHost, config.ipfs.ipfsAddUrl);
    const isDevEnvironment = app.get('env') === 'development';
    const ONE_YEAR = 1000 * 60 * 60 * 24 * 365;

    app.set('port', config.port);
    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');
    app.engine('html', require('ejs').renderFile);

    passportConfigurer.configure(passport as any, mediaProvider, config.auth);

    // app.use(new ExpressPinoLogger({logger: logger}));
    app.use(cors(config.cors));
    const get_ip = require('ipware')().get_ip;
    app.use(function(req, res, next) {
      get_ip(req);
      next();
    });

    app.use(function(req, res, next) {
      // if (!isDevEnvironment) {
      //   res.setHeader('Content-Security-Policy-Report-Only', "default-src https: style-src 'unsafe-inline'");
      //   res.setHeader('Strict-Transport-Security', "max-age=31536000");
      // }
      // res.header('X-Frame-Options', "Deny");
      // res.header('X-XSS-Protection', "1; mode=block;");
      // res.header('X-Content-Type-Options', "nosniff");
      next();
    });
    app.use(favicon(__dirname + '/public/favicon.ico'));
    logging.configure(app, config.loggingConfig);
    app.use(cookieParser());
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));

    app.use(session({
      name: app.get('env') === 'development' ? 'staging-musicoin-session' : 'musicoin-session',
      secret: config.sessionSecret,
      store: new RedisStore({ url: config.redis.url }),
      cookie: {
        path: '/',
        domain: '.musicoin.org',
        maxAge: ONE_YEAR
      },
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    app.use(flash());

    routes.configure(app, passport, musicoinApi, mediaProvider, config);
    app.use(express.static(path.join(__dirname, 'overview')));

    // let angular catch them
    app.use(function(req, res) {
      res.render('not-found');
    });

    if (isDevEnvironment) {
      app.listen(config.port, function() {
        console.log('Listening on port ' + config.port);
        console.log('Environment ' + app.get('env'));
        console.log("loaded config: " + JSON.stringify(config, null, 2));
      });

      app.use(function(err, req, res, next) {
        console.log(err);
        res.status(err.status || 500);
        res.render('error', {
          message: err.message,
          error: err
        });
      });
    }
    else {
      // returns an instance of node-letsencrypt with additional helper methods
      let certServer = app.get('env') === 'staging' ? 'staging' : 'https://acme-v01.api.letsencrypt.org/directory';
      const lex = require('letsencrypt-express').create({
        // set to https://acme-v01.api.letsencrypt.org/directory in production
        // server: 'staging',
        server: certServer,
        email: 'musicoin@musicoin.org',
        agreeTos: true,
        approveDomains: config.certificate.approveDomains
      });

      require('http').createServer(lex.middleware(require('redirect-https')())).listen(80, function() {
        console.log("Listening for ACME http-01 challenges on", this.address());
      });

      require('https').createServer(lex.httpsOptions, lex.middleware(app)).listen(443, function() {
        console.log("Listening for ACME tls-sni-01 challenges and serve app on", this.address());
        console.log('Environment ' + app.get('env'));
        console.log("loaded config: " + JSON.stringify(config, null, 2));
      });
    }

    // production error handler
    // no stacktraces leaked to user
    app.use(function(err, req, res, next) {
      console.log("ERROR: " + err);
      res.status(err.status || 500);
      res.render('error', {
        message: err.message,
        error: {}
      });
    });

    function approveDomains(opts, certs, cb) {
      // This is where you check your database and associated
      // email addresses with domains and agreements and such


      // The domains being approved for the first time are listed in opts.domains
      // Certs being renewed are listed in certs.altnames
      if (certs) {
        opts.domains = certs.altnames;
      }
      else {
        opts.email = 'musicoin@musicoin.org';
        opts.agreeTos = true;
      }

      cb(null, { options: opts, certs: certs });
    }
  });

app.use(helmet({
  frameguard: false
}))

app.use(gettext(app, {
  directory: path.join(__dirname, 'locales'),
  useAcceptedLanguageHeader: true,
  alias: '_'
}));
app.use(function(req, res: any, next) {
  if (req.query && req.query.locale) {
    res.setLocale(req.query.locale);
  }
  next();
});

export = app;
