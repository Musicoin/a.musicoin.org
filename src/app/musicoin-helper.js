"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bluebird_1 = require("bluebird");
const UrlUtils = require("./url-utils");
class MusicoinHelper {
    constructor(musicoinApi, mediaProvider, playbackLinkTTLMillis) {
        this.musicoinApi = musicoinApi;
        this.mediaProvider = mediaProvider;
        this.playbackLinkTTLMillis = playbackLinkTTLMillis;
    }
    getArtistProfile(profileAddress) {
        return this.musicoinApi.getProfile(profileAddress)
            .then((profile) => {
            const s = this.mediaProvider.readJsonFromIpfs(profile.socialUrl).catchReturn({});
            const d = this.mediaProvider.readTextFromIpfs(profile.descriptionUrl).catchReturn("");
            return bluebird_1.Promise.join(s, d, function (social, description) {
                profile.image = profile.imageUrl ? this.mediaProvider.resolveIpfsUrl(profile.imageUrl) : "";
                profile.social = social;
                profile.description = description;
                profile.profileAddress = profileAddress;
                return profile;
            }.bind(this));
        });
    }
    ;
    getLicense(address) {
        return this.musicoinApi.getLicenseDetails(address)
            .then(license => {
            try {
                license.image = this.mediaProvider.resolveIpfsUrl(license.imageUrl);
            }
            catch (e) {
                console.log(e);
                return license;
            }
            try {
                license.audioUrl = "/ppp/" + UrlUtils.createExpiringLink(license.address, this.playbackLinkTTLMillis);
            }
            catch (e) {
                console.log(e);
                return license;
            }
            return license;
        });
    }
}
exports.MusicoinHelper = MusicoinHelper;
//# sourceMappingURL=musicoin-helper.js.map