/**************************************

	Bitcoin / Litecoin / Altcoin Faucet
	April 2014, clapyohands <clapyohands1@gmail.com>
	https://github.com/clapyohands/cryptofaucet-node

	See config.js for Configuration Variables
	Edit views/inc/nav.jade to add navigation elements
	Edit views/inc/rightcol.jade and views/inc/leftcol.jade to manage advertisements and other text in the sidebars

	Requirements:
	express 3.x (not tested with express 4)
	jade
	node-bitcoin
	iz
	nedb
	querystring

***************************************/

//global
config = require('./config')
,iz = require('iz')
,bitcoin = require('bitcoin')
,client = new bitcoin.Client(config.rpc)
,db = require('./db')(config.database)
,processor = require('./processor');

//local
var express = require('express')
	,routes = require('./routes')
 	,http = require('http')
	,path = require('path')
	,app = express();


//Express Configuration
app.set('port', process.env.PORT || 80);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.logger('dev'));
//app.use(express.methodOverride());
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({ secret: config.session_secret }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.csrf());
app.use(function(req, res, next){
	//res.cookie('TOKEN', req.csrfToken());
	res.locals.csrftoken = req.csrfToken();
	next();
});
app.disable('x-powered-by');
app.use(express.errorHandler());


// Express Routes
app.get('/', routes.index);
app.get('/captcha', routes.captcha);
app.get('/submit', function(req,res){res.redirect(302,'/')});
app.post('/submit', routes.submit);
app.get(config.dashboard.path, routes.dashboard);
app.post(config.dashboard.path, routes.dashboard);

// Run Express
http.createServer(app).listen(app.get('port'), function(){
	console.log("Express server listening on port " + app.get('port'));
});

// Run Faucet Processor
processor.start();

