// mv-ui.js
// handling the ui layer

/*global _ $ jQuery */

"use strict";

var mvui = (function (mvui) {
  // make _.template use a variable rather than "with"
  _.templateSettings['variable'] = 'data';

  mvui.templates = {};
  mvui.render = function (name, data) {
    return mvui.templates[name](data);
  };

  var _View = {
    _init : function (el) {
      mv.eventify(this);
      this.isDestroyed = false;
      this.el = $(el);
    },
    destroy : function () {
      if (this.isDestroyed) {
        throw new Error("Cannot destroy a view twice.");
      }
      this.isDestroyed = true;
    },
    checkIfDestroyed : function () {
      if (this.isDestroyed) {
        throw "removeHandler";
      }
    },
    hide : function () {
      this.el.hide();
    },
    show : function () {
      this.el.show();
    }
  };

  mvui._WebSelectorView = _.create(_View, {
    _init : function (el) {
      _View._init.apply(this, el);
      this.renderSkeleton();
      mv.WebModel.on(["updated", "selected", "deselected"], _.im(this, 'redraw'));
      _.defer(_.im(this, 'redraw'));

      $("#add_web").click(function (e) {
        e.preventDefault();
        var webname = prompt("Name for a new web");
        mv.WebModel.addWeb(webname,
                           function (res) {
                             if (!res) {
                               alert("There is already a web with that name.");
                             }
                           });
        return false;
      });
    },
    renderSkeleton : function () {
      this.el.html('<a href="#" data-dropdown="#dropdown-webs"><span data-webname>(no web)</span></a>');
    },
    redraw : function () {
      this.checkIfDestroyed();
      var that = this;
      mv.WebModel.getWebs(function (webs) {
        console.log("redraw");
        // update thing which shows the current web
        var webname;
        var currentWeb = mv.WebModel.getCurrentWeb();
        if (currentWeb === undefined) {
          webname = "(no web)";
        } else {
          webname = currentWeb.name;
        }
        that.el.find("[data-webname]").text(webname);

        // update dropdown
        var sel = $("#web_selector");
        sel.empty();
        _.each(webs, function (web) {
          var opt = $('<a/>').attr("href", "#" + web.name).text(web.name);
          var edit = $('<a/>').attr('href', '#').addClass("webEditButton").text("edit");
          var li = $('<li/>').append(edit).append(opt);
          sel.append(li);
//          opt.on("click", function () {
//            mv.WebModel.setCurrentWeb(web.id);
//          });
          edit.on("click", function (e) {
            e.preventDefault();
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
      });
    }
  });

  mvui._WebViews = _.create(_View, {
    _init : function (el) {
      _View._init.apply(this, el);
      mv.WebModel.on("selected", _.im(this, 'selectWeb'));
      mv.WebModel.on("deselected", _.im(this, 'deselectWeb'));
      mv.WebModel.on("updated", _.im(this, 'updateWebs'));
      this.webViews = {};
    },
    selectWeb : function () {
      this.checkIfDestroyed();
      var web = mv.WebModel.getCurrentWeb();
      if (!_.has(this.webViews, web.id)) {
        this.makeWebView(web);
      }
      _.each(this.webViews, function (view) {
        view.el.hide();
      });
      this.webViews[web.id].el.show();
    },
    deselectWeb : function () {
      this.checkIfDestroyed();
      var that = this;
      mv.WebModel.getWebs(function (webs) {
        _.each(_.keys(this.webViews), function (id) {
          if (!_.has(webs, id)) {
            that.removeWebView(id);
          }
        });
      });
    },
    updateWebs : function (model, webs) {
      this.checkIfDestroyed();
//       _.each(this.webViews, function (view, id) {
//         view.text(webs[id].name);
//       });
    },
    makeWebView : function (web) {
      var container = $('<div class="web-view"/>').hide();
      this.webViews[web.id] = _.build(mvui._WebView, container, web);
      this.el.append(container);
    },
    removeWebView : function (id) {
      var view = this.webViews[id];
      if (view !== undefined) {
        view.destroy();
        view.el.remove();
        delete this.webViews[id];
      }
    }
  });

  mvui._WebView = _.create(_View, {
    _init : function (el, web) {
      _View._init.apply(this, el);
      this.web = web;

      var iel = $('<div class="inbox"/>').hide().appendTo(this.el);
      this.inboxView = _.build(mvui._InboxView, iel, this.web);
      this.blobView = undefined;

      mv.FragmentModel.on("updated", _.im(this, 'updateViewByFragment'));
      this.updateViewByFragment(undefined, mv.FragmentModel.parsed);
    },
    updateViewByFragment : function (model, d) {
      this.checkIfDestroyed();
      if (d['web'] !== this.web.name) {
        return;
      }
      if (d['blob'] !== undefined) {
        this.showBlob(d['blob']);
      } else {
        this.showInbox();
      }
    },
    showInbox : function () {
      if (this.blobView) {
        this.blobContainer.hide();
      }
      this.inboxView.show();
    },
    showBlob : function (uuid) {
      this.inboxView.hide();
      if (this.blobView === undefined || this.blobView.uuid !== uuid) {
        this.el.children(".web-blob").remove();
        if (this.blobView) {
          this.blobView.destroy();
        }
        this.blobContainer = $('<div class="web-blob"/>').appendTo(this.el);
        this.blobView = _.build(mvui._BlobView, this.blobContainer, this.web, uuid);
      }
      this.blobContainer.show();
    }
  });

  mvui._BlobView = _.create(_View, {
    _init : function (el, web, uuid) {
      _View._init.apply(this, el);
      this.web = web;
      this.uuid = uuid;
      this.render();
    },
    render : function () {
      var that = this;
      this.id = _.uniqueId('blob_');
      var wrapper = $($.trim(mvui.render("blob-wrapper", {id : this.web.id})));
      _.seq(
        _.im(mv.BlobModel, 'getBlob', that.web.id, that.uuid),
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
            content_type : blob.content_type,
            editor : blob.editor_email,
            titleish : titleish,
            rawUrl : "/blob/" + blob.uuid + that.getFilename(that.web, blob)
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
      mv.BlobModel.getBlob(this.web.id, this.uuid, function (blob) {
      });
      this.el.empty().append(wrapper);
    },
    getFilename : function (web, blob) {
      var filename = "";
      if (blob !== undefined) {
        var srels = mv.BlobModel.getRelationsForSubject(web.id, blob.uuid);
        _.each(srels, function (rel) {
          if (rel.type === "filename" && rel.payload) {
            filename = "/" + rel.payload;
          }
        });
      }
      return filename;
    },
    // Gets a title-like thing for the blob
    getTitleish : function (callback) {
      var that = this;
      _.seq(
        _.im(mv.BlobModel, 'getBlob', this.web.id, this.uuid),
        function (blob) {
          var titleish = that.uuid;
          if (blob !== undefined) {
            var srels = mv.BlobModel.getRelationsForSubject(that.web.id, that.uuid);
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
  });

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

  mvui.makeBlobLink = function (web, uuid) {
    var frag = mv.FragmentModel.makeFragment({
      web : web.name,
      blob : uuid
    });
    var webid = web.id;
    var link = $("<a/>").text("loading...").attr('href', frag);
    mv.BlobModel.getBlob(webid, uuid, function (blob) {
      var srels = mv.BlobModel.getRelationsForSubject(webid, uuid);
      var name = uuid;
      _.each(srels, function (rel) {
        if (rel.type == "filename" || rel.type == "title") {
          name = rel.payload || name;
        }
        link.text(name);
      });
    });
    return link;
  };

  mvui._InboxView = _.create(_View, {
    _init : function (el, web) {
      _View._init.apply(this, el);
      this.web = web;
      this.render();
      mv.InboxModel.on("updated", _.im(this, 'render'));
    },
    render : function () {
      var that = this;
      that.el.empty().append($("<h1/>").text("Inbox"));
      mv.InboxModel.getInbox(that.web.id, function(uuids) {
        var ul = $("<ul/>");
        _.each(uuids, function (uuid) {
          var link = mvui.makeBlobLink(that.web, uuid);
          ul.append($('<li/>').append(link));
        });
        that.el.append(ul);
      });
    }
  });

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

  mv.Connection.longPoll(function (error) {
    console.log("long poll error: " + error);
    return true;
  });

  var WebViews = _.build(mvui._WebViews, $("#content"));
  var WebSelectorView = _.build(mvui._WebSelectorView, $("#web-selector"));

  // mv.WebModel.on(["updated", "deselected"], function (model) {
  //   _.seq(
  //     _.im(model, 'getWebs'),
  //     function (knownWebs) {
  //       var el = $("#web_selector");
  //       el.empty();
  //       var currentWeb = mv.WebModel.getCurrentWeb();
  //       _.each(knownWebs, function (web) {
  //         var opt = $("<a/>").attr("href", "#" + web.name).text(web.name);
  //         var edit = $("<a/>").attr("href", "#").addClass("webEditButton").text("edit");
  //         var li = $("<li/>").append(edit).append(opt);
  //         el.append(li);
  //         opt.on("click", function() {
  //           mv.WebModel.setCurrentWeb(web.id);
  //         });
  //         edit.on("click", function() {
  //           var newwebname = prompt("New name for the web", web.name);
  //           if (newwebname) {
  //             mv.WebModel.renameWeb(web.id, newwebname,
  //                                   function (res) {
  //                                     if (!res) {
  //                                       alert("There is already a web with that name.");
  //                                     }
  //                                   });
  //           }
  //           return false;
  //         });
  //       });
  //     })();
  // });

  // mv.WebModel.pullWebs();


  mv.UserModel.getUsers(function (users) {
    $("div[data-avatar]").each(function () {
      var $d = $(this);
      $d.empty();
      var user = users[$d.attr("data-avatar")];
      if (user !== undefined) {
        $d.append($("<img/>").attr("src", user.avatarUrl()));
      }
    });
  });
  $(document).tooltip({
    items : "[user-tooltip]",
    content : function () {
      var el = $(this);
      var id = _.uniqueId("avatar_");
      var r = $('<div class="user-tooltip"/>').attr('id', id);
      mv.UserModel.getUser(el.attr('user-tooltip'), function (user) {
        var avatar = $('<div class="user-tooltip-avatar"/>');
        avatar.append($('<img/>').attr('src', user.avatarUrl()));
        var container = $('<div class="user-tooltip-top"/>');
        container.append(avatar);
        container.append(
          $('<div class="user-tooltip-side"/>')
          .append($('<div class="user-tooltip-name"/>').text(user.first_name + " " + user.last_name))
          .append($('<div class="user-tooltip-email"/>').text(user.email))
        );
        r.append(container);
      });
      return r;
    }
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

//   function redrawInbox (web) {
//     if (web === undefined) {
//       return;
//     }
//     var el = $("#inbox");
//     el.empty();
//     $("<h2/>").text("Inbox for " + web.name).appendTo(el);
//     var ul = $("<ul/>");
//     _.each(mv.InboxModel.currentInboxes[web.id], function (uuid) {
//       //var p = $(mvui.renderBlob(web.id, uuid)).appendTo(el);
//       ul.append($("<li/>").append(mvui.makeBlobLink(web.id, uuid)));
//     });
//     el.append(ul);
//     updateBlobElements();
//   }
  
//   mv.InboxModel.on("updated", function (model, web_id) {
//     mv.WebModel.getWebs(function (webs) {
//       redrawInbox(mv.WebModel.getCurrentWeb());
//     });
//   });

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
