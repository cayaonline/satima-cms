// Conservative, deterministic matching for private directory imports.
export const schema={
 farmers:{table:'farmers',code:'customer_id',name:'full_name',phone:'primary_phone',fields:['full_name','primary_phone','physical_address','village_area','sub_location','location','sub_county','county','category'],columns:['id','customer_id','full_name','primary_phone','physical_address','village_area','sub_location','location','sub_county','county','category']},
 customers:{table:'customers',code:'customer_id',name:'full_name',phone:'phone_number',fields:['full_name','phone_number','physical_address','category'],columns:['id','customer_id','full_name','phone_number','physical_address','category']},
 distributors:{table:'distributors',code:'distributor_code',name:'name',phone:'phone_number',fields:['name','phone_number','location','route_name','manager_name'],columns:['id','distributor_code','store_code','name','phone_number','location','route_name','manager_name','record_type','parent_id']}
};
export const normalizedName=value=>String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
export function canonicalRows(entity,rows){
 const spec=schema[entity];if(!spec)throw new Error('Unknown directory.');
 const aliases={
  [spec.name]:['name','farmername','customername','distributorname','storename'],
  [spec.phone]:['phone','phoneno','phonenumber','mobilenumber','mobile','contactnumber','telephone'],
  [spec.code]:['customerid','farmerid','distributorid','storeid'],
  category:['category','suppliercategory','customercategory'],
  physical_address:['address','physicaladdress','addresslocation',...(entity==='customers'?['location','town']:[])],
  location:entity==='customers'?[]:['location','town'],route_name:['route','routename'],manager_name:['manager','managername'],
  record_type:['type','recordtype'],parent_code:['parent','parentcode','parentdistributor']
 };
 const lookup=new Map();for(const [field,names] of Object.entries(aliases))for(const name of names)lookup.set(name,field);
 return rows.map(row=>{
  const result={...row};
  for(const [key,value] of Object.entries(row)){
   const field=lookup.get(key.toLowerCase().replace(/[^a-z0-9]/g,''));
   if(!field||field===key)continue;
   if(result[field]&&value&&result[field]!==value)throw new Error('Conflicting source columns for '+field+'.');
   if(!result[field])result[field]=value;
  }
  return result;
 });
}
export function normalizedPhone(value){
 const digits=String(value||'').replace(/\D/g,'');
 if(/^0[17]\d{8}$/.test(digits))return '+254'+digits.slice(1);
 if(/^254[17]\d{8}$/.test(digits))return '+'+digits;
 return null;
}
const nonempty=value=>value!==undefined&&value!==null&&String(value).trim()!=='';
const categories={farmers:new Set(['Satima Farmers','Larger Sagana Farmers','Kangema Farmers','Others']),customers:new Set(['Current Customers','Lapsed Customers (Expected to Resume Soon)','Geographically Isolated','Dormant / Non-Responsive','Retired'])};
export function planSync(entity,sourceRows,existing){
 const spec=schema[entity];if(!spec)throw new Error('Unknown directory.');
 const records=existing.map(row=>({...row})),seenRows=new Set(),seenMatches=new Set(),planned=[];
 for(const source of sourceRows){
  const row=Number(source.source_row);if(!Number.isInteger(row)||row<2||seenRows.has(row))throw new Error('Invalid or repeated source row.');seenRows.add(row);
  const name=String(source[spec.name]||'').trim();if(!name||name.length>300)throw new Error('A source record has no valid name.');
  const phone=normalizedPhone(source[spec.phone]),code=String(source[spec.code]||'').trim();
  if(categories[entity]&&nonempty(source.category)&&!categories[entity].has(source.category))throw new Error('Unknown category in source.');
  if(entity==='distributors'&&!['distributor','store'].includes(source.record_type))throw new Error('Distributor type is required.');
  const byCode=code?records.filter(item=>item[spec.code]===code||(entity==='distributors'&&item.store_code===code)):[];
  const byIdentity=phone?records.filter(item=>normalizedName(item[spec.name])===normalizedName(name)&&normalizedPhone(item[spec.phone])===phone):[];
  const candidates=[...new Map([...byCode,...byIdentity].map(item=>[item.id||item._temporary,item])).values()];
  let result,reason='',record=null,changes={};
  if(candidates.length>1){result='review';reason='Conflicting identifiers';}
  else if(candidates.length===1){
   record=candidates[0];
   const stable=(entity!=='distributors'||record.record_type===source.record_type)&&(normalizedName(record[spec.name])===normalizedName(name)||(phone&&normalizedPhone(record[spec.phone])===phone));
   if(!stable){result='review';reason='Identifier conflicts with both name and phone';}
   else if(record._temporary||seenMatches.has(record.id)){result='review';reason='Repeated source identity';}
   else{
    seenMatches.add(record.id);
    for(const field of spec.fields){
     if(!nonempty(source[field]))continue;
     const next=String(source[field]).trim();
     if(String(record[field]??'')!==next)changes[field]={from:record[field]??null,to:next};
    }
    result=Object.keys(changes).length?'updated':'unchanged';
   }
  }else{
   const nameCollision=records.some(item=>normalizedName(item[spec.name])===normalizedName(name));
   const phoneCollision=phone&&records.some(item=>normalizedPhone(item[spec.phone])===phone);
   if(code){result='review';reason='Source identifier does not exist in this directory';}
   else if(!phone){result='review';reason='Verified phone required for automatic addition';}
   else if(nameCollision||phoneCollision){result='review';reason='Name or phone resembles an existing record';}
   else if(entity==='distributors'&&source.record_type==='store'&&!records.some(item=>item.distributor_code===source.parent_code&&item.record_type==='distributor')){result='review';reason='Store requires an existing parent distributor code';}
   else{result='added';record={_temporary:`source:${row}`,[spec.name]:name,[spec.phone]:source[spec.phone]};records.push(record);}
  }
  planned.push({source_row:row,result,record_id:record?record.id||null:null,reason,changes,source});
 }
 return planned;
}
