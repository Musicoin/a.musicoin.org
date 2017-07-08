"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bluebird_1 = require("bluebird");
const Readable = require('stream').Readable;
const fs = require('fs');
const tmp = require('tmp');
const isStream = function (stream) {
    return stream !== null && typeof stream === 'object' && typeof stream.pipe === 'function';
};
const stringToStream = function (string) {
    const s = new Readable();
    s.push(string); // the string you want
    s.push(null); // indicates end-of-file basically - the end of the stream
    return s;
};
const asStream = function (pathOrStream) {
    return isStream(pathOrStream) ? pathOrStream : fs.createReadStream(pathOrStream);
};
const writeToTempFile = function (stream) {
    return new bluebird_1.Promise(function (resolve, reject) {
        tmp.file({}, function (err, tmpPath) {
            if (err)
                return reject(err);
            const w = fs.createWriteStream(tmpPath);
            stream.pipe(w)
                .on('finish', function () {
                resolve(tmpPath);
            });
        });
    });
};
module.exports.asStream = asStream;
module.exports.stringToStream = stringToStream;
module.exports.isStream = isStream;
module.exports.writeToTempFile = writeToTempFile;
//# sourceMappingURL=stream-utils.js.map