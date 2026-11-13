-- The directory contact is the retail lines person, not a store manager.
-- Preserve the existing values while making the business meaning explicit.
ALTER TABLE distributors RENAME COLUMN manager_name TO lines_person_name;

GRANT UPDATE (name,route_name,lines_person_name,phone_number,location,updated_at) ON distributors TO satima_app;
