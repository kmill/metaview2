# methods.py
# rpc methods for manipulating the database

import minirpc
from minirpc import rpcmethod

import models

RPC_MODULES = {}
def rpc_module(name) :
    def _rpc_module(c) :
        RPC_MODULES[name] = c
        return c
    return _rpc_module

@rpc_module("test")
class TestRPC(minirpc.RPCServable) :
    def __init__(self, channels) :
        self.channels = channels
    @rpcmethod
    def hello(self, user, m) :
        self.channels.broadcast([TextMessage(user.email, m)])
        return "done"
