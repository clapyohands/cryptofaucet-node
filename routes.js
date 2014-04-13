/***************************

	routes.js

	One public function for each available URL

	/ = index(req,res)				-- Home page
	/submit = submit(req,res)		-- POST handler for faucet submission
	/captcha = captcha(req,res)		-- Javascript based captcha
	/dashboard = dashboard(req,res)	-- Control Panel (single page) - the path depends on the configuration

****************************/

/*
	Custom Javascript Generated Captcha
	By outputting <script src="/captcha"></script> we will get a captcha code that is unique to this user session and can only be used once
	This is less obtrusive and less able to be spammed by bots than ReCaptcha
*/
exports.captcha = function(req,res) {
	var cap = _randomString(20);
	res.cookie('captcha',cap);
	res.set('Content-Type','application/javascript');
	_render(req,res,'captcha',{captcha:cap});
};

/*
	CONTROL PANEL
*/
exports.dashboard = function(req,res){
	
	var pg = 'login'
		,arg = {
			msg:'Please enter the admin password'
			,wallet:{
				balance:'N/A'
				,block_count:'N/A'
				,difficulty:'N/A'
				,connections:'N/A'
			}
			,queue:{
				users:'N/A'
				,next_run:'N/A'
			}
			,historical:{
				run_count:'N/A'
				,send_count:'N/A'
				,amount:'N/A'
			}
			,processor_success:''
			,processor_error:''
			,address_data:null
		};

	if (iz.required(req.body.password)) {
		console.log('Logging in',req.body.password)
		if (req.body.password == config.dashboard.password) {
			console.log('LOGGED IN!');
			req.session.dashboard_allowed = true;
			//redirect so they can refresh w/o reposting
			res.redirect(302,config.dashboard.path);
		} else {
			arg.msg = 'Invalid password';
			arg.login_failed=true;
		}
	}

	if (_isAdmin(req)) {
		pg = 'dashboard';
	}

	if (pg == 'login') {
		_render(req,res,pg,arg);
	} else {

		//delay rendering until we have data.
		var data = processor.getData();
		

		//if the processor is failing, we will display the error message
		arg.processor_error = data.error_message;

		//current queue info: # of users, ETA until run
		arg.queue.users = data.queue.length;
		arg.queue.next_run = _formatNextRun(data.next_run);

		//historical info: total times, total recipients, and total amount sent
		arg.historical.run_count = data.counters.run;
		arg.historical.send_count = data.counters.sent;
		arg.historical.amount = data.counters.amount+' '+config.symbol;

		//wallet daemon info
		arg.wallet = {
			balance: (iz.number(data.wallet.balance) ? data.wallet.balance+' '+config.symbol : data.wallet.balance)
			,block_count: data.wallet.block_count
			,difficulty: data.wallet.difficulty
			,connections: data.wallet.connections
			,deposit_address: data.wallet.deposit_address
		};

		if (iz.required(req.body.force_run)) {
			console.log("FORCING PROCESSOR TO RUN!");
			processor.force();
			arg.processor_success = 'Processor will run shortly. <a href="'+config.dashboard.path+'">Update dashboard</a>';
		}

		//user requesting an address report
		if (iz.required(req.body.address)) {
			db.users.findOne({key:req.body.address},function(err,user){
				if (err) {
					console.log("Error fetching address for dashboard report",req.body.address,err);
					arg.processor_error += 'Address not found';
				} else if (!user || iz.empty(user)) {
					arg.processor_error += 'Address not found';
				} else {
					arg.address_data = {
						address: req.body.address
						,counter: user.counter
						,payouts: (iz.required(user.payouts) ? user.payouts : [])
					}
				}

				_render(req,res,pg,arg);
			});

		} else {
			// just show the dashboard
			_render(req,res,pg,arg);

		}

	}
};


/*
	HOMEPAGE
*/
exports.index = function(req, res){

	_render(req,res,'home');
	
};

