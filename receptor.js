/*
	receptor.js
	author: masatoshi teruya
	email: mah0x211@gmail.com
	copyright (C) 2011, masatoshi teruya. all rights reserved.
*/
var pkg = {
        EventEmitter: require('events').EventEmitter,
        fs: require('fs'),
        path: require('path'),
        http: require('http'),
        url: require('url'),
        mime: require('mime')
    },
    OPAQUE = [],
    // default conf
    CONF = {
        ServerRoot: undefined,
        Listen: '127.0.0.1',
        Port: 1977,
        User: process.getuid(),
        Group: process.getgid(),
        PidFile: 'logs/receptor.pid',
        LimitRequestBody: 0,
        LimitRequestLine: 8190,
        Timeout: 120,
        DefaultType: 'text/plain',
        DocumentRoot: 'htdocs',
        KeepAlive: false,
        DirectorySlash: true,
        DirectoryIndex: 'index.htm',
        Cached: true
    },
    STATUS = {
        CONTINUE: 100,
        SWITCHING_PROTOCOLS: 101,
        PROCESSING: 102,
        OK: 200,
        CREATED: 201,
        ACCEPTED: 202,
        NON_AUTHORITATIVE: 203,
        NO_CONTENT: 204,
        RESET_CONTENT: 205,
        PARTIAL_CONTENT: 206,
        MULTI_STATUS: 207,
        MULTIPLE_CHOICES: 300,
        MOVED_PERMANENTLY: 301,
        MOVED_TEMPORARILY: 302,
        SEE_OTHER: 303,
        NOT_MODIFIED: 304,
        USE_PROXY: 305,
        TEMPORARY_REDIRECT: 307,
        BAD_REQUEST: 400,
        UNAUTHORIZED: 401,
        PAYMENT_REQUIRED: 402,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        METHOD_NOT_ALLOWED: 405,
        NOT_ACCEPTABLE: 406,
        PROXY_AUTHENTICATION_REQUIRED: 407,
        REQUEST_TIME_OUT: 408,
        CONFLICT: 409,
        GONE: 410,
        LENGTH_REQUIRED: 411,
        PRECONDITION_FAILED: 412,
        REQUEST_ENTITY_TOO_LARGE: 413,
        REQUEST_URI_TOO_LARGE: 414,
        UNSUPPORTED_MEDIA_TYPE: 415,
        RANGE_NOT_SATISFIABLE: 416,
        EXPECTATION_FAILED: 417,
        UNPROCESSABLE_ENTITY: 422,
        LOCKED: 423,
        FAILED_DEPENDENCY: 424,
        UPGRADE_REQUIRED: 426,
        INTERNAL_SERVER_ERROR: 500,
        NOT_IMPLEMENTED: 501,
        BAD_GATEWAY: 502,
        SERVICE_UNAVAILABLE: 503,
        GATEWAY_TIME_OUT: 504,
        VERSION_NOT_SUPPORTED: 505,
        VARIANT_ALSO_VARIES: 506,
        INSUFFICIENT_STORAGE: 507,
        NOT_EXTENDED: 510
    };


