"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
// create the model for users and expose it to our app
module.exports = mongoose.model('Follow', mongoose.Schema({
    follower: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    following: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    startDate: {
        type: Date,
        default: Date.now
    }
}));
//# sourceMappingURL=follow.js.map