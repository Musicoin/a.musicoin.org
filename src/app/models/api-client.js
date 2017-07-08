"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
module.exports = mongoose.model('APIClient', mongoose.Schema({
    name: String,
    clientId: {
        type: String,
        index: true
    },
    domains: [String],
    methods: [String],
    accountLocked: Boolean
}));
//# sourceMappingURL=api-client.js.map