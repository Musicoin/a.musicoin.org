import {Promise} from 'bluebird';
import {MusicoinHelper} from "../musicoin-helper";
import {MusicoinAPI} from "../musicoin-api";
import * as moment from "moment";
import * as FormUtils from "../form-utils";
import * as crypto from 'crypto';
import {MailSender} from "../mail-sender";
import unitOfTime = moment.unitOfTime;
const User = require('../../app/models/user');
const UserStats = require('../../app/models/user-stats');
const Follow = require('../../app/models/follow');
const Release = require('../../app/models/release');
const PendingPlayback = require('../../app/models/pending-playback');
const ReleaseStats = require('../../app/models/release-stats');
const Playback = require('../../app/models/playback');
const UserPlayback = require('../../app/models/user-playback');
const ReportActivity = require('../../app/models/report-activity');
const InviteRequest = require('../../app/models/invite-request');
const TrackMessage = require('../../app/models/track-message');
const Hero = require('../../app/models/hero');
const ErrorReport = require('../../app/models/error-report');
// const defaultProfileIPFSImage = "ipfs://QmQTAh1kwntnDUxf8kL3xPyUzpRFmD3GVoCKA4D37FK77C";
const defaultProfileIPFSImage = "ipfs://QmR8mmsMn9TUdJiA6Ja3SYcQ4ckBdky1v5KGRimC7LkhGF";
const uuidV4 = require('uuid/v4');

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

export interface Hero {
  title: string,
  titleLink: string,
  subtitle: string,
  subtitleLink: string,
  image: string,
  profileImage: string,
  licenseAddress?: string,
  label: string,
}

