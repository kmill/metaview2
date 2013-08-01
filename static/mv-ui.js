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
      _View._init.call(this, el);
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
			
			$('#web-actions').toggle(mv.WebModel.getCurrentWeb() !== undefined);

			$('#view-inbox').click(function (e) {
				e.preventDefault();
				window.location = mv.FragmentModel.makeFragment({web : mv.WebModel.getCurrentWeb().name});
				return false;
			});
			$('#compose').click(function (e) {
				e.preventDefault();
				window.location = mv.FragmentModel.makeFragment({web : mv.WebModel.getCurrentWeb().name, action : 'compose'});
				return false;
			});
    },
    renderSkeleton : function () {
      this.el.html('<a href="#" data-dropdown="#dropdown-webs"><span data-webname>(no web)</span></a>');
    },
    redraw : function () {
      this.checkIfDestroyed();
			$('#web-actions').toggle(mv.WebModel.getCurrentWeb() !== undefined);
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
          var viewFrag = mv.FragmentModel.makeFragment({web : web.name});
          var editFrag = mv.FragmentModel.makeFragment({web : web.name, action : 'config'});
          var opt = $('<a/>').attr("href", viewFrag).text(web.name);
          var edit = $('<a/>').attr('href', editFrag).addClass("webEditButton").text("edit");
          var li = $('<li/>').append(edit).append(opt);
          sel.append(li);
        });
      });
    }
  });

  mvui._WebViews = _.create(_View, {
    _init : function (el) {
      _View._init.call(this, el);
      this.webViews = {};
      mv.WebModel.on("selected", _.im(this, 'selectWeb'));
      mv.WebModel.on("deselected", _.im(this, 'deselectWeb'));
      mv.WebModel.on("updated", _.im(this, 'updateWebs'));
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
        _.each(_.keys(that.webViews), function (id) {
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
      _View._init.call(this, el);
      this.web = web;

      var iel = $('<div class="inbox"/>').hide().appendTo(this.el);
      this.inboxView = _.build(mvui._InboxView, iel, this.web);
      this.blobView = undefined;
			this.composeView = undefined;
      this.configView = $('<div class="web-config"/>').appendTo(this.el);

      mv.FragmentModel.on("updated", _.im(this, 'updateViewByFragment'));
      this.updateViewByFragment(undefined, mv.FragmentModel.getParsed());
    },
    updateViewByFragment : function (model, d) {
      this.checkIfDestroyed();
      if (d['web'] !== this.web.name) {
        return;
      }
			if (d['action'] === 'compose') {
				this.showCompose(d['blob']);
      } else if (d['action'] === 'config') {
        this.showConfig();
			} else if (d['blob'] !== undefined) {
        this.showBlob(d['blob']);
      } else {
        this.showInbox();
      }
    },
    showConfig : function () {
      var that = this;
      if (this.blobView) { this.blobContainer.hide(); }
			if (this.composeView) this.composeView.hide();
      this.inboxView.hide();
      this.configView.show();
      this.configView.empty().html(mvui.render("web-config", {
        name : this.web.name,
        isPublic : this.web.isPublic
      }));
      var nameform = this.configView.find("form.web-config-name");
      var namesubmit = nameform.find('input[type="submit"]');
      var nametext = nameform.find('input[name="web-name"]');
      var nameerror = nameform.find('.rename-error');
      var nameWithError = undefined;
      namesubmit.hide();
      nametext.on("keyup", function () {
        console.log("change");
        if ($(this).val() === that.web.name) {
          namesubmit.fadeOut();
        } else {
          namesubmit.fadeIn();
        }
        if ($(this).val() !== nameWithError) {
          nameerror.fadeOut();
        }
      });
      nameform.on("submit", function (e) {
        e.preventDefault();
        var newwebname = nametext.val();
        if (newwebname && newwebname !== that.web.name) {
          mv.WebModel.renameWeb(that.web.id, newwebname,
                                function (res) {
                                  if (!res) {
                                    nameWithError = newwebname;
                                    nameerror.fadeIn();
                                  } else {
                                    nameWithError = undefined;
                                  }
                                });
        } else {
          nametext.val(that.web.name);
        }
        return false;
      });
      var publicform = this.configView.find("form.web-config-public");
      publicform.find('input').on("change", function (e) {
        var checked = $(this).prop('checked');
        mv.WebModel.setWebPublic(that.web.id, checked);
      });
      mv.WebModel.getWebUsers(that.web.id, function (users) {
        var ul = that.configView.find(".web-config-users");
        _.each(users, function(user) {
          ul.append($("<li/>").attr("user-tooltip", user).text(user));
        });
      });
      var deleteform = this.configView.find("form.web-config-delete");
      deleteform.on("submit", function (e) {
        e.preventDefault();
        deleteform.find("input").prop('disabled', true);
        deleteform.find(".form-error").fadeOut();
        mv.WebModel.deleteWeb(that.web.id, function (r) {
          if (!r) {
            deleteform.find(".form-error").fadeIn();
          }
          deleteform.find("input").prop('disabled', false);
        });
        return false;
      });
      return;

    },
    showInbox : function () {
      if (this.blobView) this.blobContainer.hide();
			if (this.composeView) this.composeView.hide();
      this.configView.hide();
      this.inboxView.show();
    },
    showBlob : function (uuid) {
      this.inboxView.hide();
      this.configView.hide();
			if (this.composeView) this.composeView.hide();
      if (this.blobView === undefined || this.blobView.uuid !== uuid) {
        this.el.children(".web-blob").remove();
        if (this.blobView) {
          this.blobView.destroy();
        }
        this.blobContainer = $('<div class="web-blob"/>').appendTo(this.el);
        this.blobView = _.build(mvui._BlobView, this.blobContainer, this.web, uuid);
      }
      this.blobContainer.show();
    },
		// fromBlob is either the blob to revise or reply to (optional)
		showCompose : function (fromBlob) {
			this.inboxView.hide();
      this.configView.hide();
			if (this.blobView) this.blobView.hide();
			if (this.composeView != undefined) {
				this.composeView.destroy();
				this.composeView = undefined;
			}
			if (this.composeView === undefined) {
				this.composeContainer = $('<div class="web-blob-compose"/>').appendTo(this.el);
				this.composeView = _.build(mvui._BlobEditView, this.composeContainer, this.web, fromBlob);
			}
			this.composeView.show();
		}
  });

  mvui._BlobView = _.create(_View, {
    _init : function (el, web, uuid) {
      _View._init.call(this, el);
      this.web = web;
      this.uuid = uuid;
      this.render();
    },
    render : function () {
      var that = this;
      this.id = _.uniqueId('blob_');
      var wrapper = $($.trim(mvui.render("blob-wrapper", {id : this.id})));
      _.seq(
        _.im(mv.BlobModel, 'getBlob', that.web.id, that.uuid),
        function (blob, callback) {
          var dest = wrapper.find('.blob-wrapped-dest');
          if (blob === undefined) {
            dest.text("Error: no such blob.");
          } else {
            callback(blob, dest, blob.getName());
          }
        },
        function (blob, dest, titleish, callback) {
          dest.empty();
          var data = {
            created : mv.shortTime(blob.date_created, true),
            uuid : blob.uuid,
            content_type : blob.content_type,
            editor : blob.editor_email,
            titleish : titleish,
            rawUrl : blob.getUrl()
          };
          dest.html(mvui.render("blob-generic", data));

					mv.UserModel.getUsers(function (users) {
						_.each(blob.getAuthors(), function (author) {
							var avatar = $('<div class="blob-author-avatar"/>').attr('user-tooltip', author);
							var user = users[author];
							if (user !== undefined) {
								avatar.append($('<img/>').attr('src', user.avatarUrl()));
							}
							dest.find('.blob-authors').append(avatar);
						});
					});

          if (blob.content_type.slice(0,"mime:text/".length) === "mime:text/") {
            dest.find('.blob-content').text("Loading...");
            blob.getContent(function (c) {
              dest.find('.blob-content').html($("<pre/>").text(c));
            });
          }
					if (blob.content_type.slice(0,"relation:".length) === "relation:") {
            dest.find('.blob-content').text("Loading...");
            blob.getContent(function (c) {
              var el = dest.find('.blob-content').empty();
							var pel = $("<p/>").appendTo(el);
							var rel = c.split("\n", 2);
							pel.append($('<a/>').text("blob").attr("href", mv.FragmentModel.makeFragment({web : that.web.name, blob : rel[0]})));
							pel.append(" ");
							pel.append($("<strong/>").text(blob.content_type.slice("relation:".length)));
							pel.append(" ");
							if (/^[0-9a-f]{32}$/.test(rel[1])) { // is it uuid-ish?
								pel.append($('<a/>').text("blob").attr("href", mv.FragmentModel.makeFragment({web : that.web.name, blob : rel[1]})));
							} else {
								pel.append(rel[1]);
							}
            });
					}
					var editbutton = dest.find('.blob-edit-button');
					editbutton.attr('href', mv.FragmentModel.makeFragment({web : that.web.name, blob : blob.uuid, action : "compose"}));
					var relarea = dest.find('.blob-relations-holder');
					var relcontent = dest.find('.blob-relations');
					var shownAny = false;
					relarea.hide();
          _.each(_.sortBy(blob.srels, function (rel) { return rel.date_created.getTime(); }), function (rel) {
						if (rel.uuid !== null && !rel.deleted && rel.name != "deletes" && !(rel.name == "revises" && rel.isInherited(blob))) {
							shownAny = true;
							var el = $('<p/>');
							el.append($('<a/>').append($("<strong/>").text(rel.name)).attr("href", mv.FragmentModel.makeFragment({web : that.web.name, blob : rel.uuid})));
							if (rel.object) {
								el.append(' ').append($('<a/>').text("blob").attr("href", mv.FragmentModel.makeFragment({web : that.web.name, blob : rel.object})));
							} else {
								el.append(' ').append($('<span/>').text(rel.payload));
							}
							if (rel.isInherited(blob)) {
								el.append(" <em>(inherited)</em>");
							}
							relcontent.append(el);
						}
          });
          _.each(_.sortBy(blob.orels, function (rel) { return rel.date_created.getTime(); }), function (rel) {
						shownAny = true;
  					var el = $('<p/>')
	  							.append($('<a/>').text("blob").attr("href", mv.FragmentModel.makeFragment({web : that.web.name, blob : rel.subject})))
									.append(' ')
   	 							.append($('<a/>').append($("<strong/>").text(rel.name)).attr("href", mv.FragmentModel.makeFragment({web : that.web.name, blob : rel.uuid})))
									.append(" <em>this</em>");
						relcontent.append(el);
          });
					if (!shownAny) {
						relcontent.append("<p>No relations.</p>");
					}
					var rel_toggler = dest.find(".blob-rel-toggler");
					rel_toggler.text("relations");
					var rel_expand = true;
					rel_toggler.on("click", function (e) {
						e.preventDefault();
						rel_toggler.text(rel_expand ? "hide" : "relations");
						relarea.toggle("blind", {}, 250); // TODO figure out how to set which way it should be expanded.
						rel_expand = !rel_expand;
						return false;
					});
					var tags_el = dest.find('.blob-tags');
					tags_el.tagit({
						availableTags : ["research", "fun", "etc"],
						autocomplete : {delay:250, minLength:1},
						removeConfirmation : true,
						allowDuplicates : false,
						allowSpaces : true,
						placeholderText : "Add tags",
						singleField : true
					});
					var tags = _.pluck(_.where(blob.srels, {name : 'tag', deleted : false}), 'payload');
					tags.sort();
					_.each(tags, function(tag) {
						if (tag) {
							tags_el.tagit('createTag', tag);
						}
					});
        }
      )();
      mv.BlobModel.getBlob(this.web.id, this.uuid, function (blob) {
      });
      this.el.empty().append(wrapper);
    }
  });

	mvui._BlobEditView = _.create(_View, {
		_init : function (el, web, fromBlob) {
			_View._init.call(this, el);
			this.web = web;
			this.fromBlob = fromBlob;
			this.render();
		},
		destroy : function() {
			if (this.editor) {
				//this.editor.clear();
			}
			_View.destroy.call(this);
		},
		render : function () {
			this.el.append(mvui.render('compose-blob', {
				
			}));
			var that = this;
			that.el.find('.blob-save-button').prop('disabled', true);
			_.defer(function () {
				_.seq(function (callback) {
					if (that.fromBlob) {
						mv.BlobModel.getBlob(that.web.id, that.fromBlob, function (blob) {
							var tags = _.pluck(_.where(blob.srels, {name : 'tag', deleted : false}), 'payload');
							tags.sort();
							_.each(tags, function(tag) {
								if (tag) {
									tags_el.tagit('createTag', tag);
								}
							});
							if (blob.content_type.slice(0, "mime:text/".length) === "mime:text/") {
								blob.getContent(callback);
							} else {
								callback("");
							}
						});
					} else {
						callback("");
					}
				},
				function (value) {
					that.el.find('.blob-save-button').prop('disabled', false);
					that.el.find(".blob-edit").empty();
					that.editor = CodeMirror(that.el.find(".blob-edit")[0], {
						lineWrapping : true,
						viewportMargin : Infinity,
						lineNumbers : true,
						value : value
					});
				})();
			});
			var tags_el = this.el.find('.blob-tags');
			tags_el.tagit({
				availableTags : ["research", "fun", "etc"],
				autocomplete : {delay:250, minLength:1},
				removeConfirmation : true,
				allowDuplicates : true,
				allowSpaces : true,
				placeholderText : "Add tags",
				singleField : true
			});
			this.el.find('.blob-save-button').on('click', function (e) {
				e.preventDefault();
				that.el.find('.blob-save-button').prop('disabled', true);
				var content = that.editor.getValue();
				var title = that.el.find('.blob-edit-title').val() || undefined;
				var tags = that.el.find('.blob-tags').tagit('assignedTags');
				mv.BlobModel.createBlob(that.web.id, content, "text/metaview-email-style", title, tags, that.fromBlob ? [that.fromBlob] : [],
															 function (uuid) {
																 if (uuid) {
																	 window.location = that.nextUrl || mv.FragmentModel.makeFragment({web : that.web.name, blob : uuid});
																 } else {
																	 // TODO deal with errors better!
																	 that.el.find('.blob-save-button').prop('disabled', false);
																 }
															 });
				return false;
			});
		}
	});

  mvui._InboxView = _.create(_View, {
    _init : function (el, web) {
      _View._init.call(this, el);
      this.web = web;
      this.rows = {};
      this.render();
      this.table = undefined;
      mv.InboxModel.on("updated", _.im(this, 'render'));
    },
    render : function () {
      var that = this;
      if (that.table === undefined) {
        that.el.empty().append($("<h1/>").text("Inbox"));
        that.el.append($('<p class="removeWhenLoaded"><em>Loading</em></p>'));
        that.table = $('<table class="inbox-table"/>').appendTo(that.el);
        that.table.append($('<colgroup/>')
                          .append($('<col class="inbox-editor"/>'))
                          .append($('<col class="inbox-summary"/>'))
                          .append($('<col class="inbox-time"/>')));
      }
      var table = that.table;
      _.seq(
        _.im(mv.InboxModel, 'getInbox', that.web.id),
        function (uuids, callback) {
          mv.BlobModel.getBlobs(that.web.id, uuids, callback);
        },
        function (blobs) {
          var oldRows = that.rows;
          that.rows = {};
          _.each(blobs, function (blob) {
            if (_.has(oldRows, blob.uuid)) {
              that.rows[blob.uuid] = oldRows[blob.uuid];
              delete oldRows[blob.uuid];
            } else {
              that.rows[blob.uuid] = {
                blob : blob,
                row : that.renderBlobRow(blob)
              };
            }
          });
          that.el.find(".removeWhenLoaded").remove();
          var sorted = _.sortBy(_.keys(that.rows), function (uuid) {
            return -that.rows[uuid].blob.date_created.getTime();
          });
          _.each(oldRows, function (row) {
            row.row.remove();
          });
          _.each(sorted, function (uuid) {
            table.append(that.rows[uuid].row);
          });
        }
      )();
    },
    renderBlobRow : function (blob) {
      var frag = mv.FragmentModel.makeFragment({
        web : this.web.name,
        blob : blob.uuid
      });
      var blobAuthors = blob.getAuthors();
      var row = $("<tr/>");
      row.append($('<td class="inbox-editor"/>'));
      row.append($('<td class="inbox-summary"/>')
                 .append($('<span class="inbox-summary-name"/>')
                         .text(blob.getName()))
                 .append(" &mdash; ")
                 .append(blob.summary || blob.content_type)
                );
      row.append($('<td class="inbox-time"/>').append(mv.shortTime(blob.date_created)));
      row.on("click", function (e) {
        window.location = frag;
      });
      mv.UserModel.getUsers(function (users) {
        var ed = row.children('.inbox-editor');
        var sep = "";
        _.each(blobAuthors, function (email) {
          ed.append(sep);
          $('<span/>').text(users[email].first_name)
            .attr("user-tooltip", email)
            .appendTo(ed);
          sep = ", ";
        });
      });
      return row;
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

	// Remove loading screen
	$("#app-loading").hide();
});
