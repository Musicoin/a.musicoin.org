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

app.set('port', process.env.PORT || config.port || 3000);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// connect to database
mongoose.connect(config.database.url);

passportConfigurer.configure(passport, mediaProvider, config.auth);

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


app.listen(config.port, function () {
  console.log('Listening on port ' + config.port);
  console.log("loaded config: " + JSON.stringify(config, null, 2));
});