/*
	FORM SUBMISSION
	If given coin address is valid, add to the queue and track the submission

*/
exports.submit = function(req, res){
	
	var address_regex = /^[a-zA-Z0-9]{20,40}$/ //This regex is very basic. We just see if input is alphanumeric between 20 and 40 chars before passing through to RPC for further inspection
		,address_ok = (iz.required(req.body.address) && iz.string(req.body.address) && address_regex.test(req.body.address))
		,captcha_ok = (iz.required(req.cookies.captcha) && iz.required(req.body[req.cookies.captcha]) && iz.string(req.body[req.cookies.captcha]) && req.body[req.cookies.captcha] === "1");

	if (processor.isQueued(req.ip,req.body.address)) {

		//This IP or coin address is already entered in the current faucet cycle
		console.log('User already entered!',req.ip,req.body.address);
		_failure(req,res,'You are already entered');

	} else if (address_ok && captcha_ok) {

		//Seems like we may have an address and the captcha is OK. Let's check the user's history

		db.users.find({$or: [{key:req.ip},{key:req.body.address}] },function(err,users){
			if (err) {
				//Error!
				console.log('Database error',err);
				_failure(req,res,'Database error');
				return;
			} else if (users && _limitExceeded(users)) {
				//User exists by IP or coin address and one or the other has exceeded the max # of entries
				console.log('User exceeded limit',req.ip,req.body.address);
				_failure(req,res,'You have exceeded your limit');
				return;
			}
			// Now see if the address is valid
			client.validateAddress(req.body.address,function(err,response){
					console.log('validateAddress',req.body.address,response);
					if (err) {
						//Error
						console.log(err);
						_failure(req,res,'Unable to validate address');
					} else if (!iz.required(response.isvalid) || response.isvalid === false) {
						//Invalid
						_failure(req,res,'Please enter a valid address');
					} else {
						//Address is valid. Queue this entry.
						processor.queue(req.ip,req.body.address,function(err,result){
							if (err) {
								//Error
								console.log('Database error',err);
								_failure(req,res,'Failed to create record');
							} else {
								// Yay! User is now entered in the queue.
								_success(req,res,'You are now entered!');
							}
						});
					}
				});

			
		});
		
	} else {

		_failure(req,res,'Enter your address and click the checkbox');

	}
};//end submit



/***************************

	PRIVATE / HELPER FUNCTIONS

****************************/

/*
	copy of jQuery's extend()
*/
function _extend() {
	var options, 
		name, 
		src, 
		copy, 
		copyIsArray, 
		clone, 
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false,
		toString = Object.prototype.toString,
		hasOwn = Object.prototype.hasOwnProperty,
		push = Array.prototype.push,
		slice = Array.prototype.slice,
		trim = String.prototype.trim,
		indexOf = Array.prototype.indexOf,
		class2type = {
			"[object Boolean]": "boolean",
			"[object Number]": "number",
			"[object String]": "string",
			"[object Function]": "function",
			"[object Array]": "array",
			"[object Date]": "date",
			"[object RegExp]": "regexp",
			"[object Object]": "object"
		},
		jQuery = {
			isFunction: function (obj) {
				return jQuery.type(obj) === "function"
			},
			isArray: Array.isArray ||
				function (obj) {
					return jQuery.type(obj) === "array"
				},
			isWindow: function (obj) {
				return obj != null && obj == obj.window
			},
			isNumeric: function (obj) {
				return !isNaN(parseFloat(obj)) && isFinite(obj)
			},
			type: function (obj) {
				return obj == null ? String(obj) : class2type[toString.call(obj)] || "object"
			},
			isPlainObject: function (obj) {
				if (!obj || jQuery.type(obj) !== "object" || obj.nodeType) {
					return false
				}
				try {
					if (obj.constructor && !hasOwn.call(obj, "constructor") && !hasOwn.call(obj.constructor.prototype, "isPrototypeOf")) {
						return false
					}
				} catch (e) {
					return false
				}
				var key;
				for (key in obj) {}
				return key === undefined || hasOwn.call(obj, key)
			}
		};//end jquery

	if (typeof target === "boolean") {
		deep = target;
		target = arguments[1] || {};
		i = 2;
	}
	if (typeof target !== "object" && !jQuery.isFunction(target)) {
		target = {}
	}
	if (length === i) {
		target = this;
		--i;
	}
	for (i; i < length; i++) {
		if ((options = arguments[i]) != null) {
			for (name in options) {
				src = target[name];
				copy = options[name];
				if (target === copy) {
					continue
				}
				if (deep && copy && (jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)))) {
					if (copyIsArray) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : []
					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}
						// WARNING: RECURSION
						target[name] = _extend(deep, clone, copy);
					} else if (copy !== undefined) {
						target[name] = copy;
					}
				}
			}
	}
	return target;
}//end _extend


