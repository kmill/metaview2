# minirpc.py
# a simple rpc interface

import types

import logging
logger = logging.getLogger(__name__)

def rpcmethod(name=None) :
    def _rpcmethod(f) :
        f.is_rpc = True
        f.rpc_name = name if type(name) == str else f.func_name
        return f
    if type(name) is types.FunctionType :
        return _rpcmethod(name)
    else :
        return _rpcmethod

class RPCServerMetaclass(type) :
    def __new__(cls, name, bases, dct) :
        dct2 = dct.copy()
        dct2['__rpc__'] = dict((getattr(v, "rpc_name", k), v)
                               for k, v in dct.iteritems() if getattr(v, "is_rpc", False))
        return super(RPCServerMetaclass, cls).__new__(cls, name, bases, dct2)

class RPCServable(object) :
    __metaclass__ = RPCServerMetaclass

def handle_request(servable, getMessage) :
    ident = None
    method = None
    args = None
    kwargs = None
    try :
        message = getMessage()
        if "info" in message :
            if "dir" == message["info"] :
                result = sorted(servable.__rpc__.keys())
            elif "func_doc" == message["info"] :
                result = servable.__rpc__[message["method"]].func_doc
            else :
                raise NotImplementedError("No such info request", message["info"])
        else :
            ident = message.get("id", None)
            method = message.get("method", None)
            args = message.get("args", [])
            kwargs = message.get("kwargs", {})
            #logger.debug("Handling %s", report_method(method, args, kwargs))
            logger.debug("  id=%r" % ident if ident else "")
            caller = getattr(servable, "__around_rpc__", lambda f : f())
            forResult = lambda : servable.__rpc__[method](servable, *args, **kwargs)
            result = caller(forResult)
        return {"id" : ident,
                "result" : result}
    except Exception as x :
        logger.exception("Exception handling rpc call")
        return render_exception(x, ident=ident)

def report_method(method, args, kwargs) :
    return "%s(%s)" % (method, ", ".join([repr(a) for a in args]
                                         + ["%s=%r" % (k, v)
                                            for k, v in kwargs.iteritems()]))
def render_exception(x, ident=None) :
    return {"id" : ident,
            "error" : {"type" : x.__class__.__name__,
                       "args" : x.args}}
