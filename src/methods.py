# methods.py
# rpc methods for manipulating the database

import minirpc
from minirpc import rpcmethod, RPCServable
from rpcmodules import rpc_module
import relations
from tornado import httputil

import models
import channel

@rpc_module("webs")
class WebsRPC(RPCServable) :
    def __init__(self, handler, channels) :
        self.handler = handler
        self.channels = channels
    @rpcmethod
    def create_web(self, user, webname) :
        webname = str(webname).strip()
        if not webname or webname in [w.name for w in models.Web.get_all()] :
            return None
        web = models.Web(name=webname, public=False)
        models.Web.update(web)
        models.UserWebAccess.add_for_user(web, user)
        self.channels.broadcast([channel.WebChangeMessage(web.id, web.name, web.public)])
        return web.id
    @rpcmethod
    def rename_web(self, user, id, newwebname) :
        newwebname = str(newwebname).strip()
        if not newwebname or newwebname in [w.name for w in models.Web.get_all()] :
            return None
        web = models.Web.get_by_id(id)
        if not web or user.id not in [u.id for u in models.UserWebAccess.users_for_web(id)] :
            raise Exception("no such web") # makes sure has explicit access
        web.name = newwebname
        models.Web.update(web)
        self.channels.broadcast([channel.WebChangeMessage(web.id, web.name, web.public)])
        return web.id
    @rpcmethod
    def set_public(self, user, id, isPublic) :
        web = models.Web.get_by_id(id)
        if not web or user.id not in [u.id for u in models.UserWebAccess.users_for_web(id)] :
            raise Exception("no such web") # makes sure has explicit access
        wasPublic = web.public
        web.public = bool(isPublic)
        models.Web.update(web)
        self.channels.broadcast([channel.WebChangeMessage(web.id, web.name, web.public, was_public=wasPublic)])
        return
    @rpcmethod
    def get_webs(self, user) :
        return {w.id : {'name' : w.name, 'isPublic' : w.public}
                for w in models.UserWebAccess.get_for_user(user)}
    @rpcmethod
    def get_web_users(self, user, id) :
        if not models.UserWebAccess.can_user_access(user, id) :
            raise Exception("no such web") # public is ok
        return [u.email for u in models.UserWebAccess.users_for_web(id)]
    @rpcmethod
    def delete_web(self, user, id) :
        web = models.Web.get_by_id(id)
        if not web or id not in [w.id for w in models.UserWebAccess.get_for_user(user)] :
            raise Exception("no such web") # makes sure has explicit access
        if models.WebBlobAccess.does_web_have_blobs(web) :
            return False
        for user in models.UserWebAccess.users_for_web(web) :
            models.UserWebAccess.remove_for_user(web, user)
        old_id = web.id
        web.remove()
        self.channels.broadcast([channel.WebChangeMessage(old_id, None, web.public)])
        return True
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
               "date_created" : httputil.format_timestamp(blob.date_created),
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
                if b != None :
                    with_content = b.content_type.startswith("relation:")
                    blobs.append(self.blob_as_dict(b, with_content=with_content))
                    for rel in relations.get_relations_for_subject(web_id, uuid) :
                        to_process.append(rel['ruuid'])
                        to_process.append(rel['ouuid'])
                    for rel in relations.get_relations_for_object(web_id, uuid) :
                        to_process.append(rel)
        return blobs

