"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bluebird_1 = require("bluebird");
const fs = require("fs");
const request = require("request");
const os = require("os");
const cachedRequest = require('cached-request')(request);
const cacheDir = os.tmpdir() + "/request-cache";
cachedRequest.setCacheDirectory(cacheDir);
cachedRequest.setValue('ttl', 30000);
class MusicoinAPI {
    constructor(apiConfig) {
        this.apiConfig = apiConfig;
    }
    getKey(licenseAddress) {
        return this.getJson(this.apiConfig.getKey + '/' + licenseAddress)
            .then(function (response) {
            if (response.err)
                throw response.err;
            return response;
        });
    }
    getTransactionHistory(address, length, start) {
        return this.getJson(this.apiConfig.getTransactionHistory + "/" + address, 5000, {
            length: length,
            start: start
        });
    }
    getAccountBalances(addresses) {
        return bluebird_1.Promise.all(addresses.map(a => this.getAccountBalance(a)));
    }
    getAccountBalance(address) {
        return this.getJson(`${this.apiConfig.getAccountBalance}/${address}`, 5000)
            .then((balance) => {
            try {
                balance.formattedMusicoins = parseInt(balance.musicoins).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            }
            catch (e) {
                console.log(e);
                return 0;
            }
            try {
                balance.formattedMusicoinsShort = this._formatShortNumber(balance.musicoins);
            }
            catch (e) {
                console.log(e);
                return 0;
            }
            return balance;
        });
    }
    getMusicoinAccountBalance() {
        return this.getJson(this.apiConfig.getClientBalance, 5000)
            .then(function (balance) {
            balance.formattedMusicoins = parseInt(balance.musicoins).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            return balance;
        });
    }
    getTransactionStatus(tx) {
        return this.getJson(this.apiConfig.getTransactionStatus + '/' + tx);
    }
    getProfile(profileAddress) {
        return this.getJson(this.apiConfig.getProfile + '/' + profileAddress, 60 * 1000);
    }
    getLicenseDetails(licenseAddress) {
        return this.getJson(this.apiConfig.getLicenseDetails + '/' + licenseAddress, 60 * 1000);
    }
    updateTrack(contractAddress, title, imageUrl, metadataUrl, contributors) {
        console.log(`updating track ${title} @ ${contractAddress}`);
        return this.postJson(this.apiConfig.updateLicense, {
            contractAddress: contractAddress,
            title: title,
            imageUrl: imageUrl,
            metadataUrl: metadataUrl,
            contributors: contributors
        }).then(body => body.txs);
    }
    releaseTrack(profileAddress, artistName, title, imageUrl, metadataUrl, audioUrl, contributors, royalties, contentType, key) {
        console.log(`releasing track ${title}`);
        return this.postJson(this.apiConfig.releaseLicense, {
            profileAddress: profileAddress,
            artistName: artistName,
            title: title,
            imageUrl: imageUrl,
            metadataUrl: metadataUrl,
            audioUrl: audioUrl,
            contributors: contributors,
            royalties: royalties,
            contentType: contentType,
            encryptionKey: key
        }).then(body => body.tx);
    }
    sendFromProfile(profileAddress, recipientAddress, musicoins) {
        return this.postJson(this.apiConfig.sendFromProfile, {
            profileAddress: profileAddress,
            recipientAddress: recipientAddress,
            musicoins: musicoins
        }).then(body => body.tx);
    }
    distributeBalance(licenseAddress) {
        return this.postJson(this.apiConfig.distributeLicenseBalance, {
            address: licenseAddress
        }).then(body => body.tx);
    }
    pppFromProfile(profileAddress, licenseAddress) {
        return this.postJson(this.apiConfig.pppFromProfile, {
            profileAddress: profileAddress,
            licenseAddress: licenseAddress
        })
            .then(function (response) {
            if (response.err)
                throw response.err;
            return response;
        });
    }
    sendReward(recipient, musicoins) {
        return this.postJson(this.apiConfig.sendReward, {
            recipient: recipient,
            musicoins: musicoins
        }).then(body => body.tx);
    }
    publishProfile(profileAddress, artistName, descriptionUrl, imageUrl, socialUrl) {
        return this.postJson(this.apiConfig.publishProfile, {
            profileAddress: profileAddress,
            artistName: artistName,
            descriptionUrl: descriptionUrl,
            imageUrl: imageUrl,
            socialUrl: socialUrl,
        }).then(body => body.tx);
    }
    postJson(url, postData) {
        return new bluebird_1.Promise(function (resolve, reject) {
            console.log(`Sending post ${url},  data=${JSON.stringify(postData)}`);
            const options = {
                method: 'post',
                body: postData,
                json: true,
                url: url,
                headers: {
                    clientID: this.apiConfig.clientID,
                    clientSecret: this.apiConfig.clientSecret
                }
            };
            request(options, function (err, res, body) {
                if (err) {
                    console.log(err);
                    return reject(err);
                }
                else if (res.statusCode != 200) {
                    console.log(`Request failed with status code ${res.statusCode}, url: ${url}`);
                    return reject(new Error(`Request failed with status code ${res.statusCode}, url: ${url}`));
                }
                resolve(body);
            });
        }.bind(this));
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
        const key = MusicoinAPI.hashKey(JSON.stringify(options));
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
                    fs.unlink(cacheFile, err => {
                        // it's ok, this can happen if another thread deleted it first
                    });
                    MusicoinAPI.makeRequest(options, cacheFile, callback);
                });
            }
            else {
                MusicoinAPI.makeRequest(options, cacheFile, callback);
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
        var hash = 0, i, chr, len;
        if (key.length == 0)
            return hash;
        for (i = 0, len = key.length; i < len; i++) {
            chr = key.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        ;
        return hash;
    }
    ;
    _getJson(url, cacheTTL, properties) {
        const requestImpl = cacheTTL ? MusicoinAPI.localImpl : request;
        return new bluebird_1.Promise(function (resolve, reject) {
            requestImpl({
                url: url,
                qs: properties,
                json: true,
                ttl: cacheTTL ? cacheTTL : null,
                headers: {
                    clientID: this.apiConfig.clientID,
                    clientSecret: this.apiConfig.clientSecret
                }
            }, function (error, response, result) {
                if (error) {
                    console.log(`Request failed with ${error}, url: ${url}, properties: ${JSON.stringify(properties)}`);
                    return bluebird_1.Promise.reject(error).catch(error => { console.log('Caught Error!', error.message); });
                }
                else if (response.statusCode != 200) {
                    console.log(`Request failed with status code ${response.statusCode}, url: ${url}, properties: ${JSON.stringify(properties)}`);
                    return bluebird_1.Promise.reject(new Error(`Request failed with status code ${response.statusCode}, url: ${url}, properties: ${JSON.stringify(properties)}`)).catch(error => { console.log('Caught Error!', error.message); });
                }
                resolve(result);
            });
        }.bind(this));
    }
    _formatShortNumber(value) {
        if (!value || value == 0)
            return 0;
        if (value < 1)
            return parseFloat(value).toFixed(1);
        const lookup = ["", "k", "M", "B", "T"];
        var order = Math.min(Math.floor(Math.log10(value) / 3), lookup.length - 1);
        var mult = value / Math.pow(10, 3 * order);
        var decimals = order > 0 ? 1 : 0;
        return mult.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + lookup[order];
    }
}
exports.MusicoinAPI = MusicoinAPI;
//# sourceMappingURL=musicoin-api.js.map