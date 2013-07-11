// mv.js
// main javascript for metaview

"use strict";

// Stuff to make dealing with javascript better
// --------------------------------------------

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

    // The id of the polling channel for this client
    mv.channel_id = undefined;

    // Makes a long polling loop. Calls 'handler' on any list of
    // messages which come by, else calls 'onError' with an error
    // message.
    mv.longPollDriver = function (handler, onError) {
        if (_.isUndefined(mv.channel_id)) {
            throw new TypeError("longPollDriver needs mv.channel_id to be set");
        }
        var _xsrf = mv.getCookie("_xsrf");
        onError = onError || function() {};
        function loop() {
            $.ajax({url : "/ajax/poll",
                    type : "POST",
                    dataType : "json",
                    data : {_xsrf : _xsrf,
                            channel_id : mv.channel_id},
                    success : function (data) {
                        if ("messages" in data) {
                            handler(data["messages"]);
                            loop();
                        } else {
                            if (onError(data["error"])) {
                                _.delay(loop, 500);
                            }
                        }
                    },
                    error : function (jqXHR, textStatus, errorThrown) {
                        if (textStatus == "timeout") {
                            loop();
                        } else {
                            console.log("Long polling error: " + textStatus);
                            if (onError(textStatus)) {
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
        onError = onError || function(err, exc) {console.log("rpc error: " + err + "\n" + exc);};
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
            args.push(this);
            _.each(this.eventHandlers[name], function(handler) {
                handler.apply(undefined, args);
            });
        }
    };


    // Webs
    // ----

    var _WebModel = _.create(_Model, {
        _init : function() {
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
        pullWebs : function() {
            var self = this;
            mv.rpc("webs", "get_webs", {},
                   function (webs) {
                       self.knownWebs = webs;
                       if (_.size(webs) == 1) { // there is only one option! no need for fancy stuff
                           self.currentWeb = _.first(_.keys(webs));
                       }
                       if (self.currentWeb === undefined && mv.getCookie("default_web_id")) {
                           var web_id = mv.getCookie("default_web_id");
                           if (_.has(self.knownWebs, web_id)) {
                               self.currentWeb = web_id;
                           }
                       }
                       self.triggerEvent("updated");
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
            mv.rpc("webs", "rename_web", {id : this.currentWeb, newwebname : newwebname},
                   callback);
        }
    });

    // The actual web model
    mv.WebModel = _.build(_WebModel);

    mv.parseHashUrl = function () {
        var hash = $(window.location).attr('hash');
    };

    // dealing with inbox
    mv.current_inbox = [];
    mv.addMessageHandler("InboxMessage", function(args) {
        if (args.adding) {
            if (!_.contains(mv.current_inbox, args.uuid)) {
                mv.current_inbox.push(args.uuid)
            }
        } else {
            mv.remove(args.uuid);
        }
    });

    return mv;
})(window.my || {}, jQuery);


// stuff to tie into the DOM

jQuery(function ($) {
    mv.channel_id = $('#poll_info_form').find('input[name="channel_id"]').val();

    function errorHandler(error) {
        $("#polldest").append("<div><em>error: "+error+"</em></div>");
        return false;
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

    mv.WebModel.addEventHandler(["updated", "deselected"], function (model) {
        var el = $("#current_web_selector");
        el.empty();
        if (model.currentWeb === undefined) {
            el.append($("<option/>").attr("value", -1).text("-- web --"));
        }
        _.each(model.knownWebs, function (value, key) {
            var opt = $("<option/>").attr("value", key).text(value);
            if (value == mv.currentWeb) {
                opt.attr("selected", true);
            }
            el.append(opt);
        });
    });

    $("#current_web_selector").change(function () {
        mv.WebModel.setCurrentWeb(this.value);
    });
    mv.WebModel.addEventHandler("selected", function (model) {
        if (model.currentWeb !== undefined) {
            $("#current_web_selector").find("[value='-1']").remove();
            $("#current_web_selector").val(model.currentWeb);
        }
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

    // dealing with file uploads

    if (FormData) {
        $("#fileupload").find('input[type="submit"]').hide();
    }
    $.widget("mv.fileUploadBar", {
        options : {
            filename : "(no name)",
            progress : 0,
            done : false,
            error : false,
            finishToken : undefined,
        },
        _create : function() {
            this.element.addClass("fileUploadBar");
            this.element.append($("<span>").text(this.options["filename"]));
            $("<progress/>").appendTo(this.element).attr("max", 100);
            this._update();
        },
        _update : function() {
            if (this.options.done) {
                this.element.empty();
                this.element.append($("<span>").text(this.options["filename"]));
                if (this.options.error) {
                    this.element.append($("<span>").text("Upload error"));
                } else {
                    this.element.append($("<span>").text(this.options.finishToken));
                }
            } else {
                this.element.find("progress").val(this.options["progress"]);
            }
        },
        value : function(v) {
            if (v === undefined) {
                return this.options.progress;
            } else {
                this.options.progress = v;
                this._update();
            }
        },
        finish : function(token) {
            this.options.done = true;
            this.options.error = false;
            this.options.finishToken = token;
            this._update();
        },
        error : function() {
            this.options.done = true;
            this.options.error = true;
            this._update();
        }
    });
    function uploadFile(file) {
        var progress = $("<div/>").appendTo("#file_upload_notification").fileUploadBar({filename : file.name});
        var formData = new FormData();
        formData.append('files', file);
        formData.append('_xsrf', mv.getCookie("_xsrf"));
        $.ajax({url : "/upload/" + mv.current_web,
                type : "POST",
                data : formData,
                contentType : false,
                processData : false,
                cache : false,
                xhr : function() {
                    function progressHandler (e) {
                        progress.fileUploadBar("value", Math.round(100*e.loaded/Math.max(1, e.total)));
                    }
                    var myXhr = $.ajaxSettings.xhr();
                    if (myXhr.upload) {
                        myXhr.upload.addEventListener('progress', progressHandler, false);
                    }
                    return myXhr;
                },
                success : function (data) {
                    progress.fileUploadBar("finish", data.uuids[0]);
                },
                error : function (data) {
                    progress.fileUploadBar("error");
                }
               });
    }
    $("#fileupload").find(":file").change(function () {
        if (mv.current_web === undefined) {
            alert("Select a web first");
            $('#fileupload').find(":file").val('');
            return;
        } 
        if (!$('#fileupload').find(":file").val()) {
            return;
        }
        var files = $('#fileupload').find(":file")[0].files;
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            uploadFile(file);
        }
        $("#fileupload").find(":file").val('');

    });


    mv.parseHashUrl();
});
