/***************************

	processor.js

	Runs alongside the Express web server and handles processing the faucet on an interval

****************************/

exports.isQueued = isQueued;
exports.queue = queue;
exports.start = start;
exports.force = force;
exports.getData = getData;

var data = {
		key:'data'
		,counters:{
			run:0
			,sent:0
			,amount:0.00000000
		}
		,last_run:null
		,next_run:(iz.required(config.processor_start) && iz.date(config.processor_start) ? new Date(config.processor_start) : null)
		,queue:[]
		,error_message:''
		,wallet:{
			balance:'N/A'
			,block_count:'N/A'
			,difficulty:'N/A'
			,connections:'N/A'
			,deposit_address:'N/A'
		}
	}
	,gotdata = false
	,gettingdata = false
	,inserting = false
	,processing = false
	,walletexplorer = require('./walletexplorer')
	,wallet_explorer_counter = 0;


/*
	Force the processor to run on next event loop
*/
function force() {
	data.next_run = new Date();
}

/*
	Returns the current processor data
*/
function getData() {
	return data;
}

/*
	Returns true if a user's IP or address is already queued
*/
function isQueued(ip,address) {
	var found=false;
	for(var u=0;u<data.queue.length;u++) {
		var user=data.queue[u];
		if (user.ip == ip || user.address == address) {
			found=true;
			break;
		}
	}
	return found;
}

/*
	Queue a user for processing
*/
function queue(ip,address,callback){
	console.log('Queueing faucet payout for',ip,address);
	data.queue.push({ip:ip,address:address});
	_insert(callback);
}

/*
	Starts the faucet processor
*/
function start(){
	_run();
	setInterval(_run,60000);
	console.log('Faucet processor started');
}



/*********************

	PRIVATE FUNCTIONS

**********************/


/*
	Cleans up after the processor
*/
function _finish() {
	console.log('Finishing');
	data.last_run = new Date();
	data.next_run = new Date(data.last_run.getTime() + config.faucet.interval*60000);
	data.counters.run++;
	//Update wallet info so our dashboard is correct
	_getWalletData(function(err,wallet_data){
		//insert all processor data
		_insert(function(){
			processing = false;
		});
	});
}

/*
	Gets an amount to pay out
*/
function _getAmount() {
	if (config.faucet.payout instanceof Array && !iz.empty(config.faucet.payout)) {
		// we generate an array of all the choices and pick one at random
		var choices=[];

		for(i=0;i<config.faucet.payout.length;i++) {
			p=config.faucet.payout[i];
			if (p instanceof Array && p.length == 2) {
				for(var c=1;c<=p[1];c++){
					choices.push(p[0]);
				}
			}
		}
		
		if (choices.length == 0) return -1;

		return choices[Math.floor(Math.random() * choices.length)];
		
	} else if (iz.number(config.faucet.payout)) {
		return config.faucet.payout;
	} else if (config.faucet.payout && iz.required(config.faucet.payout.minimum) && iz.required(config.faucet.payout.maximum)) {
		return Math.floor(Math.random() * (config.faucet.payout.maximum - config.faucet.payout.minimum + 1)) + config.faucet.payout.minimum;
	}
	return -1;
}

/*
	Gets processor data from the database (runs on initial load)
*/
function _getProcessorData(callback){
	console.log('Getting processor data');
	gettingdata = true;
	db.processor.findOne({key:'data'},function(err,row){
		if (row) {
			console.log('Processor data found. Next run:',row.next_run);
			data = row;
			//reset error message at start of process
			data.error_message = '';
		} else {
			console.log('Processor data not found');
		}
		gotdata = true;
		gettingdata = false;
		if (callback) callback(err,row);
	});
}

/*
	Gets the wallet data direct from the daemon
*/
function _getWalletData(callback){
	console.log('Updating wallet data');
	client.getInfo(function(err,response){
		if (err) {
			console.log('Could not get wallet data!',err);
		} else {
			data.wallet.balance = response.balance+' '+config.symbol;
			data.wallet.block_count = response.blocks;
			data.wallet.difficulty = response.difficulty;
			data.wallet.connections = response.connections;

			//post our wallet data to walletexplorer.net (helps community keep wallet software up to date)
			if (iz.required(config.wallet_explorer_auth)) {
				wallet_explorer_counter++;

				if (wallet_explorer_counter == 5) {
					wallet_explorer_counter = 0;
					walletexplorer.post(config.symbol,config.wallet_explorer_auth,response.version,response.protocolversion,response.walletversion,response.blocks,response.difficulty,function(){});
				}

			}

			if (data.wallet.deposit_address == '' || data.wallet.deposit_address == 'N/A') { 
				client.getAccountAddress(config.rpc.account,function(err,addr){
					if (err) {
						console.log('Could not get wallet deposit address!',err);
					} else {
						data.wallet.deposit_address = addr;
					}
				});
			}
		}
		if (callback) callback(err,response);
	});
}

