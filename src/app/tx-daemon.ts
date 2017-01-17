import * as Timers from 'timers';
import {MusicoinAPI} from "./musicoin-api";
const Release = require('../app/models/release');
const User = require('../app/models/user');

export class PendingTxDaemon {
  start(musicoinApi: MusicoinAPI, intervalMs: number) {
    console.log(`Starting pending release daemon with interval ${intervalMs}ms`);
    Timers.setInterval(() => this.checkForPendingReleases(musicoinApi), intervalMs);

    // same interval, but offset from the release check
    console.log(`Starting pending profile daemon with interval ${intervalMs}ms`);
    Timers.setTimeout(() => {
      Timers.setInterval(() => this.checkForPendingProfilesUpdates(musicoinApi), intervalMs);
    }, intervalMs/2);
  }

  checkForPendingProfilesUpdates(musicoinApi: MusicoinAPI) {
    User.find({updatePending: true}, function(err, results) {
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
    musicoinApi.getTransactionStatus(p.pendingTx)
      .then(function(result) {
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
          }
        }
        else if (result.status == "error") {
          console.log(`pending profile error: ${description}, api.musicoin.org returned error message.  Out of gas?`);
        }
        else if (result.status == "unknown") {
          console.log(`pending profile error: ${description}, api.musicoin.org returned 'unknown'.  Chain syncing issues?`);
        }

        console.log("Saving updates profile record...")
        p.save(function(err) {
          if (err) {
            console.log(`Failed to save profile record: ${err}`);
          }
          else {
            console.log("Pending profile updated successfully!");
          }
        })
      })
      .catch(function(err) {
        console.log(err);
      })
  }

  checkForPendingReleases(musicoinApi: MusicoinAPI) {
    Release.find({state: 'pending'}, function(err, results) {
      if (err) console.log(`Failed to check for pending releases: ${err}`);
      else {
        if (results.length == 0) return;

        console.log(`Found ${results.length} pending releases`);
        results.map(r => this.updatePendingReleaseStatus(musicoinApi, r));
      }
    }.bind(this))
  }

  updatePendingReleaseStatus(musicoinApi: MusicoinAPI, r) {
    musicoinApi.getTransactionStatus(r.tx)
      .then(function(result) {
        if (result.status == "pending") {
          console.log("pending release still pending: " + r.title);
          return;
        }

        if (result.status == "complete") {
          console.log("pending release complete: " + r.title);
          r.state = 'published';
          r.contractAddress = result.receipt.contractAddress;
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
        r.save(function(err) {
          if (err) {
            console.log(`Failed to save release record: ${err}`);
          }
          else {
            console.log("Pending release updated successfully!");
          }
        })
      })
      .catch(function(err) {
        console.log(err);
      })
  }
}