"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose = require("mongoose");
module.exports = mongoose.model('ReportActivity', mongoose.Schema({
    startDate: {
        type: Date,
        index: true
    },
    duration: {
        type: String,
        index: true
    },
    sent: Boolean,
    sentDate: {
        type: Date,
        default: Date.now
    },
    totalSent: Number,
    totalErrors: Number
}));
//# sourceMappingURL=report-activity.js.map