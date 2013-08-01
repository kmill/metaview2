// mv.js
// main javascript for metaview

"use strict";

// Stuff to make dealing with javascript better
// --------------------------------------------

// Adds a method to an object.  This method is used on a constructor
// function.
Function.prototype.method = function (name, f) {
  this.prototype[name] = f;
  return this;
};

// in Firefox, there is no window.console
if (window.console === undefined) {
  window.console = { log: function () {} };
}

_.mixin({
  // Creates a new object from a prototype, extending the new object
  // with the optional 'props' argument.
  create : function (o, props) {
    if (o === undefined) {
      throw new TypeError("Cannot extend undefined.");
    }
    function F() { this._super = o; _.extend(this, props); }
    F.prototype = o;
    return new F();
  },
  // Creates a new object, calling '_init' with the passed-in arguments.
  build : function (o) {
    var args = _.rest(arguments, 1);
    var newobj = _.create(o);
    (newobj._init || function () {}).apply(newobj, args);
    return newobj;
  },
  // Creates a function which is like the composition of the given
  // functions, but each function gets as its last argument a callback
  // which continues the chain.  Kind of like "foldr (>>=) id
  // arguments".  The callback can take any number of arguments, all
  // of which get passed to the next function.
  seq : function () {
    var funcs = arguments;
    var func = function () {};
    for (var i = funcs.length - 1; i >= 0; i--) {
      func = (function (i, callback) {
        return function () {
          var args = _.toArray(arguments);
          args.push(callback);
          return funcs[i].apply(this, args);
        };
      })(i, func);
    }
    return func;
  },
  // Gets an instance method of an object
  im : function (o, fname) {
    var f = o[fname];
    if (f === undefined) {
      throw new TypeError("No such method '" + fname + "' when creating instance method.");
    }
    var args = _.rest(arguments, 2);
    return function () {
      return f.apply(o, args.concat(_.toArray(arguments)));
    };
  }
});

