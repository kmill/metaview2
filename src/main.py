import tornado.ioloop
import tornado.web as web
import tornado.escape
import tornado.template
import tornado.httputil
import tornado.httpclient
import tornado.auth
import httplib
import tornado.options

import json

import uuid
import base64
import hashlib

import datetime
import time
import email.utils

import logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

import models
import channel
import minirpc
import methods

channels = channel.ChannelSet()

import plugin_inbox
plugin_inbox.add_inbox_plugin(channels)

tornado.options.define("port", default=8222, help="the port number to run on", type=int)
tornado.options.define("host", default=None, help="the host name to run on", type=str)

models.db_connect("mv.db")

def random256() :
    return base64.b64encode(uuid.uuid4().bytes + uuid.uuid4().bytes)

class MVRequestHandler(web.RequestHandler) :
    def get_current_user(self) :
        return models.User.get_by_email("kmill31415@gmail.com")
        return models.User.get_by_email(self.get_secure_cookie("user_email"))

class GoogleHandler(MVRequestHandler, tornado.auth.GoogleMixin):
    @tornado.web.asynchronous
    def get(self):
        # override the host name so that the redirect comes back to the right URL
        if self.application.settings["host_name_override"] != None :
            self.request.host = self.application.settings["host_name_override"]
        if self.get_argument("openid.mode", None):
            self.get_authenticated_user(self.async_callback(self._on_auth))
            return
        self.authenticate_redirect()

    def _on_auth(self, user):
        if not user or not user["email"]:
            raise tornado.web.HTTPError(500, "Google auth failed")
        # construct/get User object and update it
        u = models.User.get_by_email(user["email"]) or models.User(email=user["email"])
        u.first_name = user.get("first_name", None) or u.first_name
        u.last_name = user.get("last_name", None) or u.last_name
        u.locale = user.get("locale", None) or u.locale
        models.User.update(u)
        self.set_secure_cookie("user_email", u.email)
        logger.info("User logged in: %s", u)
        #self.redirect("/")
        self.redirect(self.get_argument("next", "/"))

class LoginHandler(MVRequestHandler) :
    def get(self) :
        self.render("login.html", next=self.get_argument("next", "/"))

class LogoutHandler(MVRequestHandler) :
    def get(self) :
        logger.info("User logging out.")
        self.clear_cookie("user_email")
        self.redirect("/login")

class MainHandler(MVRequestHandler) :
    @tornado.web.authenticated
    def get(self) :
        channel = channels.add_channel(self.current_user)
        self.render("index.html", channel_id=channel.channel_id)

class PollHandler(MVRequestHandler) :
    @tornado.web.authenticated
    @tornado.web.asynchronous
    def post(self) :
        logger.info("Poll request for %s", self.current_user)
        channel = None
        try :
            logger.info("channel_id=%s", self.get_argument("channel_id", None))
            self.channel_id = int(self.get_argument("channel_id", None))
            channel = channels.get_channel(self.channel_id)
        except TypeError, ValueError :
            pass
        if channel != None and not channel.verify(self.current_user) :
            channel = None
        if channel == None :
            logger.warning("User %s got empty channel", self.current_user)
            self.finish({"error" : "no such channel"})
            return
        channel.add_callback(self.on_new_messages)
    def on_new_messages(self, messages) :
        logger.info("Sending messages to %s", self.current_user)
        if self.request.connection.stream.closed() :
            return False
        else :
            self.finish(dict(messages=[m.serialize() for m in messages]))
            return True
    def on_connection_close(self) :
        logger.info("client closed the connection")
        channel = channels.get_channel(self.channel_id)
        if channel != None :
            channel.remove_callback(self.on_new_messages)

class PushHandler(MVRequestHandler) :
    def get(self) :
        from channel import TextMessage
        msg = self.get_argument("m", "empty message")
        channels.broadcast([TextMessage("no one", msg)])
        self.finish("Wrote out: %s" % msg)

