CREATE TABLE IF NOT EXISTS "snapshot" (id integer primary key, note integer not null, modified integer not null, content text not null, title text, locked bool default false, FOREIGN KEY(note) REFERENCES note(id));
UPDATE "setting" SET value = 4 WHERE name = 'dbversion';
