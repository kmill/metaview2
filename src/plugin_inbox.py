# plugin_inbox.py
# adds new blobs to the inbox

import models
import channel
import methods

class Inbox(object) :
    @staticmethod
    def add_to_inbox(blob, user) :
        blob_id = blob.id if isinstance(blob, models.Blob) else blob
        with models.DB :
            models.DB.execute("insert into plugin_inbox (user_id, blob_id) values (?,?)", (user.id, blob_id))
    @staticmethod
    def remove_from_inbox(blob, user) :
        blob_id = blob.id if isinstance(blob, models.Blob) else blob
        with models.DB :
            models.DB.execute("delete from plugin_inbox where user_id=? and blob_id=?", (user.id, blob_id))

class InboxMessage(channel.Message) :
    def __init__(self, blob, user, adding=True) :
        self.blob = blob
        self.user = user
        self.adding = adding
    def appropriate_for(self, user) :
        return user.id == self.user.id
    def serialize(self) :
        return {"type" : "InboxMessage",
                "args" : {"uuid" : self.blob.uuid,
                          "adding" : self.adding}}

def add_inbox_plugin(channels) :
    def inbox_channel_callback(messages) :
        newBlobMessages = [m for m in messages if isinstance(m, channel.NewBlobMessage)]
        if not newBlobMessages :
            return
        for m in newBlobMessages :
            for user in models.WebBlobAccess.users_can_access(m.blob) :
                Inbox.add_to_inbox(m.blob, user)
                channels.broadcast([InboxMessage(m.blob, user, True)])
    channels.add_firehose_listener(inbox_channel_callback)

