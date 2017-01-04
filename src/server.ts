import * as express from 'express';
import * as path from 'path';
import * as bodyParser from 'body-parser';
import * as logging  from './app/logging';
import * as routes from "./app/routes";
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
import * as mongoose from 'mongoose';
import * as passport from 'passport';
import * as passportConfigurer from './config/passport';
import {MusicoinAPI} from './app/musicoin-api';

import favicon = require('serve-favicon');
const config = require('./config/config');
const app = express();
const flash = require('connect-flash');
const musicoinApi = new MusicoinAPI(config.musicoinApi);
const MediaProvider = require('./media/media-provider');
const mediaProvider = new MediaProvider(config.ipfs.ipfsHost, config.ipfs.ipfsAddUrl);
const isDevEnvironment = app.get('env') === 'development';

app.set('port', config.port);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// connect to database
mongoose.connect(config.database.url);

passportConfigurer.configure(passport, mediaProvider, config.auth);

app.use(function(req, res, next) {
  if (!isDevEnvironment) {
    res.setHeader('Content-Security-Policy-Report-Only', "default-src https:");
    res.setHeader('Strict-Transport-Security', "max-age=31536000");
  }
  res.setHeader('X-Frame-Options', "Deny");
  res.setHeader('X-XSS-Protection', "1; mode=block;");
  res.setHeader('X-Content-Type-Options', "nosniff");
  next();
});
app.use(favicon(__dirname + '/public/favicon.ico'));
logging.configure(app, config.loggingConfig);
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: config.sessionSecret }));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.get('/', function(req, res) {
  res.render('index');
});

routes.configure(app, passport, musicoinApi, mediaProvider);

// let angular catch them
app.use(function(req, res) {
  res.render('index');
});

if (app.get('env') === 'development') {
  app.listen(config.port, function () {
    console.log('Listening on port ' + config.port);
    console.log('Environment ' + app.get('env'));
    console.log("loaded config: " + JSON.stringify(config, null, 2));
  });

  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}
else {
  // returns an instance of node-letsencrypt with additional helper methods
  const lex = require('letsencrypt-express').create({
    // set to https://acme-v01.api.letsencrypt.org/directory in production
    // server: 'staging',
    server: 'https://acme-v01.api.letsencrypt.org/directory',
    email: 'musicoin@berry.ai',
    agreeTos: true,
    approveDomains: ['join.musicoin.org']
  });

  require('http').createServer(lex.middleware(require('redirect-https')())).listen(80, function () {
    console.log("Listening for ACME http-01 challenges on", this.address());
  });

  require('https').createServer(lex.httpsOptions, lex.middleware(app)).listen(443, function () {
    console.log("Listening for ACME tls-sni-01 challenges and serve app on", this.address());
    console.log('Environment ' + app.get('env'));
    console.log("loaded config: " + JSON.stringify(config, null, 2));
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
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
    opts.email = 'im@berry.ai';
    opts.agreeTos = true;
  }

  cb(null, { options: opts, certs: certs });
}
