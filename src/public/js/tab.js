(function(namespace) {

  namespace.Tab = Tab;

  function Tab(options) {

    if (!options.root) {
      throw new Error('Tab: Invalid root element');
    }

    var rootEl = document.getElementById(options.root);

    if (!rootEl) {
      throw new Error('Tab: root element not found');
    }

    this.$rootEl = $(rootEl);

    this.initialize();

  }

  Tab.prototype.initialize = function() {
    
    var self = this;
    this.$rootEl.find('.tab-links').on('click', 'li', function tabClickHandler(event) {
      event.preventDefault();
      var tab = $(this).closest('li');
      self.switchTab(tab); 
      return false;
    });


    this.$currentTab = this.$rootEl.find('.tab-links > li').first();
    this.$currentContent = this.$rootEl.find('.tab-contents > *').first();
    this.switchTab(this.$currentTab);

  };

  Tab.prototype.switchTab = function($tab) {
    
    this.$currentTab.removeClass('active');
    this.$currentContent.removeClass('active');
    $tab.addClass('active');
    var tabIndex = $tab.index();
    var $content = this.$rootEl.find('.tab-contents > *').filter(function(index) {
      return tabIndex === index;
    }).addClass('active');

    this.$currentTab = $tab;
    this.$currentContent = $content;

  };



})(window.musicoin);