(function(namespace) {

	namespace.Dialog = Dialog;

  function Dialog(options) {
    if (options.width) {
      this.width = +options.width;
    }
    if (options.height) {
      this.height = +options.height;
    }
    if (!options.root) {
      throw new Error('Dialog: Invalid root element');
    }

    var rootEl = document.getElementById(options.root);

    if (!rootEl) {
      throw new Error('Dialog: root element not found');
    }

    this.$rootEl = $(rootEl);
    this.$rootEl.find('.dialog-wrapper').css({ width: this.width + 'px', height: this.height + 'px' });

    if(options.display) {
    	this.open();
    }

    this.hideOnOuterClick();

  }

  Dialog.prototype.open = function() {
  	this.$rootEl.show();
  };

  Dialog.prototype.close = function() {
  	this.$rootEl.hide();
  };

  Dialog.prototype.hideOnOuterClick = function() {
  	var self = this;
  	console.log('test');
  	this.$rootEl.on('click', function clickHandler(event) {
  		if(event.target.id === self.$rootEl[0].id) {
  			self.close();
  		}
  	});
  };

})(window.musicoin);