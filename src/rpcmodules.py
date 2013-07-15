# rpcmodules.py
# thing in which to plug rpc modules (methods.py is an example use)

import minirpc
from minirpc import rpcmethod, RPCServable

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
        import channel
        self.channels.broadcast([channel.TextMessage(user.email, m)])
        return "done"
