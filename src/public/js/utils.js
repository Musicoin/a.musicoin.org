(function utils(window) {

  var musicoin = window.musicoin = window.musicoin || {};

  musicoin.utils = {
    objectToQueryParams: function objectToQueryParams(data) {

      data = data || {};
      var queryParams = [];
      for (var key in data) {
        if (data.hasOwnProperty(key)) {
          queryParams.push(key + '=' + data[key]);
        }
      }

      return queryParams.length ? '?' + queryParams.join('&') : '';

    },

    queryParamsToObject: function queryParamsToObject(qs) {

      var queryString = (qs || window.location.search).substring(1);

      return queryString.split('&').reduce(function f(previous, current) {
        var temp = current.split('=');
        previous[temp[0]] = temp[1];
        return previous;
      }, {});

    },

    getFrameDocument: function getFrameDocument(frameId) {
    	
      var frame = document.getElementById(frameId);
      if(!frame) {
      	return null;
      }
      var frameDocument = frame.contentDocument || frame.contentWindow.document;
      return frameDocument;

    },

    filterQueryParams: function filterQueryParams(qs, filterArray) {
      
      var queryObject = musicoin.utils.queryParamsToObject(qs);
      var arrayLen = filterArray.length;

      for(var i = 0; i < arrayLen; i++) {
        delete queryObject[filterArray[i]];
      }


      return musicoin.utils.objectToQueryParams(queryObject);

    }

  };

})(window);