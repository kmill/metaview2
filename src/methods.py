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
        if blob.content_type.startswith("mime:text/") :
            ret["summary"] = self.blob_summary(blob)
        if with_content :
            ret["content"] = blob.content.stuff
        return ret
    def blob_summary(self, blob) :
        content = blob.content.stuff
        summary = content[:min(len(content), 160)]
        return " ".join(summary.split())
    def rel_as_dict(self, rel) :
        return {"uuid" : None if rel.uuid.startswith("pseudo:") else rel.uuid,
                "date_created" : httputil.format_timestamp(rel.date_created),
                "deleted" : getattr(rel, "deleted", None),
                "name" : rel.name,
                "subject" : rel.subject_uuid,
                "object" : rel.object_uuid,
                "payload" : rel.payload}
    @rpcmethod
    def get_blob_metadata(self, user, web_id, uuids) :
        if web_id not in [w.id for w in models.UserWebAccess.get_for_user(user)] :
            raise Exception("no such web") # makes sure has explicit access
        blobs = []
        for uuid in set(uuids) :
            b = models.Blob.get_by_uuid(uuid)
            if b != None :
                srels = relations.get_inherited_relations(web_id, uuid)
                orels = relations.CachedRelation.get_for_object(web_id, uuid)
                blobs.append({"blob" : self.blob_as_dict(b),
                              "srels" : [self.rel_as_dict(r) for r in srels],
                              "orels" : [self.rel_as_dict(r) for r in orels]})
        return blobs
    @rpcmethod
    def create_blob(self, user, web_id, content, mime_type=None, title=None, tags=[], revises=[]) :
        if web_id not in [w.id for w in models.UserWebAccess.get_for_user(user)] :
            raise Exception("no such web") # makes sure has explicit access
        web = models.Web.get_by_id(web_id)
        content_type = "mime:" + (mime_type or "plain/text")
        c = models.Content.get_by_stuff(str(content))
        b = models.Blob.make_blob(user, content_type, c)
        models.WebBlobAccess.add_for_blob(web, b)
        for puuid in revises :
            parent_blob = models.Blob.get_by_uuid(puuid)
            if parent_blob :
                relations.BinaryRelation.make(web, user, "revises", b, parent_blob)
        # we don't want to just add tags and title; we want to ensure their presence
        inherited = relations.get_inherited_relations(web, b)
        if title :
            inherited_title = [r for r in inherited if not r.deleted and r.name == "title"]
            for r in inherited_title :
                if r.payload != title :
                    relations.BinaryRelation.make(web, user, "deletes", b, r.blob)
                    print "deleting",r
            if not any(r.payload == title for r in inherited_title) :
                relations.BinaryRelation.make(web, user, "title", b, title)
                print "adding"
        tags = set([t.strip() for t in tags if t.strip()])
        inherited_tags = [r for r in inherited if not r.deleted and r.name == "tag"]
        inherited_tags_payloads = set(r.payload for r in inherited_tags)
        for r in inherited_tags :
            if r.payload not in tags :
                relations.BinaryRelation.make(web, user, "deletes", b, r.blob)
        for tag in tags :
            if tag not in inherited_tags_payloads :
                relations.BinaryRelation.make(web, user, "tag", b, tag)
        self.channels.broadcast([channel.NewBlobMessage(b)])
        return b.uuid
    @rpcmethod
    def remove_tag(self, user, web_id, uuid, tag) :
        if web_id not in [w.id for w in models.UserWebAccess.get_for_user(user)] :
            raise Exception("no such web") # makes sure has explicit access
        web = models.Web.get_by_id(web_id)
        b = models.Blob.get_by_uuid(uuid)
        inherited = relations.get_inherited_relations(web_id, b)
        inherited_tags = [r for r in inherited if not r.deleted and r.name == "tag"]
        for r in inherited_tags :
            if r.payload == tag :
                relations.BinaryRelation.make(web, user, "deletes", b, r.blob)
        return True
    @rpcmethod
    def add_tag(self, user, web_id, uuid, tag) :
        if web_id not in [w.id for w in models.UserWebAccess.get_for_user(user)] :
            raise Exception("no such web") # makes sure has explicit access
        tag = tag.strip()
        if not tag : return False
        web = models.Web.get_by_id(web_id)
        b = models.Blob.get_by_uuid(uuid)
        inherited = relations.get_inherited_relations(web_id, b)
        inherited_tags = [r for r in inherited if not r.deleted and r.name == "tag"]
        for r in inherited_tags :
            if r.payload == tag :
                return True
        relations.BinaryRelation.make(web, user, "tag", b, tag)
        return True
