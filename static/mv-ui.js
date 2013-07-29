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

  var _BlobView = {
    _init : function (webid, uuid) {
      mv.eventify(this);
      this.webid = webid;
      this.uuid = uuid;
    },
    render : function () {
      var that = this;
      this.id = _.uniqueId('blob_');
      var wrapper = $($.trim(mvui.render("blob-wrapper", {id : this.id})));
      _.seq(
        _.im(mv.BlobModel, 'getBlob', that.webid, that.uuid),
        function (blob, callback) {
          var dest = wrapper.find('.blob-wrapped-dest');
          if (blob === undefined) {
            dest.text("Error: no such blob.");
          } else {
            that.getTitleish(function (titleish) {
              callback(blob, dest, titleish);
            });
          }
        },
        function (blob, dest, titleish, callback) {
          dest.empty();
          var data = {
            created : mv.shortTime(blob.date_created),
            uuid : blob.uuid,
            editor : blob.editor_email,
            titleish : titleish,
            rawUrl : "/blob/" + blob.uuid
          };
          dest.html(mvui.render("blob-generic", data));
          if (blob.content_type.slice(0,"mime:text/".length) === "mime:text/") {
            dest.find('.blob-content').text("Loading...");
            blob.getContent(function (c) {
              dest.find('.blob-content').html($("<pre/>").text(c));
            });
          }
        }
      )();
      mv.BlobModel.getBlob(this.webid, this.uuid, function (blob) {
      });
      return wrapper;
    },
    // Gets a title-like thing for the blob
    getTitleish : function (callback) {
      var that = this;
      _.seq(
        _.im(mv.BlobModel, 'getBlob', this.webid, this.uuid),
        function (blob) {
          var titleish = that.uuid;
          if (blob !== undefined) {
            var srels = mv.BlobModel.getRelationsForSubject(that.webid, that.uuid);
            _.each(srels, function (rel) {
              console.log(rel.type);
              if (_.contains(["filename", "title"], rel.type)) {
                titleish = rel.payload || titleish;
              }
            });
          }
          callback(titleish);
        }
      )();
    }
  };

  mvui.makeBlobView = function (webid, uuid) {
    return _.build(_BlobView, webid, uuid);
  };

  mvui.renderBlobWrapper = function (webid, uuid, content) {
    return mvui.render("blob-wrapper",
                       {webid : webid,
                        uuid : uuid,
                        content : content});
  };
  mvui.renderBlob = function (webid, uuid) {
    return mvui.makeBlobView(webid, uuid).render();
  };

  mvui.makeBlobLink = function (webid, uuid) {
    var link = $("<a/>").text("loading...");
    mv.BlobModel.getBlob(webid, uuid, function (blob) {
      var srels = mv.BlobModel.getRelationsForSubject(webid, uuid);
      var name = uuid;
      _.each(srels, function (rel) {
        if (rel.type == "filename" || rel.type == "title") {
          name = rel.payload || name;
        }
      });
      
      link.text(name).on("click", function (e) {
        e.preventDefault();
        $("#blob-view").empty().append(mvui.renderBlob(webid, uuid));
        return false;
      });
    });
    return link;
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
    mv.WebModel.autoselectWeb(true);
  };

  mv.WebModel.on(["updated", "selected", "deselected"], function (model) {
    var webname;
    var currentWeb = mv.WebModel.getCurrentWeb();
    if (currentWeb === undefined) {
      webname = "(no web)";
    } else {
      webname = currentWeb.name;
    }
    $("[data-webname]").text(webname);
    $('#rename_web_form [name="newwebname"]').val(webname);
    redrawInbox(currentWeb);
  });

  mv.WebModel.on(["updated", "deselected"], function (model) {
    _.seq(
      _.im(model, 'getWebs'),
      function (knownWebs) {
        var el = $("#web_selector");
        el.empty();
        var currentWeb = mv.WebModel.getCurrentWeb();
        _.each(knownWebs, function (web) {
          var opt = $("<a/>").attr("href", "#" + web.name).text(web.name);
          var edit = $("<a/>").attr("href", "#").addClass("webEditButton").text("edit");
          var li = $("<li/>").append(edit).append(opt);
          el.append(li);
          opt.on("click", function() {
            mv.WebModel.setCurrentWeb(web.id);
          });
          edit.on("click", function() {
            var newwebname = prompt("New name for the web", web.name);
            if (newwebname) {
              mv.WebModel.renameWeb(web.id, newwebname,
                                    function (res) {
                                      if (!res) {
                                        alert("There is already a web with that name.");
                                      }
                                    });
            }
            return false;
          });
        });
      })();
  });

  mv.WebModel.pullWebs();

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
    if (mv.WebModel.currentWebId === undefined) {
      alert("Select a web to rename first.");
    } else {
      var webname = prompt("Name for a new web");
      mv.WebModel.renameWeb(mv.WebModel.currentWebId, webname,
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
      this.element.find(".fileUploadSize").text(mv.sensibleSize(this.options.fileState.size));
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
    if (mv.WebModel.currentWebId === undefined) {
      alert("Select a web first");
      $('#fileupload').find(":file").val('');
      return;
    } 
    if (!$('#fileupload').find(":file").val()) {
      return;
    }
    _.each($('#fileupload').find(":file")[0].files, function (file) {
      mv.FileUploadModel.uploadFile(mv.WebModel.currentWebId, file);
    });
    $("#fileupload").find(":file").val('');
  });

  function redrawInbox (web) {
    var el = $("#inbox");
    el.empty();
    $("<h2/>").text("Inbox for " + web.name).appendTo(el);
    var ul = $("<ul/>");
    _.each(mv.InboxModel.currentInboxes[web.id], function (uuid) {
      //var p = $(mvui.renderBlob(web.id, uuid)).appendTo(el);
      ul.append($("<li/>").append(mvui.makeBlobLink(web.id, uuid)));
    });
    el.append(ul);
    updateBlobElements();
  }
  
  mv.InboxModel.on("updated", function (model, web_id) {
    mv.WebModel.getWebs(function (webs) {
      redrawInbox(mv.WebModel.getCurrentWeb());
    });
  });

//  mv.BlobModel.on("updated", function (model, web_id, blob_id) {
//    updateBlobElements();
//  });
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
    mv.BlobModel.getBlob(web_id, uuid, function (blob) {
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
        _.seq(
          _.im(mv.UserModel, 'getUser', blob.editor_email),
          function (editor) {
            e.empty();
            var editor_name = (editor !== undefined && editor.first_name) || blob.editor_email;
            e.append($("<span/>").text(editor_name));
            e.append(" | ");
            e.append($("<a/>").attr("href", url).attr("target", "_blank").text(filename));
            e.append(" ");
            e.append($("<span/>").text(mv.shortTime(blob.date_created)));
          }
        )();
      }
    });
  }
  

});
