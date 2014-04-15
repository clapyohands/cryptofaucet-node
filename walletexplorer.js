/***************************
	
	walletexplorer.js
	
	WalletExplorer.net API - WalletExplorer helps the community keep their wallets up to date by tracking what versions are in use by public services

****************************/
var querystring = require('querystring')
	,https = require('https');

exports.post = post;

function post(coin,auth,version,protocol_version,wallet_version,blocks,diff,callback) {
	var query = querystring.stringify({
			coin:coin
			,auth:auth
			,version:version
			,protocol_version:protocol_version
			,wallet_version:wallet_version
			,blocks:blocks
			,diff:diff
		})
		,opts = {
			host:'walletexplorer.net'
			,method:'POST'
			,port:443
			,path:'/api/submit'
			,headers:{
				'Content-Type': 'application/x-www-form-urlencoded',
          		'Content-Length': query.length
          	}
		}
		,stream = ''
		,req = https.request(opts,
			function(res){
				res.setEncoding('utf8');
				res.on('data', function (chunk) {
					stream += chunk;
				});
				res.on('end',function(){
					console.log('<WalletExplorer API> RESPONSE',stream);
					try {
						var data = JSON.parse(stream);	
					} catch(err) {
						console.log('<WalletExplorer API> Error: WalletExplorer API Response is invalid JSON!',err,stream);
						//return the error
						return callback(err,null);
					}
					// return the result of the JSON parsing
					return callback(null,data);
				});
			}
		).on('error',function(err){
			console.log('<WalletExplorer API> Error posting API data',err);
			return callback(err,null);
		});

	console.log('<WalletExplorer API> POST',query);
	req.write(query);
	req.end();
}