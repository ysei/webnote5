/*

____________________________________________
\\\|///
 \\|//   server.js
  \|/
   |


*/

var express = require('express')
    , io = require('socket.io')
    , connect = require('connect')
    , crypto = require('crypto')
    , csrf = require('express-csrf')
    , Model = require('./lib/domain/models')
    , MemoryStore = express.session.MemoryStore
    , sessionStore = new MemoryStore()
    , port = process.argv[2] || process.env.C9_PORT || 80;


var app = module.exports = express.createServer();

// View Helpers
app.dynamicHelpers({
  csrf: csrf.token
});

app.dynamicHelpers({
  flash: function(req) {
    var flash;
    flash = req.flash();
    return flash;
  }
});

app.dynamicHelpers({
  current_user: function(req) {
    return req.session.user;
  }
});


// Configuration
app.configure(function() {
    app.set('views', __dirname + '/views');
    app.set('view engine', 'jade');
    app.use(express.cookieParser());
    app.use(express.bodyParser());
    app.use(express.session({store: sessionStore
        , secret: 'secret'
        , key: 'express.sid'}));
    app.use(csrf.check());
    app.use(express.methodOverride());
    app.use(require('stylus').middleware({
        src: __dirname + '/public'
    }));
    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
});

app.configure('development', function() {
    app.use(express.errorHandler({
        dumpExceptions: true,
        showStack: true
    }));
});

app.configure('production', function() {
    app.use(express.errorHandler());
});

// dynamic helpers
// action filter
// Routes
app.get('/', function(req, res) {
    // if(req.session.usr)
    var d = new Date(),
        days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
        d2 = function(d, ampm){
            return d < 10 ? ('0' + d) : '' + d; 
        }
        hr12 = function(hour){
            return hour > 12 ? '' + (hour - 12) : '' + hour; 
        },
        ampm = function(hour){
            return hour > 12 ? 'PM' : 'AM';
        };

    res.render('new', {
        date: days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(),
        time: hr12(d.getHours()) + ':' + d2(d.getMinutes()) + ampm(d.getHours()),
        title: '* untitled note '  
    });
});

app.get('/category/:name', function(req, res) {
    res.render('index')
});

// app.get('/new', function(req, res) {
    
// });

app.listen(port);

io = io.listen(app);

io.configure('production', function(){
    io.enable('browser client minification');
    io.enable('browser client etag');
    io.set('log level', 1);
    io.set('transports', ['websocket', 'flashsocket', 'htmlfile', 'xhr-polling', 'jsonp-polling' ]);
});

io.configure('development', function(){
  io.set('transports', ['websocket']);
});

var parseCookie = connect.utils.parseCookie,
    Session = connect.middleware.session.Session;

io.set('authorization', function (data, accept) {
    if (data.headers.cookie) {
        data.cookie = parseCookie(data.headers.cookie);
        data.sessionID = data.cookie['express.sid'];
        // save the session store to the data object 
        // (as required by the Session constructor)
        data.sessionStore = sessionStore;
        sessionStore.get(data.sessionID, function (err, session) {
            if (err) {
                accept(err.message, false);
            } else {
                // create a session object, passing data as request and our
                // just acquired session data
                data.session = new Session(data, session);
                accept(null, true);
            }
        });
    } else {
       return accept('No cookie transmitted.', false);
    }
});

io.sockets.on('connection', function(socket){
    // Notes ...
    var hs = socket.handshake;
    console.log('A socket with sessionID ' + hs.sessionID+ ' connected!');
    // setup an inteval that will keep our session fresh
    var intervalID = setInterval(function () {
        // reload the session (just in case something changed,
        // we don't want to override anything, but the age)
        // reloading will also ensure we keep an up2date copy
        // of the session with our connection.
        if(!hs.session) return;
        hs.session.reload( function () { 
            // "touch" it (resetting maxAge and lastAccess)
            // and save it back again.
            hs.session.touch().save();
        });
    }, 60 * 1000);

    socket.on('disconnect', function () {
        console.log('A socket with sessionID ' + hs.sessionID + ' disconnected!');
        // clear the socket interval to stop refreshing the session
        clearInterval(intervalID);
    });

    socket.on('addnote', function(message){
        var note = Model('Note').create(message);
        note.save(function(err, savedNote){
            socket.emit('notesaved', savedNote);
        });
    });

    // session
    socket.on('session/new', function(data, fn){
        var currentUser = Model('User').create(data);

        currentUser.authenticate(function(err, user){
            
            if (user) { // valid user, set session user
                hs.session.user = user;
                hs.session.save();
            }
            
            fn.apply(null, arguments);
        }); 
    });

    socket.on('session/destroy', function(message, fn){
        hs.session.user = null;
        hs.session.save();
        
        // UHhhh... need to destroy the session, or is that even required??
        // need to get a new session if this one is destroyed.
        
        // hs.session.destroy(function() {
        //    clearInterval(intervalID);
        // });

        fn.apply(null);
    });

    // User create or update
    socket.on('user/save', function(data, fn){

        var newUser = Model('User').create(data);
        
        newUser.save(function(err, user){
            if (user) { // valid user, set session user
                hs.session.user = user;
                hs.session.save();
            }
            fn.apply(null, arguments);
        });
    });


    socket.on('user/exists', function(data, fn){
        Model('User').where('username', data.username, function(err, users){
            // if a user with this username was found send true
            users[0] ? fn(true) : fn(false);
        });
    });
});

console.log("Express server listening at %s:%d", app.address().address, app.address().port);