function Receptor( app, confpath, rootpath )
{
    // private id
    var self = this,
        id = OPAQUE.length,
        // event emitter
        evt = new pkg.EventEmitter(),
        // custom function for http.ServerResponse
        addHeader = function( name, val )
        {
            var hval = this.getHeader( name );
            
            if( hval )
            {
                if( !( hval instanceof Array ) ){
                    hval = [hval];
                }
                hval.push( val );
                this.setHeader.call( this, name, hval );
            }
            else {
                this.setHeader( name, val );
            }
        },
        onRequest = function( req, res )
        {
            var odata = OPAQUE[id],
                r = {
                    // INTERNAL
                    server: self,
                    // http.ServerRequest
                    req: req,
                    // http.ServerResponse
                    res: res,
                    // id of setTimeout
                    timeout: undefined,
                    // INCOMING DATA
                    // set at translateName
                    uri: {},
                    // set at RequestData
                    data: undefined,
                    // OUTGOING DATA
                    // HTTP status
                    status: 0,
                    // response mime-type
                    mime: undefined,
                    // response page
                    page: '',
                };
            
            // append custom function
            res.addHeader = addHeader;
            
            // server will stop
            if( odata.graceful ){
                self.cbGraceful( r );
            }
            else
            {
                // increment number of connection
                odata.nconn++;
                // set keep-alive
                res.shouldKeepAlive = odata.conf.KeepAlive;
                // remove default timeout
                req.connection.removeAllListeners('timeout');
                // set Timeout event
                if( odata.conf.Timeout ){
                    r.timeout = setTimeout( function(){
                        self.outgoing( r, STATUS.REQUEST_TIME_OUT );
                    }, odata.conf.Timeout );
                }
                // check LimitRequestLine
                if( req.url.length > odata.conf.LimitRequestLine ){
                    self.outgoing( r, STATUS.REQUEST_URI_TOO_LARGE );
                }
                else {
                    // translate name
                    r.uri = self.translateName( req.url );
                    // routing
                    app.incoming( r );
                }
            }
        };
	
    // check application
    rootpath = pkg.fs.realpathSync( rootpath );
    if( typeof app.incoming !== 'function' ){
        throw Error( 'application require method: incoming( r:Object )' );
    }
    else if( typeof app.outgoing !== 'function' ){
        throw Error( 'application require method: outgoing( r:Object, callback:Function )' );
    }
    // path resolve
    if( confpath )
    {
        try {
            confpath = pkg.fs.realpathSync( confpath );
        }catch(e){
            e.message = "failed to resolve confpath: " + e.message;
            throw e;
        };
    }
    // opaque data
    OPAQUE[id] = {
        // arguments
        confpath: confpath,
        // create server
        core: pkg.http.createServer(),
        // number of current connection
        nconn: 0,
        // file cache
        cached: {},
        // flag use graceful close
        graceful: false,
        // original process dir
        processRoot: rootpath,
        // config obj
        conf:{}
    };
	
    // confpath
    this.__defineGetter__('confpath',function(){
        return confpath;
    });
    // rootpath
    this.__defineGetter__('rootpath',function(){
        return rootpath;
    });
    // id getter
    this.__defineGetter__('id',function(){
        return id;
    });
    // application getter
    this.__defineGetter__('app',function(){
        return app;
    });
    // event emitter
    // this.__defineSetter__('on',function(){
    //     OPAQUE[id].evt.on( arguments[0], arguments[1] );
    // });
    // defalut graceful response: 503 SERVICE UNAVAILABLE
    this.cbGraceful = function( r ){
        r.server.outgoing( r, STATUS.SERVICE_UNAVAILABLE );
    };
    
    // server setup
    // create and add http request handler
    OPAQUE[id].core.on( 'request', onRequest );
    // upgrade
    // this.core.on( 'upgrade', function( req, sock, head ){ conf.delegate.onUpgrade( req, sock, head ); } );	
    /*
    // client socket error
    this.core.on( 'clientError', function( exception ){ 
        console.log( 'clientError->exception: ' + exception );
    });
    */
};

Receptor.prototype.listen = function( callback )
{
    var self = this,
        odata = OPAQUE[this.id],
        Configure = function()
        {
            var conf;
            
            delete odata.conf;
            if( odata.confpath )
            {
                try {
                    // read configuraton file
                    conf = JSON.parse( pkg.fs.readFileSync( odata.confpath, 'utf8' ) );
                }catch(e){
                    e.message = "failed to read conf file: " + e.message;
                    throw e;
                };
                // set rewrite configuration
                for( var prop in CONF )
                {
                    if( !conf[prop] ){
                        conf[prop] = CONF[prop];
                    }
                }
            }
            else
            {
                conf = {};
                for( var prop in CONF ){
                    conf[prop] = CONF[prop];
                }
            }
            // set ServerRoot and chdir
            conf.ServerRoot = pkg.fs.realpathSync( ( conf.ServerRoot ) ? conf.ServerRoot : self.rootpath );
            process.chdir( conf.ServerRoot );
            // set DocumentRoot
            try{
                conf.DocumentRoot = pkg.fs.realpathSync( conf.DocumentRoot );
            }catch(e){
                e.message = "failed to set DocumentRoot: \n    " + e.message;
                throw e;
            }
            
            // set Listen
            conf.Listen = ( typeof conf.Listen === 'string' ) ? conf.Listen : '127.0.0.1';
            // set Port
            conf.Port = ( typeof conf.Port === 'number' ) ? conf.Port : 1977;
            // set LimitRequestBody
            conf.LimitRequestBody = ( typeof +conf.LimitRequestBody === 'number' ) ? +conf.LimitRequestBody : 0;
            // set LimitRequestLine
            conf.LimitRequestLine = ( typeof +conf.LimitRequestLine === 'number' ) ? conf.LimitRequestLine : 8190;
            // set Timeout
            conf.Timeout = ( typeof conf.Timeout === 'number' ) ? (+conf.Timeout * 1000) : 0;
            // set KeepAlive
            conf.KeepAlive = ( typeof conf.KeepAlive === 'boolean' && conf.KeepAlive ) ? true : false;
            // set DirectorySlash
            conf.DirectorySlash = ( typeof conf.DirectorySlash === 'boolean' && conf.DirectorySlash ) ? true : false;
            // set Cached
            conf.Cached = ( typeof conf.Cached === 'boolean' && conf.Cached ) ? true : false;
            // set PidFile
            if( conf.PidFile )
            {
                var pidfd;
                
                try {
                    conf.PidFile = pkg.fs.realpathSync( conf.ServerRoot + '/' + conf.PidFile );
                }catch(e){};
                // create pid file and write process-id
                pidfd = pkg.fs.openSync( conf.PidFile, 'w' );
                pkg.fs.writeSync( pidfd, new Buffer( String( process.pid ) ), 0, String( process.pid ).length, null );
                pkg.fs.closeSync( pidfd );
            }
            
            // set uid/gid
            if( typeof conf.User === 'string' ){
                process.setuid( conf.User );
            }
            if( typeof conf.Group === 'string' ){
                process.setgid( conf.Group );
            }
            // set number of current connection
            odata.nconn = 0;
            // set graceful
            odata.graceful = false;
            odata.conf = conf;
            // console.log( OPAQUE[this.id] );
        };
    
    // configure
    Configure();
    // reset close event
    odata.core.removeAllListeners('close');
    // notify DocumentRoot to application
    if( typeof this.app.SetDocumentRoot === 'function' ){
        this.app.SetDocumentRoot( odata.conf.DocumentRoot );
    }
    // listen
    odata.core.listen( odata.conf.Port, odata.conf.Listen, callback );
};

