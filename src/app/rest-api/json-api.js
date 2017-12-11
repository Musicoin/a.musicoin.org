"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bluebird_1 = require("bluebird");
const moment = require("moment");
const FormUtils = require("../form-utils");
const crypto = require("crypto");
const services_1 = require("./services");
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
const APIClient = require('../../app/models/api-client');
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
class MusicoinOrgJsonAPI {
    constructor(musicoinAPI, mcHelper, mediaProvider, mailSender, exchangeRateProvider, config) {
        this.musicoinAPI = musicoinAPI;
        this.mcHelper = mcHelper;
        this.mediaProvider = mediaProvider;
        this.mailSender = mailSender;
        this.exchangeRateProvider = exchangeRateProvider;
        this.config = config;
    }
    getArtist(address, includeReleases, includePending) {
        if (!address) {
            return bluebird_1.Promise.resolve({
                artist: {},
                releases: [],
                pendingReleases: []
            });
        }
        const a = User.findOne({ profileAddress: address }).exec()
            .then(dbRecord => {
            if (!dbRecord)
                return null;
            return this._convertDbRecordToArtist(dbRecord);
        });
        const rs = !includeReleases
            ? bluebird_1.Promise.resolve(null)
            : this._getLicensesForEntries({ artistAddress: address, state: 'published' });
        const ps = !includePending
            ? bluebird_1.Promise.resolve(null)
            : this._getReleaseEntries({ artistAddress: address, state: 'pending' });
        return bluebird_1.Promise.join(a, rs, ps, function (artist, releases, pendingReleases) {
            if (!artist)
                return null;
            return {
                artist: artist,
                releases: releases,
                pendingReleases: pendingReleases
            };
        });
    }
    removeInviteRequest(_id) {
        return InviteRequest.findByIdAndRemove(_id).exec()
            .then((removed) => {
            if (removed) {
                console.log(`Removed waitlist entry: ${removed.username}`);
                return { success: true };
            }
            return { success: false, reason: "Not found" };
        })
            .catch((err) => {
            console.log(`Failed to remove waitlist entry: ${err}`);
            return { success: false, reason: "Error" };
        });
    }
    sendRewardsForInvite(p) {
        if (!p || !p.invite || !p.invite.invitedBy) {
            console.log(`Could not send an invite reward, user did not have an invite, newUser.id: ${p._id}, invite: ${JSON.stringify(p.invite)}`);
            return bluebird_1.Promise.resolve();
        }
        return User.findById(p.invite.invitedBy).exec()
            .then(sender => {
            if (!sender || !sender.invite) {
                console.log("Not sending reward because there is no sender or not sender invite field");
                return {};
            }
            if (sender.invite.noReward) {
                console.log("Not sending reward because the sender was blacklisted, or inherited blacklist status: " + sender.profileAddress);
                return {};
            }
            if (!sender.verified && this._onlyEmailAuth(sender)) {
                console.log("Not sending reward because the sender does not have a social account linked and is not verified: " + sender.profileAddress + ", email: " + sender.local.email);
                return {};
            }
            // rewards for invites sent by verified users are different
            const rewards = sender.verified ? this.config.rewards.verifiedSender : this.config.rewards.unverifiedSender;
            // no reward sent to invitee if they don't link a social (too many scammers)
            const inviteeReward = this._onlyEmailAuth(p) ? 0 : rewards.forAcceptingInvite;
            console.log(`Sending invite rewards: invitee=${p.profileAddress}, and inviter=${sender.profileAddress}, since sender.invite.noReward = '${sender.invite.noReward}', rewards=${JSON.stringify(rewards)}`);
            const sendRewardToInvitee = this.musicoinAPI.sendReward(p.profileAddress, inviteeReward);
            const sendRewardToInviter = this.musicoinAPI.sendReward(sender.profileAddress, rewards.forInviteeJoining);
            return bluebird_1.Promise.join(sendRewardToInvitee, sendRewardToInviter, (tx1, tx2) => {
                return {
                    inviteeRewardTx: tx1,
                    inviterRewardTx: tx2
                };
            });
        });
    }
    sendInvite(sender, email) {
        let promise = bluebird_1.Promise.resolve(null);
        if (email) {
            email = email.trim();
            if (!FormUtils.validateEmail(email)) {
                console.log(`Invalid email address provided: ${email}`);
                return bluebird_1.Promise.resolve({
                    email: email,
                    from: sender._id,
                    success: false,
                    reason: "invalid"
                });
            }
            const conditions = [];
            conditions.push({ "invite.invitedAs": { "$regex": email, "$options": "i" } });
            conditions.push({ "google.email": { "$regex": email, "$options": "i" } });
            promise = User.findOne({ $or: conditions }).exec();
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
                    };
                })
                    .catch(function (err) {
                    console.log(err);
                    return {
                        email: email,
                        from: sender._id,
                        success: false,
                        reason: "error"
                    };
                });
            }
            else {
                console.log(`User already exists: ${email}`);
                return {
                    email: email,
                    from: sender._id,
                    success: false,
                    reason: "exists"
                };
            }
        })
            .catch(function (err) {
            console.log(err);
            return {
                email: email,
                from: sender._id,
                success: false,
                reason: "error"
            };
        });
    }
    getUserRecentPlays(userId, start, length) {
        return UserPlayback.find({ user: userId })
            .sort({ "playbackDate": 'desc' })
            .skip(start)
            .limit(length)
            .populate("release")
            .exec()
            .then(results => {
            return bluebird_1.Promise.all(results.map(r => this._convertDbRecordToLicenseLite(r.release)));
        });
    }
    getPlaybackHistory(userId, anonymousUserId, releaseId, start, length) {
        let conditions = [];
        if (userId)
            conditions.push({ user: userId });
        if (anonymousUserId)
            conditions.push({ anonymousUser: anonymousUserId });
        if (releaseId)
            conditions.push({ release: releaseId });
        const rs = UserPlayback.find(conditions.length > 0 ? { $or: conditions } : {})
            .sort({ "playbackDate": 'desc' })
            .skip(start)
            .limit(length)
            .populate("user")
            .populate("anonymousUser")
            .populate("release")
            .exec();
        const t = UserPlayback.count();
        return bluebird_1.Promise.join(rs, t, (records, total) => {
            return {
                records: records,
                total: total
            };
        });
    }
    getAllInviteRequests(_search, start, length) {
        const search = this._sanitize(_search);
        let filter = {};
        if (search) {
            filter = { $or: [
                    { "username": { "$regex": search, "$options": "i" } },
                    { "source": { "$regex": search, "$options": "i" } }
                ] };
        }
        return InviteRequest.find(filter)
            .sort({ "requestDate": 'asc' })
            .skip(start)
            .limit(length)
            .exec();
    }
    getAllAPIClients(start, length) {
        const c = APIClient.count().exec();
        const u = APIClient.find()
            .skip(start)
            .limit(length)
            .exec();
        return bluebird_1.Promise.join(c, u, (count, users) => {
            return {
                count: count,
                clients: users
            };
        });
    }
    getAllUsers(_search, invitedByIds, verified, artist, start, length) {
        let filter = {};
        if (_search) {
            const search = _search.trim();
            filter = { $or: [
                    { "draftProfile.artistName": { "$regex": search, "$options": "i" } },
                    { "profileAddress": { "$regex": search, "$options": "i" } },
                    { "invite.invitedAs": { "$regex": search, "$options": "i" } },
                    { "invite.inviteCode": { "$regex": search, "$options": "i" } },
                    { "invite.groupInviteCode": { "$regex": search, "$options": "i" } },
                    { "google.email": { "$regex": search, "$options": "i" } },
                    { "google.name": { "$regex": search, "$options": "i" } },
                    { "twitter.username": { "$regex": search, "$options": "i" } },
                    { "twitter.displayName": { "$regex": search, "$options": "i" } },
                    { "facebook.email": { "$regex": search, "$options": "i" } },
                    { "facebook.name": { "$regex": search, "$options": "i" } },
                    { "soundcloud.name": { "$regex": search, "$options": "i" } },
                    { "soundcloud.username": { "$regex": search, "$options": "i" } },
                    { "local.email": { "$regex": search, "$options": "i" } },
                ] };
        }
        if (invitedByIds && invitedByIds.length > 0) {
            filter["invite.invitedBy"] = { $in: invitedByIds };
        }
        if (verified) {
            filter["verified"] = verified == "true" ? { $eq: true } : { $ne: true };
            filter["accountLocked"] = { $ne: true };
            filter["blocked"] = { $ne: true };
        }
        if (artist) {
            filter["mostRecentReleaseDate"] = artist == "true" ? { $exists: true, $ne: null } : { $not: { $exists: true, $ne: null } };
        }
        const c = User.count(filter).exec();
        const u = User.find(filter).sort({ "invite.invitedOn": 'desc' })
            .skip(start)
            .limit(length)
            .populate("invite.invitedBy")
            .exec()
            .map(user => {
            user.timeSinceJoining = this._timeSince(user.joinDate);
            return user;
        });
        return bluebird_1.Promise.join(c, u, (count, users) => {
            return {
                count: count,
                users: users
            };
        });
    }
    getAddressBook(_search, start, length) {
        let filter = {};
        if (_search) {
            const search = _search.trim();
            filter = { $or: [
                    { "draftProfile.artistName": { "$regex": search, "$options": "i" } },
                    { "invite.invitedAs": { "$regex": search, "$options": "i" } },
                    { "google.email": { "$regex": search, "$options": "i" } },
                    { "google.name": { "$regex": search, "$options": "i" } },
                    { "twitter.username": { "$regex": search, "$options": "i" } },
                    { "twitter.displayName": { "$regex": search, "$options": "i" } },
                    { "facebook.email": { "$regex": search, "$options": "i" } },
                    { "facebook.name": { "$regex": search, "$options": "i" } },
                    { "soundcloud.name": { "$regex": search, "$options": "i" } },
                    { "soundcloud.username": { "$regex": search, "$options": "i" } },
                ] };
        }
        let query = User.find(filter)
            .where({ profileAddress: { $exists: true, $ne: null } })
            .sort({ "invite.invitedOn": 'desc' })
            .skip(start);
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
                };
            });
        });
    }
    getAllReleases(_search, start, length) {
        let filter = {};
        if (_search) {
            const search = _search.trim();
            filter = { $or: [
                    { "artistName": { "$regex": search, "$options": "i" } },
                    { "artistAddress": { "$regex": search, "$options": "i" } },
                    { "title": { "$regex": search, "$options": "i" } },
                    { "contractAddress": { "$regex": search, "$options": "i" } },
                ] };
        }
        const c = Release.count(filter).exec();
        const rs = this._getReleaseEntriesByPage(filter, start, length, { "releaseDate": 'desc' });
        return bluebird_1.Promise.join(c, rs, (count, releases) => {
            return {
                count: count,
                releases: releases
            };
        });
    }
    getInvitedBy(userId, start, length) {
        return User.find({ "invite.invitedBy": userId })
            .sort({ "invite.invitedOn": 'desc' })
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
            });
        });
    }
    getTopPlayed(limit, genre) {
        const filter = genre ? { state: 'published', genres: genre } : { state: 'published' };
        return this._getLicensesForEntries(filter, limit, { directPlayCount: 'desc' })
            .then(function (licenses) {
            // secondary sort based on plays recorded in the blockchain.  This is the number that will
            // show on the screen, but it's too slow to pull all licenses and sort.  So, sort fast with
            // our local db, then resort top results to it doesn't look stupid on the page.
            return licenses.sort((a, b) => {
                const v1 = a.playCount ? a.playCount : 0;
                const v2 = b.playCount ? b.playCount : 0;
                return v2 - v1; // descending
            });
        });
    }
    getTopPlayedLastPeriod(limit, period) {
        const start = MusicoinOrgJsonAPI._getPreviousDatePeriodStart(Date.now(), period);
        return ReleaseStats.find({ startDate: start, duration: period })
            .sort({ "playCount": "desc" })
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
                    };
                    return output;
                });
            });
        })
            .then(promises => bluebird_1.Promise.all(promises));
    }
    getTopTippedLastPeriod(limit, period) {
        const start = MusicoinOrgJsonAPI._getPreviousDatePeriodStart(Date.now(), period);
        return ReleaseStats.find({ startDate: start, duration: period })
            .sort({ "tipCount": "desc" })
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
                    };
                    return output;
                });
            });
        })
            .then(promises => bluebird_1.Promise.all(promises));
    }
    getHero() {
        return Hero.find({ startDate: { $lte: Date.now() } })
            .sort({ startDate: 'desc' })
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
        });
    }
    getUserHero(profileAddress) {
        return User.findOne({ profileAddress: profileAddress }).exec()
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
            };
        });
    }
    getFallbackHero() {
        return this.getNewReleases(1)
            .then(releases => {
            const release = releases[0];
            return this._createHeroFromReleaseRecord(release, "images/hero.jpeg");
        });
    }
    _createHeroFromReleaseRecord(release, image) {
        return {
            subtitle: release.title,
            subtitleLink: `/track/${release.address}`,
            title: release.artistName,
            titleLink: `/artist/${release.artistAddress}`,
            image: image,
            licenseAddress: release.address,
            label: "",
        };
    }
    markAsAbuse(licenseAddress, isAbuse) {
        return Release.findOne({ contractAddress: licenseAddress }).exec()
            .then(release => {
            if (release) {
                release.markedAsAbuse = isAbuse;
                return release.save();
            }
        })
            .then(() => {
            return { success: true };
        })
            .catch(err => {
            console.log("Failed to mark track as abuse: " + err);
            return {
                success: false,
                reason: "Failed to mark track as abuse"
            };
        });
    }
    promoteTrackToHero(licenseAddress) {
        return Release.findOne({ contractAddress: licenseAddress }).exec()
            .then(release => {
            if (!release)
                return { success: false, reason: "Release not found" };
            return User.findOne({ profileAddress: release.artistAddress }).exec()
                .then(artist => {
                if (!artist)
                    return { success: false, reason: "Artist not found" };
                if (!artist.draftProfile || !artist.draftProfile.heroImageUrl || artist.draftProfile.heroImageUrl.trim().length == 0)
                    return { success: false, reason: "Artist does not have a promo image defined" };
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
                    return { success: true };
                });
            });
        })
            .catch(err => {
            console.log("Failed to promote track to Hero: " + err);
            return {
                success: false,
                reason: "Failed to promote track to Hero"
            };
        });
    }
    getRecentPlays(limit) {
        // grab the top 2*n from the db to try to get a distinct list that is long enough.
        return Playback.find({}).sort({ playbackDate: 'desc' }).limit(2 * limit).exec()
            .then(records => records.map(r => r.contractAddress))
            .then(addresses => Array.from(new Set(addresses))) // insertion order is preserved
            .then(addresses => addresses.slice(0, Math.min(addresses.length, limit)))
            .then(addresses => addresses.map(address => this.getLicense(address)))
            .then(promises => bluebird_1.Promise.all(promises));
    }
    getFeaturedArtists(limit) {
        // find recently joined artists that have at least one release
        let query = User.find({ profileAddress: { $ne: null } })
            .where({ mostRecentReleaseDate: { $ne: null } });
        return query.sort({ joinDate: 'desc' }).limit(limit).exec()
            .then(records => records.map(r => this._convertDbRecordToArtist(r)))
            .then(promises => bluebird_1.Promise.all(promises));
    }
    getAllArtists() {
        let query = User.find({ profileAddress: { $ne: null } });
        return query.sort({ joinDate: 'desc' }).exec()
            .then(records => records.map(r => this._convertDbRecordToArtist(r)))
            .then(promises => bluebird_1.Promise.all(promises));
    }
    findArtists(limit, _search) {
        const search = this._sanitize(_search);
        let query = User.find({ profileAddress: { $exists: true, $ne: null } })
            .where({ mostRecentReleaseDate: { $exists: true, $ne: null } });
        if (search) {
            query = query.where({
                $or: [
                    { "draftProfile.artistName": { "$regex": search, "$options": "i" } },
                    { "google.email": { "$regex": search, "$options": "i" } },
                    { "facebook.email": { "$regex": search, "$options": "i" } },
                    { "local.email": { "$regex": search, "$options": "i" } },
                ]
            });
        }
        return query.sort({ joinDate: 'desc' }).limit(limit).exec()
            .then(records => records.map(r => {
            return {
                id: r.profileAddress,
                label: `${r.draftProfile.artistName} (${r.profileAddress})`,
                value: r.profileAddress
            };
        }));
    }
    getNewArtists(limit, _search, _genre) {
        const search = this._sanitize(_search);
        const genre = this._sanitize(_genre);
        let query = User.find({ profileAddress: { $exists: true, $ne: null } })
            .where({ mostRecentReleaseDate: { $exists: true, $ne: null } });
        if (search) {
            query = query.where({
                $or: [
                    { "draftProfile.artistName": { "$regex": search, "$options": "i" } },
                    { "draftProfile.genres": { "$regex": search, "$options": "i" } },
                    { "draftProfile.regions": { "$regex": search, "$options": "i" } }
                ]
            });
        }
        if (genre) {
            query = query.where({ "draftProfile.genres": genre });
        }
        return query.sort({ joinDate: 'desc' }).limit(limit).exec()
            .then(records => records.map(r => this._convertDbRecordToArtist(r)))
            .then(promises => bluebird_1.Promise.all(promises));
    }
    getNewReleases(limit, genre) {
        const filter = genre ? { state: 'published', genres: genre, markedAsAbuse: { $ne: true } } : { state: 'published', markedAsAbuse: { $ne: true } };
        return this._getLicensesForEntries(filter, limit);
    }
    getTrackDetailsByIds(addresses) {
        return Release.find({ contractAddress: { $in: addresses } })
            .populate('artist')
            .then(releases => {
            return bluebird_1.Promise.all(releases.map(r => this._convertDbRecordToLicenseLite(r)));
        })
            .then(releases => {
            const byId = {};
            releases.forEach(r => byId[r.address] = r);
            return addresses.map(a => byId[a]);
        });
    }
    getSampleOfVerifiedTracks(limit, genre) {
        // short of upgrading the DB, random selection is a bit difficult.
        // However, we don't really need it to be truly random
        const condition = { verified: true, mostRecentReleaseDate: { $ne: null } };
        if (!limit || limit < 1 || limit > 10) {
            limit = 1;
        }
        // TODO we could cache the count() result as it doesn't change very often
        return User.find(condition).count()
            .then(count => {
            let offset = count < limit ? 0 : Math.floor(Math.random() * (count - limit));
            return User.find(condition, '_id')
                .limit(limit)
                .skip(offset);
        })
            .then(artists => {
            const filter = genre ? { state: 'published', genres: genre, markedAsAbuse: { $ne: true } } : { state: 'published', markedAsAbuse: { $ne: true } };
            let query = Release.find(filter)
                .where({ artist: { $in: artists.map(a => a._id) } })
                .populate("artist");
            return query.exec()
                .then(items => {
                this.shuffle(items);
                const newItems = [];
                const artists = {};
                items.forEach(item => {
                    if (!artists[item.artistAddress]) {
                        artists[item.artistAddress] = true;
                        newItems.unshift(item);
                    }
                    else {
                        newItems.push(item);
                    }
                });
                return newItems.length > limit ? newItems.slice(0, limit) : newItems;
            })
                .then(items => items.map(item => this._convertDbRecordToLicense(item)))
                .then(promises => bluebird_1.Promise.all(promises));
        });
    }
    getRandomReleases(limit, genre) {
        return this.doGetRandomReleases({ limit: limit, genre: genre, artist: null });
    }
    doGetRandomReleases({ limit = 1, genre, artist }) {
        let filter = { state: 'published', markedAsAbuse: { $ne: true } };
        if (genre) {
            filter = Object.assign({}, filter, { genre: genre });
        }
        if (artist) {
            filter = Object.assign({}, filter, { artistAddress: artist });
        }
        let query = Release.find(filter).populate('artist');
        return query.exec()
            .then(items => {
            this.shuffle(items);
            return items.length > limit ? items.slice(0, limit) : items;
        })
            .then(items => bluebird_1.Promise.all(items.map(item => this._convertDbRecordToLicense(item))));
    }
    getAllContracts() {
        const filter = { state: 'published' };
        return this._getLicensesForEntries(filter, 99999999);
    }
    getNewReleasesByGenre(limit, maxGroupSize, _search, _genre, _sort) {
        const search = this._sanitize(_search);
        const genre = _genre;
        const flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? flatten(b) : b), []);
        const sort = _sort == "plays"
            ? [["directPlayCount", 'desc'], ["directTipCount", 'desc'], ["releaseDate", 'desc']]
            : _sort == "date"
                ? [["releaseDate", 'desc'], ["directTipCount", 'desc'], ["directPlayCount", 'desc']]
                : [["directTipCount", 'desc'], ["directPlayCount", 'desc'], ["releaseDate", 'desc']];
        const artistList = search
            ? User.find({ "draftProfile.artistName": { "$regex": search, "$options": "i" } })
                .where({ mostRecentReleaseDate: { $ne: null } })
                .exec()
                .then(records => records.map(r => r.profileAddress))
            : bluebird_1.Promise.resolve([]);
        return artistList
            .then(profiles => {
            let releaseQuery = Release.find({ state: "published", markedAsAbuse: { $ne: true } });
            if (search) {
                releaseQuery = releaseQuery.where({ $or: [
                        { artistAddress: { $in: profiles } },
                        { title: { "$regex": search, "$options": "i" } },
                        { genres: { "$regex": search, "$options": "i" } },
                        { languages: { "$regex": search, "$options": "i" } },
                        { moods: { "$regex": search, "$options": "i" } },
                        { regions: { "$regex": search, "$options": "i" } }
                    ] });
            }
            if (genre) {
                releaseQuery = releaseQuery.where({ "genres": genre });
            }
            return releaseQuery
                .sort(sort)
                .exec()
                .then(items => {
                const genreOrder = [];
                const genreItems = {};
                let itemsIncluded = 0;
                for (let i = 0; i < items.length && itemsIncluded < limit; i++) {
                    const item = items[i];
                    const itemGenres = item.genres.slice(0);
                    itemGenres.push("Other");
                    for (let g = 0; g < itemGenres.length; g++) {
                        const genre = itemGenres[g];
                        if (knownGenres.indexOf(genre) == -1)
                            continue;
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
                .then(promises => bluebird_1.Promise.all(promises));
        });
    }
    getTransactionHistory(address, length, start) {
        return this.musicoinAPI.getTransactionHistory(address, length, start);
    }
    getTransactionStatus(tx) {
        return this.musicoinAPI.getTransactionStatus(tx);
    }
    _getLicensesForEntriesByPage(condition, start, limit, sort) {
        return this._getReleaseEntriesByPage(condition, start, limit, sort)
            .then(items => items.map(item => this._convertDbRecordToLicense(item)))
            .then(promises => bluebird_1.Promise.all(promises));
    }
    _getReleaseEntriesByPage(condition, start, limit, sort) {
        let query = Release.find(condition)
            .limit(limit)
            .skip(start)
            .sort(sort)
            .populate("artist");
        return query.exec();
    }
    _getLicensesForEntries(condition, limit, sort) {
        return this._getReleaseEntries(condition, limit, sort)
            .then(items => items.map(item => this._convertDbRecordToLicense(item)))
            .then(promises => bluebird_1.Promise.all(promises));
    }
    _getReleaseEntries(condition, limit, _sort) {
        let sort = _sort ? _sort : { releaseDate: 'desc' };
        let query = Release.find(condition).sort(sort);
        if (limit) {
            query = query.limit(limit);
        }
        return query.exec();
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
    migrateUserFollowing(userId) {
        return User.findById(userId).exec()
            .then(user => {
            if (user.following && user.following.length > 0) {
                const promises = user.following.map(f => {
                    return User.findOne({ profileAddress: f }).exec()
                        .then(wasFollowing => {
                        return this.startFollowing(userId, wasFollowing._id);
                    });
                });
                return bluebird_1.Promise.all(promises)
                    .then(() => {
                    user.following = [];
                    return user.save();
                });
            }
        });
    }
    setupNewUser(user) {
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
        return bluebird_1.Promise.join(user.save(), d, s, (saved, descriptionUrl, socialUrl) => {
            return this.musicoinAPI.publishProfile(null, name, descriptionUrl, user.draftProfile.ipfsImageUrl, socialUrl);
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
            .then(user => {
            return this.startFollowing(user._id, this.config.autoFollowUserId);
        })
            .then(() => {
            console.log(`User ${name} is now following the musicoin account`);
            return user;
        });
    }
    isUserFollowing(userId, toFollow) {
        return Follow.findOne({ follower: userId, following: toFollow }).exec()
            .then(match => {
            return {
                success: true,
                following: !!match
            };
        });
    }
    startFollowing(userId, toFollow) {
        const options = { upsert: true, new: true, setDefaultsOnInsert: true };
        return Follow.findOneAndUpdate({ follower: userId, following: toFollow }, {}, options).exec()
            .then(inserted => {
            MusicoinOrgJsonAPI._updateFollowerCount(toFollow, 1)
                .catch(err => console.log(`Could not update total followers after follow for ${toFollow}: ${err}`));
            return {
                success: true,
                following: !!inserted
            };
        });
    }
    stopFollowing(userId, toFollow) {
        return Follow.findOneAndRemove({ follower: userId, following: toFollow }).exec()
            .then(removed => {
            if (removed) {
                // fire and forget
                MusicoinOrgJsonAPI._updateFollowerCount(toFollow, -1)
                    .catch(err => console.log(`Could not update total followers after unfollow for ${toFollow}: ${err}`));
            }
            return {
                success: true,
                following: false
            };
        });
    }
    static _updateFollowerCount(toFollow, inc) {
        const findUser = User.findById(toFollow).exec();
        const updateStats = this._updateUserStats(toFollow, Date.now(), { $inc: { followCount: inc } });
        return bluebird_1.Promise.join(findUser, updateStats, (user, stats) => {
            user.followerCount = Math.max(0, user.followerCount ? user.followerCount + inc : inc);
            return user.save();
        });
    }
    static _updateUserStat(userId, date, duration, update) {
        const options = { upsert: true, new: true, setDefaultsOnInsert: true };
        return UserStats.findOneAndUpdate(this._getUserStatsCondition(userId, date, duration), update, options).exec();
    }
    static _updateUserStats(userId, date, update) {
        return bluebird_1.Promise.all([
            this._updateUserStat(userId, date, "day", update),
            this._updateUserStat(userId, date, "week", update),
            this._updateUserStat(userId, date, "month", update),
            this._updateUserStat(userId, date, "year", update),
            this._updateUserStat(userId, date, "all", update)
        ]);
    }
    static _updateReleaseStats(releaseId, date, update) {
        return bluebird_1.Promise.all([
            this._updateReleaseStat(releaseId, date, "day", update),
            this._updateReleaseStat(releaseId, date, "week", update),
            this._updateReleaseStat(releaseId, date, "month", update),
            this._updateReleaseStat(releaseId, date, "year", update),
            this._updateReleaseStat(releaseId, date, "all", update)
        ]);
    }
    static _updateReleaseStat(releaseId, date, duration, update) {
        const options = { upsert: true, new: true, setDefaultsOnInsert: true };
        return ReleaseStats.findOneAndUpdate(this._getReleaseStatsCondition(releaseId, date, duration), update, options).exec();
    }
    static _getUserStatsCondition(userId, date, duration) {
        return {
            user: userId,
            startDate: this._getDatePeriodStart(date, duration),
            duration: duration
        };
    }
    static _getReleaseStatsCondition(releaseId, date, duration) {
        return {
            release: releaseId,
            startDate: this._getDatePeriodStart(date, duration),
            duration: duration
        };
    }
    static _getPreviousDatePeriodStart(date, duration) {
        if (duration == "day" || duration == "week" || duration == "month" || duration == "year")
            return moment(date).subtract(1, duration).startOf(duration);
        else if (duration == "all")
            return 0;
        else
            throw new Error("Invalid duration specified for stats table: " + duration);
    }
    static _getDatePeriodStart(date, duration) {
        if (duration == "day" || duration == "week" || duration == "month" || duration == "year")
            return moment(date).startOf(duration);
        else if (duration == "all")
            return 0;
        else
            throw new Error("Invalid duration specified for stats table: " + duration);
    }
    deleteMessage(callerAddress, messageId) {
        return TrackMessage.findById(messageId).exec()
            .then(message => {
            if (message && message.senderAddress == callerAddress) {
                return message.remove();
            }
            return null;
        });
    }
    repostMessages(senderAddress, messageId) {
        if (!messageId || !senderAddress)
            return bluebird_1.Promise.resolve(null);
        const s = User.findOne({ profileAddress: senderAddress }).exec();
        const m = TrackMessage.findById(messageId).exec();
        return bluebird_1.Promise.join(s, m, (sender, message) => {
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
            });
        });
    }
    postLicenseMessages(contractAddress, _artistAddress, senderAddress, message, _messageType, replyToId, _threadId) {
        const r = contractAddress ? Release.findOne({ contractAddress: contractAddress }).exec() : bluebird_1.Promise.resolve(null);
        const a = _artistAddress ? User.findOne({ profileAddress: _artistAddress }).exec() : bluebird_1.Promise.resolve(null);
        const s = User.findOne({ profileAddress: senderAddress }).exec();
        const m = replyToId ? TrackMessage.findById(replyToId).exec() : bluebird_1.Promise.resolve(null);
        const messageType = _messageType ? _messageType : "comment";
        return bluebird_1.Promise.join(r, a, s, m, (release, artist, sender, replyToMessage) => {
            const artistAddress = artist ? artist.profileAddress : release ? release.artistAddress : replyToMessage ? replyToMessage.artistAddress : null;
            // notify the user that is the subject of this message about the comment/tip, as long as
            // they allow it.
            const actualArtist = artist
                ? bluebird_1.Promise.resolve(artist)
                : artistAddress
                    ? User.findOne({ profileAddress: artistAddress }).exec()
                    : bluebird_1.Promise.resolve(null);
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
                else if (senderAddress == artistAddress) {
                    console.log(`Not sending notification because the sender and receiver are the same: ${senderAddress}`);
                    sendNotification = false;
                }
                const threadId = _threadId
                    ? _threadId
                    : replyToMessage && replyToMessage.threadId
                        ? replyToMessage.threadId
                        : uuidV4();
                if (sendNotification) {
                    const recipient = a ? this._getUserEmail(a)
                        : messageType == "donate" ? "musicoin@berry.ai" : null;
                    if (recipient) {
                        console.log(`Sending message notification to: ${recipient}`);
                        const urlPath = `/nav/thread-page?thread=${threadId}`;
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
                    replyToSender: replyToMessage ? replyToMessage.sender : null,
                    threadId: threadId,
                    messageType: messageType
                });
            });
        });
    }
    getFeedMessages(userId, limit, messageTypes, minDate) {
        const f = Follow.find({ follower: userId }).exec();
        const u = User.findOne({ _id: userId }).exec();
        return bluebird_1.Promise.join(u, f, (user, followingRecords) => {
            if (user) {
                const following = followingRecords.map(fr => fr.following);
                const filter = minDate ? { timestamp: { $gte: minDate } } : {};
                let query = TrackMessage.find(filter)
                    .or([
                    { sender: { $in: following } },
                    { sender: userId },
                    { $and: [{ artist: userId }, { messageType: { $in: ["tip", "follow"] } }] },
                    { replyToSender: userId } // messages in reply to my messages
                ])
                    .limit(limit);
                if (messageTypes && messageTypes.length > 0) {
                    query = query.where({ messageType: { $in: messageTypes } });
                }
                return this._executeTrackMessagesQuery(query);
            }
            return [];
        });
    }
    getThreadMessages(threadId, limit) {
        if (!threadId)
            return bluebird_1.Promise.resolve([]);
        return this._executeTrackMessagesQuery(TrackMessage.find({ threadId: threadId }).limit(limit));
    }
    getLicenseMessages(contractAddress, limit) {
        const condition = contractAddress && contractAddress.trim().length > 0
            ? { contractAddress: contractAddress, messageType: { $ne: "repost" } }
            : {};
        return this._executeTrackMessagesQuery(TrackMessage.find(condition).limit(limit));
    }
    getUserMessages(profileAddress, limit) {
        const condition = profileAddress && profileAddress.trim().length > 0
            ? { senderAddress: profileAddress }
            : {};
        return this._executeTrackMessagesQuery(TrackMessage.find(condition).limit(limit));
    }
    _executeTrackMessagesQuery(query) {
        return query
            .sort({ "timestamp": 'desc' })
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
                };
            });
        });
    }
    addPendingPPPTransaction(userId, releaseId, coinsPerPlay, tx) {
        return PendingPlayback.create({
            release: releaseId,
            user: userId,
            coins: coinsPerPlay,
            tx: tx
        });
    }
    getPendingPPPPayments(userId) {
        return PendingPlayback.find({ user: userId }).exec();
    }
    addToMessageTipCount(messageId, coins) {
        return TrackMessage.findById(messageId)
            .then(record => {
            record.tips += coins;
            return record.save();
        });
    }
    addToReleaseTipCount(contractAddress, coins) {
        return Release.findOne({ contractAddress: contractAddress }).exec()
            .then(release => {
            if (release) {
                release.directTipCount = release.directTipCount ? release.directTipCount + coins : coins;
                return release.save();
            }
            return false;
        })
            .then(release => {
            return MusicoinOrgJsonAPI._updateReleaseStats(release.id, Date.now(), { $inc: { tipCount: coins } })
                .catch(err => {
                console.log(`Failed to update reporting stats for release: ${err}`);
                return release;
            })
                .then(() => release);
        });
    }
    addToReleaseCommentCount(contractAddress) {
        return Release.findOne({ contractAddress: contractAddress }).exec()
            .then(release => {
            return MusicoinOrgJsonAPI._updateReleaseStats(release.id, Date.now(), { $inc: { commentCount: 1 } })
                .catch(err => {
                console.log(`Failed to update reporting stats for release: ${err}`);
                return release;
            })
                .then(() => release);
        });
    }
    addToReleasePlayCount(userId, anonymousUserId, releaseId) {
        return Release.findById(releaseId).exec()
            .then(release => {
            release.directPlayCount = release.directPlayCount ? release.directPlayCount + 1 : 1;
            return release.save();
        })
            .then(release => {
            // fire and forget
            UserPlayback.create({
                user: userId,
                release: release.id,
                anonymousUser: anonymousUserId
            });
            return MusicoinOrgJsonAPI._updateReleaseStats(release.id, Date.now(), { $inc: { playCount: 1 } })
                .catch(err => {
                console.log(`Failed to update reporting stats for release: ${err}`);
                return release;
            })
                .then(() => release);
        });
    }
    addToUserTipCount(profileAddress, coins) {
        return User.findOne({ profileAddress: profileAddress }).exec()
            .then(user => {
            if (user) {
                user.directTipCount = user.directTipCount ? user.directTipCount + coins : coins;
                return user.save();
            }
            return false;
        })
            .then(user => {
            return MusicoinOrgJsonAPI._updateUserStats(user._id, Date.now(), { $inc: { tipCount: coins } })
                .catch(err => {
                console.log(`Failed to update reporting stats for user: ${err}`);
                return user;
            })
                .then(() => user);
        });
    }
    getOverallReleaseStats() {
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
    sendAllUserReports(duration, durationAdj, exchangeRateInfo) {
        let sent = 0;
        let errors = 0;
        const asOf = MusicoinOrgJsonAPI._getPreviousDatePeriodStart(Date.now(), duration);
        return ReportActivity.findOne({
            startDate: new Date(asOf),
            duration: duration,
            sent: true
        })
            .then(finishedReport => {
            if (finishedReport) {
                const msg = `Not sending report, already sent for ${new Date(asOf)}, duration: ${duration}`;
                console.log(msg);
                return bluebird_1.Promise.resolve({ success: false, reason: msg });
            }
            return User.find({
                accountLocked: { $ne: true },
                mostRecentReleaseDate: { $exists: true, $ne: null }
            })
                .then(users => {
                return bluebird_1.Promise.all(users.map(user => {
                    const userName = user.draftProfile ? user.draftProfile.artistName : user._id;
                    return this._sendUserStatsReport(user, asOf, duration, durationAdj, exchangeRateInfo)
                        .then((output) => {
                        sent++;
                        return output;
                    })
                        .catch(err => {
                        console.log(`Failed to send report for user: ${userName}, profile=${user.profileAddress}, id=${user._id}, err: ${err}`);
                        errors++;
                        return null;
                    });
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
                });
            });
        });
    }
    sendUserStatsReport(userId, duration, durationAdj, exchangeRateInfo) {
        const asOf = MusicoinOrgJsonAPI._getPreviousDatePeriodStart(Date.now(), duration);
        return User.findById(userId).exec()
            .then(user => {
            return this._sendUserStatsReport(user, asOf, duration, durationAdj, exchangeRateInfo);
        });
    }
    _sendUserStatsReport(user, asOf, duration, durationAdj, exchangeRateInfo) {
        if (user.accountLocked) {
            console.log("Not sending report to user with locked account: " + user.profileAddress);
            return bluebird_1.Promise.resolve();
        }
        const preferredFrequency = user.preferences && user.preferences.activityReporting ? user.preferences.activityReporting : "week";
        if (preferredFrequency != duration) {
            console.log(`Not sending report to user because this does not match their preferences: ${preferredFrequency} != ${duration} ${user.profileAddress}`);
            return bluebird_1.Promise.resolve();
        }
        return this.getUserStatsReport(user.profileAddress, asOf, duration)
            .then(report => {
            report.exchangeRateInfo = exchangeRateInfo;
            report.actionUrl = "https://musicoin.org/nav/feed";
            report.baseUrl = "https://musicoin.org";
            report.description = `Musicoin ${durationAdj} report`;
            report.duration = duration;
            const tracksHaveEvents = report.stats.releases
                .filter(r => r.playCount > 0 || r.tipCount > 0 || r.commentCount > 0)
                .length > 0;
            const userHasEvents = report.user.followCount > 0 || report.user.tipCount > 0 || report.user.commentCount;
            if (report.stats.releases.length > 0 && (tracksHaveEvents || userHasEvents)) {
                const userName = user.draftProfile ? user.draftProfile.artistName : user._id;
                console.log(`Sending report to user: ${userName}, ${this._getUserEmail(user)}, ${user.profileAddress}`);
                return this.mailSender.sendActivityReport(this._getUserEmail(user), report);
            }
            else {
                console.log("Not sending report to user with no events, user: " + user.profileAddress);
                return bluebird_1.Promise.resolve();
            }
        });
    }
    getUserStatsReport(_profileAddress, date, duration) {
        const profileAddress = FormUtils.requiredString(_profileAddress);
        if (duration != "day" && duration != "week" && duration != "month" && duration != "all")
            throw new Error("invalid duration: " + duration);
        const u = User.findOne({ profileAddress: profileAddress }).exec();
        const rs = Release.find({ artistAddress: profileAddress, state: 'published' }).exec();
        return bluebird_1.Promise.join(u, rs, (user, releases) => {
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
                };
            });
            const rstats = releases.map(release => {
                const rStatsCondition = MusicoinOrgJsonAPI._getReleaseStatsCondition(release._id, date, duration);
                return ReleaseStats.findOne(rStatsCondition)
                    .then(stats => {
                    if (!stats) {
                        stats = Object.assign(rStatsCondition, { playCount: 0, tipCount: 0, commentCount: 0 });
                    }
                    stats.track = release;
                    return stats ? stats : {
                        playCount: 0,
                        tipCount: 0,
                        commentCount: 0,
                        duration: rStatsCondition.duration,
                        startDate: rStatsCondition.startDate,
                        release: release._id
                    };
                });
            });
            const options = { year: 'numeric', month: 'short', day: 'numeric' };
            return bluebird_1.Promise.join(ustats, bluebird_1.Promise.all(rstats), (userStats, allReleaseStats) => {
                return {
                    user: user,
                    startDate: new Date(date).toLocaleDateString('en-US', options),
                    endDate: duration != "all" ? moment(date).add(1, duration).toDate().toLocaleDateString('en-US', options) : null,
                    stats: {
                        user: userStats,
                        releases: allReleaseStats
                    }
                };
            });
        });
    }
    getLicense(contractAddress) {
        console.log("Getting license: " + contractAddress);
        return Release.findOne({ contractAddress: contractAddress, state: 'published' }).exec()
            .then(record => {
            if (record)
                return this._convertDbRecordToLicense(record);
            return null;
        });
    }
    getErrors(_search, start, length) {
        const search = _search;
        let filter = {};
        if (search) {
            filter = { $or: [
                    { "errorCode": { "$regex": search, "$options": "i" } },
                    { "errorContext": { "$regex": search, "$options": "i" } }
                ] };
        }
        return ErrorReport.find(filter)
            .sort({ "date": 'desc' })
            .skip(start)
            .limit(length)
            .populate("user")
            .exec()
            .then(errorReports => {
            const updated = errorReports.map(report => {
                return Release.findOne({ contractAddress: report.licenseAddress })
                    .exec()
                    .then(track => {
                    return {
                        report: report,
                        track: track
                    };
                });
            });
            return bluebird_1.Promise.all(updated);
        });
    }
    removeError(_id) {
        return ErrorReport.findByIdAndRemove(_id).exec()
            .then((removed) => {
            if (removed) {
                console.log(`Removed error report entry: ${removed._id}`);
                return { success: true };
            }
            return { success: false, reason: "Not found" };
        })
            .catch((err) => {
            console.log(`Failed to remove error report entry: ${err}`);
            return { success: false, reason: "Error" };
        });
    }
    getArtistEarnings(id) {
        const x = this.exchangeRateProvider.getMusicoinExchangeRate();
        const u = User.findById(id).exec();
        return bluebird_1.Promise.join(u, x, (user, exchangeRate) => {
            if (!user)
                return { success: false };
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
                    followers: user.followerCount,
                    formattedTotalUSD: "$" + this._formatNumber((totalPlays + totalTips) * exchangeRate.usd, 2)
                };
            });
        });
    }
    getTrackEarnings(id) {
        const x = this.exchangeRateProvider.getMusicoinExchangeRate();
        const r = Release.findById(id).exec();
        return bluebird_1.Promise.join(r, x, (release, exchangeRate) => {
            if (!release)
                return { success: false };
            const plays = release.directPlayCount || 0;
            const tips = release.directTipCount || 0;
            return {
                success: true,
                plays: plays,
                tips: tips,
                formattedTotalUSD: "$" + this._formatNumber((plays + tips) * exchangeRate.usd, 2)
            };
        });
    }
    getReleaseByTx(tx) {
        return Release.findOne({ tx: tx })
            .then(release => {
            if (release)
                return this._convertDbRecordToLicenseLite(release);
            return null;
        });
    }
    getVotesByTrack(options) {
        return services_1.song.getVoteStats(options);
    }
    addVote(options) {
        return services_1.songVote.add(options);
    }
    removeVote(options) {
        return services_1.songVote.remove(options);
    }
    _convertDbRecordToLicenseLite(record) {
        const draftProfile = record.artist && record.artist.draftProfile ? record.artist.draftProfile : null;
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
            tx: record.tx,
            artist: {
                artistName: draftProfile ? draftProfile.artistName : "",
                image: draftProfile ? this.mediaProvider.resolveIpfsUrl(draftProfile.ipfsImageUrl) : "",
                verified: record.artist && record.artist.verified
            }
        };
    }
    _convertDbRecordToLicense(record) {
        return this.mcHelper.getLicense(record.contractAddress)
            .bind(this)
            .then(function (license) {
            if (!license.artistName)
                license.artistName = record.artistName;
            license.genres = record.genres;
            license.languages = record.languages;
            license.moods = record.moods;
            license.regions = record.regions;
            license.description = record.description;
            license.timeSince = this._timeSince(record.releaseDate);
            license.directTipCount = record.directTipCount || 0;
            license.directPlayCount = record.directPlayCount || 0;
            license.releaseDate = record.releaseDate;
            license.tx = record.tx;
            license.markedAsAbuse = record.markedAsAbuse;
            license.pendingUpdateTxs = record.pendingUpdateTxs;
            return license;
        });
    }
    _getUserEmail(user) {
        if (!user)
            return null;
        if (user.preferredEmail)
            return user.preferredEmail;
        if (user.google && user.google.email)
            return user.google.email;
        if (user.facebook && user.facebook.email)
            return user.facebook.email;
        if (user.local && user.local.email)
            return user.local.email;
        if (user.invite && user.invite.invitedAs)
            return user.invite.invitedAs;
        return null;
    }
    _getUserName(user) {
        if (!user)
            return "New User";
        if (user.google && this._notBlank(user.google.name))
            return user.google.name;
        if (user.facebook && this._notBlank(user.facebook.name))
            return user.facebook.name;
        if (user.twitter && this._notBlank(user.twitter.displayName))
            return user.twitter.displayName;
        if (user.soundcloud && this._notBlank(user.soundcloud.username))
            return user.soundcloud.username;
        if (user.local && this._notBlank(user.local.username))
            return user.local.username;
        return "New User";
    }
    _notBlank(s) {
        return s && s.trim().length > 0;
    }
    shuffle(a) {
        for (let i = a.length; i; i--) {
            let j = Math.floor(Math.random() * i);
            [a[i - 1], a[j]] = [a[j], a[i - 1]];
        }
    }
    _sanitize(_s) {
        const s = FormUtils.defaultString(_s, "");
        return s ? s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&").trim() : s;
    }
    _timeSince(date) {
        const seconds = Math.floor((Date.now() - date) / 1000);
        const intervals = [
            { value: 60, unit: "min" },
            { value: 60, unit: "hour" },
            { value: 24, unit: "day" },
            { value: 30, unit: "month" },
            { value: 12, unit: "year" },
        ];
        let unit = "second";
        let value = seconds;
        for (let i = 0; i < intervals.length; i++) {
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
    _onlyEmailAuth(user) {
        return !this._hasAuthMethod(user, "facebook")
            && !this._hasAuthMethod(user, "twitter")
            && !this._hasAuthMethod(user, "google")
            && this._hasAuthMethod(user, "local");
    }
    _hasAuthMethod(user, method) {
        return user[method] && user[method].id;
    }
    _formatNumber(value, decimals) {
        const raw = parseFloat(value).toFixed(decimals ? decimals : 0);
        const parts = raw.toString().split(".");
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return parts.join(".");
    }
}
exports.MusicoinOrgJsonAPI = MusicoinOrgJsonAPI;
//# sourceMappingURL=json-api.js.map