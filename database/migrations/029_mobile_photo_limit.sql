-- Match the server's 10 MB validated upload limit without changing existing images.
ALTER TABLE farmer_photographs DROP CONSTRAINT farmer_photographs_image_data_check;
ALTER TABLE farmer_photographs ADD CONSTRAINT farmer_photographs_image_data_check
 CHECK (octet_length(image_data) BETWEEN 1 AND 10485760);
ALTER TABLE milk_collection_photos DROP CONSTRAINT milk_collection_photos_image_data_check;
ALTER TABLE milk_collection_photos ADD CONSTRAINT milk_collection_photos_image_data_check
 CHECK (octet_length(image_data) BETWEEN 1 AND 10485760);
