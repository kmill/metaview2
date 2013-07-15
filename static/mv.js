// mv.js
// main javascript for metaview

"use strict";

// Stuff to make dealing with javascript better
// --------------------------------------------

if (window.console === undefined) {
    console = { log: function () {} };
}

_.mixin({
    // Creates a new object from a prototype, extending the new object
    // with the optional 'props' argument.
    create : function (o, props) {
        function F() { _.extend(this, props); }
        F.prototype = o;
        return new F();
    },
    // Creates a new object, calling '_init' with the passed-in arguments.
    build : function (o) {
        var args = _.rest(arguments, 1);
        var newobj = _.create(o);
        (newobj._init || function() {}).apply(newobj, args);
        return newobj;
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


    // Makes a long polling loop. Calls 'handler' on any list of
    // messages which come by, else calls 'onError' with an error
    // message.
    mv.longPollDriver = function (handler, onError) {
        if (mv.Connection === undefined || mv.Connection.channel_id === undefined) {
            throw new TypeError("longPollDriver needs mv.Connection.channel_id to be set");
        }
        var _xsrf = mv.getCookie("_xsrf");
        onError = onError || function() {};
        function loop() {
            $.ajax({url : "/ajax/poll",
                    type : "POST",
                    dataType : "json",
                    data : {_xsrf : _xsrf,
                            channel_id : mv.Connection.channel_id},
                    success : function (data) {
                        if ("messages" in data) {
                            handler(data["messages"]);
                            loop();
                        } else {
                            if (data.error == "no such channel") {
                                mv.Connection.triggerEvent("badChannel");
                            }
                            if (onError(data["error"])) {
                                _.delay(loop, 500);
                            }
                        }
                    },
                    error : function (jqXHR, textStatus, errorThrown) {
                        if (textStatus == "timeout") {
                            loop();
                        } else {
                            console.log("Long polling error: " + textStatus + " (" + errorThrown + ")");
                            if (textStatus == "error" && errorThrown == "Forbidden") {
                                mv.Connection.triggerEvent("badChannel");
                            }
                            if (onError(textStatus, errorThrown)) {
                                _.delay(loop, 2000);
                            }
                        }
                    }
                   });
        }
        loop();
    };

    mv.messageHandlers = {};

    // Adds a message handler for a particular message type
    // 'name'. There can be any number of handlers for any message
    // type.
    mv.addMessageHandler = function (name, func) {
        if (!_.has(mv.messageHandlers, name)) {
            mv.messageHandlers[name] = [];
        }
        mv.messageHandlers[name].push(func);
    };
    // Starts a long poll which calls message handlers on each message
    // which comes by.  Uses mv.longPollDriver to do this, and the
    // 'onError' callback is passed right on to it.
    mv.longPoll = function (onError) {
        mv.longPollDriver(
            function (messages) {
                _(messages).each(function(message) {
                    if (_.has(mv.messageHandlers, message["type"])) {
                        _(mv.messageHandlers[message["type"]]).each(function (handler) {
                            handler(message["args"]);
                        });
                    } else {
                        console.log("Unknown message type: " + message["type"]);
                    }
                });
            },
            onError);
    };

    // Asynchronously calls module/method with a given dictionary of
    // args on the server.  The callback 'onSuccess' gets the return
    // value, and 'onError' gets an error and an exception (whatever
    // those mean).
    mv.rpc = function(module, method, args, onSuccess, onError) {
        var _xsrf = mv.getCookie("_xsrf");
        onSuccess = onSuccess || function() {};
        onError = onError || function(err, exc) {console.log("rpc error: " + err + "\n" + JSON.stringify(exc));};
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
    
    // Models
    // ------

    // Prototype for models (as in MVC models).
    var _Model = {
        _init : function () {
            this.eventHandlers = {};
        },
        // Adds a type of event which can be handled.
        addEventType : function(name) {
            this.eventHandlers[name] = [];
        },
        // Register an event handler for a particular event name in this model.
        addEventHandler : function (name, func) {
            if (_.isArray(name)) {
                var self = this;
                _.each(name, function (n) { self.addEventHandler(n, func); });
            } else if (!_.has(this.eventHandlers, name)) {
                throw new TypeError("Event handler type not declared: " + name);
            } else {
                this.eventHandlers[name].push(func);
            }
        },
        // Triggers an event with some arguments.
        triggerEvent : function (name) {
            var args = _.rest(arguments, 1);
            args.unshift(this);
            _.each(this.eventHandlers[name], function(handler) {
                handler.apply(undefined, args);
            });
        }
    };

    // Connection
    // ----------

    // this should be restructured with long polling, but I just want
    // to get the interface right first.
    var _Connection = _.create(_Model, {
        _init : function (channel_id) {
            _Model._init.call(this);
            this.channel_id = channel_id; // The id of the polling channel for this client
            this.addEventType("badChannel"); // when the channel id isn't right.
        }
    });

    mv.initConnection = function (channel_id) {
        mv.Connection = _.build(_Connection, channel_id);
    };

    // Webs
    // ----

    var _WebModel = _.create(_Model, {
        _init : function () {
            _Model._init.call(this);
            this.knownWebs = {};
            this.currentWeb = undefined;
            this.addEventType("updated"); // when knownWebs is generally updated
            this.addEventType("deselected"); // when currentWeb ends up pointing to nothing
            this.addEventType("selected"); // when currentWeb is changed
            _.bindAll(this, 'WebChangeMessageHandler');
            mv.addMessageHandler("WebChangeMessage", this.WebChangeMessageHandler);

            this.pullWebs();
        },
        WebChangeMessageHandler : function(args) {
            if (args.web_name) {
                this.knownWebs[args.web_id] = args.web_name;
            } else {
                delete this.knownWebs[args.web_id];
                if (args.web_id === this.currentWeb) {
                    this.currentWeb = undefined;
                    this.triggerEvent("deselected");
                }
            }
            this.triggerEvent("updated");
        },
        // Asks the server for all of the webs
        pullWebs : function () {
            var self = this;
            mv.rpc("webs", "get_webs", {},
                   function (webs) {
                       self.knownWebs = webs;
                       var selected = false;
                       if (_.size(webs) == 1) { // there is only one option! no need for fancy stuff
                           self.currentWeb = _.first(_.keys(webs));
                           selected = true;
                       }
                       if (self.currentWeb === undefined) {
                           var web = mv.parseHashUrl().web;
                           self.currentWeb = self.getWebIdFromName(web); // sets undefined if no such web
                           if (self.currentWeb !== undefined) {
                               selected = true;
                           }
                       }
                       if (self.currentWeb === undefined && mv.getCookie("default_web_id")) {
                           var web_id = mv.getCookie("default_web_id");
                           if (_.has(self.knownWebs, web_id)) {
                               self.currentWeb = web_id;
                               selected = true;
                           }
                       }
                       self.triggerEvent("updated");
                       if (selected && self.currentWeb) {
                           self.triggerEvent("selected");
                       }
                   });
        },
        // Set the current web
        setCurrentWeb : function (web_id) {
            if (this.currentWeb == web_id) {
                return;
            }
            if (!_.has(this.knownWebs, web_id)) {
                throw new TypeError("Not a web id");
            }
            this.currentWeb = web_id;
            mv.rpc("webs", "set_default_web", {"web_id" : web_id});
            this.triggerEvent("selected");
        },
        // Add a web
        addWeb : function (webname, callback) {
            mv.rpc("webs", "create_web", {webname : webname}, callback);
        },
        // Rename a web
        renameWeb : function (webid, newwebname, callback) {
            mv.rpc("webs", "rename_web", {id : webid, newwebname : newwebname},
                   callback);
        },
        // Get by name
        getWebIdFromName : function(name) {
            return _.invert(this.knownWebs)[name];
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
        },
    }
    var _UserModel = _.create(_Model, {
        _init : function () {
            _Model._init.call(this);
            this.knownUsers = {}; // email -> User
            this.addEventType("updated"); // when knownUsers is generally updated
            this.pullUsers();
        },
        pullUsers : function () {
            var self = this;
            mv.rpc("users", "get_users", {},
                   function (users) {
                       self.knownUsers = {};
                       _.each(users, function (user) {
                           self.knownUsers[user.email] = _.create(_User, {
                               email : user.email,
                               first_name : user.first_name,
                               last_name : user.last_name,
                           });
                       });
                       self.triggerEvent("updated");
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
    };
    // Prototype for a single relation
    var _Relation = {
        blob : undefined,
        type : undefined,
        subject : undefined,
        payload : undefined
    };

    var _BlobModel = _.create(_Model, {
        _init : function () {
            _Model._init.call(this);
            this.knownBlobs = {};
            this.relationsFromSubject = {};
            this.relationsFromObject = {};
            this.relationTypes = {};
            this.addEventType("updated"); // for when the known blobs have changed
        },
        pullBlobs : function (web_id, uuids) {
            if (!_.has(this.knownBlobs, web_id)) {
                this.knownBlobs[web_id] = {};
            }
            var knownWebBlobs = this.knownBlobs[web_id];
            uuids = _.filter(uuids, function (uuid) { return !_.has(knownWebBlobs, uuid); });
            var self = this;
            mv.rpc("blobs", "get_blob_metadata", {"web_id" : web_id, "uuids" : uuids},
                   function (blobs) {
                       _.each(blobs, function (b) {
                           var blob = knownWebBlobs[b.uuid];
                           if (blob === undefined) {
                               blob = _.create(_Blob, {
                                   uuid : b.uuid,
                                   date_created : new Date(b.date_created),
                                   editor_email : b.editor_email,
                                   content_type : b.content_type,
                                   content : b.content, // might be undefined
                               });
                               knownWebBlobs[b.uuid] = blob;
                               if (blob.content_type.substring(0, 9) == "relation:") {
                                   self.addRelation(web_id, blob);
                               }
                               _.defer(function () {
                                   self.triggerEvent("updated", web_id, b.uuid);
                               });
                           }
                       });
                   });
        },
        addRelation : function (web_id, r) {
            this.relationsFromSubject[web_id] = this.relationsFromSubject[web_id] || {};
            this.relationsFromObject[web_id] = this.relationsFromObject[web_id] || {};
            var parts = r.content.split("\n", 2);
            var rel = _.create(_Relation, {
                blob : r,
                type : r.content_type.substring(9), // remove "relation:"
                subject : parts[0],
                payload : parts[1]
            });
            this.relationsFromSubject[web_id][rel.subject] = this.relationsFromSubject[web_id][rel.subject] || [];
            this.relationsFromSubject[web_id][rel.subject].push(rel);
            if (rel.payload != undefined
                && this.relationTypes[rel.type] !== undefined
                && this.relationTypes[rel.type].has_object) {
                this.relationsFromObject[web_id][rel.payload] = this.relationsFromObject[web_id][rel.payload] || [];
                this.relationsFromObject[web_id][rel.payload] = rel;
            }
        },
        getBlob : function (web_id, blob_uuid) {
            if (this.knownBlobs[web_id] !== undefined) {
                return this.knownBlobs[web_id][blob_uuid];
            } else {
                return undefined;
            }
        },
        getRelationsForSubject : function (web_id, blob_uuid) {
            if (this.relationsFromSubject[web_id] !== undefined) {
                return this.relationsFromSubject[web_id][blob_uuid] || [];
            } else {
                return [];
            }
        },
        getRelationsForObject : function (web_id, blob_uuid) {
            if (this.relationsFromObject[web_id] !== undefined) {
                return this.relationsFromObject[web_id][blob_uuid] || [];
            } else {
                return [];
            }
        },
    });

    // The actual blob model
    mv.BlobModel = _.build(_BlobModel);

    // Relations
    // ---------

    mv.RelationDef = {
        has_object : false
    }

    mv.BlobModel.relationTypes["in-reply-to"] = _.create(mv.RelationDef, {has_object : true});


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
    }

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
            this.triggerEvent("numChanged", this.numInProgress);
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
                    function progressHandler (e) {
                        if (!state.aborted) {
                            state.progress = e.loaded/Math.max(1, e.total);
                            self.triggerEvent("updated", state);
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
                    self.triggerEvent("numChanged", self.numInProgress);
                    self.triggerEvent("updated", state);
                },
                error : function () {
                    if (state.aborted) {
                        return;
                    }
                    state.done = true;
                    state.error = true;
                    self.numInProgress--;
                    self.triggerEvent("numChanged", self.numInProgress);
                    self.triggerEvent("updated", state);
                }
            });
            self.triggerEvent("updated", state);
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
            this.triggerEvent("numChanged", this.numInProgress);
            this.triggerEvent("aborted", file_id);
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
                if (args.web_id == mv.WebModel.currentWeb) {
                    this.pullInbox(mv.WebModel.currentWeb);
                }
                if (args.adding) {
                    this.triggerEvent("added", args.web_id, args.uuid);
                }
            } else {
                if (args.adding) {
                    if (!_.has(inbox, args.uuid)) {
                        inbox.push(args.uuid);
                        this.triggerEvent("added", args.web_id, args.uuid);
                    }
                    mv.BlobModel.pullBlobs(args.web_id, [args.uuid]);
                } else {
                    this.currentInboxes[args.web_id] = _.without(inbox, args.uuid);
                    this.triggerEvent("removed", args.web_id, args.uuid);
                }
                this.triggerEvent("updated", args.web_id);
            }
        },
        pullInbox : function (webid) {
            var self = this;
            mv.rpc("inbox", "get_inbox", {"webid" : webid},
                   function (uuids) {
                       if (uuids !== null) {
                           self.currentInboxes[webid] = uuids;
                           mv.BlobModel.pullBlobs(webid, uuids);
                           self.triggerEvent("updated", webid);
                       }
                   });
        }
    });

    mv.InboxModel = _.build(_InboxModel);

    mv.WebModel.addEventHandler("selected", function (model) {
        if (model.currentWeb === undefined) {
            return;
        } else if (mv.InboxModel.currentInboxes[model.currentWeb] === undefined) {
            mv.InboxModel.pullInbox(model.currentWeb);
        }
    });

    // other stuff
    // -----------

    mv.parseHashUrl = function () {
        var hash = $(window.location).attr('hash').substr(1);
        var parsed = {};
        _.each(hash.split("&"), function(part) {
            if (part == "") { return; }
            var subparts = part.split("=", 2);
            if (subparts.length == 1) {
                parsed["web"] = decodeURIComponent(subparts[0]);
            } else {
                parsed[subparts[0]] = decodeURIComponent(subparts[1]);
            }
        });
        return parsed;
    };

    var months = {
        0 : "Jan", 1 : "Feb", 2 : "Mar", 3 : "Apr", 4 : "May", 5 : "Jun",
        6 : "Jul", 7 : "Aug", 8 : "Sep", 9 : "Oct", 10 : "Nov", 11 : "Dec"};
    mv.shortTime = function (date) {
        function pad2(n) {
            var o = "0" + n;
            return o.substring(o.length-2);
        }
        var now = new Date();
        if (date.getFullYear()  == now.getFullYear()) {
            if (date.getMonth() == now.getMonth() && date.getDate() == now.getDate()) {
                var h = date.getHours();
                var hs = h%12 == 0 ? 12 : h%12;
                var ampm = h < 12 ? "am" : "pm";
                return hs + ":" + pad2(date.getMinutes()) + " " + ampm;
            } else {
                return months[date.getMonth()] + ' ' + (1 + date.getDate());
            }
        } else {
            return date.getMonth() + "/" + pad2(1 + date.getDate()) + "/" + pad2(date.getFullYear() % 100);
        }
    };

    return mv;
})(window.my || {}, jQuery);


// stuff to tie into the DOM

jQuery(function ($) {
    mv.initConnection($('#poll_info_form').find('input[name="channel_id"]').val());

    mv.Connection.addEventHandler("badChannel", function () {
        window.location.reload();
    });

    function errorHandler(error) {
        $("#polldest").append("<div><em>error: "+error+"</em></div>");
        return true;
    }

    mv.addMessageHandler("TextMessage", function(args) {
        $("#polldest").append("<div>" + args["user"] + ": " + args["m"] + "</div>");
    });

    mv.longPoll(errorHandler);

    $('#test_form').submit(function(e) {
        mv.rpc("test", "hello", {"m" : $('#test_form').find('input[name="m"]').val()},
               function (res) {
                   $("#polldest").append("<div>rpc returned: " + res + "</div>");
               },
               function (err,exc) {
                   $("#polldest").append("<div>rpc error! " + err + ", " + JSON.stringify(exc) + "</div>");
               });
        return false;
    });

    window.onhashchange = function () {
        mv.WebModel.currentWeb = undefined;
        mv.WebModel.pullWebs();
    };

    mv.WebModel.addEventHandler(["updated", "selected", "deselected"], function (model) {
        if (model.currentWeb === undefined) {
            var webname = "(no web)";
        } else {
            var webname = model.knownWebs[model.currentWeb];
        }
        $("[data-webname]").text(webname);
        $('#rename_web_form [name="newwebname"]').val(webname);
        redrawInbox(model.currentWeb);
    });

    mv.WebModel.addEventHandler(["updated", "deselected"], function (model) {
        var el = $("#web_selector");
        el.empty();
        if (model.currentWeb === undefined) {
            //el.append($("<option/>").attr("value", -1).text("-- web --"));
        }
        _.each(model.knownWebs, function (value, key) {
            var opt = $("<a/>").attr("href", "#" + value).text(value);
            var edit = $("<a/>").attr("href", "#").addClass("webEditButton").text("edit");
            var li = $("<li/>").append(edit).append(opt);
            el.append(li);
            opt.on("click", function() {
                mv.WebModel.setCurrentWeb(key);
            });
            edit.on("click", function() {
                var newwebname = prompt("New name for the web", value);
                if (newwebname) {
                    mv.WebModel.renameWeb(key, newwebname,
                                          function (res) {
                                              if (!res) {
                                                  alert("There is already a web with that name.");
                                              }
                                          });
                }
                return false;
            });
        });
    });

    $("#add_web").click(function () {
        var webname = prompt("Name for a new web");
        mv.WebModel.addWeb(webname,
                           function (res) {
                               if (!res) {
                                   alert("There is already a web with that name.");
                               }
                           });
        return false;
    });
    $("#rename_web").click(function () {
        if (mv.WebModel.currentWeb === undefined) {
            alert("Select a web to rename first.");
        } else {
            var webname = prompt("Name for a new web");
            mv.WebModel.renameWeb(mv.WebModel.currentWeb, webname,
                                  function (res) {
                                      if (!res) {
                                          alert("There is already a web with that name.");
                                      }
                                  });
        }
        return false;
    });

    mv.UserModel.addEventHandler("updated", function () {
        $("div[data-avatar]").each(function () {
            var $d = $(this);
            $d.empty();
            var user = mv.UserModel.knownUsers[$d.attr("data-avatar")];
            if (user !== undefined) {
                $d.append($("<img/>").attr("src", user.avatarUrl()));
            }
        });
    });

    // dealing with file uploads

    var fileProgressBars = {};

    mv.FileUploadModel.addEventHandler("numChanged", function (model, num) {
        if (num) {
            $("[data-num-uploads]").text("(" + num + ")");
        } else {
            $("[data-num-uploads]").text("");
        }
    });

    mv.FileUploadModel.addEventHandler("updated", function (model, fileState) {
        if (fileState.aborted) {
            return;
        }
        console.log("updated " + fileState.id);
        var progress;
        if (!_.has(fileProgressBars, fileState.id)) {
            progress = $("<div/>").prependTo("#file_upload_notifications").fileUploadBar({
                fileState : fileState,
                stopped : function (file_id) {
                    mv.FileUploadModel.abortUpload(fileState.id);
                    delete fileProgressBars[fileState.id];
                    progress.remove();
                }
            });
            fileProgressBars[fileState.id] = progress;
        } else {
            progress = fileProgressBars[fileState.id];
        }
        progress.fileUploadBar("filestate", fileState);
    });
    $("#fileupload").find('input[type="submit"]').hide();

    $.widget("mv.fileUploadBar", {
        options : {
            fileState : undefined
        },
        _create : function() {
            this.element.addClass("fileUploadBar");
            this.element.append($("<div/>").addClass("fileUploadFilename"));
            this.element.append($("<div/>").addClass("fileUploadSize"));
            $("<progress/>").appendTo(this.element).attr("max", 100);
            this.element.append($("<div/>").addClass("fileUploadPercent"));
            this.element.append($("<div/>").addClass("fileUploadError").text("Upload error"));
            this.element.append($("<div/>").addClass("fileUploadUuid"));
            var stopButton = $("<a/>").attr("href", "#").text("X");
            var self = this;
            stopButton.on("click", function () {
                self._trigger("stopped", null, {fileId : self.options.fileState.id});
            });
            this.element.append($("<div/>").addClass("fileUploadRemove").append(stopButton));
            this._update();
        },
        _update : function () {
            this.element.find(".fileUploadFilename").text(this.options.fileState.name).attr("title", this.options.fileState.name);
            var size = this.options.fileState.size;
            var sensibleSize;
            if (size < 1024/10) {
                sensibleSize = size + " B";
            } else if (size < 1024*1024/10) {
                sensibleSize = (size/1024).toPrecision(2) + " kB";
            } else {
                sensibleSize = (size/1024/1024).toPrecision(2) + " MB";
            }
            this.element.find(".fileUploadSize").text(sensibleSize);
            var percentage = Math.round(this.options.fileState.progress*100);
            if (percentage == 100) {
                //indeterminate
                this.element.find("progress").toggle(!this.options.fileState.done).removeAttr("value");
            } else {
                this.element.find("progress").toggle(!this.options.fileState.done).val(percentage);
            }
            this.element.find(".fileUploadPercent").toggle(!this.options.fileState.done).text(percentage+"%");
            this.element.find(".fileUploadError").toggle(this.options.fileState.error);
            this.element.find(".fileUploadUuid").toggle(this.options.fileState.done).text(this.options.fileState.uuid);
        },
        filestate : function (fileState) {
            if (fileState === undefined) {
                return this.options.fileState;
            } else {
                this.options.fileState = fileState;
                this._update();
            }
        }
    });
    $("#fileupload").find(":file").change(function () {
        if (mv.WebModel.currentWeb === undefined) {
            alert("Select a web first");
            $('#fileupload').find(":file").val('');
            return;
        } 
        if (!$('#fileupload').find(":file").val()) {
            return;
        }
        _.each($('#fileupload').find(":file")[0].files, function (file) {
            mv.FileUploadModel.uploadFile(mv.WebModel.currentWeb, file);
        });
        $("#fileupload").find(":file").val('');
    });

    function redrawInbox (web_id) {
        var el = $("#inbox");
        el.empty();
        $("<h2/>").text("Inbox for " + mv.WebModel.knownWebs[web_id]).appendTo(el);
        _.each(mv.InboxModel.currentInboxes[web_id], function (uuid) {
            var p = $("<p/>").attr("data-blob-webid", web_id).attr("data-blob-uuid", uuid).text("loading...").appendTo(el);
        });
        updateBlobElements();
    }
    
    mv.InboxModel.addEventHandler("updated", function (model, web_id) {
        redrawInbox(web_id);
    });

    mv.BlobModel.addEventHandler("updated", function (model, web_id, blob_id) {
        updateBlobElements();
    });
    //mv.UserModel.addEventHandler("updated", function (model) {
    //updateBlobElements();
    //});

    function updateBlobElements () {
        $("[data-blob-uuid]").each(function () {
            drawBlob(this);
        });
    }

    function drawBlob (e) {
        e = $(e);
        var web_id = e.attr("data-blob-webid");
        var uuid = e.attr("data-blob-uuid");
        var blob = mv.BlobModel.getBlob(web_id, uuid);
        if (blob !== undefined) {
            var srels = mv.BlobModel.getRelationsForSubject(web_id, uuid);
            var filename = uuid;
            _.each(srels, function (rel) {
                if (rel.type == "filename") {
                    filename = rel.payload || filename;
                }
            });
            var url = "/blob/" + uuid;
            if (filename != uuid) {
                url += "/" + filename;
            }
            e.empty();
            var editor = mv.UserModel.knownUsers[blob.editor_email];
            var editor_name = (editor !== undefined && editor.first_name) || blob.editor_email;
            e.append($("<span/>").text(editor_name));
            e.append(" | ");
            e.append($("<a/>").attr("href", url).attr("target", "_blank").text(filename));
            e.append(" ");
            e.append($("<span/>").text(mv.shortTime(blob.date_created)));
        }
    }
    

});
