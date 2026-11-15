import pg from 'pg';
const {Pool}=pg;

const male=new Set('abdallah abdi abdullahi ahmed ali anthony alex alexander benjamin brian charles chris christopher collins daniel david dennis edwin elvis eric francis fred george gerald hassan henry ibrahim isaac james jacob john joseph julius kevin martin michael milton mohamed moses nicholas omar patrick paul peter richard rogers samuel stephen thomas victor vincent wilson'.split(' '));
const female=new Set('agatha ann anne bethwel chadia christine doreen elizabeth emma emmah esther evelyn faith faiza grace jacqueline jane joy judy linet lucy maria mary maureen muthoni nyambura purity regina rose sarah susan teresia wangui wanjiku wambui wathira yvonne'.split(' '));
export function suggestNameGender(name){
 const first=String(name||'').trim().toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g,'').split(/\s+/)[0];
 if(!first||first.length<3||first.includes('.')||male.has(first)&&female.has(first))return {gender:null,reason:'Name is ambiguous or insufficient for a suggestion.'};
 if(male.has(first))return {gender:'male',reason:'First name matched a local, deterministic name dictionary.'};
 if(female.has(first))return {gender:'female',reason:'First name matched a local, deterministic name dictionary.'};
 return {gender:null,reason:'Name was not in the local dictionary; administrator review required.'};
}
export async function classify(pool){
 const {rows}=await pool.query("SELECT id,full_name FROM customers WHERE gender IS NULL AND (gender_suggestion_source IS NULL OR gender_suggestion_source='name_heuristic')");let updated=0,unknown=0;
 for(const row of rows){const result=suggestNameGender(row.full_name);await pool.query("UPDATE customers SET suggested_gender=$2,gender_suggestion_status=$3,gender_suggestion_source='name_heuristic',gender_suggestion_reason=$4 WHERE id=$1 AND gender IS NULL",[row.id,result.gender,result.gender?'pending_review':'not_reviewed',result.reason]);result.gender?updated++:unknown++;}
 return {assessed:rows.length,suggested:updated,unknown};
}
if(import.meta.url===`file://${process.argv[1]}`){const connectionString=process.env.DATABASE_URL||process.env.ADMIN_DATABASE_URL;if(!connectionString)throw new Error('DATABASE_URL is required.');const pool=new Pool({connectionString});try{console.log(JSON.stringify(await classify(pool)));}finally{await pool.end();}}
