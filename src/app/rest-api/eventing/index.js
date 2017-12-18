"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const EventEmitter = require("events");
class ServiceEventEmitter extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(1000);
    }
}
exports.default = new ServiceEventEmitter();
//# sourceMappingURL=index.js.map