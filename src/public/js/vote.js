(function(musicoin) {
  
  function VotingController() {

  }

  VotingController.prototype.initialize = function() {

    var self = this;
    
    $('.vote-button').on('click', function onVoteButtonClick(event) {
      event.preventDefault();
      var trackAddress = window.location.pathname.split('/').pop();
      if($(this).hasClass('fa-thumbs-up')) {
        self.vote({songAddress: trackAddress, type: 'UP_VOTE'}, $(this).hasClass('voted'));
      }
      else {
        self.vote({songAddress: trackAddress, type: 'DOWN_VOTE'}, $(this).hasClass('voted'));
      }
      return false;
    });

  };

  VotingController.prototype.doVote = function(options) {
    
    var self = this;

    $.post('/json-api/tracks/' + options.songAddress + '/votes', {
      data : JSON.stringify(options),
      contentType : 'application/json'
    }, function() {
      self.updateVotes(options);
    }).fail(function(error) {
      new Message(error.message, 'error', 0);
    });

  };

  VotingController.prototype.doRemoveVote = function(options) {
    
    var self = this;

    $.delete('/json-api/tracks/' + options.songAddress + '/votes', {
      data : JSON.stringify(options),
      contentType : 'application/json'
    }, function() {
      self.updateVotes(options);
    }).fail(function(error) {
      new Message(error.message, 'error', 0);
    });

  };

  VotingController.prototype.vote = function(options, isVotedAlready) {

    if(!isVotedAlready) {
      return this.doVote(options);
    }

    this.doRemoveVote(options);

  };

  VotingController.prototype.updateVotes = function(options) {

    $.get('/json-api/tracks/' + options.songAddress + '/votes', function(votes) {

      $('.vote-button.fa-thumbs-up').removeClass('voted').find('.vote-count').text('(' + votes.up + ')');
      $('.vote-button.fa-thumbs-down').removeClass('voted').find('.vote-count').text('(' + votes.down + ')');

      if(votes.viewerVote) {
        if(votes.viewerVote === 'UP_VOTE') {
          $('.vote-button.fa-thumbs-up').addClass('voted');
        }
        else {
          $('.vote-button.fa-thumbs-down').addClass('voted');
        }
      }
      
    });

  };

  musicoin.votingController = new VotingController();

  musicoin.votingController.initialize();


})(window.musicoin);