import * as Timers from 'timers';
import { Promise } from 'bluebird';

import { MusicoinAPI } from './musicoin-api';

const Release = require('../models/release');
const User = require('../models/user');

interface PendingTxDaemonConfig {
  streamingOrgFiles: string,
  streamingTracksLocation: string,
  streamingSegments: string
}

export class PendingTxDaemon {
  constructor(private newProfileCallback, private releaseCallback, public apiConfig: PendingTxDaemonConfig) {
  }

  start(musicoinApi: MusicoinAPI, intervalMs: number) {
    console.log(`Starting pending release daemon with interval ${intervalMs}ms`);
    Timers.setInterval(() => this.checkForPendingReleases(musicoinApi), intervalMs);

    // same interval, but offset from the release check
    console.log(`Starting pending profile daemon with interval ${intervalMs}ms`);
    Timers.setTimeout(() => {
      Timers.setInterval(() => this.checkForPendingProfilesUpdates(musicoinApi), intervalMs);
    }, intervalMs / 3);
  }

  checkForPendingProfilesUpdates(musicoinApi: MusicoinAPI) {
    User.find({ updatePending: true }, function (err, results) {
      if (err) console.log(`Failed to check for pending releases: ${err}`);
      else {
        if (results.length == 0) return;
        console.log(`Found ${results.length} pending profile updates`);
        results.map(r => this.updatePendingProfileStatus(musicoinApi, r));
      }
    }.bind(this))
  }

  updatePendingProfileStatus(musicoinApi: MusicoinAPI, p) {
    const description = p.pendingTx;

    // don't keep checking malformed records.
    if (!p.pendingTx) {
      p.updatePending = false;
      p.save();
      return;
    }
    musicoinApi.getTransactionStatus(p.pendingTx)
      .then((result) => {
        if (result.status == "pending") {
          console.log("pending profile update still pending: " + description);
          return;
        }

        p.updatePending = false;
        p.pendingTx = "";
        if (result.status == "complete") {
          console.log("pending profile complete: " + description);
          // Updates will not include a contractAddress since the contract already exists
          if (result.receipt.contractAddress) {
            p.profileAddress = result.receipt.contractAddress;
            this.newProfileCallback(p);
          }
        }
        else if (result.status == "error") {
          console.log(`pending profile error: ${description}, api.musicoin.org returned error message.  Out of gas?`);
        }
        else if (result.status == "unknown") {
          console.log(`pending profile error: ${description}, api.musicoin.org returned 'unknown'.  Chain syncing issues?`);
        }

        console.log("Saving updates profile record...")
        p.save(function (err) {
          if (err) {
            console.log(`Failed to save profile record: ${err}`);
          }
          else {
            console.log("Pending profile updated successfully!");
          }
        })
      })
      .catch(function (err) {
        console.log(err);
      })
  }

  checkForPendingReleases(musicoinApi: MusicoinAPI) {
    Release.find({ state: 'pending' }, function (err, results) {
      if (err) console.log(`Failed to check for pending releases: ${err}`);
      else {
        if (results.length == 0) return;

        console.log(`Found ${results.length} pending releases`);
        results.map(r => this.updatePendingReleaseStatus(musicoinApi, r));
      }
    }.bind(this))
  }

  updatePendingPlaybackStatus(musicoinApi: MusicoinAPI, r) {
    return musicoinApi.getTransactionStatus(r.tx)
      .then((result) => {
        if (result.status == "pending") {
          console.log("pending playback tx still pending: " + r.tx);
          return;
        }

        if (result.status == "complete") {
          console.log("pending playback complete: " + r.tx);
          r.remove();
        }
        else if (result.status == "error") {
          // TODO: Add record to some other table?
          console.log(`pending playback payment failed!: status=${result.status}, tx=${r.tx}`);
          r.remove();
        }
        else if (result.status == "unknown") {
          if (r.missingCount > 3) {
            // TODO: Add record to some other table?
            console.log(`pending playback payment could not be found after 3 checks!: status=${result.status}, tx=${r.tx}`);
            return r.remove();
          }
          else {
            console.log(`pending playback tx not found, wating for the next check!: tx=${r.tx}`);
            r.missingCount++;
            return r.save();
          }
        }
      });
  }

  updatePendingReleaseStatus(musicoinApi: MusicoinAPI, r) {
    musicoinApi.getTransactionStatus(r.tx)
      .then((result) => {
        if (result.status == "pending") {
          console.log("pending release still pending: " + r.title);
          return;
        }

        if (result.status == "complete") {
          console.log("pending release complete: " + r.title);
          r.contractAddress = result.receipt.contractAddress;
          Release.findOne({ contractAddress: result.receipt.contractAddress }).exec()
            .then(releaseRecord => {
              console.log('mkdir -p ' + '/var/www/mcorg/streaming-storage/org' + '/' + releaseRecord.contractAddress + ' && mv ' + releaseRecord.tmpAudioUrl + " " + '/var/www/mcorg/streaming-storage/org' + '/' + releaseRecord.contractAddress + '/' + releaseRecord.contractAddress + '.mp3');
              console.log('ffmpeg -re -i ' + this.apiConfig.streamingOrgFiles + '/' + releaseRecord.contractAddress + '/' + releaseRecord.contractAddress + '.mp3' + ' -codec copy -bsf h264_mp4toannexb -map 0 -f segment -segment_time ' + this.apiConfig.streamingSegments + ' -segment_format mpegts -segment_list ' + this.apiConfig.streamingOrgFiles + '/' + releaseRecord.contractAddress + '/' + 'index.m3u8 -segment_list_type m3u8 ' + this.apiConfig.streamingOrgFiles + '/' + releaseRecord.contractAddress + '/ts%d.ts ' + '&& cd ' + this.apiConfig.streamingTracksLocation + '/' + ' && mkdir ' + releaseRecord.contractAddress + ' && cd ' + this.apiConfig.streamingOrgFiles + '/' + releaseRecord.contractAddress + '/' + ' && find . ' + "-regex '.*\\.\\(ts\\|m3u8\\)' -exec mv {} " + this.apiConfig.streamingTracksLocation + '/' + releaseRecord.contractAddress + '/' + ' \\;');
            });
          r.state = 'published';
          r.canReceiveFunds = true;
        }
        else if (result.status == "error") {
          console.log(`pending release error: ${r.title}, api.musicoin.org returned error message.  Out of gas?`);
          r.state = 'error';
          r.errorMessage = "Transaction failed (out of gas?)";
        }
        else if (result.status == "unknown") {
          console.log(`pending release error: ${r.title}, api.musicoin.org returned 'unknown'.  Chain syncing issues?`);
          r.state = 'error';
          r.errorMessage = "Transaction id not found (maybe the chain was out of sync?)";
        }

        console.log("Saving updates release record...")
        r.save(function (err) {
          if (err) {
            console.log(`Failed to save release record: ${err}`);
          }
          else {
            console.log("Pending release updated successfully!");
          }
        })
      })
      .catch(function (err) {
        console.log(err);
      })
  }
}
