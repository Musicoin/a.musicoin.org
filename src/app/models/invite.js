"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
// const mongoose1 = require('mongoose');
// create the model for users and expose it to our app
module.exports = mongoose.model('Invite', mongoose.Schema({
    email: String,
    invitedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    inviteDate: {
        type: Date,
        default: Date.now
    }
}));
//# sourceMappingURL=invite.js.map