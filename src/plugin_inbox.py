# plugin_inbox.py
# adds new blobs to the inbox

import models
import channel
import methods
from rpcmodules import rpc_module

import minirpc
from minirpc import rpcmethod, RPCServable

class Inbox(object) :
    @staticmethod
    def add_to_inbox(user, web, blob) :
        blob_id = blob.id if isinstance(blob, models.Blob) else blob
        with models.DB :
            models.DB.execute("insert into plugin_inbox (user_id, web_id, blob_id) values (?,?,?)", (user.id, web.id, blob_id))
    @staticmethod
    def remove_from_inbox(user, web, blob) :
        blob_id = blob.id if isinstance(blob, models.Blob) else blob
        with models.DB :
            models.DB.execute("delete from plugin_inbox where user_id=? and web_id=? and blob_id=?", (user.id, web.id, blob_id))
    @staticmethod
    def get_inbox_uuids(user, web) :
        web_id = web.id if isinstance(web, models.Web) else web
        return [r["uuid"] for r in models.DB.execute("select uuid from blobs inner join plugin_inbox pi on blobs.id=pi.blob_id where pi.user_id=? and web_id=?", (user.id, web_id,))]

@rpc_module("inbox")
class InboxRPC(RPCServable) :
    def __init__(self, handler, channels) :
        self.handler = handler
        self.channels = channels
    @rpcmethod
    def get_inbox(self, user, webid) :
        if models.UserWebAccess.can_user_access(user, webid) :
            return Inbox.get_inbox_uuids(user, webid)
        else :
            return None

class InboxMessage(channel.Message) :
    def __init__(self, user, web, blob, adding=True) :
        self.user = user
        self.web = web
        self.blob = blob
        self.adding = adding
    def appropriate_for(self, user) :
        return self.user.id == user.id
    def serialize(self) :
        return {"type" : "InboxMessage",
                "args" : {"uuid" : self.blob.uuid,
                          "web_id" : self.web.id,
                          "adding" : self.adding}}

def add_inbox_plugin(channels) :
    def inbox_channel_callback(messages) :
        newBlobMessages = [m for m in messages if isinstance(m, channel.NewBlobMessage)]
        if not newBlobMessages :
            return
        myMessages = []
        for m in newBlobMessages :
            for web in models.WebBlobAccess.get_webs_for_blob(m.blob) :
                for user in models.UserWebAccess.users_for_web(web) :
                    Inbox.add_to_inbox(user, web, m.blob)
                    myMessages.append(InboxMessage(user, web, m.blob, True))
        channels.broadcast(myMessages)
    channels.add_firehose_listener(inbox_channel_callback)