class RpcHandler(MVRequestHandler) :
    @tornado.web.authenticated
    def post(self, module) :
        def getMessage() :
            args = json.loads(self.get_argument("message", None))
            args.setdefault("kwargs", {})["user"] = self.current_user
            return args
        if module not in methods.RPC_MODULES :
            logger.error("No such rpc module %s", module)
            self.finish(minirpc.render_exception(KeyError(module)))
        else :
            const_args = {"handler" : self, "channels" : channels}
            self.finish(minirpc.handle_request(methods.RPC_MODULES[module](**const_args),
                                               getMessage))

class BlobHandler(MVRequestHandler) :
    @tornado.web.authenticated
    def head(self, blob_id) :
        self.get(blob_id, include_body=False)

    @tornado.web.authenticated
    def get(self, blob_id, include_body=True) :
        blob = models.Blob.get_by_uuid(blob_id)
        if not blob :
            raise tornado.web.HTTPError(404)
        content = str(blob.content.stuff)
        if not blob or not models.WebBlobAccess.can_user_access(self.current_user, blob) :
            raise tornado.web.HTTPError(404)
        if blob.content_type.startswith("mime:") :
            self.set_header("Content-Type", blob.content_type[len("mime:"):])
        self.set_header("Content-Length", len(content))
        self.set_header("Last-Modified", blob.date_created)
        CACHE_MAX_AGE = 86400*365*10 # 10 years
        self.set_header("Expires", (datetime.datetime.utcnow() + datetime.timedelta(seconds=CACHE_MAX_AGE)))
        self.set_header("Cache-Control", "max-age=" + str(CACHE_MAX_AGE))
        ims_value = self.request.headers.get("If-Modified-Since")
        if ims_value is not None :
            date_tuple = email.utils.parsedate(ims_value)
            if_since = datetime.datetime.fromtimestamp(time.mktime(date_tuple))
            if if_since >= blob.date_created :
                self.set_status(304)
                return
        if not include_body :
            return
        self.write(content)
        self.flush()
        return

class UploadHandler(MVRequestHandler) :
    @tornado.web.authenticated
    def post(self, web_id) :
        web_id = int(web_id)
        users_webs = models.UserWebAccess.get_for_user(self.current_user)
        web = [w for w in users_webs if w.id == web_id][0]
        uuids = []
        blobs = []
        for f in self.request.files["files"] :
            content_type = "mime:" + (f.content_type or "plain/text")
            c = models.Content.get_by_stuff(buffer(f.body))
            b = models.Blob.make_blob(self.current_user, content_type, c)
            blobs.append(b)
            models.WebBlobAccess.add_for_blob(web, b)
            uuids.append(b.uuid)
        self.finish({"uuids" : uuids})
        channels.broadcast([channel.NewBlobMessage(b) for b in blobs])

class MVApplication(tornado.web.Application) :
    def __init__(self, host_name_override=None) :
        settings = dict(
            app_title="MetaView",
            template_path="templates",
            static_path="static",
            login_url="/login",
            cookie_secret=random256(),
            ui_modules={},
            xsrf_cookies=True,
            host_name_override=host_name_override
            )
        
        handlers = [
            (r"/", MainHandler),
            (r"/login", LoginHandler),
            (r"/login/google", GoogleHandler),
            (r"/logout", LogoutHandler),
            (r"/upload/(\d+)", UploadHandler),
            (r"/ajax/poll", PollHandler),
            (r"/ajax/rpc/(.*)", RpcHandler),
            (r"/blob/(.*)", BlobHandler),
            (r"/test/push", PushHandler),
            ]
        
        tornado.web.Application.__init__(self, handlers, **settings)

if __name__=="__main__" :
    tornado.options.parse_command_line()
    logger.info("Starting metaview...")
    application = MVApplication(host_name_override=tornado.options.options.host)
    if application.settings["host_name_override"] != None :
        logger.info("Using host name override of %s", application.settings["host_name_override"])
    portnum = tornado.options.options.port
    application.listen(portnum)
    logger.info("Listening on port %s", portnum)
    tornado.ioloop.IOLoop.instance().start()