var mv = (function (mv, $) {
  // Stuff to talk to the server
  // ---------------------------
  
  // Get a cookie by name
  mv.getCookie = function (name) {
    var r = document.cookie.match("\\b" + name + "=([^;]*)\\b");
    return r ? r[1] : undefined;
  };
  
  // Asynchronously calls module/method with a given dictionary of
  // args on the server.  The callback 'onSuccess' gets the return
  // value, and 'onError' gets an error and an exception (whatever
  // those mean).
  mv.rpc = function (module, method, args, onSuccess, onError) {
    var _xsrf = mv.getCookie("_xsrf");
    onSuccess = onSuccess || function () {};
    onError = onError || function (err, exc) { console.log("rpc error: " + err + "\n" + JSON.stringify(exc)); };
    var data = {method : method,
                kwargs : args || {}};
    $.ajax({url : "/ajax/rpc/" + module,
            type : "POST",
            data : {_xsrf : _xsrf, message : JSON.stringify(data)},
            dataType : "json",
            timeout : 5000,
            success : function (res) {
              if ("result" in res) {
                onSuccess(res["result"]);
              } else if ("error" in res) {
                onError("exception", res["error"]);
              } else {
                onError("malformed");
              }
            },
            error : function (hjXHR, textStatus, errorThrown) {
              onError(textStatus);
            }
           });
  };
  
  // Events
  // ------

  // A mixin for adding event handlers to an object.
  mv.eventify = function (o) {
    var eventHandlers = {};
    function getHandlers(name) {
      var handlers = eventHandlers[name];
      if (handlers === undefined) {
        throw new TypeError("Event handler type not declared: " + name);
      }
      return handlers;
    }
    function removeHandlers(name, toRemove) {
      if (toRemove.length > 0) {
        eventHandlers[name] = _.without.apply(_, [eventHandlers[name]].concat(toRemove));
      }
    }
    // Adds a type of event which can be handled.
    o.addEventType = function (name) {
      eventHandlers[name] = eventHandlers[name] || [];
      return o;
    },
    // Register an event handler for a particular event name.
    o.on = function (name, func, context) {
      if (_.isArray(name)) {
        var that = this;
        _.each(name, function (n) { that.on(n, func, context); });
      } else {
        getHandlers(name).push([func, context]);
      }
      return o;
    };
    // Triggers an event with some arguments.  The event is removed if
    // it throws the string "removeHandler".
    o.trigger = function (name) {
      var args = _.rest(arguments, 1);
      args.unshift(this);
      var toRemove = [];
      _.each(getHandlers(name), function (handler) {
        try {
          handler[0].apply(handler[1], args);
        } catch (x) {
          if (x === "removeHandler") {
            toRemove.push(handler);
          } else {
            throw x;
          }
        }
      });
      removeHandlers(name, toRemove);
      return o;
    };
    return o;
  };
  
  // Models
  // ------

  // Prototype for models (as in MVC models).
  var _Model = {
    _init : function () {
      mv.eventify(this);
    }
  };

  // Connection
  // ----------

  // Adds a message handler for a particular message type
  // 'name'. There can be any number of handlers for any message
  // type.
  mv.addMessageHandler = function (name, func, context) {
    if (_.has(mv.messageHandlers, name)) {
      mv.messageHandlers[name].push([func, context]);
    } else {
      mv.messageHandlers[name] = [[func, context]];
    }
  };
  mv.messageHandlers = {};

  // this should be restructured with long polling, but I just want
  // to get the interface right first.
  var _Connection = _.create(_Model, {
    _init : function (channel_id) {
      _Model._init.call(this);
      this.channel_id = channel_id; // The id of the polling channel for this client
      this.addEventType("badChannel"); // when the channel id isn't right.
    },
    // Starts a long poll which calls message handlers on each message
    // which comes by.  Uses longPollDriver to do this, and the
    // 'onError' callback is passed right on to it.
    longPoll : function (onError) {
      var that = this;
      this.longPollDriver(
        function (messages) {
          _.each(messages, function (message) {
            var handled = false;
            _.each(mv.messageHandlers[message["type"]], function (handler) {
              handled = true;
              handler[0].call(handler[1], message["args"]);
            });
            if (!handled) {
              console.log("Unknown message type: " + message["type"]);
            }
          });
        },
        onError);
    },

    // Makes a long polling loop. Calls 'handler' on any list of
    // messages which come by, else calls 'onError' with an error
    // message.  The onError function decides whether to continue the
    // long poll by returning something that's non-falsy.
    longPollDriver : function (handler, onError) {
      var that = this;
      var _xsrf = mv.getCookie("_xsrf");
      onError = onError || function () {};
      function loop() {
        $.ajax({url : "/ajax/poll",
                type : "POST",
                dataType : "json",
                data : {_xsrf : _xsrf,
                        channel_id : that.channel_id},
                timeout : 30000,
                success : function (data) {
                  if (_.has(data, "messages")) {
                    handler(data["messages"]);
                    loop();
                  } else {
                    if (data.error === "no such channel") {
                      that.trigger("badChannel");
                    }
                    if (onError(data["error"])) {
                      _.delay(loop, 500);
                    }
                  }
                },
                error : function (jqXHR, textStatus, errorThrown) {
                  if (textStatus === "timeout") {
                    loop();
                  } else {
                    console.log("Long polling error: " + textStatus + " (" + errorThrown + ")");
                    if (textStatus === "error" && errorThrown === "Forbidden") {
                      that.trigger("badChannel");
                    }
                    if (onError(textStatus, errorThrown)) {
                      _.delay(loop, 2000);
                    }
                  }
                }
               });
      }
      loop();
    }

  });

  // Since we need a channel id to create the connection model, we
  // have this constructor to defer its creation
  mv.initConnection = function (channel_id) {
    mv.Connection = _.build(_Connection, channel_id);
  };

  // Fragment model
  // --------------

  // Support for maintaining the url fragment
  var _FragmentModel = _.create(_Model, {
    _init : function () {
      _Model._init.apply(this);
      this.addEventType("updated");
      window.onhashchange = _.im(this, 'hashChanged');
      this.hashChanged();
    },
    hashChanged : function () {
      this.parsed = this.parse($(window.location).attr('hash').slice(1));
      this.trigger("updated", this.parsed);
    },
    changeFragment : function (d) {
      this.parsed = d;
      $(window.location).attr('hash', this.makeFragment(d));
    },
    getPart : function (key) {
      if (this.parsed && _.has(this.parsed, key)) {
        return this.parsed[key];
      } else {
        return undefined;
      }
    },
    getParsed : function () {
      return _.clone(this.parsed);
    },
    parse : function (hash) {
      var parsed = {};
      _.each(hash.split("&"), function (part) {
        if (part.length > 0) {
          var subparts = part.split("=", 2);
          if (subparts.length == 1) {
            parsed["web"] = decodeURIComponent(subparts[0]);
          } else {
            parsed[subparts[0]] = decodeURIComponent(subparts[1]);
          }
        }
      });
      return parsed;
    },
    encode : function (d) {
      var out = [];
      var keys = _.keys(d);
      if (_.has(d, "web")) {
        keys = _.without(keys, "web");
        out.push(encodeURIComponent(d.web));
      }
      keys.sort();
      _.each(keys, function (key) {
        out.push(key + "=" + encodeURIComponent(d[key]));
      });
      return out.join("&");
    },
    makeFragment : function (d) {
      return '#' + this.encode(d);
    }
  });

  mv.FragmentModel = _.build(_FragmentModel);

  // Webs
  // ----

  var _Web = {
    id : undefined,
    name : undefined,
    isPublic : undefined
  };

  var _WebModel = _.create(_Model, {
    _init : function () {
      _Model._init.call(this);
      this.knownWebs = undefined;
      this.currentWebId = undefined;
      this.getWebsCallbacks = undefined; // undefined iff there is no pullWebs in progress
      this.addEventType("updated"); // when knownWebs is generally updated
      this.addEventType("deselected"); // when currentWeb ends up pointing to nothing
      this.addEventType("selected"); // when currentWeb is changed
      mv.addMessageHandler("WebChangeMessage", this.WebChangeMessageHandler, this);
      mv.FragmentModel.on("updated", _.im(this, 'fragmentChanged'));
    },
    WebChangeMessageHandler : function (args) {
      var web;
      if (args.web_name) {
        // renamed or created
        web = this.knownWebs[args.web_id] || _.create(_Web, {id : args.web_id});
        web.name = args.web_name;
        web.isPublic = args.web_public;
        this.knownWebs[web.id] = web;
        if (this.getCurrentWeb()) {
          var d = mv.FragmentModel.getParsed();
          d['web'] = this.getCurrentWeb().name;
          mv.FragmentModel.changeFragment(d);
        }
      } else {
        delete this.knownWebs[args.web_id];
      }
      this.autoselectWeb();
      this.trigger("updated", this.knownWebs);
    },
    // Gets all of the known webs.  If a callback is supplied, then
    // the webs are supplied to the callback possibly asynchronously.
    getWebs : function (callback) {
      if (callback === undefined) {
        return this.knownWebs && _.values(this.knownWebs);
      } else if (this.knownWebs) {
        callback(_.values(this.knownWebs));
      } else if (this.getWebsCallbacks) {
        this.getWebsCallbacks.push(callback);
      } else {
        this.getWebsCallbacks = [callback];
        this.pullWebs();
      }
      return undefined;
    },
    fragmentChanged : function (model, d) {
      var currentWeb = this.getCurrentWeb();
      if (currentWeb && currentWeb.name !== d.web || currentWeb === undefined && d.web !== undefined) {
        this.currentWebId = undefined;
        this.autoselectWeb();
      }
    },
    autoselectWeb : function () {
      var that = this;
      _.seq(
        _.im(that, 'getWebs'),
        function (webs) {
          if (_.size(webs) === 1) {
            // there is only one option! no need for fancy stuff
            that.currentWebId = _.first(webs).id;
          }
          if (that.currentWebId === undefined) {
            var web = that.getWebByName(mv.FragmentModel.getPart('web'));
            that.currentWebId = web && web.id; // sets undefined if no such web
          }
          if (that.currentWebId === undefined && mv.getCookie("default_web_id")) {
            var web_id = mv.getCookie("default_web_id");
            if (_.has(that.knownWebs, web_id)) {
              that.currentWebId = web_id;
            }
          }
          if (that.currentWebId !== undefined && that.getCurrentWeb() !== undefined) {
            console.log("selected web");
            that.trigger("selected");
            if (that.getCurrentWeb().name !== mv.FragmentModel.getPart('web')) {
              mv.FragmentModel.changeFragment({web : that.getCurrentWeb().name});
            }
          } else {
            console.log("deselected web");
            that.currentWebId = undefined;
            that.trigger("deselected");
            mv.FragmentModel.changeFragment({});
          }
        }
      )();
    },
    // Asks the server for all of the webs. This is called implicitly by getWebs.
    pullWebs : function () {
      var that = this;
      that.getWebsCallbacks = that.getWebsCallbacks || [];
      mv.rpc("webs", "get_webs", {},
             function (webs) {
               var oldKnownWebs = that.knownWebs || {};
               that.knownWebs = {};
               _.each(webs, function (name, id) {
                 var web = oldKnownWebs[id] || _.create(_Web, {id : id});
                 web.name = webs[id].name;
                 web.isPublic = webs[id].isPublic;
                 that.knownWebs[id] = web;
               });
               that.autoselectWeb();
               that.trigger("updated", that.knownWebs);

               _.each(that.getWebsCallbacks, function (callback) {
                 callback(_.values(that.knownWebs));
               });
               that.getWebsCallbacks = undefined;
             },
             function () {
               // error. try again?
               _.delay(function () { that.pullWebs(); }, 2000);
             });
    },
    // Gets the object for the current web
    getCurrentWeb : function () {
      return this.knownWebs && this.knownWebs[this.currentWebId];
    },
    // Set the current web
    setCurrentWeb : function (web_id) {
      web_id = +web_id;
      if (this.currentWebId == web_id || web_id === undefined) {
        return;
      }
      if (!_.has(this.knownWebs, web_id)) {
        throw new TypeError("Not a web id");
      }
      this.currentWebId = web_id;
      mv.rpc("webs", "set_default_web", {"web_id" : +web_id});
      this.trigger("selected");
    },
    // Add a web
    addWeb : function (webname, callback) {
      mv.rpc("webs", "create_web", {webname : webname}, callback);
    },
    // Rename a web
    renameWeb : function (webid, newwebname, callback) {
      mv.rpc("webs", "rename_web", {id : +webid, newwebname : newwebname},
             callback);
    },
    // Sets 'public' for web
    setWebPublic : function (webid, isPublic) {
      mv.rpc("webs", "set_public", {id : +webid, isPublic : isPublic});
    },
    // Gets the users who can see this web
    getWebUsers : function (webid, callback) {
      mv.rpc("webs", "get_web_users", {id : +webid}, callback);
    },
    deleteWeb : function (webid, callback) {
      mv.rpc("webs", "delete_web", {id : +webid}, callback);
    },
    // Get web by name
    getWebByName : function (name) {
      return _.findWhere(this.knownWebs, {name : name});
    }
  });

  // The actual web model
  mv.WebModel = _.build(_WebModel);


  // Users
  // -----

  var _User = {
    email : undefined,
    first_name : undefined,
    last_name : undefined,

    avatarUrl : function () {
      return "/avatar/" + encodeURIComponent(this.email);
    }
  };
  var _UserModel = _.create(_Model, {
    _init : function () {
      _Model._init.call(this);
      this.knownUsers = {}; // email -> User
      this.hasPulled = false;
      this.pullUsersCallbacks = undefined;
      this.addEventType("updated"); // when knownUsers is generally updated
    },
    addUser : function (email, first_name, last_name) {
      if (!_.has(this.knownUsers, email)) {
        this.knownUsers = _.create(_User, {
          email : email,
          first_name : first_name,
          last_name : last_name
        });
      }
    },
    getUser : function (userEmail, callback) {
      if (_.has(this.knownUsers, userEmail)) {
        callback(this.knownUsers[userEmail]);
      } else {
        _.seq(_.im(this, 'getUsers'),
              function (users) {
                callback(users[userEmail]);
              }
             )();
      }
    },
    getUsers : function (callback) {
      if (this.hasPulled) {
        callback(this.knownUsers);
      } else if (this.pullUsersCallbacks === undefined) {
        this.pullUsersCallbacks = [callback];
        this.pullUsers();
      } else {
        this.pullUsersCallbacks.push(callback);
      }
    },
    pullUsers : function () {
      var that = this;
      that.pullUsersCallbacks = that.pullUsersCallbacks || {};
      mv.rpc("users", "get_users", {},
             function (users) {
               var oldUsers = that.knownUsers || {};
               that.knownUsers = {};
               _.each(users, function (user) {
                 var userObj = oldUsers[user.email] || _.create(_User);
                 _.extend(userObj, {
                   email : user.email,
                   first_name : user.first_name,
                   last_name : user.last_name
                 });
                 that.knownUsers[userObj.email] = userObj;
               });
               that.hasPulled = true;
               _.each(that.pullUsersCallbacks, function (callback) {
                 callback(that.knownUsers);
               });
               that.pullUsersCallbacks = undefined;
               that.trigger("updated", that.knownUsers);
             },
             function () {
               _.delay(_.im(that, 'pullUsers'), 5000); // try again?
             });
    }
  });

  // The actual user model
  mv.UserModel = _.build(_UserModel);


  // Blobs
  // -----
  
  // Prototype for a single blob
  var _Blob = {
    uuid : undefined,
    date_created : undefined,
    editor_email : undefined,
    content_type : undefined,
    content : undefined,
    summary : undefined,

    srels : undefined,
    orels : undefined,
    
    getUrl : function () {
      var filename;
      // sort by date so that later relations take precedence
      var srels = _.sortBy(this.srels, function (rel) {
        return rel.date_created.getTime();
      });
      _.each(srels, function (rel) {
        if (rel.name === "filename") {
          filename = rel.payload || filename;
        }
      });
      return '/blob/' + this.uuid + (filename ? '/' + filename : '');
    },

    getContent : function (callback) {
      if (this.content !== undefined) {
        callback(this.content);
      } else {
        var that = this;
        $.get('/blob/' + this.uuid, function (c) {
          that.content = c;
          callback(c);
        });
      }
    },
    // Gets a short string which might be called the "name" of this blob
    getName : function () {
      var name = this.uuid;
      // sort by date so that later relations take precedence
      var srels = _.sortBy(this.srels, function (rel) {
        return rel.date_created.getTime();
      });
      _.each(srels, function (rel) {
        if (rel.name === "filename" || rel.name === "title") {
          name = rel.payload || name;
        }
      });
      return name;
    },
    getAuthors : function () {
      var seen = {}; // being used as a set
      var authors = [];
      // sort by date to order authors
      var srels = _.sortBy(this.srels, function (rel) {
        return rel.date_created.getTime();
      });
      _.each(srels, function (rel) {
        if (rel.name === "editor" && !_.has(seen, rel.payload)) {
          authors.push(rel.payload);
          seen[rel.payload] = true;
        }
      });
      return authors;
    }		
  };
  // Prototype for a single relation
  var _Relation = {
    uuid : undefined,
    date_created : undefined,
    name : undefined,
    subject : undefined,
    object : undefined,
    payload : undefined,

    isInherited : function (blob) {
      // (not pseudo) and (for other subject)
      return this.uuid !== null && blob.uuid !== this.subject;
    }
  };

  var _BlobModel = _.create(_Model, {
    _init : function () {
      _Model._init.call(this);
      this.knownBlobs = {};
      this.pullCallbacks = [];
      this.doingPull = false;
//      this.addEventType("updated"); // for when the known blobs have changed
    },
    // performs pull for callbacks
    pullBlobs : function () {
      if (this.doingPull) {
        return;
      } else {
        this.doingPull = true;
      }
      var that = this;
      if (_.size(that.pullCallbacks) === 0) {
        this.doingPull = false;
        return;
      }
      var web_id = that.pullCallbacks[0][0];
      var uuids = _.uniq(_.map(that.pullCallbacks, function (val) { return val[1]; }));

      if (!_.has(this.knownBlobs, web_id)) {
        this.knownBlobs[web_id] = {};
      }
      var knownWebBlobs = this.knownBlobs[web_id];

      uuids = _.filter(uuids, function (uuid) { return !_.has(knownWebBlobs, uuid); });
      mv.rpc("blobs", "get_blob_metadata", {"web_id" : +web_id, "uuids" : uuids},
             function (blobs) {
               // incorporate new data
               _.each(blobs, function (meta) {
                 that.addBlob(web_id, meta);
               });
               // do callbacks
               var oldPullCallbacks = that.pullCallbacks;
               that.pullCallbacks = [];
               _.each(oldPullCallbacks, function (val) {
                 var websBlobs = _.has(that.knownBlobs, val[0]) && that.knownBlobs[val[0]];
                 if (websBlobs && _.has(websBlobs, val[1])) {
                   val[2](websBlobs[val[1]]);
                 } else if (web_id === val[0] && _.contains(uuids, val[1])) {
                   // then there was no such blob.
                   val[2](undefined);
                 } else {
                   // didn't get the blob this round. try again.
                   that.pullCallbacks.push(val);
                 }
               });
               // housekeeping, maybe run again
               that.doingPull = false;
               if (_.size(that.pullCallbacks) > 0) {
                 that.pullBlobs();
               }
             },
             function () {
               _.delay(_.im(that, 'pullBlobs'), 5000);
             });
    },
    addBlob : function (web_id, meta) {
      if (!_.has(this.knownBlobs, web_id)) {
        this.knownBlobs[web_id] = {};
      }
      var knownWebBlobs = this.knownBlobs[web_id];
      var blob = knownWebBlobs[meta.blob.uuid];
      if (blob === undefined) {
        blob = _.create(_Blob, {
          uuid : meta.blob.uuid,
          date_created : new Date(meta.blob.date_created),
          editor_email : meta.blob.editor_email,
          content_type : meta.blob.content_type,
          summary : meta.blob.summary,
          content : meta.blob.content // might be undefined
        });
        knownWebBlobs[meta.blob.uuid] = blob;
      }
      blob.srels = _.map(meta.srels, _.im(this, 'makeRelation'));
      blob.orels = _.map(meta.orels, _.im(this, 'makeRelation'));
    },
    makeRelation : function (rel) {
      return _.create(_Relation, {
        uuid : rel.uuid,
        date_created : new Date(rel.date_created),
        name : rel.name,
				deleted : rel.deleted,
        subject : rel.subject,
        object : rel.object,
        payload : rel.payload
      });
    },
    getBlob : function (web_id, blob_uuid, callback, inhibitPull) {
      callback = callback || function () {};
      if (this.knownBlobs[web_id] !== undefined && this.knownBlobs[web_id][blob_uuid]) {
        callback(this.knownBlobs[web_id][blob_uuid]);
      } else {
        this.pullCallbacks.push([web_id, blob_uuid, callback]);
        if (!this.doingPull) {
          if (!inhibitPull) {
            _.defer(_.im(this, 'pullBlobs'));
          }
        }
      }
    },
    getBlobs : function (web_id, blob_uuids, callback) {
      callback = callback || function () {};
      function _callback (blob) {
        blobs.push(blob);
        callback(blobs);
      }
      var that = this;
      var blobs = [];
      if (_.size(blob_uuids) === 0) {
        callback(blobs);
      }
      callback = _.after(_.size(blob_uuids), callback);
      _.each(blob_uuids, function (uuid) {
        that.getBlob(web_id, uuid, _callback, true);
      });
      that.pullBlobs();
    },
		createBlob : function (web_id, content, mime_type, title, tags, revises, callback) {
			mv.rpc("blobs", "create_blob", {web_id : +web_id,
																			content : content,
																			mime_type : mime_type,
																			title : title,
																			tags : tags,
																			revises : revises
																		 },
						 function (uuid) {
							 callback(uuid);
						 });						 
		}
  });

  // The actual blob model
  mv.BlobModel = _.build(_BlobModel);


  // File uploads
  // ------------

  var _FileState = {
    name : undefined,
    size : undefined,
    progress : 0,
    done : false,
    error : false,
    aborted : false,
    uuid : undefined,
    jqXHR : undefined
  };

  var _FileUploadModel = _.create(_Model, {
    _init : function () {
      _Model._init.call(this);
      this.inProgress = {};
      this.numInProgress = 0;
      this.nextId = 1;
      this.addEventType("updated"); // when a file state is updated (file state is passed)
      this.addEventType("aborted"); // when a file upload is aborted (file_id is passed)
      this.addEventType("numChanged"); // when the number of uploading files changes (num is passed)
    },
    uploadFile : function (webId, file) {
      if (window.FormData === undefined) {
        alert("This browser doesn't have 'FormData'; file uploads are not implemented.");
        return;
      }
      var self = this;
      var fileId = this.nextId++;
      var state = _.create(_FileState, {
        id : fileId,
        name : file.name,
        size : file.size
      });
      this.inProgress[fileId] = state;
      this.numInProgress++;
      this.trigger("numChanged", this.numInProgress);
      var formData = new FormData();
      formData.append('files', file);
      formData.append('_xsrf', mv.getCookie('_xsrf'));
      state.jqXHR = $.ajax({
        url : "/upload/" + webId,
        type : "POST",
        data : formData,
        contentType : false,
        processData : false,
        cache : false,
        xhr : function () {
          function progressHandler(e) {
            if (!state.aborted) {
              state.progress = e.loaded/Math.max(1, e.total);
              self.trigger("updated", state);
            }
          }
          var myXhr = $.ajaxSettings.xhr();
          if (myXhr.upload) {
            myXhr.upload.addEventListener('progress', progressHandler, false);
          }
          return myXhr;
        },
        success : function (data) {
          if (state.aborted) {
            // kind of a weird state, but ignore!
            return;
          }
          state.progress = 1;
          state.done = true;
          state.error = false;
          state.uuid = data.uuids[0];
          self.numInProgress--;
          self.trigger("numChanged", self.numInProgress);
          self.trigger("updated", state);
        },
        error : function () {
          if (state.aborted) {
            return;
          }
          state.done = true;
          state.error = true;
          self.numInProgress--;
          self.trigger("numChanged", self.numInProgress);
          self.trigger("updated", state);
        }
      });
      self.trigger("updated", state);
    },
    // Aborts the upload.  It is ok to call this even when it's
    // not appropriate to abort.
    abortUpload : function (file_id) {
      var state = this.inProgress[file_id];
      if (state === undefined) {
        return;
      } else if (state.done || state.aborted) {
        state.aborted = true;
        return;
      }
      state.aborted = true;
      delete this.inProgress[file_id];
      state.jqXHR.abort();
      this.numInProgress--;
      this.trigger("numChanged", this.numInProgress);
      this.trigger("aborted", file_id);
    }
  });

  // The actual file model
  mv.FileUploadModel = _.build(_FileUploadModel);

  // Inbox model
  // -----------

  var _InboxModel = _.create(_Model, {
    _init : function () {
      _Model._init.call(this);
      this.currentInboxes = {};
      this.addEventType("updated"); // for when anything changes in the inbox (args: web)
      this.addEventType("added"); // for when a blob gets added (args: web,uuid)
      this.addEventType("removed"); // for when a blob gets removed (args: web,uuid)
      _.bindAll(this, 'InboxMessageHandler');
      mv.addMessageHandler('InboxMessage', this.InboxMessageHandler);
    },
    InboxMessageHandler : function (args) {
      var inbox = this.currentInboxes[args.web_id];
      if (inbox === undefined) {
        // we don't track this one yet, so no use modifying currentInboxes
        if (args.web_id == mv.WebModel.currentWebId) {
          this.pullInbox(mv.WebModel.currentWebId);
        }
        if (args.adding) {
          this.trigger("added", args.web_id, args.uuid);
        }
      } else {
        if (args.adding) {
          if (!_.has(inbox, args.uuid)) {
            inbox.push(args.uuid);
            this.trigger("added", args.web_id, args.uuid);
          }
        } else {
          this.currentInboxes[args.web_id] = _.without(inbox, args.uuid);
          this.trigger("removed", args.web_id, args.uuid);
        }
        this.trigger("updated", args.web_id);
      }
    },
    pullInbox : function (webid, callback) {
      var self = this;
      mv.rpc("inbox", "get_inbox", {"webid" : +webid},
             function (uuids) {
               if (uuids !== null) {
                 self.currentInboxes[webid] = uuids;
                 callback(self.currentInboxes[webid]);
                 self.trigger("updated", webid);
               }
             });
    },
    getInbox : function (webid, callback) {
      if (_.has(this.currentInboxes, webid)) {
        callback(this.currentInboxes[webid]);
      } else {
        this.pullInbox(webid, callback);
      }
    }
  });

  mv.InboxModel = _.build(_InboxModel);

  // other stuff
  // -----------

  var months = {
    0 : "Jan", 1 : "Feb", 2 : "Mar", 3 : "Apr", 4 : "May", 5 : "Jun",
    6 : "Jul", 7 : "Aug", 8 : "Sep", 9 : "Oct", 10 : "Nov", 11 : "Dec"};

  // Converts a date object into a short time string
  mv.shortTime = function (date, showTime) {
    function pad2(n) {
      var o = "0" + n;
      return o.substring(o.length-2);
    }
    var now = new Date();
    var h = date.getHours();
    var hs = h%12 == 0 ? 12 : h%12;
    var ampm = h < 12 ? "am" : "pm";
    var time = hs + ":" + pad2(date.getMinutes()) + " " + ampm;
    var cptime = showTime ? " " + time : "";
    if (date.getFullYear()  == now.getFullYear()) {
      if (date.getMonth() == now.getMonth()
          && (date.getDate() == now.getDate()
             || (date.getDate() + 1 == now.getDate()
                && now.getHours() < 12
                && date.getHours() + date.getMinutes()/60 > 12))) {
        return time;
      } else {
        return months[date.getMonth()] + ' ' + date.getDate() + cptime;
      }
    } else {
      return (date.getMonth() + 1) + "/" + pad2(date.getDate()) + "/" + pad2(date.getFullYear() % 100) + cptime;
    }
  };

  // Converts a filesize (in bytes) to a sensible size description

  mv.sensibleSize = function (size) {
    size = parseInt(size);
    var sensibleSize;
    if (size < 1024/10) {
      sensibleSize = size + " B";
    } else if (size < 1024*1024/10) {
      sensibleSize = (size/1024).toPrecision(2) + " kB";
    } else {
      sensibleSize = (size/1024/1024).toPrecision(2) + " MB";
    }
  };

  return mv;
})(window.my || {}, jQuery);

