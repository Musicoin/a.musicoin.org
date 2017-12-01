(function(musicoin) {
	
	var shareDialog = new musicoin.Dialog({width: 300, root: 'share-track-options-dialog'});
	var shareTab = new musicoin.Tab({root: 'share-options-tab'});

	musicoin.shareDialog = shareDialog;

	$('#open-share-dialog').on('click', function handleOpenShareDialogClick(event) {
		event.preventDefault();
		shareDialog.open();
		return false;
	});

})(window.musicoin);