// MARK: close client request
Receptor.prototype.outgoing = function( r, status )
{
    var odata = OPAQUE[this.id];
    
    // clear timeout
    clearTimeout( r.timeout );
    // set status
    r.status = ( status ) ? status : r.status;
    // HEAD
    if( r.req.method === 'HEAD' ){
        r.res.setHeader( 'Content-Type', odata.conf.DefaultType );
        r.res.writeHead( r.status );
        r.res.end();
    }
    else
    {
        var self = this;
            
        // if unknown mime type
        if( !r.mime )
        {
            // set by filename
            if( r.uri.pathfile ){
                r.mime = pkg.mime.lookup( r.uri.pathfile );
            }
            // default type
            else {
                r.mime = odata.conf.DefaultType;
            }
        }
        
        // rendering
        this.app.outgoing( r, function( err )
        {
            if( err ){
                r.status = STATUS.INTERNAL_SERVER_ERROR;
                self.ErrorPage( r );
            }
            // set content-length
            r.res.setHeader( 'Content-Length', ( Buffer.isBuffer( r.page ) ) ? r.page.length : Buffer.byteLength( r.page ) );
            // set content-type
            r.res.setHeader( 'Content-Type', r.mime );
            // writeout
            r.res.writeHead( r.status );
            r.res.end( r.page );
            // decrement number of connection
            odata.nconn--;
            // delete object
            delete r;
            // close server if graceful flag is on and no-connection
            if( odata.graceful && odata.nconn <= 0 ){
                self.close();
            }
        });
    }
};

// MARK: close server
Receptor.prototype.close = function()
{
    var odata = OPAQUE[this.id];
    
    // close server
    try {
        odata.core.close();
    }catch(e){
        console.log( e );
    };
    // remove pid file
    try {
        pkg.fs.unlinkSync( odata.conf.PidFile );
    }catch(e){
        console.log( e );
    };
};

Receptor.prototype.closeGraceful = function( cbGraceful, cbClose )
{
    var odata = OPAQUE[this.id];

    if( !odata.graceful )
    {
        odata.graceful = true;
        // user specify response
        if( cbGraceful ){
            this.cbGraceful = cbGraceful;
        }
        // register close event
        if( cbClose ){
            odata.core.once( 'close', cbClose );
        }
    }
    if( odata.nconn < 1 ){
        this.close();
    }
};

