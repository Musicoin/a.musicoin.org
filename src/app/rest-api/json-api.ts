import {Promise} from 'bluebird';
import {MusicoinHelper} from "../musicoin-helper";
import {MusicoinAPI} from "../musicoin-api";
import * as FormUtils from "../form-utils";
import * as crypto from 'crypto';
import {MailSender} from "../mail-sender";
const User = require('../../app/models/user');
const Follow = require('../../app/models/follow');
const Release = require('../../app/models/release');
const Playback = require('../../app/models/playback');
const InviteRequest = require('../../app/models/invite-request');
const TrackMessage = require('../../app/models/track-message');
const Hero = require('../../app/models/hero');
const ErrorReport = require('../../app/models/error-report');

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

  addInviteRequest(email: string, musician: boolean): Promise<any> {
    return InviteRequest.findOne({username: {"$regex": email, "$options": "i"}}).exec()
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
            }
            return email
              ? this.mailSender.sendInvite(email, invite)
              : null;
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

  getAllUsers(_search: string, start: number, length: number): Promise<any> {
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
    return User.find(filter)
      .sort({"invite.invitedOn": 'desc'})
      .skip(start)
      .limit(length)
      .populate("invite.invitedBy")
      .exec();
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

    let query = User.find({profileAddress: {$ne: null}});

    if (search) {
      query = query.where({"draftProfile.artistName": {"$regex": search, "$options": "i"}})
    }

    if (genre) {
      query = query.where({"draftProfile.genres": genre});
    }

    return query.sort({joinDate: 'desc'}).limit(limit).exec()
      .then(records => records.map(r => this._convertDbRecordToArtist(r)))
      .then(promises => Promise.all(promises))
  }

  getNewReleases(limit: number, genre?: string): Promise<any> {
    const filter = genre ? {state: 'published', genres: genre} : {state: 'published'};
    return this._getLicensesForEntries(filter, limit);
  }

  getAllContracts() {
    const filter = {state: 'published'};
    return this._getLicensesForEntries(filter, 99999999);
  }

  getNewReleasesByGenre(limit: number, maxGroupSize: number, _search?: string, _genre?:string): Promise<any> {
    const search = this._sanitize(_search);
    const genre = _genre;
    const flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);
    const artistList = search
      ? User.find({"draftProfile.artistName": {"$regex": search, "$options": "i"}})
        .where({mostRecentReleaseDate: {$ne: null}})
        .exec()
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
      .then((artist) => {
        artist.profileAddress = record.profileAddress;
        artist.timeSince = this._timeSince(record.joinDate);
        artist.genres = record.draftProfile.genres;
        artist.directTipCount = record.directTipCount || 0;
        artist.followerCount = record.followerCount || 0;
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
    return User.findById(toFollow).exec()
      .then(user => {
        user.followerCount = Math.max(0, user.followerCount ? user.followerCount + inc : inc);
        user.save()
      })
  }

  postLicenseMessages(contractAddress: string, artistAddress: string, senderAddress: string, message: string, replyToId?: string): Promise<any[]> {
    const r = contractAddress ? Release.findOne({contractAddress: contractAddress}).exec() : Promise.resolve(null);
    const a = artistAddress ? User.findOne({profileAddress: artistAddress}).exec() : Promise.resolve(null);
    const s = User.findOne({profileAddress: senderAddress}).exec();
    const m = replyToId ? TrackMessage.findById(replyToId).exec() : Promise.resolve(null);

    return Promise.join(r, a, s, m, (release, artist, sender, replyToMessage) => {
      const artistAddress = artist ? artist.profileAddress : release ? release.artistAddress : replyToMessage ? replyToMessage.artistAddress : null

      // notify the user that is the subject of this message about the comment/tip, as long as
      // they allow it.
      const actualArtist = artist ? Promise.resolve(artist) : User.findOne({profileAddress: artistAddress}).exec();
      actualArtist
          .then(a => {
            let sendNotification = true;
            if (!a.preferences || !a.preferences.notifyOnComment) {
              console.log(`Not sending notification because ${a.draftProfile.artistName} does not have notifications enabled`);
              sendNotification = false;
            }
            // don't notify me about my own messages
            if (senderAddress == artistAddress) {
              console.log(`Not sending notification because the sender and receiver are the same: ${senderAddress}`);
              sendNotification = false;
            }

            if (sendNotification) {
              const recipient = a ? this._getUserEmail(a) : null;
              if (recipient) {
                console.log(`Sending message notification to: ${recipient}`);
                const urlPath = release
                  ? "/track/" + release.contractAddress
                  : "/artist/" + artistAddress;
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

            return TrackMessage.create({
              artistAddress: artistAddress,
              contractAddress: contractAddress,
              senderAddress: sender.profileAddress,
              release: release ? release._id : null,
              artist: a ? a._id : null,
              sender: sender._id,
              message: message,
              replyToMessage: replyToId,
              replyToSender: replyToMessage ? replyToMessage.sender : null
            });
          });
    })
  }

  getFeedMessages(userId: string, limit: number): Promise<any[]> {
    const f = Follow.find({follower: userId}).exec();
    const u = User.findOne({_id: userId}).exec();
    return Promise.join(u, f, (user, followingRecords) => {
        if (user) {
          const following = followingRecords.map(fr => fr.following);
          return this._executeTrackMessagesQuery(
            TrackMessage.find()
              .or([
                {artist: {$in: following}}, // comments on track from artists I follow
                {sender: {$in: following}}, // comments by users/artists I follow
                {sender: userId}, // messages I sent
                {replyToSender: userId} // messages in reply to my messages
              ])
            .limit(limit))
        }
        return [];
      })
  }

  getLicenseMessages(contractAddress: string, limit: number): Promise<any[]> {
    const condition = contractAddress && contractAddress.trim().length > 0
      ? {contractAddress: contractAddress}
      : {};
    return this._executeTrackMessagesQuery(TrackMessage.find(condition).limit(limit));
  }

  getUserMessages(profileAddress: string, limit: number): Promise<any[]> {
    const condition = profileAddress && profileAddress.trim().length > 0
      ? {$or: [{artistAddress: profileAddress}, {senderAddress: profileAddress}]}
      : {};
    return this._executeTrackMessagesQuery(TrackMessage.find(condition).limit(limit));
  }

  private _executeTrackMessagesQuery(query: any): Promise<any[]> {
    return query
      .sort({"timestamp": 'desc'})
      .populate("sender")
      .populate("release")
      .populate("artist")
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
              profileAddress: m.sender.profileAddress
            } : {};

          const artist = m.artist ? {
              name: m.artist.draftProfile.artistName,
              image: this.mediaProvider.resolveIpfsUrl(m.artist.draftProfile.ipfsImageUrl),
              profileAddress: m.artist.profileAddress
            } : {};

          return {
            id: m._id,
            sender: sender,
            release: release,
            artist: artist,
            body: m.message,
            time: this._timeSince(m.timestamp.getTime()),
            tips: m.tips
          }
        })
      })
  }

  addToMessageTipCount(messageId: string, coins: number): Promise<any> {
    return TrackMessage.findById(messageId)
      .then(record => {
        record.tips += coins;
        return record.save();
      })
      .then(r => {
        console.log("Updated tip count on track message: " + r.tips);
      })
  }

  addToReleaseTipCount(contractAddress: string, coins: number) {
    return Release.findOne({contractAddress: contractAddress}).exec()
      .then(release => {
        if (release) {
          release.directTipCount = release.directTipCount ? release.directTipCount + coins : coins;
          return release.save();
        }
        return false;
      })
  }

  addToUserTipCount(profileAddress: string, coins: number) {
    return User.findOne({profileAddress: profileAddress}).exec()
      .then(user => {
        if (user) {
          user.directTipCount = user.directTipCount ? user.directTipCount + coins : coins;
          return user.save();
        }
        return false;
      })
  }

  getLicense(contractAddress: string): Promise<any> {
    console.log("Getting license: " + contractAddress);
    return Release.findOne({contractAddress: contractAddress}).exec()
      .then(record => {
        return this._convertDbRecordToLicense(record);
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

  _convertDbRecordToLicense(record) {
    return this.mcHelper.getLicense(record.contractAddress)
      .bind(this)
      .then(function(license) {
        if (!license.artistName)
          license.artistName = record.artistName;
        license.genres = record.genres;
        license.description = record.description;
        license.timeSince = this._timeSince(record.releaseDate);
        license.directTipCount = record.directTipCount || 0;
        license.directPlayCount = record.directPlayCount || 0;
        return license;
      })
  }

  _getUserEmail(user): string {
    if (!user) return null;
    if (user.preferredEmail) return user.preferredEmail;
    if (user.google && user.google.email) return user.google.email;
    if (user.facebook && user.facebook.email) return user.facebook.email;
    if (user.invite && user.invite.invitedAs) return user.invite.invitedAs;
    return null;
  }

  _sanitize(s: string) {
    return s ? s.replace(/[^a-zA-Z0-9]/g, ' ').trim() : s;
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
}