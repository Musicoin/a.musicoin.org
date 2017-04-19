import * as express from 'express';
import {Promise} from 'bluebird';
import * as Formidable from 'formidable';
import * as MetadataLists from '../config/metadata-lists';
const router = express.Router();
import {AddressResolver} from "./address-resolver";
import {MusicoinOrgJsonAPI} from "./rest-api/json-api";
import * as FormUtils from "./form-utils";
import {MusicoinAPI} from "./musicoin-api";
const Release = require('../app/models/release');
const User = require('../app/models/user');
import * as crypto from 'crypto';
const defaultTrackImage = "ipfs://QmRsPLxCAgDZLfujibUF8EwYY9uZVU9vRq73rpAotiAsdf";
const defaultProfileIPFSImage = "ipfs://QmR8mmsMn9TUdJiA6Ja3SYcQ4ckBdky1v5KGRimC7LkhGF";
const defaultProfileIPFSImageOld = "ipfs://QmQTAh1kwntnDUxf8kL3xPyUzpRFmD3GVoCKA4D37FK77C";

export class ReleaseManagerRouter {
  constructor(musicoinApi: MusicoinAPI,
              jsonAPI: MusicoinOrgJsonAPI,
              addressResolver: AddressResolver,
              maxImageWidth: number,
              mediaProvider: any, // TODO
              config: any,
              doRender: any) {
    router.get('/', function(req, res) {
      doRender(req, res, 'release-manager/release-manager.ejs', {
        showTermsOfUse: config.termsOfUseVersion != req.user.termsOfUseVersion,
        metadata: {
          languages: MetadataLists.languages,
          moods: MetadataLists.moods,
          genres: MetadataLists.genres,
          regions: MetadataLists.regions
        }
      });
    });

    router.get('/pending', function(req, res) {
      jsonAPI.getReleaseByTx(req.query.tx)
        .then(release => {
          doRender(req, res, 'release-manager/pending-release-page.ejs', {release: release});
        })
    });

    router.post('/pending-release-element', (req, res) => {
      jsonAPI.getReleaseByTx(req.body.tx)
        .then(release => {
          doRender(req, res, 'release-manager/pending-release-element.ejs', {release: release});
        })
    });

    router.post('/license', (req, res) => {
      console.log("Getting license preview");
      convertSimpleFormToLicense(req.user.draftProfile.artistName, req.user.profileAddress, req.body)
        .then(function (license) {
          doRender(req, res, 'release-manager/license.ejs', {showRelease: true, license: license});
        })
    });

    function convertSimpleFormToLicense(artistName, selfAddress, trackFields) {
      const recipients = FormUtils.extractRecipients(trackFields);
      return Promise.join(
        addressResolver.resolveAddresses(selfAddress, recipients.contributors),
        addressResolver.resolveAddresses(selfAddress, recipients.royalties),
        function (resolvedContributors, resolveRoyalties) {
          const license = {
            coinsPerPlay: 1,
            title: trackFields['title'],
            artistName: artistName,
            royalties: resolveRoyalties,
            contributors: resolvedContributors,
            errors: []
          }
          license.errors = doValidation(license);
          return license;
        })
    }

    function isVerified(user) {
      if (!user) return false;
      return !!user.verified;
    }

    function hasSocialLinks(user) {
      if (!user) return false;
      return (user.twitter && user.twitter.id) || (user.facebook && user.facebook.id);
    }

    router.post('/release', function (req: any, res) {
      if (req.user && req.user.blocked) {
        return res.redirect("/profile?releaseError=true");
      }

      const form = new Formidable.IncomingForm();
      form.parse(req, (err, fields: any, files: any) => {
        console.log(`Fields: ${JSON.stringify(fields)}`);
        console.log(`Files: ${JSON.stringify(files)}`);

        const selfAddress = req.user.profileAddress;
        if (!isVerified(req.user) && !hasSocialLinks(req.user)) return res.json({success: false, reason: "You must link a twitter or facebook account to release music"});
        if (!fields.title) return res.json({success: false, reason: "You must profile a title"});
        if (!files.audio || files.audio.size == 0) return res.json({success: false, reason: "You must provide an audio file"});
        if (fields.rights != "confirmed") return res.json({success: false, reason: "You must confirm that you have rights to release this work."});
        if (config.termsOfUseVersion != req.user.termsOfUseVersion && fields.terms != "confirmed") return res.json({success: false, reason: "You must agree to the Musicoin website's Terms of Use before you can release music."});

        const recipients = FormUtils.extractRecipients(fields);
        const key = crypto.randomBytes(16).toString('base64'); // 128-bits

        const genres = fields.genres || "";
        const languages = fields.languages || "";
        const regions = fields.regions;
        const regionArray = regions
          ? regions.split(",").map(s => s.trim()).filter(s => s)
          : req.user.draftProfile.regions
            ? req.user.draftProfile.regions
            : [];
        const moods = fields.moods || "";

        const track = {
          title: fields.title,
          audio: files.audio,
          image: files.image,

          genres: genres,
          languages: languages,
          regions: regions,
          moods: moods,

          genreArray: genres.split(",").map(s => s.trim()).filter(s => s),
          languageArray: languages.split(",").map(s => s.trim()).filter(s => s),
          regionArray: regionArray,
          moodArray: moods.split(",").map(s => s.trim()).filter(s => s),

          contributors: recipients.contributors,
          royalties: recipients.royalties,
          description: fields.description,
          imageUrl: "",
          metadata: {}
        };

        const a = mediaProvider.upload(track.audio.path, () => key); // encrypted
        const profileHasDefaultImage = !req.user.draftProfile.ipfsImageUrl
          || req.user.draftProfile.ipfsImageUrl == defaultProfileIPFSImage
          || req.user.draftProfile.ipfsImageUrl == defaultProfileIPFSImageOld;
        const i = track.image && track.image.size > 0
          ? FormUtils.resizeImage(track.image.path, maxImageWidth)
            .then((newPath) => mediaProvider.upload(newPath))
          : profileHasDefaultImage
            ? defaultTrackImage
            : req.user.draftProfile.ipfsImageUrl;

        track.metadata = {
          genres: track.genreArray,
          regions: track.regionArray,
          languages: track.languageArray,
          moods: track.moodArray
        };

        const sessionID = req.session ? req.session.id : "";
        console.log(`Releasing Track: session=${sessionID} ${JSON.stringify(track, null, 2)}`);

        const m = mediaProvider.uploadText(JSON.stringify(track.metadata));
        const c = addressResolver.resolveAddresses(selfAddress, track.contributors);
        const r = addressResolver.resolveAddresses(selfAddress, track.royalties);
        return Promise.join(a, i, m, c, r, function (audioUrl, imageUrl, metadataUrl, contributors, royalties) {
          track.imageUrl = imageUrl;
          return musicoinApi.releaseTrack(
            req.user.profileAddress,
            req.user.draftProfile.artistName,
            track.title,
            imageUrl,
            metadataUrl,
            audioUrl,
            contributors,
            royalties,
            track.audio.type,
            key);
        })
          .then(function (tx: string) {
            console.log("Got transactions: " + JSON.stringify(tx));
            const release = {
              tx: tx,
              title: track.title,
              imageUrl: track.imageUrl,
              artistName: req.user.draftProfile.artistName,
              artistAddress: req.user.profileAddress,
              description: track.description,
              genres: track.genreArray,
              regions: track.regionArray,
              languages: track.languageArray,
              moods: track.moodArray
            };
            console.log(`Saving release txs to database ...`);
            return Release.create(release);
          })
          .then(function (releaseRecord) {
            // async, fire and forget.  Just log an error if the update doesn't work.
            User.findOne({profileAddress: selfAddress}).exec()
              .then(function (artist) {
                artist.mostRecentReleaseDate = new Date();
                artist.termsOfUseVersion = config.termsOfUseVersion;
                return artist.save();
              })
              .catch(function (err) {
                console.log("Failed to update artist with new release date, TOS version: " + err);
              });

            return releaseRecord;
          })
          .then(function (releaseRecord) {
            console.log(`Saved releases txs to database!`);
            return res.json({success: true, tx: releaseRecord.tx});
          })
          .catch(function (err) {
            console.log(`Saving releases to database failed! ${err}`);
            return res.json({success: false, reason: "An internal error occurred.  Please try again later."});
          });
      });
    });

    function doValidation(license): string[] {
      const errors = [];
      if (!license.royalties.every(r => !r.invalid)) errors.push("Invalid addresses");
      if (!license.contributors.every(r => !r.invalid)) errors.push("Invalid addresses");
      if (!(license.title && license.title.trim() != "")) errors.push("Title is required");
      return errors;
    }
  }

  getRouter() {
    return router;
  }
}


