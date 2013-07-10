// mv.js
// main javascript for metaview

var mv = (function(mv, $) {
    // main stuff to talk to server
    mv.poll_info_form = "#poll_info_form";
    mv.getCookie = function (name) {
        var r = document.cookie.match("\\b" + name + "=([^;]*)\\b");
        return r ? r[1] : undefined;
    };
    mv.longPollDriver = function (handler, onError) {
        var _xsrf = mv.getCookie("_xsrf");
        var channel_id = mv.getChannelId();
        onError = onError || function() {};
        function loop() {
            $.ajax({url : "/ajax/poll",
                    type : "POST",
                    dataType : "json",
                    data : {_xsrf : _xsrf, channel_id : channel_id},
                    success : function (data) {
                        if ("messages" in data) {
                            handler(data["messages"]);
                            loop();
                        } else {
                            if (onError(data["error"])) {
                                window.setTimeout(loop, 500);
                            }
                        }
                    },
                    error : function (jqXHR, textStatus, errorThrown) {
                        if (textStatus == "timeout") {
                            loop();
                        } else {
                            console.log("Long polling error: " + textStatus);
                            if (onError(textStatus)) {
                                window.setTimeout(loop, 2000);
                            }
                        }
                    }
                   });
        }
        loop();
    };
    mv.messageHandlers = {};
    mv.addMessageHandler = function (name, func) {
        if (!(name in mv.messageHandlers)) {
            mv.messageHandlers[name] = [];
        }
        mv.messageHandlers[name].push(func);
    };
    mv.longPoll = function (onError) {
        mv.longPollDriver(
            function (messages) {
                for (var i = 0; i < messages.length; i++) {
                    message = messages[i];
                    if (message["type"] in mv.messageHandlers) {
                        handlers = mv.messageHandlers[message["type"]];
                        for (var j = 0; j < handlers.length; j++) {
                            handlers[j](message["args"]);
                        }
                    } else {
                        console.log("Unknown message type: " + message["type"]);
                    }
                }
            },
            onError);
    };
    mv.getChannelId = function () {
        return $(mv.poll_info_form).find('input[name="channel_id"]').val();
    };

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

    // dealing with webs
    mv.knownWebs = {};
    mv.webUpdateHandler = function (knownWebs) {};
    mv.addMessageHandler("WebChangeMessage", function(args) {
        if (args["web_name"]) {
            mv.knownWebs[args["web_id"]] = args["web_name"];
        } else {
            delete mv.knownWebs[args["web_id"]];
        }
        console.log(args["web_id"]);
        mv.webUpdateHandler(mv.knownWebs);
    });
    mv.forceUpdateWebs = function() {
        mv.rpc("webs", "get_webs", {},
               function (webs) {
                   mv.knownWebs = webs;
                   mv.webUpdateHandler(mv.knownWebs);
                   if (mv.current_web == undefined && mv.getCookie("default_web_id")) {
                       var web_id = parseInt(mv.getCookie("default_web_id"));
                       if (web_id in mv.knownWebs) {
                           mv.setCurrentWeb(web_id);
                       }
                   }
               });
    };
    mv.current_web = undefined;
    mv.currentWebUpdateHandlers = [];
    mv.setCurrentWeb = function (web_id) {
        mv.current_web = web_id;
        for (var i = 0; i < mv.currentWebUpdateHandlers.length; i++) {
            mv.currentWebUpdateHandlers[i]();
        }
    };

    mv.parseHashUrl = function () {
        var hash = $(window.location).attr('hash');
    };

    return mv;
})(window.my || {}, jQuery);

jQuery(function ($) {
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

    mv.webUpdateHandler = function (knownWebs) {
        var el = $("#current_web_selector");
        el.empty();
        if (mv.current_web == undefined) {
            el.append($("<option></option>").attr("value", -1).text("-- web --"));
        }
        $.each(knownWebs, function(key, value) {
            var opt = $("<option></option>").attr("value", key).text(value);
            if (value == mv.current_web) {
                opt.attr("selected", true);
            }
            el.append(opt);
        });
    };
    $("#current_web_selector").change(function () {
        var web_id = parseInt(this.value);
        mv.setCurrentWeb(web_id);
        mv.rpc("webs", "set_default_web", {"web_id" : web_id});
    });
    mv.currentWebUpdateHandlers.push(function() {
        if ($("#current_web_selector").val() != mv.current_web) {
            $("#current_web_selector").val(mv.current_web);
        }
    });
    $("#add_web").click(function () {
        var webname = prompt("Name for a new web");
        mv.rpc("webs", "create_web", {webname : webname},
               function (res) {
                   if (!res) {
                       alert("There is already a web with that name.");
                   }
               });
        return false;
    });
    $("#rename_web").click(function () {
        if (mv.current_web == undefined) {
            alert("Select a web to rename first.");
        } else {
            var webname = prompt("Name for a new web");
            mv.rpc("webs", "rename_web", {id : mv.current_web, newwebname : webname},
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
    $("#fileupload").find(":file").change(function () {
        if (!$('#fileupload').find(":file").val()) {
            return;
        }
        function fileProgressHandler(e) {
            $("#file_upload_notification").text(Math.round(100*e.loaded/e.total) + "% uploaded");
        }
        var formData = new FormData($("#fileupload")[0]);
        $.ajax({
            url: "/upload/" + mv.current_web + "?_xsrf=" + mv.getCookie("_xsrf"),
            type: "POST",
            xhr: function() {
                var myXhr = $.ajaxSettings.xhr();
                if (myXhr.upload) {
                    myXhr.upload.addEventListener('progress', fileProgressHandler, false);
                }
                return myXhr;
            },
            success : function(data) {
                $('#fileupload').find(":file").val('');
                $("#file_upload_notification").text(JSON.stringify(data));
            },
            error : function() {
                $('#fileupload').find(":file").val('');
                alert("eit");
            },
            data : formData,
            processData : false,
            cache : false,
            contentType : false
        });
    });
    mv.forceUpdateWebs();
    mv.parseHashUrl();
});
