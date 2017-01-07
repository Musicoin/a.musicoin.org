import {Promise} from 'bluebird';
import {MusicoinAPI} from "./musicoin-api";

export class MusicoinHelper {
  constructor(public musicoinApi: MusicoinAPI, public mediaProvider: any) {
  }

  getArtistProfile(profileAddress: string) {
    return this.musicoinApi.getProfile(profileAddress)
      .then((profile) => {
        const s = this.mediaProvider.readJsonFromIpfs(profile.socialUrl)
        const d = this.mediaProvider.readTextFromIpfs(profile.descriptionUrl);
        return Promise.join(s, d, function(social, description){
          profile.image = this.mediaProvider.resolveIpfsUrl(profile.imageUrl);
          profile.social = social;
          profile.description = description;
          return profile;
        }.bind(this))
      });
  };

  getLicense(address: string) {
    return this.musicoinApi.getLicenseDetails(address)
      .then(license => {
        license.image = this.mediaProvider.resolveIpfsUrl(license.imageUrl);
        license.audioUrl = "/ppp/" + license.address;
        return license;
      })
  }
}