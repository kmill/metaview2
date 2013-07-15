# plugin_inbox.py
# adds new blobs to the inbox

import models
import channel
import methods
from rpcmodules import rpc_module

import minirpc
from minirpc import rpcmethod, RPCServable

class Relation(object) :
    _cached_relation_types = {}
    _cached_relation_types_by_id = {}
    def __init__(self, backing_blob=None) :
        """Treats a blob as a relation."""
        self.backing_blob = backing_blob
    @property
    def type(self) :
        if not self.backing_blob.content_type.startswith("relation:") :
            return None
        else :
            return self.backing_blob.content_type[len("relation:"):]
    @property
    def raw_payload(self) :
        return self.backing_blob.content
    @staticmethod
    def get_relation_type_id(name) :
        """Gets the id of a relation type, inserts into the db if it's
        not already present."""
        try :
            return Relation._cached_relation_types[name]
        except KeyError :
            for row in models.DB.execute("select id from relation_types where relation_type_name=?", (name,)) :
                Relation._cached_relation_types[name] = row['id']
                Relation._cached_relation_types_by_id[row['id']] = name
                return row['id']
            else :
                with models.DB :
                    c = models.DB.execute("insert into relation_types (relation_type_name) values (?)", (name,))
                    Relation._cached_relation_types[name] = c.lastrowid
                    Relation._cached_relation_types_by_id[c.lastrowid] = name
                    return c.lastrowid
    @staticmethod
    def get_relation_name(id) :
        """Gets the name of a relation by id."""
        try :
            return Relation._cached_relation_types_by_id[id]
        except KeyError :
            for row in models.DB.execute("select relation_type_name as name from relation_types where id=?", (id,)) :
                Relation._cached_relation_types[row['name']] = id
                Relation._cached_relation_types_by_id[id] = row['name']
                return row['name']
            else :
                raise KeyError(id)

class UnaryRelation(Relation) :
    """A unary relation has one thing in its payload, the uuid of a
    blob. (Note: such a relation is known as a predicate.)"""
    def __init__(self, *arg, **kwargs) :
        super(UnaryRelation, self).__init__(*arg, **kwargs)
        self._subject = None
    @property
    def subject(self) :
        if self._subject == None :
            self._subject = models.get_by_uuid(self.raw_payload)
        return self._subject
    @staticmethod
    def make(web, editor, name, subject) :
        """Creates and stores a new unary relation blob."""
        payload = models.Content.get_by_stuff(subject.uuid)
        b = models.Blob.make_blob(editor, "relation:" + name, payload)
        relid = Relation.get_relation_type_id(name)
        models.DB.execute("insert into relations (web_id, blob_id, subject_id, relation) values (?,?,?,?)",
                          (web.id, b.id, subject.id, relid))
        return b

class BinaryRelation(Relation) :
    """A binary relation relates a blob to some object of some kind
    (such as a string or a blob)."""
    def __init__(self, *arg, **kwargs) :
        super(UnaryRelation, self).__init__(*arg, **kwargs)
        self._subject = None
        self._object = None
    @property
    def payload_parts(self) :
        return self.raw_payload.split('\n', 2)
    @property
    def subject(self) :
        """Gets the x in xRy as a blob."""
        if self._subject == None :
            self._subject = models.get_by_uuid(self.payload_parts[0])
        return self._subject
    @property
    def content(self) :
        """Gets the y in xRy as raw text."""
        return self.payload_parts[1]
    @property
    def object(self) :
        """Gets the y in xRy as a blob."""
        if self._object == None :
            self._object = models.get_by_uuid(self.payload_parts[1])
        return self._object
    @staticmethod
    def make(web, editor, name, subject, content) :
        """Creates and stores a new binary relation blob.  The content
        is converted into a string (with blob -> blob.uuid)."""
        object_id = None
        payload_text = None
        if isinstance(content, models.Blob) :
            object_id = content.id
            content = content.uuid
        else :
            payload_text = content
        if not isinstance(content, basestring) :
            raise TypeError("content must be a string (or a blob)")
        payload = models.Content.get_by_stuff("%s\n%s" % (subject.uuid, content))
        b = models.Blob.make_blob(editor, "relation:" + name, payload)
        relid = Relation.get_relation_type_id(name)
        print (web.id, b.id, subject.id, relid, object_id, payload_text)
        models.DB.execute("insert into relations (web_id, blob_id, subject_id, relation, object_id, payload) values (?,?,?,?,?,?)",
                          (web.id, b.id, subject.id, relid, object_id, payload_text))
        return b

def get_relations_for_subject(web_id, blob_uuid) :
    """Gets all relations which for which the blob is the
    subject."""
    if isinstance(web_id, models.Web) :
        web_id = web_id.id
    if isinstance(blob_uuid, models.Blob) :
        blob_uuid = blob_uuid.uuid
    q = models.DB.execute("""
    select r.blob_id, rblob.uuid, r.relation, r.object_id, oblob.uuid as object_uuid, r.payload
    from relations as r
    inner join blobs as rblob on rblob.id=r.blob_id
    inner join blobs as sblob on sblob.id=r.subject_id
    left join blobs as oblob on oblob.id=r.object_id
    where r.web_id=? and sblob.uuid=?""", (web_id, blob_uuid))
    for row in q :
        rels.append({"uuid" : row['uuid'],
                     "name" : Relation.get_relation_name(row['relation']),
                     "subject" : blob_uuid,
                     "object" : row['object_uuid'],
                     "payload" : row['payload'],
                     "subrelations" : get_relations_for(web_id, row["uuid"])})
    return rels

def get_relations_for_subject(web_id, blob_uuid) :
    rels = []
    q = models.DB.execute("""
    select rblob.uuid as ruuid, oblob.uuid as ouuid
    from relations as r
    inner join blobs as rblob on rblob.id=r.blob_id
    inner join blobs as sblob on sblob.id=r.subject_id
    left join blobs as oblob on oblob.id=r.object_id
    where r.web_id=? and sblob.uuid=?""", (web_id, blob_uuid))
    for row in q :
        rels.append({"ruuid" : row['ruuid'], "ouuid" : row['ouuid']})
    return rels

def get_relations_for_object(web_id, blob_uuid) :
    rels = []
    q = models.DB.execute("""
    select rblob.uuid as ruuid
    from relations as r
    inner join blobs as rblob on rblob.id=r.blob_id
    inner join blobs as oblob on oblob.id=r.object_id
    where r.web_id=? and oblob.uuid=?""", (web_id, blob_uuid))
    for row in q :
        rels.append(row['ruuid'])
    return rels

@rpc_module("relations")
class RelationsRPC(RPCServable) :
    def __init__(self, handler, channels) :
        self.handler = handler
        self.channels = channels
    @rpcmethod
    def get_relations_for(self, webid, blob_uuids) :
        if models.UserWebAccess.can_user_access(user, webid) :
            return dict((i, get_relations_for(web_id, i)) for i in blob_uuids)
        else :
            return None

def add_relation_plugin(channel) :
    def relation_cache_callback(messages) :
        oeu
    channel.add_firehose_listener(messages)