export class MusicoinOrgJsonAPI {
  constructor(private musicoinAPI: MusicoinAPI,
              private mcHelper: MusicoinHelper,
              private mediaProvider,
              private mailSender: MailSender,
              private config: any) {
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
        return this._convertDbRecordToArtist(dbRecord)
      });

    const rs = !includeReleases
      ? Promise.resolve(null)
      : this._getLicensesForEntries({artistAddress: address, state: 'published'});

    const ps = !includePending
      ? Promise.resolve(null)
      : this._getReleaseEntries({artistAddress: address, state: 'pending'});

    return Promise.join(a, rs, ps, function(artist, releases, pendingReleases) {
      if (!artist) return null;
      return {
        artist: artist,
        releases: releases,
        pendingReleases: pendingReleases
      }
    });
  }

  addInviteRequest(email: string, musician: boolean): Promise<any> {
    return InviteRequest.findOne({username: {"$regex": email, "$options": "i"}, source: "waitlist"}).exec()
      .then(request => {
        let insert = Promise.resolve();
        if (!request) {
          const query = {username: email, source: "waitlist", musician: musician},
            update = {},
            options = {upsert: true, new: true, setDefaultsOnInsert: true};

          // Find the document
          insert = InviteRequest.findOneAndUpdate(query, update, options);
        }
        const condition = request ? {requestDate: {$lt: request.requestDate}} : {};
        const exists = !!request;
        return insert.then(() => InviteRequest.count(condition).exec())
          .then(count => {
            return {
              address: email,
              exists: exists,
              position: exists ? count : count-1,
              success: true
            }
          })
      });
  }

  removeInviteRequest(_id: string): Promise<any> {
    return InviteRequest.findByIdAndRemove(_id).exec()
      .then((removed) => {
        if (removed) {
          console.log(`Removed waitlist entry: ${removed.username}`);
          return {success: true}
        }
        return {success: false, reason: "Not found"}
      })
      .catch((err) => {
        console.log(`Failed to remove waitlist entry: ${err}`);
        return {success: false, reason: "Error"}
      })
  }

  sendRewardsForInvite(p: any): Promise<any> {
    if (!p || !p.invite || !p.invite.invitedBy) {
      console.log(`Could not send an invite reward, user did not have an invite, newUser.id: ${p._id}, invite: ${JSON.stringify(p.invite)}`);
      return Promise.resolve();
    }

    return User.findById(p.invite.invitedBy).exec()
      .then(sender => {
        if (!sender || !sender.invite) {
          console.log("Not sending reward because there is no sender or not sender invite field")
          return {};
        }
        if (sender.invite.noReward) {
          console.log("Not sending reward because the sender was blacklisted, or inherited blacklist status: " + sender.profileAddress);
          return {};
        }

        if (this._onlyEmailAuth(sender)) {
          console.log("Not sending reward because the sender does not have a social account linked: " + sender.profileAddress + ", email: " + sender.local.email);
          return {};
        }

        console.log(`Sending invite rewards: invitee=${p.profileAddress}, and inviter=${sender.profileAddress}, since sender.invite.noReward = '${sender.invite.noReward}'`);
        const sendRewardToInvitee = this.musicoinAPI.sendReward(p.profileAddress, this.config.rewards.forAcceptingInvite);
        const sendRewardToInviter = this.musicoinAPI.sendReward(sender.profileAddress, this.config.rewards.forInviteeJoining);
        return Promise.join(sendRewardToInvitee, sendRewardToInviter, (tx1, tx2) => {
          return {
            inviteeRewardTx: tx1,
            inviterRewardTx: tx2
          }
        });
      })
  }

  sendInvite(sender: any, email: string): Promise<any> {
    let promise = Promise.resolve(null);
    if (email) {
      email = email.trim();
      if (!FormUtils.validateEmail(email)) {
        console.log(`Invalid email address provided: ${email}`);
        return Promise.resolve({
          email: email,
          from: sender._id,
          success: false,
          reason: "invalid"
        });
      }
      const conditions = [];
      conditions.push({"invite.invitedAs": {"$regex": email, "$options": "i"}});
      conditions.push({"google.email": {"$regex": email, "$options": "i"}});
      promise = User.findOne({$or: conditions}).exec()
    }
    return promise.then((existingUser) => {
      if (!existingUser) {
        const newUser = new User();
        const inviteCode = crypto.randomBytes(4).toString('hex');
        newUser.invite = {
          noReward: sender.invite ? !!sender.invite.noReward : false,
          invitedBy: sender._id,
          invitedAs: email,
          inviteCode: inviteCode,
          invitedOn: Date.now(),
          claimed: false
        };
        return newUser.save()
          .then(() => {
            // if an and email address was provided, send an email, otherwise just generate the link
            const invite = {
              invitedBy: sender.draftProfile.artistName,
              acceptUrl: this.config.serverEndpoint + "/accept/" + inviteCode
            };
            return email
              ? this.mailSender.sendInvite(email, invite)
              : null;
          })
          .then(() => {
            console.log(`Sent invite to ${email}`);
            sender.invitesRemaining--;
            return sender.save();
          })
          .then(() => {
            return {
              email: email,
              from: sender._id,
              success: true,
              inviteCode: inviteCode
            }
          })
          .catch(function (err) {
            console.log(err);
            return {
              email: email,
              from: sender._id,
              success: false,
              reason: "error"
            }
          });
      }
      else {
        console.log(`User already exists: ${email}`);
        return {
          email: email,
          from: sender._id,
          success: false,
          reason: "exists"
        }
      }
    })
      .catch(function (err) {
        console.log(err);
        return {
          email: email,
          from: sender._id,
          success: false,
          reason: "error"
        }
      });
  }

  getPlaybackHistory(userId: string, releaseId: string, start: number, length: number): Promise<any> {
    let conditions = [];
    if (userId) conditions.push({user: userId});
    if (releaseId) conditions.push({release: releaseId});


    const rs = UserPlayback.find(conditions.length > 0 ? {$or: conditions} : {})
      .sort({"playbackDate": 'desc'})
      .skip(start)
      .limit(length)
      .populate("user")
      .populate("release")
      .exec();

    const t = UserPlayback.count();
    return Promise.join(rs, t, (records, total) => {
      return {
        records: records,
        total: total
      }
    })
  }

  getAllInviteRequests(_search: string, start: number, length: number): Promise<any> {
    const search = this._sanitize(_search);
    let filter = {};
    if (search) {
      filter = {$or: [
        {"username": {"$regex": search, "$options": "i"}},
        {"source": {"$regex": search, "$options": "i"}}
      ]};
    }
    return InviteRequest.find(filter)
      .sort({"requestDate": 'asc'})
      .skip(start)
      .limit(length)
      .exec();
  }

  getAllUsers(_search: string, invitedById: string, verified: string, artist: string, start: number, length: number): Promise<any> {
    let filter = {};
    if (_search) {
      const search = _search.trim();
      filter = {$or: [
        {"draftProfile.artistName": {"$regex": search, "$options": "i"}},
        {"profileAddress": {"$regex": search, "$options": "i"}},
        {"invite.invitedAs": {"$regex": search, "$options": "i"}},
        {"invite.inviteCode": {"$regex": search, "$options": "i"}},
        {"invite.groupInviteCode": {"$regex": search, "$options": "i"}},
        {"google.email": {"$regex": search, "$options": "i"}},
        {"google.name": {"$regex": search, "$options": "i"}},
        {"twitter.username": {"$regex": search, "$options": "i"}},
        {"twitter.displayName": {"$regex": search, "$options": "i"}},
        {"facebook.email": {"$regex": search, "$options": "i"}},
        {"facebook.name": {"$regex": search, "$options": "i"}},
        {"soundcloud.name": {"$regex": search, "$options": "i"}},
        {"soundcloud.username": {"$regex": search, "$options": "i"}},
        {"local.email": {"$regex": search, "$options": "i"}},
      ]};
    }
    if (invitedById) {
      filter["invite.invitedBy"] = invitedById;
    }
    if (verified) {
      filter["verified"] = verified == "true" ? {$eq: true} : {$ne: true};
    }
    if (artist) {
      filter["mostRecentReleaseDate"] = artist == "true" ? { $exists: true, $ne: null } : {$not: { $exists: true, $ne: null }};
    }

    const c = User.count(filter).exec()
    const u = User.find(filter).sort({"invite.invitedOn": 'desc'})
      .skip(start)
      .limit(length)
      .populate("invite.invitedBy")
      .exec()
      .map(user => {
        user.timeSinceJoining = this._timeSince(user.joinDate);
        return user;
      });
    return Promise.join(c, u, (count, users) => {
      return {
        count: count,
        users: users
      }
    })
  }

  getAddressBook(_search: string, start: number, length: number): Promise<any> {
    let filter = {};
    if (_search) {
      const search = _search.trim();
      filter = {$or: [
        {"draftProfile.artistName": {"$regex": search, "$options": "i"}},
        {"invite.invitedAs": {"$regex": search, "$options": "i"}},
        {"google.email": {"$regex": search, "$options": "i"}},
        {"google.name": {"$regex": search, "$options": "i"}},
        {"twitter.username": {"$regex": search, "$options": "i"}},
        {"twitter.displayName": {"$regex": search, "$options": "i"}},
        {"facebook.email": {"$regex": search, "$options": "i"}},
        {"facebook.name": {"$regex": search, "$options": "i"}},
        {"soundcloud.name": {"$regex": search, "$options": "i"}},
        {"soundcloud.username": {"$regex": search, "$options": "i"}},
      ]};
    }
    let query = User.find(filter)
      .where({profileAddress: { $exists: true, $ne: null }})
      .sort({"invite.invitedOn": 'desc'})
      .skip(start)

    if (length > 0) {
      query = query.limit(length);
    }

    return query
      .exec()
      .then(allRecords => {
        return allRecords.map(user => {
          return {
            name: this._getUserName(user),
            email: this._getUserEmail(user),
            artistName: user.draftProfile ? user.draftProfile.artistName : "",
            profileAddress: user.profileAddress
          }
        })
      });
  }

  getAllReleases(_search: string, start: number, length: number): Promise<any> {
    let filter = {};
    if (_search) {
      const search = _search.trim();
      filter = {$or: [
        {"artistName": {"$regex": search, "$options": "i"}},
        {"artistAddress": {"$regex": search, "$options": "i"}},
        {"title": {"$regex": search, "$options": "i"}},
        {"contractAddress": {"$regex": search, "$options": "i"}},
      ]};
    }
    const c = Release.count(filter).exec();
    const rs = this._getReleaseEntriesByPage(filter, start, length, {"releaseDate": 'desc'});
    return Promise.join(c, rs, (count, releases) => {
      return {
        count: count,
        releases: releases
      }
    });
  }

  getInvitedBy(userId: string, start: number, length: number): Promise<any> {
    return User.find({"invite.invitedBy": userId})
      .sort({"invite.invitedOn": 'desc'})
      .skip(start)
      .limit(length)
      .exec()
      .then(records => {
        return records.map(u => {
          const invite = u.invite;
          invite.profileAddress = u.profileAddress;
          invite.artistName = u.draftProfile ? u.draftProfile.artistName : "";
          invite.hasReleased = !!u.mostRecentReleaseDate;
          return invite;
        })
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

  getTopPlayedLastPeriod(limit: number, period: string): Promise<any> {
    const start = MusicoinOrgJsonAPI._getPreviousDatePeriodStart(Date.now(), period);
    return ReleaseStats.find({startDate: start, duration: period})
      .sort({"playCount": "desc"})
      .populate("release")
      .limit(Math.max(20, limit))
      .exec()
      .then(statsRecords => {
        return statsRecords
          .filter(sr => sr.release)
          .filter(sr => sr.release.state == "published")
          .filter(sr => !sr.release.markedAsAbuse)
          .slice(0, limit)
          .map(sr => {
          return this._convertDbRecordToLicense(sr.release)
            .then(output => {
              output.stats = {
                plays: sr.playCount,
                period: period
              }
              return output;
            });
        })
      })
      .then(promises => Promise.all(promises));
  }

  getTopTippedLastPeriod(limit: number, period: string): Promise<any> {
    const start = MusicoinOrgJsonAPI._getPreviousDatePeriodStart(Date.now(), period);
    return ReleaseStats.find({startDate: start, duration: period})
      .sort({"tipCount": "desc"})
      .populate("release")
      .limit(Math.max(20, limit))
      .exec()
      .then(statsRecords => {
        return statsRecords
          .filter(sr => sr.release)
          .filter(sr => sr.release.state == "published")
          .filter(sr => !sr.release.markedAsAbuse)
          .slice(0, limit)
          .map(sr => {
          return this._convertDbRecordToLicense(sr.release)
            .then(output => {
              output.stats = {
                tips: sr.tipCount,
                period: period
              }
              return output;
            });
        })
      })
      .then(promises => Promise.all(promises));
  }

  getHero(): Promise<Hero> {
    return Hero.find({startDate: {$lte: Date.now()}})
      .sort({startDate: 'desc'})
      .limit(1)
      .exec()
      .then(records => {
        if (records && records.length > 0) {
          return records[0];
        }
        throw new Error("No Hero defined!");
      })
      .catch((err) => {
        console.log("Failed to load hero, using fallback! " + err);
        return this.getFallbackHero();
      })
  }

  getUserHero(profileAddress: string): Promise<Hero> {
    return User.findOne({profileAddress: profileAddress}).exec()
      .then((user) => {
        return {
          subtitle: "",
          subtitleLink: "",
          title: user.draftProfile.artistName,
          titleLink: "",
          image: user.draftProfile.heroImageUrl
            ? this.mediaProvider.resolveIpfsUrl(user.draftProfile.heroImageUrl)
            : "",
          profileImage: this.mediaProvider.resolveIpfsUrl(user.draftProfile.ipfsImageUrl),
          licenseAddress: "",
          label: "",
          description: user.draftProfile
        }
      })
  }

  getFallbackHero(): Promise<Hero> {
    return this.getNewReleases(1)
      .then(releases => {
        const release = releases[0];
        return this._createHeroFromReleaseRecord(release, "images/hero.jpeg");
      })
  }

  private _createHeroFromReleaseRecord(release: any, image: string) {
    return {
      subtitle: release.title,
      subtitleLink: `/track/${release.address}`,
      title: release.artistName,
      titleLink: `/artist/${release.artistAddress}`,
      image: image,
      licenseAddress: release.address,
      label: "",
    }
  }

  markAsAbuse(licenseAddress: string, isAbuse: boolean): Promise<any> {
    return Release.findOne({contractAddress: licenseAddress}).exec()
      .then(release => {
        if (release) {
          release.markedAsAbuse = isAbuse;
          return release.save()
        }
      })
      .then(() => {
        return {success: true}
      })
      .catch(err => {
        console.log("Failed to mark track as abuse: " + err);
        return {
          success: false,
          reason: "Failed to mark track as abuse"
        }
      })
  }

  promoteTrackToHero(licenseAddress: string): Promise<any> {
    return Release.findOne({contractAddress: licenseAddress}).exec()
      .then(release => {
        if (!release) return {success: false, reason: "Release not found"};
        return User.findOne({profileAddress: release.artistAddress}).exec()
          .then(artist => {
            if (!artist) return {success: false, reason: "Artist not found"};
            if (!artist.draftProfile || !artist.draftProfile.heroImageUrl || artist.draftProfile.heroImageUrl.trim().length == 0)
              return {success: false, reason: "Artist does not have a promo image defined"};

            const hero = new Hero({
              subtitle: release.title,
              subtitleLink: `/track/${release.contractAddress}`,
              title: release.artistName,
              titleLink: `/artist/${release.artistAddress}`,
              image: this.mediaProvider.resolveIpfsUrl(artist.draftProfile.heroImageUrl),
              licenseAddress: release.contractAddress,
              label: "Artist of the Week",
              startDate: Date.now()
            });
            return hero.save()
              .then(() => {
                return {success: true}
              });
          })
      })
      .catch(err => {
        console.log("Failed to promote track to Hero: " + err);
        return {
          success: false,
          reason: "Failed to promote track to Hero"
        }
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
    // find recently joined artists that have at least one release
    let query = User.find({profileAddress: {$ne: null}})
      .where({mostRecentReleaseDate: {$ne: null}});

    return query.sort({joinDate: 'desc'}).limit(limit).exec()
      .then(records => records.map(r => this._convertDbRecordToArtist(r)))
      .then(promises => Promise.all(promises))
  }

  getAllArtists() {
    let query = User.find({profileAddress: {$ne: null}});
    return query.sort({joinDate: 'desc'}).exec()
      .then(records => records.map(r => this._convertDbRecordToArtist(r)))
      .then(promises => Promise.all(promises))
  }

  getNewArtists(limit: number, _search?: string, _genre?: string) {
    const search = this._sanitize(_search);
    const genre = this._sanitize(_genre);

    let query = User.find({profileAddress: { $exists: true, $ne: null }})
      .where({mostRecentReleaseDate: { $exists: true, $ne: null }});

    if (search) {
      query = query.where({
        $or: [
          {"draftProfile.artistName": {"$regex": search, "$options": "i"}},
          {"draftProfile.genres": {"$regex": search, "$options": "i"}},
          {"draftProfile.regions": {"$regex": search, "$options": "i"}}
        ]
      })
    }

    if (genre) {
      query = query.where({"draftProfile.genres": genre});
    }

    return query.sort({joinDate: 'desc'}).limit(limit).exec()
      .then(records => records.map(r => this._convertDbRecordToArtist(r)))
      .then(promises => Promise.all(promises))
  }

  getNewReleases(limit: number, genre?: string): Promise<any> {
    const filter = genre ? {state: 'published', genres: genre, markedAsAbuse: {$ne: true}} : {state: 'published', markedAsAbuse: {$ne: true}};
    return this._getLicensesForEntries(filter, limit);
  }

  getAllContracts() {
    const filter = {state: 'published'};
    return this._getLicensesForEntries(filter, 99999999);
  }

  getNewReleasesByGenre(limit: number, maxGroupSize: number, _search?: string, _genre?:string, _sort?:string): Promise<any> {
    const search = this._sanitize(_search);
    const genre = _genre;
    const flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);
    const sort = _sort == "plays"
      ? [["directPlayCount", 'desc'], ["directTipCount", 'desc'], ["releaseDate", 'desc']]
      : _sort == "date"
        ? [["releaseDate", 'desc'], ["directTipCount", 'desc'], ["directPlayCount", 'desc']]
        : [["directTipCount", 'desc'], ["directPlayCount", 'desc'], ["releaseDate", 'desc']];

    const artistList = search
      ? User.find({"draftProfile.artistName": {"$regex": search, "$options": "i"}})
        .where({mostRecentReleaseDate: {$ne: null}})
        .exec()
        .then(records => records.map(r => r.profileAddress))
      : Promise.resolve([]);

    return artistList
      .then(profiles => {
        let releaseQuery = Release.find({state: "published", markedAsAbuse: {$ne: true}});
        if (search) {
          releaseQuery = releaseQuery.where({$or: [
              {artistAddress: {$in: profiles}},
              {title: {"$regex": search, "$options": "i"}},
              {genres: {"$regex": search, "$options": "i"}},
              {languages: {"$regex": search, "$options": "i"}},
              {moods: {"$regex": search, "$options": "i"}},
              {regions: {"$regex": search, "$options": "i"}}
            ]})
        }
        if (genre) {
          releaseQuery = releaseQuery.where({"genres": genre})
        }

        return releaseQuery
          .sort(sort)
          .exec()
          .then(items => {
            const genreOrder = [];
            const genreItems = {};
            let itemsIncluded = 0;
            for (let i=0; i < items.length && itemsIncluded < limit; i++) {
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
                  itemsIncluded++;
                  break;
                }
              }
            }
            return flatten(genreOrder.map(g => genreItems[g]));
          })
          .then(items => items.map(item => this._convertDbRecordToLicenseLite(item)))
          .then(promises => Promise.all(promises));
      })
  }

  getTransactionHistory(address: string, length: number, start: number): Promise<any> {
    return this.musicoinAPI.getTransactionHistory(address, length, start);
  }

  _getLicensesForEntriesByPage(condition: any, start: number, limit: number, sort: any): Promise<any> {
    return this._getReleaseEntriesByPage(condition, start, limit, sort)
      .then(items => items.map(item => this._convertDbRecordToLicense(item)))
      .then(promises => Promise.all(promises));
  }

  _getReleaseEntriesByPage(condition: any, start: number, limit: number, sort: any) {
    let query = Release.find(condition)
      .limit(limit)
      .skip(start)
      .sort(sort)
      .populate("artist");
    return query.exec();
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
      .then((artist) => {
        artist.profileAddress = record.profileAddress;
        artist.timeSince = this._timeSince(record.joinDate);
        artist.genres = record.draftProfile.genres;
        artist.directTipCount = record.directTipCount || 0;
        artist.followerCount = record.followerCount || 0;
        artist.verified = record.verified;

        // facebook and twitter are special, used for verification, so they have to come from auth objects
        artist.social["facebook"] = record.facebook.urlIsPublic ? record.facebook.url : null;
        artist.social["twitter"] = record.twitter.urlIsPublic ? record.twitter.url : null;

        artist.id = record._id;
        return artist;
      });
  }

  migrateUserFollowing(userId: string) {
    return User.findById(userId).exec()
      .then(user => {
        if (user.following && user.following.length > 0) {
          const promises = user.following.map(f => {
            return User.findOne({profileAddress: f}).exec()
              .then(wasFollowing => {
                return this.startFollowing(userId, wasFollowing._id)
              });
          })
          return Promise.all(promises)
            .then(() => {
              user.following = [];
              return user.save();
            })
        }
      })
  }

  setupNewUser(user: any): Promise<any> {
    const name = this._getUserName(user);
    user.draftProfile = {
      artistName: name,
      description: "",
      social: {},
      ipfsImageUrl: defaultProfileIPFSImage,
      heroImageUrl: null,
      genres: [],
      version: 1
    };

    const d = this.mediaProvider.uploadText(user.draftProfile.description);
    const s = this.mediaProvider.uploadText(JSON.stringify(user.draftProfile.social));
    return Promise.join(user.save(), d, s, (saved, descriptionUrl, socialUrl) => {
      return this.musicoinAPI.publishProfile(null, name, descriptionUrl, user.draftProfile.ipfsImageUrl, socialUrl)
    })
      .then((tx) => {
        console.log(`Transaction submitted! Profile tx : ${tx}`);
        user.pendingTx = tx;
        user.updatePending = true;
        user.hideProfile = false;
        user.pendingInitialization = false;
        console.log(`Saving profile tx info to the database...`);
        return user.save();
      })
  }

  isUserFollowing(userId: string, toFollow: string ) {
    return Follow.findOne({follower: userId, following: toFollow}).exec()
      .then(match => {
        return {
          success: true,
          following: !!match
        };
      })
  }

  startFollowing(userId: string, toFollow: string) : Promise<any> {
    const options = {upsert: true, new: true, setDefaultsOnInsert: true};

    return Follow.findOneAndUpdate({follower: userId, following: toFollow}, {}, options).exec()
      .then(inserted => {
        MusicoinOrgJsonAPI._updateFollowerCount(toFollow, 1)
          .catch(err => console.log(`Could not update total followers after follow for ${toFollow}: ${err}`));
        return {
          success: true,
          following: !!inserted
        }
      })
  }

  stopFollowing(userId: string, toFollow: string) : Promise<any> {
    return Follow.findOneAndRemove({follower: userId, following: toFollow}).exec()
      .then(removed => {
        if (removed) {
          // fire and forget
          MusicoinOrgJsonAPI._updateFollowerCount(toFollow, -1)
            .catch(err => console.log(`Could not update total followers after unfollow for ${toFollow}: ${err}`));
        }
        return {
          success: true,
          following: false
        }
      })
  }

  private static _updateFollowerCount(toFollow: string, inc: number): Promise<any> {
    const findUser = User.findById(toFollow).exec();
    const updateStats = this._updateUserStats(toFollow, Date.now(), {$inc: {followCount: inc}});

    return Promise.join(findUser, updateStats, (user, stats) => {
      user.followerCount = Math.max(0, user.followerCount ? user.followerCount + inc : inc);
      return user.save();
    })
  }

  private static _updateUserStat(userId: string, date: number, duration:  string, update: any): Promise<any> {
    const options = {upsert: true, new: true, setDefaultsOnInsert: true};
    return UserStats.findOneAndUpdate(
      this._getUserStatsCondition(userId, date, duration),
      update,
      options
    ).exec();
  }

  private static _updateUserStats(userId: string, date: number, update: any): Promise<any> {
    return Promise.all([
      this._updateUserStat(userId, date, "day", update),
      this._updateUserStat(userId, date, "week", update),
      this._updateUserStat(userId, date, "month", update),
      this._updateUserStat(userId, date, "year", update),
      this._updateUserStat(userId, date, "all", update)]);
  }

  private static _updateReleaseStats(releaseId: string, date: number, update: any): Promise<any> {
    return Promise.all([
      this._updateReleaseStat(releaseId, date, "day", update),
      this._updateReleaseStat(releaseId, date, "week", update),
      this._updateReleaseStat(releaseId, date, "month", update),
      this._updateReleaseStat(releaseId, date, "year", update),
      this._updateReleaseStat(releaseId, date, "all", update)]);
  }

  private static _updateReleaseStat(releaseId: string, date: number, duration:  string, update: any): Promise<any> {
    const options = {upsert: true, new: true, setDefaultsOnInsert: true};
    return ReleaseStats.findOneAndUpdate(
      this._getReleaseStatsCondition(releaseId, date, duration),
      update,
      options
    ).exec();
  }

  private static _getUserStatsCondition(userId: string, date: number, duration: string) : Promise<any> {
    return {
      user: userId,
      startDate: this._getDatePeriodStart(date, duration),
      duration: duration
    }
  }

  private static _getReleaseStatsCondition(releaseId: string, date: number, duration: string) : Promise<any> {
    return {
      release: releaseId,
      startDate: this._getDatePeriodStart(date, duration),
      duration: duration
    }
  }

  private static _getPreviousDatePeriodStart(date: number, duration: string): Promise<number> {
    if (duration == "day" || duration == "week" || duration == "month" || duration == "year")
      return moment(date).subtract(1, duration).startOf(duration);
    else if (duration == "all")
      return 0;
    else throw new Error("Invalid duration specified for stats table: " + duration);
  }

  private static _getDatePeriodStart(date: number, duration: string): Promise<number> {
    if (duration == "day" || duration == "week" || duration == "month" || duration == "year")
      return moment(date).startOf(duration);
    else if (duration == "all")
      return 0;
    else throw new Error("Invalid duration specified for stats table: " + duration);
  }

  deleteMessage(callerAddress: string, messageId: string): Promise<any[]> {
    return TrackMessage.findById(messageId).exec()
      .then(message => {
        if (message && message.senderAddress == callerAddress) {
          return message.remove();
        }
        return null;
      })
  }

  repostMessages(senderAddress: string, messageId: string): Promise<any[]> {
    if (!messageId || !senderAddress) return Promise.resolve(null);
    const s = User.findOne({profileAddress: senderAddress}).exec();
    const m = TrackMessage.findById(messageId).exec();
    return Promise.join(s, m, (sender, message) => {
      if (message.repostMessage) {
        return this.repostMessages(senderAddress, message.repostMessage);
      }

      return TrackMessage.create({
        artistAddress: message.artistAddress,
        contractAddress: message.contractAddress,
        senderAddress: sender.profileAddress,
        release: message.release,
        artist: message.artist,
        sender: sender._id,
        message: "",
        replyToMessage: null,
        replyToSender: null,
        threadId: uuidV4(),
        messageType: "repost",
        repostMessage: message._id,
        repostOriginalSender: message.sender
      })
    })
  }

  postLicenseMessages(contractAddress: string, _artistAddress: string, senderAddress: string, message: string, _messageType: string, replyToId: string, _threadId?: string): Promise<any[]> {
    const r = contractAddress ? Release.findOne({contractAddress: contractAddress}).exec() : Promise.resolve(null);
    const a = _artistAddress ? User.findOne({profileAddress: _artistAddress}).exec() : Promise.resolve(null);
    const s = User.findOne({profileAddress: senderAddress}).exec();
    const m = replyToId ? TrackMessage.findById(replyToId).exec() : Promise.resolve(null);
    const messageType = _messageType ? _messageType : "comment";

    return Promise.join(r, a, s, m, (release, artist, sender, replyToMessage) => {
      const artistAddress = artist ? artist.profileAddress : release ? release.artistAddress : replyToMessage ? replyToMessage.artistAddress : null

      // notify the user that is the subject of this message about the comment/tip, as long as
      // they allow it.
      const actualArtist = artist
        ? Promise.resolve(artist)
        : artistAddress
          ? User.findOne({profileAddress: artistAddress}).exec()
          : Promise.resolve(null);

      return actualArtist
          .then(a => {
            let sendNotification = true;
            if (!a) {
              if (messageType != "donate") {
                console.log(`Not sending notification because not artist was found and this is not a donation`);
                sendNotification = false;
              }
            }
            else if (!a.preferences || !a.preferences.notifyOnComment) {
              console.log(`Not sending notification because ${a.draftProfile.artistName} does not have notifications enabled`);
              sendNotification = false;
            }
            // don't notify me about my own messages
            else if (senderAddress == artistAddress) {
              console.log(`Not sending notification because the sender and receiver are the same: ${senderAddress}`);
              sendNotification = false;
            }

            if (sendNotification) {
              const recipient = a ? this._getUserEmail(a)
                : messageType == "donate" ? "musicoin@berry.ai" : null;

              if (recipient) {
                console.log(`Sending message notification to: ${recipient}`);
                const urlPath = release
                  ? "/track/" + release.contractAddress
                  : artistAddress
                    ? "/artist/" + artistAddress
                    : "/artist/" + senderAddress;
                const notification = {
                  trackName: release ? release.title : null,
                  actionUrl: this.config.serverEndpoint + urlPath,
                  message: message,
                  senderName: sender.draftProfile.artistName
                };
                this.mailSender.sendMessageNotification(recipient, notification)
                  .then(() => console.log("Message notification sent to " + recipient))
                  .catch(err => `Failed to send message to ${recipient}, error: ${err}`);
              }
              else {
                console.log(`Could not send message to artist ${artistAddress} because no email address is associated with the account`);
              }
            }

            const threadId = _threadId
              ? _threadId
              : replyToMessage && replyToMessage.threadId
                ? replyToMessage.threadId
                : uuidV4();

            return TrackMessage.create({
              artistAddress: artistAddress,
              contractAddress: contractAddress,
              senderAddress: sender.profileAddress,
              release: release ? release._id : null,
              artist: a ? a._id : null,
              sender: sender._id,
              message: message,
              replyToMessage: replyToId,
              replyToSender: replyToMessage ? replyToMessage.sender : null,
              threadId: threadId,
              messageType: messageType
            })
          });
    })
  }

  getFeedMessages(userId: string, limit: number, minDate?: any): Promise<any[]> {
    const f = Follow.find({follower: userId}).exec();
    const u = User.findOne({_id: userId}).exec();
    return Promise.join(u, f, (user, followingRecords) => {
        if (user) {
          const following = followingRecords.map(fr => fr.following);
          const filter = minDate ? {timestamp: {$gte: minDate}} : {};
          return this._executeTrackMessagesQuery(
            TrackMessage.find(filter)
              .or([
                {sender: {$in: following}}, // comments by users/artists I follow
                {sender: userId}, // messages I sent
                {$and: [{artist: userId}, {messageType: {$in: ["tip", "follow"]}}]}, // anyone followed/tipped me
                {replyToSender: userId} // messages in reply to my messages
              ])
            .limit(limit))
        }
        return [];
      })
  }

  getThreadMessages(threadId: string, limit: number): Promise<any[]> {
    if (!threadId) return Promise.resolve([]);
    return this._executeTrackMessagesQuery(TrackMessage.find({threadId: threadId}).limit(limit));
  }

  getLicenseMessages(contractAddress: string, limit: number): Promise<any[]> {
    const condition = contractAddress && contractAddress.trim().length > 0
      ? {contractAddress: contractAddress, messageType: {$ne: "repost"}}
      : {};
    return this._executeTrackMessagesQuery(TrackMessage.find(condition).limit(limit));
  }

  getUserMessages(profileAddress: string, limit: number): Promise<any[]> {
    const condition = profileAddress && profileAddress.trim().length > 0
      ? {senderAddress: profileAddress}
      : {};
    return this._executeTrackMessagesQuery(TrackMessage.find(condition).limit(limit));
  }

  private _executeTrackMessagesQuery(query: any): Promise<any[]> {
    return query
      .sort({"timestamp": 'desc'})
      .populate("sender")
      .populate("release")
      .populate("artist")
      .populate("repostOriginalSender")
      .populate("repostMessage")
      .exec()
      .then(records => {
        return records.map(m => {

          // old message won't have this new property
          const release = m.release
            ? {
              title: m.release.title,
              image: this.mediaProvider.resolveIpfsUrl(m.release.imageUrl),
              contractAddress: m.release.contractAddress,
              artistAddress: m.release.artistAddress,
              id: m.release._id
            }
            : null;

          const sender = m.sender ? {
              name: m.sender.draftProfile.artistName,
              image: this.mediaProvider.resolveIpfsUrl(m.sender.draftProfile.ipfsImageUrl),
              profileAddress: m.sender.profileAddress,
              isArtist: !!m.sender.mostRecentReleaseDate
            } : {};

          const artist = m.artist ? {
              name: m.artist.draftProfile.artistName,
              image: this.mediaProvider.resolveIpfsUrl(m.artist.draftProfile.ipfsImageUrl),
              profileAddress: m.artist.profileAddress
            } : {};

          const isRepost = m.repostMessage && m.repostOriginalSender;
          const repost = isRepost ? {
              name: m.repostOriginalSender.draftProfile.artistName,
              profileAddress: m.repostOriginalSender.profileAddress,
              body: m.repostMessage.message
            } : { body: null };

          return {
            id: m._id,
            sender: sender,
            release: release,
            artist: artist,
            body: isRepost ? repost.body : m.message,
            time: this._timeSince(m.timestamp.getTime()),
            tips: m.tips,
            messageType: m.messageType ? m.messageType : "comment",
            repost: repost,
            threadId: m.threadId,
            replyToMessage: m.replyToMessage
          }
        })
      })
  }

  addPendingPPPTransaction(userId: string, releaseId: string, coinsPerPlay: number, tx: string): Promise<any> {
    return PendingPlayback.create({
      release: releaseId,
      user: userId,
      coins: coinsPerPlay,
      tx: tx
    })
  }

  getPendingPPPPayments(userId): Promise<any> {
    return PendingPlayback.find({user: userId}).exec();
  }

  addToMessageTipCount(messageId: string, coins: number): Promise<any> {
    return TrackMessage.findById(messageId)
      .then(record => {
        record.tips += coins;
        return record.save();
      });
  }

  addToReleaseTipCount(contractAddress: string, coins: number): Promise<any> {
    return Release.findOne({contractAddress: contractAddress}).exec()
      .then(release => {
        if (release) {
          release.directTipCount = release.directTipCount ? release.directTipCount + coins : coins;
          return release.save();
        }
        return false;
      })
      .then(release => {
        return MusicoinOrgJsonAPI._updateReleaseStats(release.id, Date.now(), {$inc: {tipCount: coins}})
          .catch(err => {
            console.log(`Failed to update reporting stats for release: ${err}`);
            return release;
          })
          .then(() => release);
      })
  }

  addToReleaseCommentCount(contractAddress: string): Promise<any> {
    return Release.findOne({contractAddress: contractAddress}).exec()
      .then(release => {
        return MusicoinOrgJsonAPI._updateReleaseStats(release.id, Date.now(), {$inc: {commentCount: 1}})
          .catch(err => {
            console.log(`Failed to update reporting stats for release: ${err}`);
            return release;
          })
          .then(() => release);
      })
  }

  addToReleasePlayCount(userId: string, releaseId: string): Promise<any> {
    return Release.findById(releaseId).exec()
      .then(release => {
        release.directPlayCount = release.directPlayCount ? release.directPlayCount + 1 : 1;
        return release.save();
      })
      .then(release => {
        // fire and forget
        UserPlayback.create({user: userId, release: release.id});

        return MusicoinOrgJsonAPI._updateReleaseStats(release.id, Date.now(), {$inc: {playCount: 1}})
          .catch(err => {
            console.log(`Failed to update reporting stats for release: ${err}`);
            return release;
          })
          .then(() => release);
      })
  }

  addToUserTipCount(profileAddress: string, coins: number): Promise<any> {
    return User.findOne({profileAddress: profileAddress}).exec()
      .then(user => {
        if (user) {
          user.directTipCount = user.directTipCount ? user.directTipCount + coins : coins;
          return user.save();
        }
        return false;
      })
      .then(user => {
        return MusicoinOrgJsonAPI._updateUserStats(user._id, Date.now(), {$inc: {tipCount: coins}})
          .catch(err => {
            console.log(`Failed to update reporting stats for user: ${err}`);
            return user;
        })
          .then(() => user);
      })
  }

  getOverallReleaseStats(): Promise<any> {
    return ReleaseStats.aggregate([
      {
        $match: { duration: "all" }
      },
      {
        $group: {
          _id: null,
          totalTips: { $sum: '$tipCount' },
          totalPlays: { $sum: '$playCount' },
          totalComments: { $sum: '$commentCount' }
        }
      }
    ]).exec();
  }

  sendAllUserReports(duration: string, durationAdj: string) {
    let sent = 0;
    let errors = 0;
    const asOf = MusicoinOrgJsonAPI._getPreviousDatePeriodStart(Date.now(), duration);
    return ReportActivity.findOne({
      startDate: new Date(asOf),
      duration: duration,
      sent: true})
      .then(finishedReport => {
        if (finishedReport) {
          const msg = `Not sending report, already sent for ${new Date(asOf)}, duration: ${duration}`;
          console.log(msg);
          return Promise.resolve({success: false, reason: msg});
        }
        return User.find({
          accountLocked: {$ne: true},
          mostRecentReleaseDate: {$exists: true, $ne: null}
        })
          .then(users => {
            return Promise.all(users.map(user => {
              const userName = user.draftProfile ? user.draftProfile.artistName : user._id;
              return this._sendUserStatsReport(user, asOf, duration, durationAdj)
                .then((output) => {
                  sent++;
                  return output;
                })
                .catch(err => {
                  console.log(`Failed to send report for user: ${userName}, profile=${user.profileAddress}, id=${user._id}, err: ${err}`)
                  errors++;
                  return null;
                })
            }));
          })
          .then((results) => {
            return ReportActivity.create({
              startDate: new Date(asOf),
              duration: duration,
              totalSent: sent,
              totalErrors: errors,
              sent: true
            })
              .then((record) => {
                return {
                  success: true,
                  results: record
                };
              })
          })
      });
  }

  sendUserStatsReport(userId: string, duration: string, durationAdj: string): Promise<any> {
    const asOf = MusicoinOrgJsonAPI._getPreviousDatePeriodStart(Date.now(), duration);
    return User.findById(userId).exec()
      .then(user => {
        return this._sendUserStatsReport(user, asOf, duration, durationAdj);
      })
  }

  _sendUserStatsReport(user: any, asOf: number, duration: string, durationAdj: string): Promise<any> {
    if (user.accountLocked) {
      console.log("Not sending report to user with locked account: " + user.profileAddress);
      return Promise.resolve();
    }

    var preferredFrequency = user.preferences && user.preferences.activityReporting ? user.preferences.activityReporting : "week";
    if (preferredFrequency != duration) {
      console.log(`Not sending report to user because this does not match their preferences: ${preferredFrequency} != ${duration} ${user.profileAddress}`);
      return Promise.resolve();
    }

    return this.getUserStatsReport(user.profileAddress, asOf, duration)
      .then(report => {
        report.actionUrl = "https://musicoin.org/nav/feed";
        report.baseUrl = "https://musicoin.org";
        report.description = `Musicoin ${durationAdj} report`;
        report.duration = duration;

        const tracksHaveEvents = report.stats.releases
            .filter(r => r.playCount > 0 || r.tipCount > 0 || r.commentCount > 0)
            .length > 0;

        const userHasEvents = report.user.followCount > 0 || report.user.tipCount > 0 || report.user.commentCount;
        if (report.stats.releases.length > 0 && (tracksHaveEvents || userHasEvents)) {
          const userName =  user.draftProfile ? user.draftProfile.artistName : user._id;
          console.log(`Sending report to user: ${userName}, ${this._getUserEmail(user)}, ${user.profileAddress}`);
          return this.mailSender.sendActivityReport(this._getUserEmail(user), report);
        }
        else {
          console.log("Not sending report to user with no events, user: " + user.profileAddress);
          return Promise.resolve();
        }
      })
  }

  getUserStatsReport(profileAddress: string, date: number, duration: string): Promise<any> {
    if (duration != "day" && duration != "week" && duration != "month" && duration != "all")
      throw new Error("invalid duration: " + duration);
    const u = User.findOne({profileAddress: profileAddress}).exec();
    const rs = Release.find({artistAddress: profileAddress, state: 'published'}).exec();
    return Promise.join(u, rs, (user, releases) => {
      const uStatsCondition = MusicoinOrgJsonAPI._getUserStatsCondition(user._id, date, duration);
      const ustats = UserStats.findOne(uStatsCondition)
        .then(userStats => {
          return userStats ? userStats : {
              followCount: 0,
              tipCount: 0,
              commentCount: 0,
              startDate: uStatsCondition.startDate,
              user: uStatsCondition.user,
              duration: uStatsCondition.duration
            }
        });
      const rstats = releases.map(release => {
        const rStatsCondition = MusicoinOrgJsonAPI._getReleaseStatsCondition(release._id, date, duration);
        return ReleaseStats.findOne(rStatsCondition)
          .then(stats => {
            if (!stats) {
              stats = Object.assign(rStatsCondition, {playCount: 0, tipCount: 0, commentCount: 0});
            }
            stats.track = release;
            return stats ? stats : {
                playCount: 0,
                tipCount: 0,
                commentCount: 0,
                duration: rStatsCondition.duration,
                startDate: rStatsCondition.startDate,
                release: release._id
              }
          })
      });
      var options = {year: 'numeric', month: 'short', day: 'numeric'};
      return Promise.join(ustats, Promise.all(rstats), (userStats, allReleaseStats) => {
        return {
          user: user,
          startDate: new Date(date).toLocaleDateString('en-US', options),
          endDate: duration != "all" ?  moment(date).add(1, duration).toDate().toLocaleDateString('en-US', options) : null,
          stats: {
            user: userStats,
            releases: allReleaseStats
          }
        }
      })
    })
  }

  getLicense(contractAddress: string): Promise<any> {
    console.log("Getting license: " + contractAddress);
    return Release.findOne({contractAddress: contractAddress, state: 'published'}).exec()
      .then(record => {
        if (record) return this._convertDbRecordToLicense(record);
        return null;
      })
  }

  getErrors(_search: string, start: number, length: number): Promise<any> {
    const search = _search;
    let filter = {};
    if (search) {
      filter = {$or: [
        {"errorCode": {"$regex": search, "$options": "i"}},
        {"errorContext": {"$regex": search, "$options": "i"}}
      ]};
    }

    return ErrorReport.find(filter)
      .sort({"date": 'desc'})
      .skip(start)
      .limit(length)
      .populate("user")
      .exec()
      .then(errorReports => {
        const updated = errorReports.map(report => {
          return Release.findOne({contractAddress: report.licenseAddress})
            .exec()
            .then(track => {
              return {
                report: report,
                track: track
              };
            })
        });
        return Promise.all(updated);
      });
  }

  removeError(_id: string): Promise<any> {
    return ErrorReport.findByIdAndRemove(_id).exec()
      .then((removed) => {
        if (removed) {
          console.log(`Removed error report entry: ${removed._id}`);
          return {success: true}
        }
        return {success: false, reason: "Not found"}
      })
      .catch((err) => {
        console.log(`Failed to remove error report entry: ${err}`);
        return {success: false, reason: "Error"}
      })
  }

  getArtistEarnings(id: string): Promise<any> {
    return User.findById(id).exec()
      .then(user => {
        if (!user) return {success: false};
        return this.getUserStatsReport(user.profileAddress, Date.now(), "all")
          .then(statsReport => {
            let totalTips = statsReport.stats.user.tipCount;
            let totalPlays = 0;
            statsReport.stats.releases.forEach(rs => {
              totalPlays += rs.playCount;
              totalTips += rs.tipCount;
            });
            return {
              tips: totalTips,
              plays: totalPlays,
              followers: user.followerCount
            }
          })
      })
  }

  getTrackEarnings(id: string): Promise<any> {
    return Release.findById(id).exec()
      .then(release => {
        if (!release) return {success: false}
        return {
          success: true,
          plays: release.directPlayCount || 0,
          tips: release.directTipCount || 0
        }
      })
  }

  getReleaseByTx(tx) {
    return Release.findOne({tx: tx})
      .then(release => {
        if (release) return this._convertDbRecordToLicenseLite(release);
        return null;
      })
  }

  _convertDbRecordToLicenseLite(record) {
    return {
      artistName: record.artistName,

      genres: record.genres,
      languages: record.languages,
      moods: record.moods,
      regions: record.regions,

      description: record.description,
      timeSince: this._timeSince(record.releaseDate),
      directTipCount: record.directTipCount || 0,
      directPlayCount: record.directPlayCount || 0,
      artistProfileAddress: record.artistAddress,
      title: record.title,
      image: this.mediaProvider.resolveIpfsUrl(record.imageUrl),
      address: record.contractAddress,
      tx: record.tx
    }
  }

  _convertDbRecordToLicense(record) {
    return this.mcHelper.getLicense(record.contractAddress)
      .bind(this)
      .then(function(license) {
        if (!license.artistName)
          license.artistName = record.artistName;

        license.genres = record.genres;
        license.languages = record.languages;
        license.moods =  record.moods;
        license.regions = record.regions;

        license.description = record.description;
        license.timeSince = this._timeSince(record.releaseDate);
        license.directTipCount = record.directTipCount || 0;
        license.directPlayCount = record.directPlayCount || 0;
        license.releaseDate = record.releaseDate;
        license.tx = record.tx;
        license.markedAsAbuse = record.markedAsAbuse;
        return license;
      })
  }

  _getUserEmail(user): string {
    if (!user) return null;
    if (user.preferredEmail) return user.preferredEmail;
    if (user.google && user.google.email) return user.google.email;
    if (user.facebook && user.facebook.email) return user.facebook.email;
    if (user.local && user.local.email) return user.local.email;
    if (user.invite && user.invite.invitedAs) return user.invite.invitedAs;
    return null;
  }

  private _getUserName(user: any) {
    if (!user) return "New User";
    if (user.google && this._notBlank(user.google.name)) return user.google.name;
    if (user.facebook && this._notBlank(user.facebook.name)) return user.facebook.name;
    if (user.twitter && this._notBlank(user.twitter.displayName)) return user.twitter.displayName;
    if (user.soundcloud && this._notBlank(user.soundcloud.username)) return user.soundcloud.username;
    if (user.local && this._notBlank(user.local.username)) return user.local.username;
    return "New User";
  }

  private _notBlank(s: string) {
    return s && s.trim().length > 0;
  }

  _sanitize(s: string) {
    return s ? s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&").trim() : s;
  }

  _timeSince(date) {

    const seconds = Math.floor((Date.now() - date) / 1000);

    const intervals = [
      {value: 60, unit: "min"},
      {value: 60, unit: "hour"},
      {value: 24, unit: "day"},
      {value: 30, unit: "month"},
      {value: 12, unit: "year"},
    ]

    let unit = "second";
    let value = seconds;
    for (let i=0; i < intervals.length; i++) {
      const interval = intervals[i];
      if (value > interval.value) {
        unit = interval.unit;
        value = value / interval.value;
      }
      else {
        break;
      }
    }

    if (unit == "second") {
      return "";
    }

    const rounded = Math.round(value);
    if (rounded != 1) {
      unit += "s";
    }
    return `${rounded} ${unit} ago`;
  }

  private _onlyEmailAuth(user) {
    return !this._hasAuthMethod(user, "facebook")
      && !this._hasAuthMethod(user, "twitter")
      && !this._hasAuthMethod(user, "google")
      && this._hasAuthMethod(user, "local");
  }

  private _hasAuthMethod(user: any, method: string): boolean {
    return user[method] && user[method].id;
  }
}