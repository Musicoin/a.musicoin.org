import {Promise} from 'bluebird';
import {MusicoinAPI} from "./musicoin-api";
import * as UrlUtils from "./url-utils";

export class MusicoinHelper {
  constructor(public musicoinApi: MusicoinAPI, public mediaProvider: any) {
  }

  getArtistProfile(profileAddress: string) {
    return this.musicoinApi.getProfile(profileAddress)
      .then((profile) => {
        const s = this.mediaProvider.readJsonFromIpfs(profile.socialUrl).catchReturn({});
        const d = this.mediaProvider.readTextFromIpfs(profile.descriptionUrl).catchReturn("");
        return Promise.join(s, d, function(social, description){
          profile.image = profile.imageUrl ? this.mediaProvider.resolveIpfsUrl(profile.imageUrl) : "";
          profile.social = social;
          profile.description = description;
          profile.profileAddress = profileAddress;
          return profile;
        }.bind(this))
      });
  };

  getLicense(address: string) {
    return this.musicoinApi.getLicenseDetails(address)
      .then(license => {
        license.image = this.mediaProvider.resolveIpfsUrl(license.imageUrl);
        license.audioUrl = "/ppp/" + UrlUtils.createExpiringLink(license.address, 60000);
        return license;
      })
  }
}