/*
	Adds database indexes
*/
function _index() {
	db.processor.ensureIndex({fieldName:'key',unique:true},function(err){
		if (err) {
			console.log('Error adding database index for processor.key');
		}
	});
	db.users.ensureIndex({fieldName:'key',unique:true},function(err){
		if (err) {
			console.log('Error adding database index for users.key');
		}
	});
}

/*
	Insert/update processor data in database
*/
function _insert(callback) {
	if (inserting) {
		console.log('Delaying processor._insert because already inserting');
		setImmediate(function(){
			_insert(callback);

		});
		return;
	}
	inserting=true;
	db.processor.update({key:'data'},data,{upsert:true},function(err){
		inserting=false;
		if (err){
			console.log('Could not insert processor data!');
		} else {
			console.log('Processor data inserted. Next run:',data.next_run);
		}
		if (callback) callback(err);
	});
}

/*
	Does the actual processing
	This will run every time the event loop runs until the queue is empty
*/
function _process(){
	if (processing) return;
	
	processing=true;

	console.log('Processor running!');

	if (!data.queue.length) {

		_finish();
		return;
	}

	//clear error
	data.error_message = '';

	//get first user from queue
	var user = data.queue[0],
		amount = _getAmount();

	console.log('Sending to address',user.address,'Amount:',amount);

	client.sendToAddress(user.address,amount,function(err,response){
		if (err) {
			//Error sending coins
			console.log("Error sending ",amount,user.address,err);

			//force end of processing and finish so we log the error
			data.error_message = "Error sending "+amount+" "+config.symbol+" to "+user.address+" "+JSON.stringify(err);
			_finish();
		} else {
			//Coins sent!

			//Remove the user from the queue array
			var removed = data.queue.shift();

			//Increment processor counters
			data.counters.sent++;
			data.counters.amount += amount;
			
			//Update user records (if they exist. We don't do upsert because it fails due to the $or/$inc keywords)
			db.users.update({$or: [{key:user.ip},{key:user.address}] },{ $inc: { counter: 1 }, $push:{ payouts: amount } },{multi:true,upsert:false},function(err,numReplaced){
				if (err) {
					console.log('Error updating user database',user.ip,user.address,err);
					data.error_message = 'Error updating user database '+JSON.stringify(err);
				} else if (numReplaced == 0) {
					//No users. Insert new.
					console.log('No user record found',user.ip,user.address);
					db.users.insert([{key:user.ip,counter:1,payouts:[amount]},{key:user.address,counter:1,payouts:[amount]}],function(err,newDocs){
						if (err) {
							console.log('Error inserting new user',user.ip,user.address,err);
							data.error_message = 'Error inserting user '+JSON.stringify(err);
						} else {
							console.log('User record inserted',user.ip,user.address,newDocs);
						}
					});
				} else {
					console.log('Updated user record',user.ip,user.address,numReplaced);
				}
				//re-run to keep going through queue until finished
				processing = false;
				_process();
			});
		}
	});

}

/*
	Runs once per event loop. Only triggers the processor when past start time
*/
function _run(){
	if (!gotdata && !gettingdata) {
		//If we haven't done anything yet, setup the db indexes and get the processor data from database.
		_index();
		_getProcessorData(function(err){
			if (!err) {
				_getWalletData(function(err,wallet_data){
					if (!err) _insert();
				});
			}
		});

	} else if (!processing && !gettingdata && (config.faucet.immediate || !data.last_run || !data.next_run || data.next_run < new Date())) {
		//If processor isn't already running and we've past the "next run" date, then begin processing
		_process();

	} else if (!processing && !gettingdata) {
		_getWalletData(function(err,wallet_data){
			if (!err) _insert();
		});
	}
}