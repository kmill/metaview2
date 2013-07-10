# methods.py
# rpc methods for manipulating the database

import minirpc
from minirpc import rpcmethod, RPCServable

import models
import channel

RPC_MODULES = {}
def rpc_module(name) :
    def _rpc_module(c) :
        RPC_MODULES[name] = c
        return c
    return _rpc_module

@rpc_module("test")
class TestRPC(minirpc.RPCServable) :
    def __init__(self, handler, channels) :
        self.handler = handler
        self.channels = channels
    @rpcmethod
    def hello(self, user, m) :
        self.channels.broadcast([channel.TextMessage(user.email, m)])
        return "done"


@rpc_module("webs")
class WebsRPC(RPCServable) :
    def __init__(self, handler, channels) :
        self.handler = handler
        self.channels = channels
    @rpcmethod
    def create_web(self, user, webname) :
        if webname in [w.name for w in models.Web.get_all()] :
            return None
        web = models.Web(name=webname)
        models.Web.update(web)
        models.UserWebAccess.add_for_user(web, user)
        self.channels.broadcast([channel.WebChangeMessage(web.id, web.name)])
        return web.id
    @rpcmethod
    def rename_web(self, user, id, newwebname) :
        if newwebname in [w.name for w in models.Web.get_all()] :
            return None
        web = models.Web.get_by_id(id)
        web.name = newwebname
        models.Web.update(web)
        self.channels.broadcast([channel.WebChangeMessage(web.id, web.name)])
        return web.id
    @rpcmethod
    def get_webs(self, user) :
        return dict((w.id, w.name) for w in models.UserWebAccess.get_for_user(user))
    @rpcmethod
    def set_default_web(self, user, web_id) :
        self.handler.set_cookie("default_web_id", str(web_id))
