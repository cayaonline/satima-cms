-- The application can read only the source columns needed for the flagged list.
GRANT SELECT (id, document_sha256, row_number, source_name, source_category, match_result, imported_at)
 ON farmer_master_sources TO satima_app;
