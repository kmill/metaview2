import sqlite3
import os.path
import hashlib
import time
import datetime
import uuid

DB = None

def db_connect(dbfile) :
    """Connects to the db.  Sets the global DB variable because there should be only
    one connection to the db at a time anyway."""
    global DB
    if not os.path.isfile(dbfile) :
        raise TypeError("The database file must be created first.")
    DB = sqlite3.connect(dbfile)
    DB.row_factory = sqlite3.Row

class Web(object) :
    def __init__(self, id=None, name=None) :
        self.id = id
        self.name = name
    def __repr__(self) :
        return "Web(id=%r, name=%r)" % (self.id, self.name)
    @staticmethod
    def update(web) :
        with DB :
            if web.id == None :
                c = DB.execute("insert into webs (web_name) values (?)", (web.name,))
                web.id = c.lastrowid
            else :
                DB.execute("update webs set web_name=? where id=?", (web.name, web.id,))
    @staticmethod
    def get_all() :
        return [Web(id=row['id'], name=row['web_name'])
                for row in DB.execute("select id, web_name from webs")]
    @staticmethod
    def get_by_id(id) :
        for row in DB.execute("select id, web_name from webs where id=?", (id,)) :
            return Web(id=row['id'], name=row['web_name'])
        return None


class UserWebAccess(object) :
    @staticmethod
    def get_for_user(user) :
        return [Web(id=row['id'], name=row['web_name'])
                for row in DB.execute('select id, web_name from webs inner join user_web_access on user_web_access.web_id=webs.id where user_web_access.user_id=?', (user.id,))]
    @staticmethod
    def can_user_access(user, web) :
        user_id = user.id if isinstance(user, User) else user
        web_id = web.id if isinstance(web, Web) else web
        return None != DB.execute("select web_id from user_web_access where user_id=? and web_id=?", (user_id, web_id)).fetchone()
    @staticmethod
    def remove_for_user(web, user) :
        with DB :
            DB.execute("delete from user_web_access where web_id=? and user_id=?",
                         (web.id, user.id))
    @staticmethod
    def add_for_user(web, user) :
        with DB :
            DB.execute("insert into user_web_access (web_id, user_id) values (?,?)",
                         (web.id, user.id))

class User(object) :
    def __init__(self, id=None, email=None, first_name=None, last_name=None, locale=None, avatar=None) :
        self.id = id
        self.email = email
        self.first_name = first_name
        self.last_name = last_name
        self.locale = locale
        self.avatar = avatar
    def __repr__(self) :
        return "User(id=%r, email=%r, first_name=%r, last_name=%r, locale=%r, avatar=%r)" % (self.id, self.email, self.first_name, self.last_name, self.locale, self.avatar)
    @staticmethod
    def update(user) :
        with DB :
            if user.id == None :
                c = DB.execute("insert into users (email, first_name, last_name, locale, avatar) values (?,?,?,?,?)",
                                 (user.email, user.first_name, user.last_name, user.locale, user.avatar))
                user.id = c.lastrowid
            else :
                DB.execute("update users set email=?, first_name=?, last_name=?, locale=?, avatar=? where id=?",
                             (user.email, user.first_name, user.last_name, user.locale, user.avatar, user.id))
    @staticmethod
    def get_by_email(email) :
        for row in DB.execute("select id, email, first_name, last_name, locale, avatar from users where email=?", (email,)) :
            return User(id=row['id'], email=row['email'],
                        first_name=row['first_name'], last_name=row['last_name'],
                        locale=row['locale'], avatar=row['avatar'])
        return None
    @staticmethod
    def get_by_id(id) :
        for row in DB.execute("select id, email, first_name, last_name, locale, avatar from users where id=?", (id,)) :
            return User(id=row['id'], email=row['email'],
                        first_name=row['first_name'], last_name=row['last_name'],
                        locale=row['locale'], avatar=row['avatar'])
        return None
    @staticmethod
    def get_all() :
        users = []
        for row in DB.execute("select id, email, first_name, last_name, locale, avatar from users") :
            users.append(User(id=row['id'], email=row['email'],
                              first_name=row['first_name'], last_name=row['last_name'],
                              locale=row['locale'], avatar=row['avatar']))
        return users

