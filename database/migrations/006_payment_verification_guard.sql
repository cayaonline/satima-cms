-- Payment verification applies only to the exact recorded payment details.
CREATE FUNCTION invalidate_changed_payment_verification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.mpesa_registered_name IS DISTINCT FROM OLD.mpesa_registered_name
 OR NEW.mpesa_phone_number IS DISTINCT FROM OLD.mpesa_phone_number
 OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
  NEW.verified := false;
  NEW.verified_at := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payments_verification_guard BEFORE UPDATE ON farmer_payment_profiles
 FOR EACH ROW EXECUTE FUNCTION invalidate_changed_payment_verification();
