"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bluebird_1 = require("bluebird");
const fs = require("fs");
const request = require("request");
const os = require("os");
const cacheDir = os.tmpdir() + "/request-cache";
class RequestCache {
    constructor() {
    }
    getJson(url, cacheTTL, properties) {
        // caching library has some edge cases that aren't handled properly.  Adding
        // some fill logic here, although it's not ideal.
        if (cacheTTL) {
            return this._getJson(url, cacheTTL, properties)
                .catch(err => {
                console.log("Failed to execute with cachedRequest impl, falling through: " + err);
                return this._getJson(url, null, properties);
            });
        }
        return this._getJson(url, null, properties);
    }
    static localImpl(options, callback) {
        const key = RequestCache.hashKey(JSON.stringify(options));
        const cacheFile = cacheDir + "/" + key;
        fs.exists(cacheFile, function (exists) {
            if (exists) {
                fs.readFile(cacheFile, 'utf8', function (err, data) {
                    if (data) {
                        try {
                            const json = JSON.parse(data);
                            if (Date.now() < json.expiry) {
                                // console.log("Cache hit!  Returning cached content: " + JSON.stringify(options));
                                return callback(null, {
                                    statusCode: 200,
                                }, json.data);
                            }
                        }
                        catch (e) {
                            console.log("Failed to parse JSON data: '" + cacheFile + "', " + data + ", err: " + err);
                        }
                    }
                    fs.unlink(cacheFile, () => {
                        // it's ok, this can happen if another thread deleted it first
                    });
                    console.log("Making request: " + JSON.stringify(options));
                    RequestCache.makeRequest(options, cacheFile, callback);
                });
            }
            else {
                console.log("Making request: " + JSON.stringify(options));
                RequestCache.makeRequest(options, cacheFile, callback);
            }
        });
    }
    static makeRequest(options, cacheFile, callback) {
        request(options, function (error, response, result) {
            const entry = {
                data: result,
                expiry: Date.now() + options.ttl
            };
            const tmpFile = cacheFile + "." + Date.now() + ".tmp";
            fs.writeFile(tmpFile, JSON.stringify(entry), 'utf8', function (err) {
                if (!err) {
                    fs.rename(tmpFile, cacheFile, function (err) {
                        if (err) {
                            // the file might have already been deleted, which is fine.
                            if (err.code !== 'ENOENT') {
                                // otherwise, log an error.
                                console.log("Failed to rename cached file: " + err);
                            }
                        }
                    });
                }
            });
            callback(error, response, result);
        });
    }
    static hashKey(key) {
        let hash = 0, i, chr, len;
        if (key.length == 0)
            return hash;
        for (i = 0, len = key.length; i < len; i++) {
            chr = key.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        return hash;
    }
    ;
    _getJson(url, cacheTTL, properties) {
        const requestImpl = cacheTTL ? RequestCache.localImpl : request;
        return new bluebird_1.Promise(function (resolve, reject) {
            requestImpl({
                url: url,
                qs: properties,
                json: true,
                ttl: cacheTTL ? cacheTTL : null,
            }, function (error, response, result) {
                if (error) {
                    console.log(`Request failed with ${error}, url: ${url}, properties: ${JSON.stringify(properties)}`);
                    return reject(error);
                }
                else if (response.statusCode != 200) {
                    console.log(`Request failed with status code ${response.statusCode}, url: ${url}, properties: ${JSON.stringify(properties)}`);
                    return reject(new Error(`Request failed with status code ${response.statusCode}, url: ${url}, properties: ${JSON.stringify(properties)}`));
                }
                resolve(result);
            });
        }.bind(this));
    }
}
exports.RequestCache = RequestCache;
//# sourceMappingURL=cached-request.js.map