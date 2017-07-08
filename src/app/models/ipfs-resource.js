"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
// create the model for users and expose it to our app
module.exports = mongoose.model('IPFSResource', mongoose.Schema({
    hash: String,
    dateAdded: {
        type: Date,
        default: Date.now,
        index: true
    }
}));
//# sourceMappingURL=ipfs-resource.js.map