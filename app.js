// vim:et:sw=2
/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes/router')
  , http = require('http')
  , redis = require('redis')
  , tribune = require('./tribune')
  , io = require('socket.io')
  , passport = require('passport')
  , LocalStrategy = require('passport-local').Strategy
  , GoogleStrategy = require('passport-google').Strategy
  , path = require('path');

// This is for AppFog. If not there, we'll just use
// a local redis instance.
if (process.env.VCAP_SERVICES) {
  var conf = JSON.parse(process.env.VCAP_SERVICES);
  for (first in conf) break;
  conf = conf[first];
  global.db = redis.createClient(conf.port, conf.host);
  global.db.auth(conf.password);
} else {
  var redis_port = process.env.REDIS_PORT || 6379;
  var redis_host = process.env.REDIS_HOST || "localhost";
  global.db = redis.createClient(redis_port, redis_host);
}

var app = express();
var server = http.createServer(app);

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.favicon());
app.use(express.logger('dev'));
app.use(express.cookieParser());
app.use(express.bodyParser());
//app.use(express.methodOverride());
app.use(express.session({ secret: 'plop' }));
app.use(passport.initialize());
app.use(passport.session());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}


passport.use(new LocalStrategy({
    usernameField: 'username',
    passwordField: 'password'
  },
  function(username, password, done) {
    var profile = {
      displayName: username,
      pass: password
    };

    global.db.hmset('user:local:' + username, profile, function() {
      profile.id = 'user:local:' + username;
      done(null, profile);
    });
  }
));

passport.use(new GoogleStrategy({
    returnURL: 'http://aenea.seos.fr:3000/auth/google/return',
    realm: 'http://aenea.seos.fr:3000'
  },
  function(identifier, profile, done) {
    global.db.hmset('user:google:' + identifier, profile, function() {
      profile.id = 'user:google:' + identifier;
      done(null, profile);
    });
  }
));

passport.serializeUser(function(user, done) {
  console.log("Serialize " + user.id);
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  console.log("Deserialize " + id);
  global.db.hgetall(id, function(err, data) {
    console.log(data);
    console.log(err);
    done(null, data);
  });
});


app.get('/', routes.home);

app.all('/tribune/:id', tribune.load);
app.all('/tribune/:id/*', tribune.load);

app.get('/tribune/:id', routes.tribune);
app.post('/tribune/:id/post', tribune.form_post);
app.get('/tribune/:id/xml', tribune.xml);
app.post('/tribune/:id/login', passport.authenticate('local'), function (req, res) { res.redirect('/tribune/' + req.params.id); });
app.get('/tribune/:id/logout', function (req, res) { req.logout(); res.redirect('/tribune/' + req.params.id); });

app.get('/auth/google', passport.authenticate('google'));
app.get('/auth/google/return', passport.authenticate('google', { successRedirect: '/', failureRedirect: '/login' }));

io = io.listen(server);

tribune.onNewPost = function(tribune, post) {
  io.sockets.in(post.tribune).emit('new-post', {tribune: tribune, post: post});
};

io.sockets.on('connection', function(socket) {
  socket.on('post', function(post) {
    console.log('Posting');
    tribune.direct_post(post);
  });

  socket.on('join', function(tribune) {
    console.log('Joining tribune ' + tribune);
    socket.join(tribune);
  });
});


server.listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
