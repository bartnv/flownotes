ALTER TABLE "note" ADD COLUMN deleted bool default false;
CREATE TABLE "link" (id integer primary key, source integer not null, target integer not null, name text, FOREIGN KEY(source) REFERENCES note(id), FOREIGN KEY(target) REFERENCES note(id));
CREATE TABLE "auth_token" (id integer primary key, hash text not null, expires integer not null);
UPDATE "setting" SET value = 2 WHERE name = 'dbversion';
