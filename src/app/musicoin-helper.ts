import {Promise} from 'bluebird';
import {MusicoinAPI} from "./musicoin-api";

export class MusicoinHelper {
  constructor(public musicoinApi: MusicoinAPI, public mediaProvider: any) {
  }

  getArtistProfileAndTracks(profileAddress: string, licenses: string[]) {
    const p = this.musicoinApi.getProfile(profileAddress)
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

    const r = licenses
      .map(address => {
        return this.musicoinApi.getLicenseDetails(address)
          .then(license => this.loadLicenseData(license))
      });

    return Promise.join(p, Promise.all(r), function(profile, releases) {
      profile.releases = releases;
      return profile;
    });
  }

  loadLicenseData(license: any) {
    return new Promise(function(resolve, reject) {
      license.image = this.mediaProvider.resolveIpfsUrl(license.imageUrl);
      license.audioUrl = "/ppp/" + license.address;
      resolve(license);
    }.bind(this));
  }
}