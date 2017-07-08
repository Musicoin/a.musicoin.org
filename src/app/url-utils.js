"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require("crypto");
const key = ")3(*D)*)(*3)(6S7DF";
const algorithm = 'aes-256-ctr';
function createExpiringLink(text, ttlMillis) {
    return encryptText(text + ":" + (Date.now() + ttlMillis));
}
exports.createExpiringLink = createExpiringLink;
function resolveExpiringLink(encrypted) {
    if (!encrypted)
        return null;
    const decrypted = decryptText(encrypted);
    const idx = decrypted.lastIndexOf(":");
    try {
        if (idx > 0) {
            if (Date.now() < parseInt(decrypted.substr(idx + 1))) {
                return decrypted.substr(0, idx);
            }
        }
    }
    catch (e) {
        console.log("Failed to decode expiring link: " + encrypted + " -> " + decrypted);
    }
    // link expired or failed
    return null;
}
exports.resolveExpiringLink = resolveExpiringLink;
const decryptText = function (text) {
    var decipher = crypto.createDecipher(algorithm, key);
    var dec = decipher.update(text, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
};
const encryptText = function (text) {
    var cipher = crypto.createCipher(algorithm, key);
    var crypted = cipher.update(text, 'utf8', 'hex');
    crypted += cipher.final('hex');
    return crypted;
};
//# sourceMappingURL=url-utils.js.map