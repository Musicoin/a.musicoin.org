"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
module.exports = mongoose.model('EmailConfirmation', mongoose.Schema({
    email: String,
    code: String,
    date: {
        type: Date,
        default: Date.now
    }
}));
//# sourceMappingURL=email-confirmation.js.map