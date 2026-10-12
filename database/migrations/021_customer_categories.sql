ALTER TABLE customers ADD COLUMN category text
 CHECK (category IN (
  'Current Customers',
  'Lapsed Customers (Expected to Resume Soon)',
  'Geographically Isolated',
  'Dormant / Non-Responsive',
  'Retired'
 ));
CREATE INDEX customers_category_id ON customers(category,customer_id);
GRANT SELECT (category) ON customers TO satima_app;
