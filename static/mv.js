// mv.js
// main javascript for metaview

var mv = (function(mv, $) {
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
    mv.longPoll = function (onError) {
        mv.longPollDriver(
            function (messages) {
                for (var i = 0; i < messages.length; i++) {
                    message = messages[i];
                    if (message["type"] in mv.messageHandlers) {
                        mv.messageHandlers[message["type"]](message["args"]);
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
        onError = onError || function() {};
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

    return mv;
})(window.my || {}, jQuery);

jQuery(function ($) {
    function errorHandler(error) {
        $("#polldest").append("<div><em>error: "+error+"</em></div>");
        return false;
    }

    mv.messageHandlers["TextMessage"] = function(args) {
        $("#polldest").append("<div>" + args["user"] + ": " + args["m"] + "</div>");
    };

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
});