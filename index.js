/***
 * Jscoverage for node
 * Based on jscoverage@siliconforks.com
 * Modified by kate.sf@taobao.com, jianxun.zxl@taobao.com, fengmk2@gmail.com
 ***/

var fs = require('fs');
var _jscoverage = require('./jscoverage.node')
var _jsclass = new _jscoverage.Jscoverage();
var Module = require('module');
var path = require('path');
var Script = process.binding('evals').NodeScript;
var runInThisContext = Script.runInThisContext;
var runInNewContext = Script.runInNewContext;

exports.process = function(filename, content, encode) {
  if(encode!=null && typeof(encode)==='string')
    var _encode = encode;
  else
    var _encode = 'utf-8';
  

  if(content!=null && Buffer.isBuffer(content)) 
    var _content = content;
  if(content!=null && typeof(content)==='string')
    var _content = new Buffer(content, _encode);

  if(_content==null) {
    console.error('content is required.');
    return null;
  }
  if(filename==null || typeof(filename)!='string') {
    console.error('filename is required.');
    return null;
  }

  var _buf = _jsclass.doBufferSync(_content, _encode, filename);
  return _buf.toString(_encode);
};

exports.processFile = function(filename, encode) {
  if(encode!=null && typeof(encode)==='string')
    var _encode = encode;
  else
    var _encode = 'utf-8';

  if(filename==null || typeof(filename)!='string') {
    console.error('filename is required.');
    return null;
  }
  
  var _stats = fs.statSync(filename);
  if(!_stats.isFile()) {
    console.error('file is not correct.');
    return null;
  }
  var _buffer = new Buffer(_stats.size);
  var _fd = fs.openSync(filename, 'r');
  fs.readSync(_fd, _buffer, 0, _stats.size, 0);
  var _buf = _jsclass.doBufferSync(_buffer, _encode, filename);
  return _buf.toString(_encode);  
};


exports.processDir = function(source, dest, exclude, exclude_file, options) {
  if (typeof(source) !== 'string' || typeof(dest) !== 'string') {
    console.error('source and destination dictionary must be set.');
    return;
  }
  if (exclude!=null && exclude!='') exclude+='|.workspace';
  else var exclude = '';
  if (exclude_file!=null && exclude_file!='') exclude_file+='|.tmp';
  else var exclude_file = '';
  if (options==null) var options = '';

  _jsclass.doDirSync(source, dest, exclude, exclude_file, options);
};


//global variable. when using mocha, please register it.
_$jscoverage = {};

/**
 * Enable module cache or not.
 * @type {Boolean}
 */
exports.enableModuleCache = false;

/**
 * require module, instead of the node require().
 * @param  {Object} mo module object.
 */