// MARK: uri to filename
Receptor.prototype.translateName = function( uri )
{
    var odata = OPAQUE[this.id],
        parsed_url = {};
            
    // parse url
    parsed_url = pkg.url.parse( uri, true );
    // path normalize
    parsed_url.pathname = pkg.path.normalize( parsed_url.pathname );
    // TODO: Alias
    // set directory index and check exists
    if( odata.conf.DirectoryIndex && parsed_url.pathname.charAt( parsed_url.pathname.length - 1 ) === '/' ){
        parsed_url.pathname += odata.conf.DirectoryIndex;
        parsed_url.pathfile = odata.conf.DocumentRoot + parsed_url.pathname;
        parsed_url.resolved = true;
    }
    // set realpath based on DocumentRoot
    else {
        parsed_url.pathfile = odata.conf.DocumentRoot + parsed_url.pathname;
        parsed_url.resolved = false;
    }
    return parsed_url;
};

// MARK: read file
Receptor.prototype.mapToStorage = function( r, callback )
{
    var odata = OPAQUE[this.id],
        status = 0,
        finfo = undefined,
        failed = function( err )
        {
            switch( err.errno ){
                case 9:		// EBADF: Bad file descriptor 
                case 12:	// ENOMEM: Cannot allocate memory
                case 14:	// EFAULT: Bad address
                case 62:	// ELOOP: Too many levels of symbolic links
                case 63:	// ENAMETOOLONG: File name too long
                    status = STATUS.INTERNAL_SERVER_ERROR;
                break;
                case 13:	// EACCES: Permission denied
                    status = STATUS.FORBIDDEN;
                break;
                case 21:	// EISDIR
                    // set redirect if uri.pathname is not end at slash
                    if( odata.conf.DirectorySlash && !r.uri.resolved ){
                        r.res.setHeader( 'Location', r.uri.pathname + '/' + ( ( r.uri.search ) ? r.uri.search : '' ) );
                        status = STATUS.MOVED_PERMANENTLY;
                    }
                    // not found
                    else {
                        status = STATUS.NOT_FOUND;
                    }
                break;
                    // 2 = ENOENT: No such file or directory
                    // 20 = ENOTDIR: Not a directory
                default:
                    status = STATUS.NOT_FOUND;
            }
            callback( err, status, r );
        },
        readFile = function( err, data )
        {
            if( err ){
                failed( err );
            }
            else
            {
                r.page = data;
                r.mime = pkg.mime.lookup( r.uri.pathfile );
                // save cache
                if( finfo )
                {
                    odata.cached[r.uri.pathfile] = {
                        finfo:finfo,
                        data:data,
                        mime:r.mime
                    };
                }
                callback( err, 0, r );
            }
        },
        readCached = function( err, stats )
        {
            if( err ){
                failed( err );
            }
            else if( stats.isDirectory() ){
                err = new Error();
                err.errno = 21;
                failed( err );
            }
            else
            {
                var cache = odata.cached[r.uri.pathfile];
                // check has cache
                if( cache && 
                    +(cache.finfo.mtime) == +(stats.mtime) && 
                    cache.finfo.size === stats.size ){
                    r.page = cache.data;
                    r.mime = cache.mime;
                    callback( undefined, 0, r );
                }
                else{
                    finfo = stats;
                    pkg.fs.readFile( r.uri.pathfile, readFile );
                }
            }
        };
    
    // check stat
    if( odata.conf.Cached ){
        pkg.fs.stat( r.uri.pathfile, readCached );
    }
    else {
        pkg.fs.readFile( r.uri.pathfile, readFile );
    }
};

