import {Promise} from 'bluebird';
import {MusicoinHelper} from "../musicoin-helper";
import {MusicoinAPI} from "../musicoin-api";
const User = require('../../app/models/user');
const Release = require('../../app/models/release');
const Playback = require('../../app/models/playback');

export interface ArtistProfile {
  artist: any,
  releases: any[],
  pendingReleases: any[]
}

export class MusicoinOrgJsonAPI {
  constructor(private musicoinAPI: MusicoinAPI, private mcHelper: MusicoinHelper) {
  }

  getArtist(address: string, includeReleases: boolean, includePending: boolean): Promise<ArtistProfile> {
    if (!address) {
      return Promise.resolve({
        artist: {},
        releases: [],
        pendingReleases: []
      });
    }

    const a = User.findOne({profileAddress: address}).exec()
      .then(dbRecord => {
        if (!dbRecord) return null;
        return this.mcHelper.getArtistProfile(address)
      });

    const rs = !includeReleases
      ? Promise.resolve(null)
      : this._getLicensesForEntries({artistAddress: address, state: 'published'});

    const ps = !includePending
      ? Promise.resolve(null)
      : this._getReleaseEntries({artistAddress: address, state: 'pending'})

    return Promise.join(a, rs, ps, function(artist, releases, pendingReleases) {
      if (!artist) return null;
      return {
        artist: artist,
        releases: releases,
        pendingReleases: pendingReleases
      }
    });
  }

  getNewReleases(limit: number): Promise<any> {
    return this._getLicensesForEntries({state: 'published'}, limit);
  }

  getRecentPlays(limit: number): Promise<any> {
    return Playback.find({}).sort({playbackDate: 'desc'}).limit(limit).exec()
      .then(records => records.map(r => r.contractAddress))
      .then(addresses => Array.from(new Set(addresses))) // insertion order is preserved
      .then(addresses => addresses.map(address => this.getLicense(address)))
      .then(promises => Promise.all(promises))
  }

  getNewArtists(limit: number) {
    // TODO: Sort
    return User.find({profileAddress: {$ne: null}}).limit(limit).exec()
      .then(records => records.map(r => this._convertDbRecordToArtist(r)))
      .then(promises => Promise.all(promises))
  }

  _getLicensesForEntries(condition: any, limit?: number) {
    return this._getReleaseEntries(condition, limit)
      .then(items => items.map(item => this._convertDbRecordToLicense(item)))
      .then(promises => Promise.all(promises));
}

  _getReleaseEntries(condition: any, limit?: number) {
    let query = Release.find(condition).sort({releaseDate: 'desc'});
    if (limit) {
      query = query.limit(limit);
    }

    return query.exec()
  }

  _convertDbRecordToArtist(record) {
    return this.mcHelper.getArtistProfile(record.profileAddress)
      .then(function(artist) {
        artist.profileAddress = record.profileAddress;
        return artist;
      });
  }

  getLicense(contractAddress: string): Promise<any> {
    console.log("Getting license: " + contractAddress);
    return this.mcHelper.getLicense(contractAddress)
      .bind(this)
      .then(function(license) {
        console.log("Getting license: " + contractAddress + " ... done");
        return User.findOne({profileAddress: license.artistProfileAddress}).exec()
          .then(function(record) {
            license.artistName = record.artistName;
            return license;
          })
      })
  }

  _convertDbRecordToLicense(record) {
    return this.mcHelper.getLicense(record.contractAddress)
      .bind(this)
      .then(function(license) {
        license.artistName = record.artistName;
        return license;
      })
  }
}