// A flag is one unresolved supplier-list row, even when several CMS farmers
// are possible matches. Resolving its last matching issue removes the flag.
export async function listFlaggedSuppliers(pool){
 const {rows}=await pool.query(`WITH latest AS (
   SELECT document_sha256 FROM farmer_master_sources ORDER BY imported_at DESC LIMIT 1
 )
 SELECT s.id,s.row_number,s.source_name,s.source_category,
   (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object(
      'id',f.id,'customer_id',f.customer_id,'full_name',f.full_name,
      'category',f.category,'registration_status',f.registration_status
    )),'[]'::jsonb)
    FROM farmer_data_issues i JOIN farmers f ON f.id=i.farmer_id
    WHERE i.status='open' AND i.field_name='master_supplier_match'
      AND i.description LIKE 'Supplier master row '||s.row_number::text||':%') AS candidates
 FROM farmer_master_sources s,latest
 WHERE s.document_sha256=latest.document_sha256 AND s.match_result='review_required'
   AND EXISTS (SELECT 1 FROM farmer_data_issues i
     WHERE i.status='open' AND i.field_name='master_supplier_match'
       AND i.description LIKE 'Supplier master row '||s.row_number::text||':%')
 ORDER BY s.row_number`);
 return {total:rows.length,records:rows};
}