Receptor.prototype.ErrorPage = function( r )
{
    r.mime = 'text/html';
    switch( r.status )
    {
        case 100:
            r.page = '<html><head><title>100 CONTINUE</title></head><body><h1>100 CONTINUE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: CONTINUE </p></body></html>';
        break;
        case 101:
            r.page = '<html><head><title>101 SWITCHING PROTOCOLS</title></head><body><h1>101 SWITCHING PROTOCOLS</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: SWITCHING PROTOCOLS </p></body></html>';
        break;
        case 102:
            r.page = '<html><head><title>102 PROCESSING</title></head><body><h1>102 PROCESSING</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: PROCESSING </p></body></html>';
        break;
        case 200:
            r.page = '<html><head><title>200 OK</title></head><body><h1>200 OK</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: OK </p></body></html>';
        break;
        case 201:
            r.page = '<html><head><title>201 CREATED</title></head><body><h1>201 CREATED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: CREATED </p></body></html>';
        break;
        case 202:
            r.page = '<html><head><title>202 ACCEPTED</title></head><body><h1>202 ACCEPTED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: ACCEPTED </p></body></html>';
        break;
        case 203:
            r.page = '<html><head><title>203 NON AUTHORITATIVE</title></head><body><h1>203 NON AUTHORITATIVE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: NON AUTHORITATIVE </p></body></html>';
        break;
        case 204:
            r.page = '<html><head><title>204 NO CONTENT</title></head><body><h1>204 NO CONTENT</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: NO CONTENT </p></body></html>';
        break;
        case 205:
            r.page = '<html><head><title>205 RESET CONTENT</title></head><body><h1>205 RESET CONTENT</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: RESET CONTENT </p></body></html>';
        break;
        case 206:
            r.page = '<html><head><title>206 PARTIAL CONTENT</title></head><body><h1>206 PARTIAL CONTENT</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: PARTIAL CONTENT </p></body></html>';
        break;
        case 207:
            r.page = '<html><head><title>207 MULTI STATUS</title></head><body><h1>207 MULTI STATUS</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: MULTI STATUS </p></body></html>';
        break;
        case 300:
            r.page = '<html><head><title>300 MULTIPLE CHOICES</title></head><body><h1>300 MULTIPLE CHOICES</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: MULTIPLE CHOICES </p></body></html>';
        break;
        case 301:
            r.page = '<html><head><title>301 MOVED PERMANENTLY</title></head><body><h1>301 MOVED PERMANENTLY</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: MOVED PERMANENTLY </p></body></html>';
        break;
        case 302:
            r.page = '<html><head><title>302 MOVED TEMPORARILY</title></head><body><h1>302 MOVED TEMPORARILY</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: MOVED TEMPORARILY </p></body></html>';
        break;
        case 303:
            r.page = '<html><head><title>303 SEE OTHER</title></head><body><h1>303 SEE OTHER</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: SEE OTHER </p></body></html>';
        break;
        case 304:
            r.page = '<html><head><title>304 NOT MODIFIED</title></head><body><h1>304 NOT MODIFIED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: NOT MODIFIED </p></body></html>';
        break;
        case 305:
            r.page = '<html><head><title>305 USE PROXY</title></head><body><h1>305 USE PROXY</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: USE PROXY </p></body></html>';
        break;
        case 307:
            r.page = '<html><head><title>307 TEMPORARY REDIRECT</title></head><body><h1>307 TEMPORARY REDIRECT</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: TEMPORARY REDIRECT </p></body></html>';
        break;
        case 400:
            r.page = '<html><head><title>400 BAD REQUEST</title></head><body><h1>400 BAD REQUEST</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: BAD REQUEST </p></body></html>';
        break;
        case 401:
            r.page = '<html><head><title>401 UNAUTHORIZED</title></head><body><h1>401 UNAUTHORIZED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: UNAUTHORIZED </p></body></html>';
        break;
        case 402:
            r.page = '<html><head><title>402 PAYMENT REQUIRED</title></head><body><h1>402 PAYMENT REQUIRED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: PAYMENT REQUIRED </p></body></html>';
        break;
        case 403:
            r.page = '<html><head><title>403 FORBIDDEN</title></head><body><h1>403 FORBIDDEN</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: FORBIDDEN </p></body></html>';
        break;
        case 404:
            r.page = '<html><head><title>404 NOT FOUND</title></head><body><h1>404 NOT FOUND</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: NOT FOUND </p></body></html>';
        break;
        case 405:
            r.page = '<html><head><title>405 METHOD NOT ALLOWED</title></head><body><h1>405 METHOD NOT ALLOWED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: METHOD NOT ALLOWED </p></body></html>';
        break;
        case 406:
            r.page = '<html><head><title>406 NOT ACCEPTABLE</title></head><body><h1>406 NOT ACCEPTABLE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: NOT ACCEPTABLE </p></body></html>';
        break;
        case 407:
            r.page = '<html><head><title>407 PROXY AUTHENTICATION REQUIRED</title></head><body><h1>407 PROXY AUTHENTICATION REQUIRED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: PROXY AUTHENTICATION REQUIRED </p></body></html>';
        break;
        case 408:
            r.page = '<html><head><title>408 REQUEST TIME OUT</title></head><body><h1>408 REQUEST TIME OUT</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: REQUEST TIME OUT </p></body></html>';
        break;
        case 409:
            r.page = '<html><head><title>409 CONFLICT</title></head><body><h1>409 CONFLICT</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: CONFLICT </p></body></html>';
        break;
        case 410:
            r.page = '<html><head><title>410 GONE</title></head><body><h1>410 GONE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: GONE </p></body></html>';
        break;
        case 411:
            r.page = '<html><head><title>411 LENGTH REQUIRED</title></head><body><h1>411 LENGTH REQUIRED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: LENGTH REQUIRED </p></body></html>';
        break;
        case 412:
            r.page = '<html><head><title>412 PRECONDITION FAILED</title></head><body><h1>412 PRECONDITION FAILED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: PRECONDITION FAILED </p></body></html>';
        break;
        case 413:
            r.page = '<html><head><title>413 REQUEST ENTITY TOO LARGE</title></head><body><h1>413 REQUEST ENTITY TOO LARGE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: REQUEST ENTITY TOO LARGE </p></body></html>';
        break;
        case 414:
            r.page = '<html><head><title>414 REQUEST URI TOO LARGE</title></head><body><h1>414 REQUEST URI TOO LARGE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: REQUEST URI TOO LARGE </p></body></html>';
        break;
        case 415:
            r.page = '<html><head><title>415 UNSUPPORTED MEDIA TYPE</title></head><body><h1>415 UNSUPPORTED MEDIA TYPE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: UNSUPPORTED MEDIA TYPE </p></body></html>';
        break;
        case 416:
            r.page = '<html><head><title>416 RANGE NOT SATISFIABLE</title></head><body><h1>416 RANGE NOT SATISFIABLE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: RANGE NOT SATISFIABLE </p></body></html>';
        break;
        case 417:
            r.page = '<html><head><title>417 EXPECTATION FAILED</title></head><body><h1>417 EXPECTATION FAILED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: EXPECTATION FAILED </p></body></html>';
        break;
        case 422:
            r.page = '<html><head><title>422 UNPROCESSABLE ENTITY</title></head><body><h1>422 UNPROCESSABLE ENTITY</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: UNPROCESSABLE ENTITY </p></body></html>';
        break;
        case 423:
            r.page = '<html><head><title>423 LOCKED</title></head><body><h1>423 LOCKED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: LOCKED </p></body></html>';
        break;
        case 424:
            r.page = '<html><head><title>424 FAILED DEPENDENCY</title></head><body><h1>424 FAILED DEPENDENCY</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: FAILED DEPENDENCY </p></body></html>';
        break;
        case 426:
            r.page = '<html><head><title>426 UPGRADE REQUIRED</title></head><body><h1>426 UPGRADE REQUIRED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: UPGRADE REQUIRED </p></body></html>';
        break;
        case 501:
            r.page = '<html><head><title>501 NOT IMPLEMENTED</title></head><body><h1>501 NOT IMPLEMENTED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: NOT IMPLEMENTED </p></body></html>';
        break;
        case 502:
            r.page = '<html><head><title>502 BAD GATEWAY</title></head><body><h1>502 BAD GATEWAY</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: BAD GATEWAY </p></body></html>';
        break;
        case 503:
            r.page = '<html><head><title>503 SERVICE UNAVAILABLE</title></head><body><h1>503 SERVICE UNAVAILABLE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: SERVICE UNAVAILABLE </p></body></html>';
        break;
        case 504:
            r.page = '<html><head><title>504 GATEWAY TIME OUT</title></head><body><h1>504 GATEWAY TIME OUT</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: GATEWAY TIME OUT </p></body></html>';
        break;
        case 505:
            r.page = '<html><head><title>505 VERSION NOT SUPPORTED</title></head><body><h1>505 VERSION NOT SUPPORTED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: VERSION NOT SUPPORTED </p></body></html>';
        break;
        case 506:
            r.page = '<html><head><title>506 VARIANT ALSO VARIES</title></head><body><h1>506 VARIANT ALSO VARIES</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: VARIANT ALSO VARIES </p></body></html>';
        break;
        case 507:
            r.page = '<html><head><title>507 INSUFFICIENT STORAGE</title></head><body><h1>507 INSUFFICIENT STORAGE</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: INSUFFICIENT STORAGE </p></body></html>';
        break;
        case 510:
            r.page = '<html><head><title>510 NOT EXTENDED</title></head><body><h1>510 NOT EXTENDED</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: NOT EXTENDED </p></body></html>';
        break;
        case 500:
        default:
                r.status = 500;
            r.page = '<html><head><title>500 INTERNAL SERVER ERROR</title></head><body><h1>500 INTERNAL SERVER ERROR</h1><p>Failed to Requested URL: ' + encodeURI( r.req.url ) + '<br />reason: INTERNAL SERVER ERROR </p></body></html>';
        break;
    }
};

module.exports = Receptor;
module.exports.STATUS = STATUS;
