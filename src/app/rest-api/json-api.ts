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

  getTopPlayed(limit: number): Promise<any> {
    return this._getLicensesForEntries({state: 'published'}, limit, {directPlayCount: 'desc'})
      .then(function(licenses) {
        // secondary sort based on plays recorded in the blockchain.  This is the number that will
        // show on the screen, but it's too slow to pull all licenses and sort.  So, sort fast with
        // our local db, then resort top results to it doesn't look stupid on the page.
        return licenses.sort((a, b) => {
          const v1 = a.playCount ? a.playCount : 0;
          const v2 = b.playCount ? b.playCount : 0;
          return v2 - v1; // descending
        })
      })
  }

  getRecentPlays(limit: number): Promise<any> {
    // grab the top 2*n from the db to try to get a distinct list that is long enough.
    return Playback.find({}).sort({playbackDate: 'desc'}).limit(2*limit).exec()
      .then(records => records.map(r => r.contractAddress))
      .then(addresses => Array.from(new Set(addresses))) // insertion order is preserved
      .then(addresses => addresses.slice(0, Math.min(addresses.length, limit)))
      .then(addresses => addresses.map(address => this.getLicense(address)))
      .then(promises => Promise.all(promises))
  }

  getFeaturedArtists(limit: number) {
    // HACK
    return this.getNewArtists(limit);
  }

  getNewArtists(limit: number) {
    return User.find({profileAddress: {$ne: null}}).sort({joinDate: 'desc'}).limit(limit).exec()
      .then(records => records.map(r => this._convertDbRecordToArtist(r)))
      .then(promises => Promise.all(promises))
  }

  _getLicensesForEntries(condition: any, limit?: number, sort?: any): Promise<any> {
    return this._getReleaseEntries(condition, limit, sort)
      .then(items => items.map(item => this._convertDbRecordToLicense(item)))
      .then(promises => Promise.all(promises));
}

  _getReleaseEntries(condition: any, limit?: number, _sort?: any) {
    let sort = _sort ? _sort : {releaseDate: 'desc'};
    let query = Release.find(condition).sort(sort);
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
        if (license.artistName) return license;

        console.log("Looking up artist: " + license.artistProfileAddress);
        return User.findOne({profileAddress: license.artistProfileAddress}).exec()
          .then(function(record) {
            if (record && record.artistName) {
              license.artistName = record.artistName;
            }
            else {
              license.artistName = "";
            }
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