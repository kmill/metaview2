-- createdb.sql
-- metaview; Kyle Miller
--
-- Create the database for metaview.

create table webs (
  id integer primary key,
  web_name text not null,
  unique(web_name)
);

create table users (
  id integer primary key,
  email text not null,
  first_name text,
  last_name text,
  locale text,
  unique(email)
);

create table user_web_access (
  web_id integer not null,
  user_id integer not null,
  foreign key(web_id) references webs(id),
  foreign key(user_id) references users(id)
);

create table content (
  hash text not null,
  stuff blob not null,
  unique(hash)
);

create table blobs (
  id integer primary key,
  uuid text not null,
  date_created integer not null,
  editor_email text not null,
  content_type text not null,
  content_hash text,
  unique(uuid),
  foreign key(editor_email) references users(email),
  foreign key(content_hash) references content(hash)
);

create table blobs_web (
  web_id integer not null,
  blob_id integer not null,
  foreign key(web_id) references webs(id),
  foreign key(blob_id) references blobs(id)
);

--- cached

create table relation_types (
  id integer primary key,
  relation_type_name text,
  unique(relation_type_name)
);

create table relations (
  id integer primary key,
  web_id integer,
  subject_id integer not null,
  relation integer not null,
  object_id integer,
  payload text,
  foreign key(web_id) references webs(id),
  foreign key(subject_id) references blobs(id),
  foreign key(object_id) references blobs(id),
  foreign key(relation) references relation_types(id)
);

--- drafts