/*
	Renders a failure page
*/
function _failure(req, res, msg) {
	_render(req,res,'home',{failed:true,fail_msg:msg});
}

/*
	Formats next run date for display
*/
function _formatNextRun(dt) {
	var d = dt.getDate()
		month=["January","February","March","April","May","June","July","August","September","October","November","December"],
		m = month[dt.getMonth()];

	return m+' '+d+', '+dt.toLocaleTimeString();
}


/*
	Returns true if user is admin
*/
function _isAdmin(req) {
	return (iz.required(req.session.dashboard_allowed) && req.session.dashboard_allowed === true);
}

/*
	Returns true if a user (or any one of matching set of users) has exceeded the limit
*/
function _limitExceeded(users) {
	if (!(users instanceof Array)) {
		users = [users];
	}
	for (var u=0;u<users.length;u++){
		var user=users[u];
		if (user.counter >= config.faucet.user_limit) {
			return true;
		}
	}
	return false;
}


/*
	Changes interval from a number to an easy to read string
*/
function _normalizeInterval(interval) {
	if (interval < 60) {
		return interval+' minutes';
	} else {
		var hr = Math.round(interval/60);
		return hr+' hour'+(hr != 1 ? 's' : '');
	}
}


/*
	Includes odds data when payouts are given as an array
*/
function _normalizePayout(payout) {
	if (payout instanceof Array && !iz.empty(payout)) {
		// we calculate the odds and reset the array to [{payout,odds}]
		var total=0,result=[],p=0,i='';
		for(i=0;i<payout.length;i++) {
			p=payout[i];
			if (p instanceof Array && p.length == 2) {
				total += p[1];
			}
		}
		for(i=0;i<payout.length;i++) {
			p=payout[i];
			if (p instanceof Array && p.length == 2) {
				var odds = (total > 0 ? (p[1] / total)*100 : 0);
				result.push({payout:p[0],odds:iz.decimal(odds) ? odds.toFixed(2) : odds});
			}
		}
		return result;
	} else if (iz.number(payout)) {
		return payout;
	} else if (payout && iz.required(payout.minimum) && iz.required(payout.maximum)) {
		return payout;
	}
	return 0;
}


/*
	Generates a random string
*/
function _randomString(length) {
	var chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghiklmnopqrstuvwxyz',
		string = '',
		i = 0,
		randomNumber=0;

	for (i = 0; i < length; i++) {
		randomNumber = Math.floor(Math.random() * chars.length);
		string += chars.substring(randomNumber, randomNumber + 1);
	}

	return string;
}


/*
	Render page
*/
function _render(req,res,page,additional) {
	res.render(page, _vars(req,res,page,additional));
}


/*
	Render a success page
*/
function _success(req, res, msg) {
	_render(req,res,'home',{success:true,success_msg:msg});
}


/*
	Get variables for render

	additional arguments can be passed in at time of request, e.g. whether the form post was successful or not

	Start with global parameters for all pages
	Add in any existing global ones for this page type
	Include the default parameters for current request (page = this page, CSRFTOKEN)
	Sprinkle in the additional parameters (if any)
*/
function _vars(req,res,page,additional) {
	var processor_data = processor.getData()
		,req_config = {
			page:page
			,csrftoken:res.locals.csrftoken
			,isAdmin:_isAdmin(req)
			,next_run:_formatNextRun(processor_data.next_run)
			,wallet_balance:processor_data.wallet.balance
		}
		,conf = {};

	/*global*/
	conf = _extend(true,conf,config);

	/*global for page*/
	conf = _extend(true,conf,iz.required(config.pages[page]) ? config.pages[page] : {});

	/* request vars*/
	conf = _extend(true,conf,req_config);

	/*additional post params*/
	conf = _extend(true,conf,additional);

	/*fix payout so if it's an array we also know the percentages for payout chances*/
	conf.faucet.payout = _normalizePayout(conf.faucet.payout);

	/*make interval a convenient string instead of a number*/
	conf.faucet.interval = _normalizeInterval(conf.faucet.interval);

	return conf;
}
