"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
// const mongoose1 = require('mongoose');
// create the model for users and expose it to our app
module.exports = mongoose.model('Hero', mongoose.Schema({
    subtitle: String,
    subtitleLink: String,
    title: String,
    titleLink: String,
    image: String,
    licenseAddress: String,
    label: String,
    startDate: Date,
    expirationDate: Date
}));
//# sourceMappingURL=hero.js.map