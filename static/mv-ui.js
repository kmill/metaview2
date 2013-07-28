// mv-ui.js
// handling the ui layer

"use strict";

var mvui = (function (mvui) {
    // make _.template use a variable rather than "with"
    _.templateSettings['variable'] = 'data';

    mvui.templates = {};
    mvui.render = function (name, data) {
        return mvui.templates[name](data);
    };

    mvui.renderBlobWrapper = function (webid, uuid, content) {
        return mvui.render("blob-wrapper",
                           {webid : webid,
                            uuid : uuid,
                            content : content});
    };
    mvui.renderBlob = function (webid, uuid) {
        var blob = mv.BlobModel.getBlob(webid, uuid);
        var content = undefined;
        if (blob !== undefined) {
            content = "<b>have blob</b>";
        }
        return mvui.renderBlobWrapper(webid, uuid, content);
    };

    mvui.makeBlobLink = function (webid, uuid) {
        var srels = mv.BlobModel.getRelationsForSubject(webid, uuid);
        var name = uuid;
        _.each(srels, function (rel) {
            if (rel.type == "filename" || rel.type == "title") {
                name = rel.payload || name;
            }
        });

        return $("<a/>").text(name).on("click", function (e) {
            e.preventDefault();
            $("#blob-view").empty().append(mvui.renderBlob(webid, uuid));
            return false;
        });
    };

    return mvui;
})({});

jQuery(function ($) {

    // pre-compile templates
    $("script[template-name]").each(function () {
        mvui.templates[$(this).attr("template-name")] = _.template($(this).html());
    });

    mv.initConnection($('#poll_info_form').find('input[name="channel_id"]').val());

    mv.Connection.on("badChannel", function () {
        window.location.reload();
    });

    function errorHandler(error) {
        $("#polldest").append("<div><em>error: "+error+"</em></div>");
        return true;
    }

    mv.addMessageHandler("TextMessage", function(args) {
        $("#polldest").append(template("test-message-entry", {args:args}));
    });

    mv.Connection.longPoll(errorHandler);

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
        console.log("hash change");
        mv.WebModel.currentWeb = undefined;
        mv.WebModel.pullWebs();
    };

    mv.WebModel.on(["updated", "selected", "deselected"], function (model) {
        if (model.currentWeb === undefined) {
            var webname = "(no web)";
        } else {
            var webname = model.knownWebs[model.currentWeb];
        }
        $("[data-webname]").text(webname);
        $('#rename_web_form [name="newwebname"]').val(webname);
        redrawInbox(model.currentWeb);
    });

    mv.WebModel.on(["updated", "deselected"], function (model) {
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

    mv.UserModel.on("updated", function () {
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

    mv.FileUploadModel.on("numChanged", function (model, num) {
        if (num) {
            $("[data-num-uploads]").text("(" + num + ")");
        } else {
            $("[data-num-uploads]").text("");
        }
    });

    mv.FileUploadModel.on("updated", function (model, fileState) {
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
            this.element.find(".fileUploadSize").text(mv.sensibleSize(size));
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
            var p = $(mvui.renderBlob(web_id, uuid)).appendTo(el);
            el.append(mvui.makeBlobLink(web_id, uuid));
        });
        updateBlobElements();
    }
    
    mv.InboxModel.on("updated", function (model, web_id) {
        redrawInbox(web_id);
    });

    mv.BlobModel.on("updated", function (model, web_id, blob_id) {
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
