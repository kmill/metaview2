# methods.py
# rpc methods for manipulating the database

import minirpc
from minirpc import rpcmethod, RPCServable
from rpcmodules import rpc_module
import relations

import models
import channel

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
        if not newwebname or newwebname in [w.name for w in models.Web.get_all()] :
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


@rpc_module("users")
class UsersRPC(RPCServable) :
    def __init__(self, handler, channels) :
        self.handler = handler
        self.channels = channels
    def user_as_dict(self, user) :
        return {"email" : user.email,
                "first_name" : user.first_name,
                "last_name" : user.last_name,
                "avatar" : None}
    @rpcmethod
    def get_users(self, user) :
        users = models.User.get_all()
        return [self.user_as_dict(u) for u in users]

@rpc_module("blobs")
class BlobsRPC(RPCServable) :
    def __init__(self, handler, channels) :
        self.handler = handler
        self.channels = channels
    def blob_as_dict(self, blob, with_content=False) :
        ret = {"uuid" : blob.uuid,
               "date_created" : blob.date_created.isoformat(),
               "editor_email" : blob.editor_email,
               "content_type" : blob.content_type}
        if with_content :
            ret["content"] = blob.content.stuff
        return ret
    @rpcmethod
    def get_blob_metadata(self, user, web_id, uuids) :
        seen = set()
        to_process = list(uuids)
        blobs = []
        while to_process :
            uuid = to_process.pop()
            if uuid and uuid not in seen :
                seen.add(uuid)
                b = models.Blob.get_by_uuid(uuid)
                with_content = b.content_type.startswith("relation:")
                blobs.append(self.blob_as_dict(b, with_content=with_content))
                for rel in relations.get_relations_for_subject(web_id, uuid) :
                    to_process.append(rel['ruuid'])
                    to_process.append(rel['ouuid'])
                for rel in relations.get_relations_for_object(web_id, uuid) :
                    to_process.append(rel)
        return blobs

