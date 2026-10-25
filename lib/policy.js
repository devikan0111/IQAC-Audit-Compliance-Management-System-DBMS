export class AppError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export const assert=(condition,message,status=400)=>{if(!condition)throw new AppError(message,status)};
export function integer(value,label='ID'){const n=Number(value);assert(Number.isSafeInteger(n)&&n>0,label+' must be a positive integer');return n;}
export function text(value,label,max=500){assert(typeof value==='string'&&value.trim().length>0&&value.length<=max,label+' is required (max '+max+' characters)');return value.trim();}
export function url(value){const s=text(value,'Evidence URL',500);let u;try{u=new URL(s)}catch{throw new AppError('Enter a valid evidence URL')};assert(['http:','https:'].includes(u.protocol),'Use an http or https evidence URL');return s;}
export function kindConfig(kind){assert(['faculty','department'].includes(kind),'Unknown record type',404);return kind==='faculty'?{table:'Faculty_Submissions',id:'submission_id',collection:'faculty_evidence',owner:'faculty_id',role:'Faculty'}:{table:'Department_Metrics',id:'dept_metric_id',collection:'department_evidence',owner:'hod_id',role:'HOD'};}
export function canRead(user,row,kind){return ['Auditor','Admin'].includes(user.role)||(user.role==='Faculty'&&kind==='faculty'&&Number(row.faculty_id)===user.user_id)||(user.role==='HOD'&&Number(row.dept_id)===user.dept_id);}
export function canEdit(user,row,kind){return user.role===(kind==='faculty'?'Faculty':'HOD')&&Number(row[kind==='faculty'?'faculty_id':'hod_id'])===user.user_id&&['Draft','Rejected'].includes(row.status)&&row.cycle_status==='Active';}
export function transitions(user,row,kind){
 if(row.cycle_status!=='Active')return [];
 const owner=Number(row[kind==='faculty'?'faculty_id':'hod_id'])===user.user_id&&user.role===(kind==='faculty'?'Faculty':'HOD');
 if(owner&&row.status==='Draft')return ['Submitted'];
 if(owner&&row.status==='Rejected')return ['Draft'];
 if(row.status==='Submitted'&&((kind==='faculty'&&user.role==='HOD'&&Number(row.dept_id)===user.dept_id)||(kind==='department'&&user.role==='Auditor')))return ['Verified','Rejected'];
 if(row.status==='Verified'&&user.role==='Auditor')return ['Approved','Rejected'];
 return [];
}
const finite=(o,k,min,max=Number.MAX_SAFE_INTEGER)=>{assert(typeof o[k]==='number'&&Number.isFinite(o[k])&&o[k]>=min&&o[k]<=max,k+' must be between '+min+' and '+max)};
const string=(o,k)=>{o[k]=text(o[k],k,2000)};
export function evidence(input,kind){
 assert(input&&typeof input==='object'&&!Array.isArray(input),'Evidence must be an object');
 const d=input.details;assert(d&&typeof d==='object'&&!Array.isArray(d),'details must be an object');
 // Whitelist type-specific fields; immutable IDs/owners are always supplied by the server.
 const type=kind==='faculty'?input.submission_type:input.metric_category;
 const specs={
 research_paper:{required:['journal_name','publication_year','indexing'],fields:['journal_name','publication_year','indexing','impact_factor','doi']},
 patent:{required:['patent_number','patent_status'],fields:['patent_number','patent_status','filing_date','country']},
 workshop:{required:['role','duration_days'],fields:['role','duration_days','attendee_count','certificate_url']},
 fdp:{required:['program_name','duration_days','mode'],fields:['program_name','organizer','duration_days','mode']},
 book_chapter:{required:['book_title','publisher'],fields:['book_title','publisher','isbn']},
 mentorship:{required:['program_name','mentee_count'],fields:['program_name','mentee_count','period']},
 placement:{required:['students_placed','total_eligible'],fields:['students_placed','total_eligible','highest_package_lpa','average_package_lpa','top_recruiters']},
 budget:{required:['allocated_inr','spent_inr'],fields:['allocated_inr','spent_inr','heads']},
 lab_upgrade:{required:['lab_name','cost_inr'],fields:['lab_name','cost_inr','vendor','equipment']},
 infrastructure:{required:['facility','area_sqft'],fields:['facility','area_sqft','capacity']}
 };
 const allowed=kind==='faculty'?['research_paper','patent','workshop','fdp','book_chapter','mentorship']:['placement','budget','lab_upgrade','infrastructure'];
 assert(allowed.includes(type),'Invalid evidence type');
 const spec=specs[type],details={};
 for(const k of spec.required)assert(d[k]!==undefined,k+' is required');
 for(const k of Object.keys(d)){assert(spec.fields.includes(k),'Unexpected details field: '+k);details[k]=d[k];}
 const mins={publication_year:1990,impact_factor:0,duration_days:1,attendee_count:0,mentee_count:1,students_placed:0,total_eligible:1,highest_package_lpa:0,average_package_lpa:0,allocated_inr:0,spent_inr:0,cost_inr:0,area_sqft:1,capacity:0};
 for(const k of Object.keys(details)){
 if(k in mins)finite(details,k,mins[k],k==='publication_year'?2100:undefined);
 else if(!['top_recruiters','heads','equipment','filing_date'].includes(k))string(details,k);
 }
 const enums={indexing:['Scopus','WoS','UGC-CARE','Other'],patent_status:['filed','published','granted'],role:['attendee','resource_person','organizer'],mode:['online','offline','hybrid']};
 for(const [k,values]of Object.entries(enums))if(k in details)assert(values.includes(details[k]),'Invalid '+k);
 if(details.filing_date){assert(typeof details.filing_date==='string'&&!Number.isNaN(Date.parse(details.filing_date)),'Invalid filing_date');details.filing_date=new Date(details.filing_date).toISOString();}
 if(details.top_recruiters){assert(Array.isArray(details.top_recruiters),'top_recruiters must be an array');details.top_recruiters=details.top_recruiters.map(x=>text(x,'Recruiter',200));}
 for(const k of ['heads','equipment'])if(details[k]){
 assert(Array.isArray(details[k]),k+' must be an array');
 details[k]=details[k].map(x=>{assert(x&&typeof x==='object','Invalid '+k+' item');const label=k==='heads'?'head':'item',amount=k==='heads'?'amount_inr':'quantity';finite(x,amount,k==='heads'?0:1);return {[label]:text(x[label],label,200),[amount]:x[amount]};});
 }
 if(type==='placement')assert(details.students_placed<=details.total_eligible,'Placed students cannot exceed eligible students');
 const result={details,[kind==='faculty'?'submission_type':'metric_category']:type};
 if(kind==='faculty'){
 result.abstract=typeof input.abstract==='string'?input.abstract.slice(0,10000):'';
 result.keywords=input.keywords??[];assert(Array.isArray(result.keywords)&&result.keywords.every(x=>typeof x==='string'&&x.length<=100),'Invalid keywords');
 result.authors=input.authors??[];assert(Array.isArray(result.authors)&&result.authors.length>0,'At least one author is required');
 result.authors=result.authors.map(a=>{assert(a&&typeof a==='object','Invalid author');return {name:text(a.name,'Author name',200),affiliation:typeof a.affiliation==='string'?a.affiliation.slice(0,300):'',is_internal:a.is_internal===true};});
 }else result.summary=typeof input.summary==='string'?input.summary.slice(0,2000):'';
 result.attachments=input.attachments??[];assert(Array.isArray(result.attachments),'attachments must be an array');
 result.attachments=result.attachments.map(a=>{assert(a&&typeof a==='object','Invalid attachment');return {file_name:text(a.file_name,'File name',255),url:url(a.url)};});
 assert(JSON.stringify(result).length<=100000,'Evidence is too large');
 return result;
}
