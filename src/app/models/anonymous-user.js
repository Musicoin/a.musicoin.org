"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
module.exports = mongoose.model('AnonymousUser', mongoose.Schema({
    ip: {
        type: String,
        index: true
    },
    session: {
        type: String,
        index: true
    },
    sessionDate: {
        type: Date,
        default: Date.now
    },
    accountLocked: Boolean,
    freePlaysRemaining: {
        type: Number,
        default: 100
    },
    nextFreePlayback: Date,
    currentPlay: {
        licenseAddress: String,
        release: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Release'
        },
        encryptedKey: String
    }
}));
//# sourceMappingURL=anonymous-user.js.map