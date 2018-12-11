require('dotenv').config();
import * as bodyParser from 'body-parser';
import * as cookieParser from 'cookie-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as gettext from 'express-gettext';
import * as session from 'express-session';
import * as helmet from 'helmet';
import * as passport from 'passport';
import * as path from 'path';
import favicon = require('serve-favicon');

import { MusicoinAPI } from './app/internal/musicoin-api';
import * as logging from './app/logging';
import * as routes from './app/routes';
import * as passportConfigurer from './config/passport';
import * as redis from './redis';

const RedisStore = require('connect-redis')(session);
const app = express();
const flash = require('connect-flash');
const ConfigUtils = require('./config/config');
const MediaProvider = require('./media/media-provider');
const get_ip = require('request-ip');

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
    app.use(cors(config.cors));

    app.use(function (req, res, next) {
      get_ip.getClientIp(req);
      next();
    });

    app.use(favicon(__dirname + '/public/favicon.ico'));
    logging.configure(app, config.loggingConfig);
    app.use(cookieParser());
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.static(path.join(__dirname, 'overview')));

    app.use(session({
      name: app.get('env') === 'development' ? 'staging-musicoin-session' : 'musicoin-session',
      secret: config.sessionSecret,
      store: new RedisStore({ url: config.redis.url }),
      cookie: {
        path: '/',
        domain: config.sessionDomain,
        maxAge: ONE_YEAR
      },
    }));

    app.use(passport.initialize());
    app.use(passport.session());
    app.use(flash());

    routes.configure(app, passport, musicoinApi, mediaProvider, config);

    // let angular catch them
    app.use(function (req, res) {
      res.render('not-found');
    });

    app.listen(config.port, function () {
      console.log('Listening on port ' + config.port);
      console.log('Environment ' + app.get('env'));
      console.log("loaded config: " + JSON.stringify(config, null, 2));
    });

    if (isDevEnvironment) {
      app.use(function (err, req, res, next) {
        console.log(err);
        res.status(err.status || 500);
        res.render('error', {
          message: err.message,
          error: err
        });
      });
    } else {
      // production error handler
      // no stacktraces leaked to user
      app.use(function (err, req, res, next) {
        console.log("ERROR: " + err);
        res.status(err.status || 500);
        res.render('error', {
          message: err.message,
          error: {}
        });
      });
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

app.use(function (req, res: any, next) {
  if (req.query && req.query.locale) {
    res.setLocale(req.query.locale);
  }
  next();
});

export = app;
