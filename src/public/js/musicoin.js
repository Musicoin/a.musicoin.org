//Okay. This file did not added from the first time. So, "window.musicoin" was constructed everywhere needed & reused if already exist.
//That is the reason, window.musicoin is passed into the function, just in case, some other file already created it, we don't want to overwrite it.

(function (musicoin) {
	window.musicoin = musicoin || {};
})(window.musicoin);

