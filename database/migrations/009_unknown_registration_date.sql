-- A blank paper registration date must remain unknown, not become import day.
ALTER TABLE farmers ALTER registration_date DROP NOT NULL;
