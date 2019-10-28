ALTER TABLE "note" ADD COLUMN cursor text;
UPDATE "setting" SET value = 3 WHERE name = 'dbversion';
