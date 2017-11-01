var audioPlayer = {
  audioElement: null,

  nowPlayingLicenseAddress: null,
  nowPlayingArtistProfile: null,
  playbackId: 0,
  previousTime: 0,
  minMillisBetweenPlays: 2000,

  previouslySelectedTrack: null,

  progressThumb: null,
  progressArea: null,
  progressForeground: null,

  currentPlaylist: [],
  currentIdx: -1,
  shuffle: false,
  playlistListener: null,

  playItemById: function(licenseAddress, callback) {
    console.log("Checking eligibility for " + licenseAddress);
    $.post("/user/canPlay", { address: licenseAddress }, function(eligibility) {
      if (eligibility.success) {
        console.log("Getting details for " + licenseAddress);
        $.get("/json-api/track/" + licenseAddress, function(data) {
          var result = audioPlayer.playItem(null,
            data.audioUrl,
            data.title,
            data.artistName,
            data.image,
            data.playCount,
            data.tipCount,
            data.artistProfileAddress,
            data.address
          )
          if (callback) callback(null, result);
          if (eligibility.message) parent.showMessage(eligibility.message, "success", 5000);
        })
      } else {
        parent.showMessage(eligibility.message, "warning", 5000);
        if (callback) callback(new Error("Cannot play track"), false);
      }
    })
  },

  queueTrack: function(licenseAddress, startIfPaused) {
    var newLength = audioPlayer.currentPlaylist.push(licenseAddress);
    audioPlayer._playlistChanged();

    // auto play this new track if the player is paused
    if (!audioPlayer.isPlaying() && (startIfPaused || newLength === 1)) {
      audioPlayer.jumpToIndex(newLength - 1);
    }
  },

  removePlaylistItem: function(idx) {
    if (idx >= 0 && idx < audioPlayer.currentPlaylist.length && idx != audioPlayer.currentIdx) {
      var beforeCurrent = idx < audioPlayer.currentIdx;
      audioPlayer.currentPlaylist.splice(idx, 1);
      audioPlayer._playlistChanged();
      if (beforeCurrent) {
        audioPlayer.currentIdx--;
        audioPlayer._selectedItemChanged()
      }
    }
  },

  clearPlaylist: function() {
    if (audioPlayer.currentPlaylist.length > audioPlayer.currentIdx) {
      audioPlayer.currentPlaylist = [audioPlayer.currentPlaylist[audioPlayer.currentIdx]];
      audioPlayer.currentIdx = 0;
      audioPlayer._playlistChanged();
      audioPlayer._selectedItemChanged();
    }
  },

  playList: function(licenseIds) {
    if (licenseIds) {
      audioPlayer.currentPlaylist = licenseIds.slice();
      audioPlayer._playlistChanged();
      if (audioPlayer.shuffle) {
        audioPlayer.playNextItem();
      } else {
        audioPlayer.jumpToIndex(0);
      }
    }
  },

  skipTrack: function() {
    audioPlayer.playNextItem();
  },

  jumpToIndex: function(idx) {
    if (idx >= 0 && idx < audioPlayer.currentPlaylist.length) {
      console.log("Jumping to index: " + idx);
      audioPlayer.playItemById(audioPlayer.currentPlaylist[idx], function(err, played) {
        if (!err && played) {
          audioPlayer.currentIdx = idx;
          audioPlayer._selectedItemChanged();
        } else {
          console.log("Jumping to index: aborted: cannot play track now: " + idx + ": " + err);
        }
      });
    } else {
      console.log("Not kumping to index: index out of range: " + idx);
    }
  },

  setShuffle: function(newValue) {
    audioPlayer.shuffle = newValue;
    $("#shuffle").toggleClass('button-highlight', audioPlayer.shuffle);
    audioPlayer._shuffleStateChanged();
  },

  toggleShuffle: function() {
    audioPlayer.setShuffle(!audioPlayer.shuffle)
  },

  playNextItem: function() {
    var nextIdx = audioPlayer.shuffle ?
      Math.floor(Math.random() * audioPlayer.currentPlaylist.length) :
      audioPlayer.currentIdx + 1;

    console.log("Playing next item at index: " + nextIdx);
    audioPlayer.jumpToIndex(nextIdx);
  },

  pause: function() {
    audioPlayer.audioElement.pause();
  },

  isPlaying: function() {
    return !audioPlayer.audioElement.paused;
  },

  setPlayQueueClosed: function() {
    $("#play-queue-trigger").toggleClass("play-queue-open", false);
  },

  _selectedItemChanged: function() {
    if (audioPlayer.playlistListener && audioPlayer.playlistListener.selectedItemChanged)
      audioPlayer.playlistListener.selectedItemChanged(audioPlayer.currentIdx);
    audioPlayer._updateNextButton();
  },

  _playlistChanged: function() {
    if (audioPlayer.playlistListener && audioPlayer.playlistListener.playlistChanged)
      audioPlayer.playlistListener.playlistChanged(audioPlayer.currentPlaylist.slice());
    audioPlayer._updateNextButton();
    audioPlayer._updateQueueCount();
  },

  _shuffleStateChanged: function() {
    if (audioPlayer.playlistListener && audioPlayer.playlistListener.shuffleStateChanged) {
      audioPlayer.playlistListener.shuffleStateChanged(audioPlayer.shuffle);
    }
    audioPlayer._updateNextButton();
  },

  _playStateChanged: function(playing) {
    if (audioPlayer.playlistListener && audioPlayer.playlistListener.playStateChanged) {
      audioPlayer.playlistListener.playStateChanged(playing);
    }
    audioPlayer._updateNextButton();
  },

  _updateNextButton: function() {
    var canGoNext = audioPlayer.shuffle ?
      audioPlayer.currentPlaylist.length > 0 :
      audioPlayer.currentIdx < audioPlayer.currentPlaylist.length - 1;
    console.log("canGoNext: " + canGoNext);
    $("#player-next-button").toggleClass("disabled", !canGoNext);
  },

  _updateQueueCount: function() {
    let queueCount = $("#play-queue-count");
    queueCount.toggle(audioPlayer.currentPlaylist.length > 1);
    queueCount.text(audioPlayer.currentPlaylist.length);
  },

  playItem: function(e, url, title, artist, img, playCount, tipCount, artistProfileAddress, licenseAddress) {
    var now = new Date().getTime();
    if (now - audioPlayer.previousTime < audioPlayer.minMillisBetweenPlays) {
      audioPlayer.previousTime = now;
      console.log("Too fast!");
      return false;
    }
    audioPlayer.playbackId++;
    console.log("Current playbackId: " + audioPlayer.playbackId);
    var thisPlay = audioPlayer.playbackId;
    var messageArea = $("#player-message");
    messageArea.show();
    messageArea.text("musicoin.org is sending 1 coin to '" + title + "'...");
    window.setTimeout(function() {
      if (thisPlay == audioPlayer.playbackId) {
        messageArea.text("musicoin.org sent 1 coin to '" + title + "'");
      }
    }, 20000);
    window.setTimeout(function() {
      if (thisPlay == audioPlayer.playbackId) {
        messageArea.hide();
      }
    }, 22000);

    audioPlayer.previousTime = now;
    audioPlayer.nowPlayingLicenseAddress = licenseAddress;
    audioPlayer.nowPlayingArtistProfile = artistProfileAddress;
    if (e) {
      if (audioPlayer.previouslySelectedTrack) audioPlayer.previouslySelectedTrack.classList.remove("selected-track")
      audioPlayer.previouslySelectedTrack = e;
      e.classList.add("selected-track");
    }
    $(".show-on-play", window.parent.document).css("display", "flex");
    $(".show-on-play").css("display", "flex");
    $("#player-title")[0].innerHTML = title;
    $("#player-artist")[0].innerHTML = artist;
    $("#player")[0].src = url + "?" + new Date().getTime();
    $("#player-background")[0].style.backgroundImage = "url('" + img + "')";
    $("#player-badge-image")[0].src = img;
    //      $("#player-plays")[0].innerHTML = playCount;
    //      $("#player-tips")[0].innerHTML = tipCount;

    // update the tip button with the new address and reset the icon
    //      var tipButton = $("#player-tip-button");
    //      tipButton.attr("recipient", licenseAddress);
    //      tipButton.html('<i class="fa fa-heart-o message-tip" aria-hidden="true"></i>');

    var heartButton = $("#player-tip-button");
    heartButton.attr("recipient", licenseAddress);

    audioPlayer.audioElement.play();
    audioPlayer.resetProgressNow();
    return true;
  },

  initialize: function() {
    if (!audioPlayer.audioElement) {
      audioPlayer.audioElement = $('#player')[0];
      audioPlayer.audioElement.style.display = "block";
      audioPlayer.progressThumb = $("#progress-thumb");
      audioPlayer.progressArea = $("#player-progress");
      audioPlayer.progressForeground = $("#player-progress-div");
      audioPlayer.audioElement.addEventListener('error', function(e) {
        if (audioPlayer.nowPlayingLicenseAddress == null) return;

        $("#player-message").text("Playback failed!");
        console.log("Old playbackId: " + audioPlayer.playbackId);
        audioPlayer.playbackId++;
        console.log("New playbackId: " + audioPlayer.playbackId);
        $.post('/error-report', {
          licenseAddress: audioPlayer.nowPlayingLicenseAddress,
          errorContext: audioPlayer.audioElement.src,
          errorCode: e.target.error.code
        }, function(data) {
          if (data.success) {
            console.log("Reported error to Musicoin service successfully");
          } else {
            console.log("Failed to report error to Musicoin service: " + JSON.stringify(data));
          }
        });
        switch (e.target.error.code) {
          case e.target.error.MEDIA_ERR_ABORTED:
            //              alert('You aborted the video playback.');
            break;
          case e.target.error.MEDIA_ERR_NETWORK:
            alert('A network error caused the audio download to fail.');
            break;
          case e.target.error.MEDIA_ERR_DECODE:
            alert('The audio playback was aborted due to a corruption problem or because the video used features your browser did not support.');
            break;
          case e.target.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
            alert('The video audio not be loaded, either because the server or network failed or because the format is not supported.');
            break;
          default:
            alert('An unknown error occurred.');
            break;
        }
      });

      audioPlayer.audioElement.addEventListener('timeupdate', function() {
        if (!isNaN(audioPlayer.audioElement.currentTime) && !isNaN(audioPlayer.audioElement.duration)) {
          $("#player-time-played")[0].innerText = audioPlayer.formatTime(audioPlayer.audioElement.currentTime);
          $("#player-time-left")[0].innerText = audioPlayer.formatTime(audioPlayer.audioElement.duration);

          // tell the progress bar to get to the end at the time the track will end
          if (audioPlayer.audioElement.paused) {
            audioPlayer.syncProgressNow();
            return;
          }

          var secondsLeft = audioPlayer.audioElement.duration - audioPlayer.audioElement.currentTime;
          audioPlayer.progressForeground.css('transition', 'width ' + parseInt(secondsLeft) + 's linear');
          audioPlayer.progressForeground.css('width', audioPlayer.progressArea.width());

          if (!audioPlayer.seeking) {
            audioPlayer.progressThumb.css('transition', 'left ' + parseInt(secondsLeft) + 's linear');
            audioPlayer.progressThumb.css('left', audioPlayer.progressArea.width() - 8);
          }
        }
      });

      audioPlayer.audioElement.addEventListener('ended', function() {
        audioPlayer.nowPlayingLicenseAddress = null;
        audioPlayer.audioElement.src = null;
        audioPlayer.playNextItem();
      })

      audioPlayer.audioElement.addEventListener('play', function() {
        audioPlayer.syncProgressNow();
        $("#player-play-button").hide();
        $("#player-pause-button").show();
        audioPlayer._playStateChanged(true);
      })

      audioPlayer.audioElement.addEventListener('pause', function() {
        audioPlayer.syncProgressNow();
        $("#player-play-button").show();
        $("#player-pause-button").hide();
        audioPlayer._playStateChanged(false);
      })

      audioPlayer.audioElement.addEventListener('canplay', function() {
        audioPlayer.syncProgressNow();
      })

      $("#player-artist").on('click', function() {
        if (audioPlayer.nowPlayingArtistProfile)
          parent.document.getElementById("mainFrame").src = "/artist/" + audioPlayer.nowPlayingArtistProfile;
      })

      $(".title-link").on('click', function() {
        if (audioPlayer.nowPlayingLicenseAddress)
          parent.document.getElementById("mainFrame").src = "/track/" + audioPlayer.nowPlayingLicenseAddress;
      })

      $(".toggle-shuffle").on('click', function() {
        audioPlayer.toggleShuffle();
      })

      $(".play-queue-trigger").on('click', function() {
        var playQueue = parent.document.getElementById("mainFrame").contentWindow.playQueue;
        var wasVisible = playQueue.isVisible();
        if (playQueue) {
          playQueue.toggle();
        }
        $(this).toggleClass("play-queue-open", !wasVisible);
      })

    }
    return audioPlayer.audioElement;
  },

  resetProgressNow: function() {
    audioPlayer.progressThumb.css('left', -8);
    audioPlayer.progressForeground.css('width', 0);
    audioPlayer.progressThumb.css('transition', 'none');
    audioPlayer.progressForeground.css('transition', 'none');
  },

  syncProgressNow: function() {
    var progress_fraction = audioPlayer.audioElement.currentTime / audioPlayer.audioElement.duration;
    audioPlayer.progressThumb.css('left', progress_fraction * audioPlayer.progressArea.width() - 8);
    audioPlayer.progressForeground.css('width', progress_fraction * audioPlayer.progressArea.width());

    audioPlayer.progressThumb.css('transition', 'none');
    audioPlayer.progressForeground.css('transition', 'none');
  },

  formatTime: function(seconds) {
    if (isNaN(seconds)) return "";
    var output = new Date(seconds * 1000).toISOString().substr(11, 8);
    if (output.startsWith("00:")) return output.substr(3);
    return output;
  },

  togglePlayState: function() {
    if (audioPlayer.audioElement.paused) {
      if (audioPlayer.audioElement.readyState > 0) {
        audioPlayer.audioElement.play();
      }
    } else {
      audioPlayer.audioElement.pause();
    }
  }
}

$(document).ready(function() {
  audioPlayer.initialize();

  audioPlayer.progressThumb.draggable({ axis: "x", containment: "#player-progress" });
  audioPlayer.progressThumb.draggable({
    start: function() {
      audioPlayer.seeking = true;
      audioPlayer.progressThumb.css('transition', 'none');
    },
    drag: function() {},
    stop: function() {
      audioPlayer.seeking = false;
      var position = parseInt(audioPlayer.progressThumb.css('left'));
      var max = audioPlayer.progressArea.width();
      var newValue = (position / max) * audioPlayer.audioElement.duration;
      if (!isNaN(newValue)) {
        audioPlayer.audioElement.currentTime = newValue;
        audioPlayer.syncProgressNow();
      }
    }
  });

  $("#player-tip-button").on('click', function() {
    var _tipModule = parent.document.getElementById("mainFrame").contentWindow.tipModule;
    _tipModule.accumulateTips($(this));
  })
});