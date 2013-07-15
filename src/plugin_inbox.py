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
    def add_to_inbox(blob, web) :
        blob_id = blob.id if isinstance(blob, models.Blob) else blob
        with models.DB :
            models.DB.execute("insert into plugin_inbox (web_id, blob_id) values (?,?)", (web.id, blob_id))
    @staticmethod
    def remove_from_inbox(blob, web) :
        blob_id = blob.id if isinstance(blob, models.Blob) else blob
        with models.DB :
            models.DB.execute("delete from plugin_inbox where web_id=? and blob_id=?", (web.id, blob_id))
    @staticmethod
    def get_inbox_uuids(web) :
        web_id = web.id if isinstance(web, models.Web) else web
        return [r["uuid"] for r in models.DB.execute("select uuid from blobs inner join plugin_inbox on blobs.id=plugin_inbox.blob_id where web_id=?", (web_id,))]

@rpc_module("inbox")
class InboxRPC(RPCServable) :
    def __init__(self, handler, channels) :
        self.handler = handler
        self.channels = channels
    @rpcmethod
    def get_inbox(self, user, webid) :
        if models.UserWebAccess.can_user_access(user, webid) :
#            import relations
#            return dict((i, relations.get_relations_for(webid, i)) for i in Inbox.get_inbox_uuids(webid))
            return Inbox.get_inbox_uuids(webid)
        else :
            return None

class InboxMessage(channel.Message) :
    def __init__(self, blob, web, adding=True) :
        self.blob = blob
        self.web = web
        self.adding = adding
    def appropriate_for(self, user) :
        return models.UserWebAccess.can_user_access(user, self.web)
    def serialize(self) :
        import relations
        return {"type" : "InboxMessage",
                "args" : {"uuid" : self.blob.uuid,
#                          "relations" : relations.get_relations_for(self.web.id, self.blob.uuid) if self.adding else {},
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
                Inbox.add_to_inbox(m.blob, web)
                myMessages.append(InboxMessage(m.blob, web, True))
        channels.broadcast(myMessages)
    channels.add_firehose_listener(inbox_channel_callback)

