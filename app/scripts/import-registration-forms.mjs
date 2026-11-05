// Private, reviewed paper-form import. Keep the PDF and manifest outside Git.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {importArchiveBatch} from '../registration-archive.mjs';

const [manifestPath, mode='check'] = process.argv.slice(2);
if (!manifestPath || !['check','apply'].includes(mode)) throw new Error('Provide a private registration manifest and optional apply mode.');
const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
const bytes = await readFile(manifest.document_path);
const checksum = createHash('sha256').update(bytes).digest('hex');
assert.equal(checksum, manifest.document_sha256, 'PDF changed after review');
const pdf = await PDFDocument.load(bytes, {updateMetadata:false});
assert.equal(pdf.getPageCount(), 8, 'Expected an eight-page source PDF');
assert.equal(manifest.forms?.length, 4, 'Expected four reviewed forms');

const seenPages = new Set();
for (const form of manifest.forms) {
  assert(Number.isInteger(form.page_start) && form.page_start % 2 === 1 && form.page_end === form.page_start + 1, 'Each form must occupy two pages');
  assert(!seenPages.has(form.page_start), 'Repeated page pair');
  seenPages.add(form.page_start);
  assert(form.full_name && form.primary_phone, 'Every reviewed form needs a name and phone');
  assert(['match','create','hold'].includes(form.action), 'Unknown reviewed action');
  if (form.action === 'match') assert(form.existing_farmer_id, 'Matched form needs an existing farmer ID');
  if (form.action !== 'match') assert(!form.existing_farmer_id, 'Unmatched form cannot claim an existing farmer ID');
}
for (let page=1; page<=7; page+=2) assert(seenPages.has(page), 'A form page pair is missing');

const summary = {
  forms: manifest.forms.length,
  matched: manifest.forms.filter(f=>f.action==='match').length,
  new_profiles: manifest.forms.filter(f=>f.action==='create').length,
  held_for_review: manifest.forms.filter(f=>f.action==='hold').length,
  review_required: manifest.forms.filter(f=>(f.issues||[]).length>0).length
};
if (mode !== 'apply') {
  console.log(JSON.stringify({...summary, source_sha256: checksum, applied:false}));
  process.exit(0);
}
if (!process.env.ADMIN_DATABASE_URL) throw new Error('Owner database connection required.');

const db = new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL, connectionTimeoutMillis:15000,
  options:'-c lock_timeout=5000 -c statement_timeout=120000'});
const clean = value => value == null || value === '' ? null : String(value).trim();
const phoneDigits = value => String(value||'').replace(/\D/g,'');
const lastNine = value => phoneDigits(value).replace(/^254/,'').replace(/^0/,'').slice(-9);
const phoneForDb = value => {
  const digits = phoneDigits(value);
  return digits.startsWith('0') ? digits : `0${digits.slice(-9)}`;
};
const dateIso = value => value ? String(value).split('/').reverse().join('-') : null;

