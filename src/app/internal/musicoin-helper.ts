import { Promise } from 'bluebird';

import * as UrlUtils from '../utils/url-utils';
import { MusicoinAPI } from './musicoin-api';

export class MusicoinHelper {
  constructor(public musicoinApi: MusicoinAPI, public mediaProvider: any, public playbackLinkTTLMillis: number) {
  }

  getArtistProfile(profileAddress: string) {
    return this.musicoinApi.getProfile(profileAddress)
      .then((profile) => {
        const s = this.mediaProvider.readJsonFromIpfs(profile.socialUrl).catchReturn({});
        const d = this.mediaProvider.readTextFromIpfs(profile.descriptionUrl).catchReturn("");
        return Promise.join(s, d, function (social, description, artistName) {
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
        try {
          license.image = this.mediaProvider.resolveIpfsUrl(license.imageUrl);
        } catch (e) {
          console.log(e);
          return license;
        }
        try {
          license.audioUrl = "/ppp/" + UrlUtils.createExpiringLink(license.address, this.playbackLinkTTLMillis);
        } catch (e) {
          console.log(e);
          return license;
        }
        return license;
      })
  }
}