exports.require = function(mo) {
  var _old_require = Module.prototype.require;
  Module.prototype.require = function(filename, needjsc) {
    if (!needjsc) {
      return _old_require.call(this, filename);    
    }
    filename = Module._resolveFilename(filename, this);
    if (typeof(filename) === 'object') filename = filename[0];
    if (exports.enableModuleCache) {
      var cachedModule = Module._cache[filename];
      if (cachedModule) {
        return cachedModule.exports;
      }
    }
    var module = new Module(filename, this);
    Module._cache[filename] = module;
    try {
      module.load(filename);
      module.filename = filename;
      module.paths = Module._nodeModulePaths(path.dirname(filename));
      module.loaded = true;
      module.needjsc = needjsc; // need jscoverage process
      Module._extensions['.js'](module, filename);
    } catch (err) {
      delete Module._cache[filename];
      throw err;
    }
    return module.exports;
  }

  Module.prototype._compile = function(content, filename) {
    var self = this;
    // remove shebang
    content = content.replace(/^\#\!.*/, '');
    
    // inject exports: _test(func,params) ,_get(func) 
    content += '\n\
      exports._test = function(func,args){\
        var f,o;\
        if(func.match(/\\./)){\
          func = func.split(".");\
          f = func[func.length-1];\
          func.pop();\
          o = func.join(".");\
        }else{\
          f = func;\
          o = "this";\
        }\
        return eval(f+".apply(" + o + "," + JSON.stringify(args) + ")");\
      };\
      exports._get = function(objstr){\
      return eval(objstr);\
      };';

    if (this.needjsc) {
      content = exports.processFile(filename,'utf-8');
    }

    function require(path, needjsc) {
      return self.require(path, needjsc);
    }

    require.resolve = function(request) {
      return Module._resolveFilename(request, self);
    };

    Object.defineProperty(require, 'paths', { get: function() {
      var msg = 'require.paths is removed. Use node_modules folders, \
        or the NODE_PATH environment variable instead.';
      throw new Error(msg);
    }});

    require.main = process.mainModule;

    // Enable support to add extra extension types
    require.extensions = Module._extensions;
    require.registerExtension = function() {
      throw new Error('require.registerExtension() removed. \
        Use require.extensions instead.');
    };

    require.cache = Module._cache;

    var dirname = path.dirname(filename);

    if (Module._contextLoad) {
      if (self.id !== '.') {
        debug('load submodule');
        // not root module
        var sandbox = {};
        for (var k in global) {
          sandbox[k] = global[k];
        }
        sandbox.require = require;
        sandbox.exports = self.exports;
        sandbox.__filename = filename;
        sandbox.__dirname = dirname;
        sandbox.module = self;
        sandbox.global = sandbox;
        sandbox.root = root;

        return runInNewContext(content, sandbox, filename, true);
      }

      debug('load root module');
      // root module
      global.require = require;
      global.exports = self.exports;
      global.__filename = filename;
      global.__dirname = dirname;
      global.module = self;

      return runInThisContext(content, filename, true);
    }

    // create wrapper function
    var wrapper = Module.wrap(content);

    var compiledWrapper = runInThisContext(wrapper, filename, true);
    if (global.v8debug) {
      if (!resolvedArgv) {
        resolvedArgv = Module._resolveFilename(process.argv[1], null);
      }

      // Set breakpoint on module start
      if (filename === resolvedArgv) {
        global.v8debug.Debug.setBreakPoint(compiledWrapper, 0, 0);
      }
    }

    var args = [ self.exports, require, self, filename, dirname ];
    return compiledWrapper.apply(self.exports, args);
  };

  return function() {
    return mo.require.apply(mo, arguments);
  };
};

function requirePath(require, p, cov) {
  var stat = fs.statSync(p);
  if (stat.isFile()) {
    // only require .js file.
    if (path.extname(p) === '.js') {
      require(p, cov);
    }
  } else if (stat.isDirectory()) {
    var names = fs.readdirSync(p);
    for (var i = 0, l = names.length; i < l; i++) {
      var name = names[i];
      if (name[0] === '.') {
        continue;
      }
      requirePath(require, path.join(p, name), cov);
    }
  }
}

/**
 * Require libs and ignore libs with jscoverage.
 * @param  {Object} mo, current module object.
 * @param  {Array} libs, need to coverage libs.
 * @param  {Array} ignoreLibs, no need to coverage libs.
 */
exports.requireLibs = function(mo, libs, ignoreLibs) {
  var _require = exports.require(mo);
  var items = [];
  ignoreLibs = ignoreLibs || [];
  for (var i = 0, l = ignoreLibs.length; i < l; i++) {
    items.push([ignoreLibs[i], false]);
  }
  libs = libs || [];
  for (var i = 0, l = libs.length; i < l; i++) {
    items.push([libs[i], true]);
  }
  for (var i = 0, l = items.length; i < l; i++) {
    var item = items[i];
    requirePath(_require, item[0], item[1]);
  }
};

/**
 * sum the coverage rate
 */
exports.coverage = function() {
  var file;
  var tmp;
  var total;
  var touched;
  for (var i in _$jscoverage) {
    file = i;
    tmp = _$jscoverage[i];
    total = touched = 0;
    for (var n=0,len = tmp.length; n < len ; n++){
      if (tmp[n] !== undefined) {
        total ++ ;
        if (tmp[n] > 0)
            touched ++;
      }
    }
    console.log(
      "  [JS Coverage] " +
      file + ":" + 
      (total ? (((touched / total)*100).toFixed(2) + '%') : "Not prepared!!!") 
    );
  }
  console.log("\n  --EOF--\n");
};
