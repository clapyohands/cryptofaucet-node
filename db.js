/***************************
	
	db.js
	
	Returns an object with the application datastores, using the filenames specified in the configuration

****************************/
var Datastore = require('nedb');
module.exports = function(config) {
	return {
		processor:new Datastore({filename:config.processor,autoload:true})
		,users:new Datastore({filename:config.users,autoload:true})
		,wallet:new Datastore({filename:config.wallet,autoload:true})
	};
}
