import {Promise} from 'bluebird';
import {MusicoinHelper} from "../musicoin-helper";
import {MusicoinAPI} from "../musicoin-api";
const User = require('../../app/models/user');
const Release = require('../../app/models/release');
const Playback = require('../../app/models/playback');

const knownGenres = [
  "Alternative Rock",
  "Ambient",
  "Classical",
  "Country",
  "Dance & EDM",
  "Dancehall",
  "Deep House",
  "Disco",
  "Drum & Bass",
  "Electronic",
  "Folk & Singer-Songwriter",
  "Hip-hop & Rap",
  "House",
  "Indie",
  "Jazz & Blues",
  "Latin",
  "Metal",
  "Piano",
  "Pop",
  "R&B & Soul",
  "Reggae",
  "Reggaeton",
  "Rock",
  "Soundtrack",
  "Techno",
  "Trance",
  "World",
  "Other"
];

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

  getTopPlayed(limit: number, genre?: string): Promise<any> {
    const filter = genre ? {state: 'published', genres: genre} : {state: 'published'};
    return this._getLicensesForEntries(filter, limit, {directPlayCount: 'desc'})
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

  getNewArtists(limit: number, _search?: string, _genre?: string) {
    const search = this._sanitize(_search);
    const genre = this._sanitize(_genre);

    let query = User.find({profileAddress: {$ne: null}})
      .where({hideProfile: {$ne: true}});

    if (search) {
      query = query.where({"draftProfile.artistName": {"$regex": search, "$options": "i"}})
    }

    if (genre) {
      query = query.where({"draftProfile.genres": genre});
    }

    return query.limit(limit).exec()
      .then(records => records.map(r => this._convertDbRecordToArtist(r)))
      .then(promises => Promise.all(promises))
  }

  getNewReleases(limit: number, genre?: string): Promise<any> {
    const filter = genre ? {state: 'published', genres: genre} : {state: 'published'};
    return this._getLicensesForEntries(filter, limit);
  }

  getNewReleasesByGenre(limit: number, maxGroupSize: number, _search?: string, _genre?:string): Promise<any> {
    const search = this._sanitize(_search);
    const genre = this._sanitize(_genre);
    const flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);
    const artistList = search
      ? User.find({"draftProfile.artistName": {"$regex": search, "$options": "i"}}).exec()
        .then(records => records.map(r => r.profileAddress))
      : Promise.resolve([]);

    return artistList
      .then(profiles => {
        let releaseQuery = Release.find({state: "published"});
        if (search) {
          releaseQuery = releaseQuery.where({$or: [
            {artistAddress: {$in: profiles}},
            {title: {"$regex": search, "$options": "i"}}]})
        }
        if (genre) {
          releaseQuery = releaseQuery.where({"genres": genre})
        }

        return releaseQuery
          .sort([["directPlayCount", 'desc'], ["releaseDate", 'desc']])
          .limit(limit)
          .exec()
          .then(items => {
            const genreOrder = [];
            const genreItems = {};
            for (let i=0; i < items.length; i++) {
              const item = items[i];
              const itemGenres = item.genres.slice(0);
              itemGenres.push("Other");
              for (let g=0; g < itemGenres.length; g++) {
                const genre = itemGenres[g];
                if (knownGenres.indexOf(genre) == -1) continue;
                if (genreOrder.indexOf(genre) == -1) {
                  genreOrder.push(genre);
                  genreItems[genre] = [];
                }
                if (genreItems[genre].length < maxGroupSize) {
                  item.genres = genre;
                  genreItems[genre].push(item);
                  break;
                }
              }
            }
            return flatten(genreOrder.map(g => genreItems[g]));
          })
          .then(items => items.map(item => this._convertDbRecordToLicense(item)))
          .then(promises => Promise.all(promises));
      })
  }

  getTransactionHistory(address: string, length: number, start: number): Promise<any> {
    return this.musicoinAPI.getTransactionHistory(address, length, start);
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
        if (!license.artistName)
          license.artistName = record.artistName;
        license.genres = record.genres;
        return license;
      })
  }

  _sanitize(s: string) {
    return s ? s.replace(/[^a-zA-Z0-9]/g, ' ').trim() : s;
  }
}