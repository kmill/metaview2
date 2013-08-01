# plugin_inbox.py
# adds new blobs to the inbox

import models
import channel
import methods
from rpcmodules import rpc_module

import minirpc
from minirpc import rpcmethod, RPCServable

import datetime

class Relation(object) :
    _cached_relation_types = {}
    _cached_relation_types_by_id = {}
    def __init__(self, backing_blob=None) :
        """Treats a blob as a relation."""
        self._backing_blob = backing_blob
    @property
    def type(self) :
        if not self.backing_blob.content_type.startswith("relation:") :
            raise TypeError("The blob %s is not a relation." % self.backing_blob.uuid)
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

class BinaryRelation(Relation) :
    """A binary relation relates a blob to some object of some kind
    (such as a string or a blob)."""
    def __init__(self, *arg, **kwargs) :
        super(BinaryRelation, self).__init__(*arg, **kwargs)
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
            object_id = content.id # for rel cache
            content = content.uuid # for rel blob
        else :
            payload_text = content # for rel cache
        if not isinstance(content, basestring) :
            raise TypeError("content must be a string (or a blob)")
        payload = models.Content.get_by_stuff("%s\n%s" % (subject.uuid, content))
        b = models.Blob.make_blob(editor, "relation:" + name, payload)
        models.WebBlobAccess.add_for_blob(web, b)
        # cache the relation (otherwise traversal would be horrendous!)
        relid = Relation.get_relation_type_id(name)
        with models.DB :
            models.DB.execute("insert into relations (web_id, blob_id, subject_id, relation, object_id, payload) values (?,?,?,?,?,?)",
                              (web.id, b.id, subject.id, relid, object_id, payload_text))
        return b

class CachedRelation(object) :
    def __init__(self, uuid, date_created, name, subject_uuid, object_uuid=None, payload=None) :
        self.uuid = uuid
        self.date_created = date_created
        self.name = name
        self.subject_uuid = subject_uuid
        self.object_uuid = object_uuid
        self.payload = payload
        self.deleted = False # assume not deleted until get_inherited_relations says otherwise
        self._blob = None
        self._subject = None
        self._object = None
    pseudo_counter = 0
    @staticmethod
    def make_pseudo(date_created, name, subject_uuid, payload) :
        CachedRelation.pseudo_counter += 1
        return CachedRelation("pseudo:" + str(CachedRelation.pseudo_counter),
                              date_created, name, subject_uuid, payload=payload)
    @property
    def blob(self) :
        if self._blob == None :
            self._blob = models.Blob.get_by_uuid(self.uuid)
        return self._blob
    @property
    def subject(self) :
        if self._subject == None :
            self._subject = models.Blob.get_by_uuid(self.subject_uuid)
        return self._subject
    @property
    def object(self) :
        if self._object == None :
            self._object = models.Blob.get_by_uuid(self.object_uuid)
        return self._object
    def __repr__(self) :
        return "CachedRelation(uuid=%r,date_created=%r,name=%r,subject_uuid=%r,object_uuid=%r,payload=%r)" \
            % (self.uuid, self.date_created, self.name, self.subject_uuid, self.object_uuid, self.payload)
    @staticmethod
    def get_for_subject(web_id, blob_uuid) :
        if isinstance(web_id, models.Web) :
            web_id = web_id.id
        if isinstance(blob_uuid, models.Blob) :
            blob_uuid = blob_uuid.uuid
        q = models.DB.execute("""
        select rblob.uuid, rblob.date_created, r.relation, r.object_id, oblob.uuid as object_uuid, r.payload
        from relations as r
        inner join blobs as rblob on rblob.id=r.blob_id
        inner join blobs as sblob on sblob.id=r.subject_id
        left join blobs as oblob on oblob.id=r.object_id
        where r.web_id=? and sblob.uuid=?""", (web_id, blob_uuid))
        rels = []
        for row in q :
            rels.append(CachedRelation(uuid=row['uuid'],
                                       date_created=datetime.datetime.utcfromtimestamp(row["date_created"]),
                                       name=Relation.get_relation_name(row['relation']),
                                       subject_uuid=blob_uuid,
                                       object_uuid=row['object_uuid'],
                                       payload=row['payload']))
        return rels
    @staticmethod
    def get_for_object(web_id, blob_uuid) :
        if isinstance(web_id, models.Web) :
            web_id = web_id.id
        if isinstance(blob_uuid, models.Blob) :
            blob_uuid = blob_uuid.uuid
        q = models.DB.execute("""
        select rblob.uuid, rblob.date_created, r.relation, sblob.uuid as subject_uuid, oblob.uuid as object_uuid, r.payload
        from relations as r
        inner join blobs as rblob on rblob.id=r.blob_id
        inner join blobs as sblob on sblob.id=r.subject_id
        inner join blobs as oblob on oblob.id=r.object_id
        where r.web_id=? and oblob.uuid=?""", (web_id, blob_uuid))
        rels = []
        for row in q :
            rels.append(CachedRelation(uuid=row['uuid'],
                                       date_created=datetime.datetime.utcfromtimestamp(row["date_created"]),
                                       name=Relation.get_relation_name(row['relation']),
                                       subject_uuid=row['subject_uuid'],
                                       object_uuid=row['object_uuid'],
                                       payload=row['payload']))
        return rels

def get_inherited_relations(web_id, blob_uuid) :
    """Returns a list of CachedRelation objects which are inherited by the blob (these are subject relations)."""
    if isinstance(web_id, models.Web) :
        web_id = web_id.id
    if isinstance(blob_uuid, models.Blob) :
        blob_uuid = blob_uuid.uuid

    def sane_revises(r) :
        """Enforce arrow of time!"""
        if r.name != "revises" :
            return False
        subject_created = models.Blob.get_created_by_uuid(r.subject_uuid)
        object_created = models.Blob.get_created_by_uuid(r.object_uuid)
        return subject_created != None and object_created != None and subject_created > object_created

    inher_rels = {}
    def _get_rels(uuid) :
        if uuid in inher_rels :
            return inher_rels[uuid]
        rels = CachedRelation.get_for_subject(web_id, uuid)
        # step 1: inherit
        revs = [r for r in rels if sane_revises(r)]
        got = {} # uuid -> (Maybe date(revises), r)  (date is none to mean non-inherited)
        for rev in revs :
            rrels = _get_rels(rev.object_uuid)
            for t, r in rrels :
                if r.uuid in got :
                    if  got[r.uuid][0] > rev.date_created :
                        got[r.uuid][0] = rev.date_created
                else :
                    got[r.uuid] = [rev.date_created, r]
        # step 2: provide own
        for r in rels :
            got[r.uuid] = [None, r]
        my_inher_rels = got.values()
        # step 3: add pseudo-relation (for author list)
        blob = models.Blob.get_by_uuid(uuid)
        def make_pseudo(name, value) :
            return [blob.date_created, CachedRelation.make_pseudo(blob.date_created, name, uuid, value)]
        my_inher_rels.append(make_pseudo("editor", blob.editor_email))
        # cache
        inher_rels[uuid] = my_inher_rels
        return my_inher_rels
    # don't need to keep track of which r[0] are None because inherited <=> rel.subject_uuid != blob_uuid
    rels = [r[1] for r in _get_rels(blob_uuid)]
    # mark deletions
    rels.sort(key=lambda r : r.date_created, reverse=True)
    deleted = set()
    for rel in rels :
        if rel.uuid and rel.uuid not in deleted and rel.name == "deletes" :
            deleted.add(rel.object)
            rel.deleted = True
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