await db.connect();
try {
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(728410023)');
  await db.query("SELECT set_config('app.actor','Paper farmer registration import',true)");

  const {rows:[prior]} = await db.query('SELECT id,sha256 FROM registration_archive_batches WHERE id=$1',[manifest.batch_id]);
  if (prior) {
    assert.equal(prior.sha256, checksum, 'Batch ID belongs to another PDF');
    const {rows:[state]} = await db.query(`SELECT
      (SELECT count(*)::int FROM registration_archive_entries WHERE batch_id=$1) AS entries,
      (SELECT count(*)::int FROM farmer_registration_sources WHERE document_sha256=$2) AS sources`, [manifest.batch_id, checksum]);
    assert.deepEqual(state, {entries:4, sources:4}, 'Existing import is incomplete');
    await db.query('ROLLBACK');
    console.log(JSON.stringify({...summary, source_sha256:checksum, already_applied:true}));
    process.exit(0);
  }

  const entries = [];
  const created = [];
  for (const form of manifest.forms) {
    if (form.action === 'hold') {
      entries.push({page_start:form.page_start,page_end:form.page_end,farmer_id:null,verification_status:'needs_review'});
      continue;
    }
    let farmerId;
    let existing = null;
    const sourcePhone = phoneForDb(form.primary_phone);
    if (form.action === 'match') {
      const result = await db.query(`SELECT id,customer_id,full_name,primary_phone,national_id,kra_pin,registration_status,record_kind
        FROM farmers WHERE id=$1 AND record_kind='registered' FOR UPDATE`, [form.existing_farmer_id]);
      existing = result.rows[0];
      assert(existing, 'Matched farmer no longer exists');
      assert.equal(lastNine(existing.primary_phone), lastNine(sourcePhone), 'Matched phone changed');
      farmerId = existing.id;
      if (existing.national_id && form.national_id && existing.national_id !== form.national_id) {
        form.issues = [...(form.issues||[]), {field:'national_id', description:'Source National ID differs from the existing profile; existing value was preserved pending manual verification.'}];
      }
      if (existing.kra_pin && form.kra_pin && existing.kra_pin.toUpperCase() !== form.kra_pin.toUpperCase()) {
        form.issues = [...(form.issues||[]), {field:'kra_pin', description:'Source KRA PIN differs from the existing profile; existing value was preserved pending manual verification.'}];
      }
      await db.query(`UPDATE farmers SET
        national_id=coalesce(national_id,$2), primary_phone=coalesce(primary_phone,$3),
        physical_address=coalesce(physical_address,$4), village_area=coalesce(village_area,$5),
        sub_location=coalesce(sub_location,$6), location=coalesce(location,$7),
        sub_county=coalesce(sub_county,$8), county=coalesce(county,$9), kra_pin=coalesce(kra_pin,$10),
        date_of_birth=coalesce(date_of_birth,$11), preferred_language=coalesce(preferred_language,$12)
        WHERE id=$1`, [farmerId, clean(form.national_id), sourcePhone, clean(form.physical_address),
        clean(form.village_area), clean(form.sub_location), clean(form.location), clean(form.sub_county),
        clean(form.county), clean(form.kra_pin), dateIso(form.date_of_birth), clean(form.preferred_language)]);
      if (existing.full_name.toLowerCase() !== form.full_name.toLowerCase()) {
        form.issues = [...(form.issues||[]), {field:'full_name', description:`Source name differs from existing profile; preserved existing profile name for manual review.`}];
      }
    } else {
      const conflicts = await db.query(`SELECT id,customer_id,full_name FROM farmers WHERE record_kind='registered' AND
        (right(regexp_replace(coalesce(primary_phone,''),'[^0-9]','','g'),9)=$1 OR ($2::text IS NOT NULL AND national_id=$2)) FOR UPDATE`,
        [lastNine(sourcePhone), clean(form.national_id)]);
      assert.equal(conflicts.rowCount, 0, 'New form now conflicts with an existing identifier');
      const {rows:[row]} = await db.query(`INSERT INTO farmers(
        customer_id,record_kind,registration_status,status,full_name,national_id,primary_phone,
        registered_business_name,physical_address,village_area,sub_location,location,sub_county,county,
        kra_pin,registration_date,registered_by,gender,gender_source,date_of_birth,preferred_language,category)
        VALUES(NULL,'registered','review_required','pending_verification',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        RETURNING id,customer_id`, [form.full_name,clean(form.national_id),sourcePhone,clean(form.registered_business_name),
        clean(form.physical_address),clean(form.village_area),clean(form.sub_location),clean(form.location),clean(form.sub_county),
        clean(form.county),clean(form.kra_pin),dateIso(form.registration_date),clean(form.registered_by),clean(form.gender||'not_verified'),
        clean(form.gender_source),dateIso(form.date_of_birth),clean(form.preferred_language),clean(form.category)]);
      farmerId = row.id; created.push(row.customer_id);
    }

    const contact = form.next_of_kin;
    if (contact?.name && contact.phone && contact.relationship) {
      const priorContact = await db.query('SELECT 1 FROM farmer_contacts WHERE farmer_id=$1 AND is_primary_alternative',[farmerId]);
      if (!priorContact.rowCount) await db.query(`INSERT INTO farmer_contacts(farmer_id,full_name,phone_number,relationship,is_primary_alternative)
        VALUES($1,$2,$3,$4,true)`, [farmerId,contact.name,phoneForDb(contact.phone),contact.relationship]);
    }
    if (form.mpesa?.name && form.mpesa.phone) {
      const priorPayment = await db.query('SELECT 1 FROM farmer_payment_profiles WHERE farmer_id=$1 AND is_active',[farmerId]);
      if (!priorPayment.rowCount) await db.query(`INSERT INTO farmer_payment_profiles(farmer_id,mpesa_registered_name,mpesa_phone_number)
        VALUES($1,$2,$3)`, [farmerId,form.mpesa.name,phoneForDb(form.mpesa.phone)]);
    }
    if (form.consent?.date) {
      const priorConsent = await db.query('SELECT 1 FROM farmer_consents WHERE farmer_id=$1 LIMIT 1',[farmerId]);
      if (!priorConsent.rowCount) await db.query(`INSERT INTO farmer_consents(
        farmer_id,consent_version,information_accuracy_confirmed,data_processing_consent,communications_consent,
        consent_given,signed_name,signature_method,consent_date)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [farmerId,`paper-unversioned-${checksum.slice(0,12)}`,
        form.consent.accuracy ?? null, form.consent.processing ?? null, form.consent.communications ?? null,
        form.consent.accuracy===true && form.consent.processing===true && form.consent.signed===true ? true : null,
        form.consent.signed_name || form.full_name, form.consent.signed ? 'signature' : null,
        `${dateIso(form.consent.date)}T12:00:00+03:00`]);
    }
    if (!(await db.query('SELECT 1 FROM farmer_verifications WHERE farmer_id=$1 LIMIT 1',[farmerId])).rowCount) {
      await db.query(`INSERT INTO farmer_verifications(
        farmer_id,verified_by,notes,national_id_verified,kra_pin_verified,primary_phone_verified,
        mpesa_number_verified,mpesa_registered_name_confirmed,registration_form_complete,consent_obtained)
        VALUES($1,$2,$3,NULL,NULL,NULL,NULL,NULL,NULL,$4)`, [farmerId,'Pending manual verification',
        'Imported from a paper registration form; official verification fields were not completed on the source form.',
        form.consent?.accuracy===true && form.consent?.processing===true && form.consent?.signed===true]);
    }
    for (const issue of form.issues||[]) await db.query(`INSERT INTO farmer_data_issues(farmer_id,field_name,description,severity)
      VALUES($1,$2,$3,'review')`, [farmerId,issue.field,issue.description]);
    await db.query(`INSERT INTO farmer_registration_sources(farmer_id,document_name,document_sha256,first_page,last_page,raw_transcription)
      VALUES($1,$2,$3,$4,$5,$6)`, [farmerId,manifest.original_filename,checksum,form.page_start,form.page_end,JSON.stringify(form)]);
    entries.push({page_start:form.page_start,page_end:form.page_end,farmer_id:farmerId,verification_status:(form.issues||[]).length?'needs_review':'matched'});
  }
  await importArchiveBatch({id:manifest.batch_id,name:manifest.batch_name,filename:manifest.original_filename,expected:4},
    {bytes,pageCount:8,checksum}, entries, db);
  await db.query('COMMIT');
  console.log(JSON.stringify({...summary,created_customer_ids:created,archive_entries:entries.length,source_sha256:checksum,applied:true}));
} catch (error) {
  await db.query('ROLLBACK');
  console.error('Registration import rolled back:', error.code || error.message, error.constraint || '', error.stack?.split('\\n').slice(0,3).join(' | ') || '');
  process.exitCode = 1;
} finally { await db.end(); }