class Content(object) :
    def __init__(self, hash=None, stuff=None) :
        self.hash = hash
        self.stuff = stuff
    def __repr__(self) :
        return "Content(hash=%s)" % self.hash
    @staticmethod
    def make_hash_from_string(s) :
        m = hashlib.sha1()
        m.update(s)
        return m.hexdigest()
    @staticmethod
    def get_by_stuff(stuff) :
        """Gets a content object for the string, adding the stuff to the database if
        it is not already present."""
        hash = Content.make_hash_from_string(stuff)
        r = DB.execute("select hash from content where hash=?", (hash,)).fetchone()
        if r == None :
            with DB :
                DB.execute("insert into content (hash, stuff) values (?,?)", (hash, stuff))
            return Content(hash=hash, stuff=stuff)
        else :
            return Content(hash=hash, stuff=stuff)
    @staticmethod
    def get_by_hash(hash) :
        r = DB.execute("select stuff from content where hash=?", (hash,)).fetchone()
        if r == None :
            return None
        else :
            return Content(hash=hash, stuff=r['stuff'])
    @staticmethod
    def get_by_file(filename) :
        with open(filename, 'rb') as f :
            content = f.read()
        return Content.get_by_stuff(buffer(content))
        c = Content.get_by_hash(hash)
        if c == None :
            with DB :
                DB.execute("insert into content (hash, stuff) values (?,?)", (hash, "".join(lines)))
            c = Content(hash=hash, stuff=stuff)
        return c

class Blob(object) :
    def __init__(self, id=None, uuid=None, date_created=None, editor_email=None, content_type=None, content_hash=None) :
        self.id = id
        self.uuid = uuid
        self.date_created = date_created
        self.editor_email = editor_email
        self._editor = None
        self.content_type = content_type
        self.content_hash = content_hash
        self._content = None
    def __repr__(self) :
        return "Blob(%r)" % self.uuid
    @property
    def content(self) :
        if self._content == None :
            self._content = Content.get_by_hash(self.content_hash)
        return self._content
    @property
    def editor(self) :
        if self._editor == None :
            self._editor = User.get_by_email(self.editor_email)
    @staticmethod
    def get_by_uuid(uuid) :
        r = DB.execute("select id, uuid, date_created, editor_email, content_type, content_hash from blobs where uuid=?", (uuid,)).fetchone()
        if r == None :
            return None
        else :
            created = datetime.datetime.utcfromtimestamp(r["date_created"])
            return Blob(id=r["id"], uuid=r["uuid"], date_created=created,
                        editor_email=r["editor_email"], content_type=r["content_type"], content_hash=r["content_hash"])
    @staticmethod
    def make_blob(editor, content_type, content) :
        if isinstance(content, Content) :
            content = content.hash
        id = uuid.uuid4().hex
        with DB :
            DB.execute("insert into blobs (uuid, date_created, editor_email, content_type, content_hash) values (?,?,?,?,?)", (id, int(time.time()), editor.email, content_type, content))
        return Blob.get_by_uuid(id)

class WebBlobAccess(object) :
#    @staticmethod
#    def get_for_blob(user) :
#        return [Web(id=row['id'], name=row['web_name'])
#                for row in DB.execute('select id, web_name from webs inner join user_web_access on user_web_access.web_id=webs.id where user_web_access.user_id=?', (user.id,))]
    @staticmethod
    def can_user_access(user, blob) :
        r = DB.execute("select blobs.id from blobs inner join blobs_web on blobs.id=blobs_web.blob_id inner join user_web_access on blobs_web.web_id=user_web_access.web_id where blobs.id=? and user_web_access.user_id=?", (blob.id, user.id)).fetchone()
        return r != None
    @staticmethod
    def users_can_access(blob) :
        return [User.get_by_id(r['id']) for r in DB.execute("select user_web_access.user_id as id from blobs inner join blobs_web on blobs.id=blobs_web.blob_id inner join user_web_access on blobs_web.web_id=user_web_access.web_id where blobs.id=?", (blob.id,))]

    @staticmethod
    def remove_for_web(web, blob) :
        with DB :
            DB.execute("delete from blobs_web where web_id=? and blob_id=?",
                       (web.id, blob.id))
    @staticmethod
    def add_for_blob(web, blob) :
        with DB :
            DB.execute("insert into blobs_web (web_id, blob_id) values (?,?)",
                         (web.id, blob.id))
    @staticmethod
    def get_webs_for_blob(blob) :
        blob_id = blob.id if isinstance(blob, Blob) else blob
        return [Web.get_by_id(r['web_id']) for r in DB.execute("select web_id from blobs_web where blob_id=?", (blob_id,))]
