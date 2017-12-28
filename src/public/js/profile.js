$(function onDocumentReady() {
	
	$('#send-email-verify-link').on('click', function onSendVerifyEmailLinkClick(e) {
		
		e.preventDefault();
		$.post('/json-api/user/send-email-address-verification-email', {}, function onResponse(data) {
			
			if(data.alreadyVerified) {
				return window.location.reload();
			}
			else if(data.success) {
				$('#send-email-verify-link').hide();
				$('#email-verify-link-sent').show();
			}

		});
		return false;

	});

});