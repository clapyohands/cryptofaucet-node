$(function(){
	$('#faucet').submit(function(event){
		var a = $('#txtAddress').val(),
			c = $('#faucet input[type=checkbox]:checked'),
			l = a.length,
			err = '';
		if (l < 20 || l > 40) {
			err='Please enter your address';
		} else if (!c || !c.length) {
			err='Please click the checkbox';
		}
		if (err != '') {
			alert(err);
			event.preventDefault();
			return false;
		}
	})
})