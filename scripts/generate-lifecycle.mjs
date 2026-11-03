import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)).replaceAll('\\','/').replace(/\/$/,'');
const files={};
async function code(file,start,end,label){
 const text=files[file]??=await fs.readFile(root+'/'+file,'utf8'),lines=text.split(/\r?\n/);
 const from=lines.findIndex(l=>l.includes(start));if(from<0)throw Error('Missing source anchor: '+file+' '+start);
 let until=end?lines.findIndex((l,i)=>i>from&&l.includes(end)):Math.min(from+12,lines.length);
 if(until<0)throw Error('Missing end anchor: '+file+' '+end);
 return {file,line:from+1,label,lines:lines.slice(from,until)};
}
const C={
 contract:await code('lib/policy.js',"research_paper:{required:","patent:{required:",'Evidence fields'),
 session:await code('lib/auth.js','export async function userFromRequest','export async function login','Signed-in identity'),
 login:await code('lib/auth.js','export async function login','export function sessionCookie','Login and session'),
 browser:await code('app/page.js',' async function save(',' async function statusAction','Save button'),
 create:await code('lib/service.js','export async function createRecord','export async function changeStatus','Create SQL Draft'),
 insert:await code('06_triggers.sql','CREATE TRIGGER trg_fsub_bi','-- BEFORE UPDATE:','Insert checks'),
 duplicates:await code('06_triggers.sql','CREATE PROCEDURE sp_check_duplicate','-- FACULTY_SUBMISSIONS','Duplicate rule'),
 transaction:await code('lib/db.js','export async function transaction',null,'Commit or rollback'),
 outbox:await code('lib/outbox.js','export async function enqueue','export function bsonDocument','Queue evidence'),
 mongo:await code('lib/outbox.js','export async function flushOutbox','export async function latestEvidence','Deliver to MongoDB'),
 rules:await code('lib/policy.js','export function transitions','const finite=','Allowed transitions'),
 evidenceGuard:await code('lib/service.js','export async function changeStatus'," const remarks=typeof input.remarks",'Evidence preconditions'),
 read:await code('lib/service.js','export async function readEvidence','export async function updateRecord','Read actual evidence'),
 hod:await code('06_triggers.sql',"        ELSEIF OLD.status = 'Submitted'","        ELSEIF OLD.status = 'Verified'",'Same-department HOD'),
 auditor:await code('06_triggers.sql',"        ELSEIF OLD.status = 'Verified'",'        ELSE','Auditor and score range'),
 approve:await code('lib/service.js'," if(kind==='faculty'&&input.status==='Approved')",'export async function readEvidence','Approve + refresh score'),
 logs:await code('06_triggers.sql','CREATE TRIGGER trg_fsub_au','-- BEFORE DELETE:','Record status history'),
 locked:await code('06_triggers.sql',"    IF OLD.status = 'Approved'","    SELECT status INTO v_cycle",'Approved record lock'),
 score:await code('09_score_calculation.sql','    INSERT INTO Score_Aggregates','END$$','Weighted department score'),
 reject:await code('lib/service.js'," const remarks=typeof input.remarks"," if(kind==='faculty'&&input.status==='Approved')",'Rejection requires remarks'),
 edit:await code('lib/service.js','export async function updateRecord','export async function deleteEvidence','Correct evidence'),
 editRule:await code('lib/policy.js','export function canEdit','export function transitions','Who may edit'),
 cycle:await code('lib/service.js','export async function changeCycle','export async function createCycle','Optional cycle closure'),
 workflowButton:await code('app/page.js',' async function statusAction(',' async function removeEvidence','Review button')
};
const step=(title,actor,status,evidence,explain,actions,guard,keys,route,viva)=>({title,actor,status,evidence,explain,actions,guard,keys,route,viva});
const S={
 ready:step('The paper is ready','Faculty',null,'Not attached','Ravi has completed a research paper. Before entering it, he gathers the journal details, publication year, indexing, DOI (if available), co-author names and an evidence link.',
 ['The project starts tracking the paper only when a Draft is saved.','The criterion must be a Faculty leaf metric in an Active audit cycle.','Completing a paper alone does not prove publication or accreditation eligibility.'],
 'This is preparation outside the app: there is no submission row, evidence document or review log yet.',['contract'],'Outside the app → gather evidence','The research work exists first; our system records and reviews the evidence supporting the claim.'),
 login:step('Faculty signs in','Faculty',null,'Not attached','Ravi signs in using his institutional account. The backend identifies him from a server-checked session, rather than trusting a user ID supplied by the browser.',
 ['Demo account: ravi.kumar@pes.edu / Pass@123.','The session is checked again on authenticated API requests.','For a write, the backend sets the trusted SQL actor on the same transaction connection.'],
 'A browser-supplied role or owner does not grant permission. Faculty can create only their own record.',['session','login','transaction'],'Sign in → session → authenticated identity','Authentication identifies Ravi; authorization determines what he may create or change.'),
 draft:step('Save a new Draft','Faculty','Draft','Queued for sync','Ravi selects the research-paper criterion and Active cycle, enters the title and evidence, and saves a Draft.',
 ['MySQL creates Faculty_Submissions with Ravi as owner and a new Mongo document ID.','The insert trigger checks ownership, role, cycle, leaf criterion and duplicates.','The same MySQL transaction queues the evidence payload in Evidence_Outbox.'],
 'No score is awarded. Duplicate DOI/ISBN or normalized title in a non-Rejected record of the same cycle can block creation, including an existing Draft.',['browser','create','insert','duplicates'],'POST /api/faculty → service → INSERT → BEFORE INSERT trigger','Saving creates a Draft record and a durable evidence job; it does not submit the paper for review.'),
 sync:step('Save the detailed evidence','System','Draft','Synchronized','After the MySQL transaction commits, the outbox worker attempts to write the evidence to MongoDB.',
 ['faculty_evidence stores the research-paper details, authors and attachment URL metadata.','The SQL mongo_doc_id corresponds to the MongoDB ObjectId.','Successful delivery marks the outbox job processed; retry uses the same ID.'],
 'MySQL and MongoDB do not share one atomic transaction. If MongoDB is unavailable, the committed Draft and pending job remain.',['outbox','mongo','create'],'Committed SQL job → Mongo replaceOne(upsert) → mark processed','MySQL owns workflow data; MongoDB owns flexible evidence details, synchronized through an outbox.'),
 submit:step('Submit for HOD review','Faculty','Submitted','Synchronized','Ravi clicks Submit for review. The backend checks the permitted transition and confirms that the evidence really exists with no pending synchronization.',
 ['Draft changes to Submitted.','The AFTER UPDATE trigger creates Draft → Submitted history.','The record is now frozen for ordinary content edits.'],
 'Only the owning Faculty member can submit. Submitting is blocked if evidence is missing or synchronization is pending.',['workflowButton','evidenceGuard','rules','logs'],'PATCH /api/faculty/:id/status → Submitted → SQL triggers','Submitting changes the workflow state and records history; it does not approve the evidence or award points.'),
 hodRead:step('HOD opens the submission','CSE HOD','Submitted','Synchronized','The CSE HOD sees the Submitted record in their review queue, opens the actual Mongo evidence and reads its supporting details.',
 ['Demo account: hod.cse@pes.edu / Pass@123.','The HOD checks the publication/evidence context and whether correction is needed.','Reading the record does not change its status or add a status log.'],
 'An ECE HOD cannot inspect this CSE submission through the app. A matching department is enforced on the server.',['read','hod'],'Statistics review queue → evidence + review history','The HOD reviews submissions belonging to their department and inspects the actual evidence document.'),
 verify:step('HOD verifies the paper','CSE HOD','Verified','Synchronized','The CSE HOD clicks Verify. The record moves from Submitted to Verified and enters the Auditor review queue.',
 ['The trigger checks that the actor is an HOD from Ravi’s department.','History gains Submitted → Verified with the actor, time and remarks.','There is still no awarded faculty-submission score.'],
 'Verified means department verification, not final approval. The HOD cannot give the final approval score.',['hod','rules','logs'],'PATCH status → Verified → HOD/department check → history','Verification confirms the department review; final approval remains with the Auditor.'),
 auditRead:step('Auditor reviews the evidence','Auditor','Verified','Synchronized','The Auditor opens the Verified record, inspects the evidence and HOD review history, and decides whether to approve it or return it for correction.',
 ['Demo account: auditor@pes.edu / Pass@123.','The Auditor can review across departments.','Reading is separate from approving: the record remains Verified until a decision is saved.'],
 'Admin/Principal oversight is not Auditor approval authority. A Faculty submission cannot jump straight from Draft or Submitted to Approved.',['read','rules','auditor'],'Auditor queue → evidence → HOD history → decision','The Auditor makes the final review decision after HOD verification.'),
 approve:step('Approve and award a score','Auditor','Approved','Synchronized','For this illustration, the Auditor awards 18 out of a maximum 20 and approves the paper.',
 ['The backend validates the score and updates status + score together.','The AFTER UPDATE trigger records Verified → Approved.','The same SQL transaction calls sp_recalculate_scores for the audit cycle.'],
 'The score must be within the metric maximum. If scoring fails, the transaction rolls back the approval and its status log as well.',['approve','auditor','logs','transaction'],'UPDATE status + score → audit log → CALL scoring → COMMIT','Approval, its audit trail and department score refresh succeed together in one MySQL transaction.'),
 finish:step('The approved record is protected','System','Approved','Synchronized','The paper’s review is complete. It contributes to the department’s weighted score, and current-status reports now count it as Approved.',
 ['For a research-paper weight of 0.20, an approved 18/20 contributes 18 points before considering other approved papers and the per-metric cap.','A department’s faculty scores for that metric are summed and capped at its maximum; each paper does not receive a separate uncapped department allocation.','Approved rows cannot be edited, and the app does not implement reopening an Approved paper.'],
 'This is a project-defined scoring policy. Co-authors can be listed in evidence, but there is no separate individual co-author credit allocation.',['score','locked','cycle'],'Approved record → weighted score snapshot → reports/statistics','The workflow ends in an approved, locked record with traceable review history and a refreshed department score.'),
 hodReject:step('HOD requests a correction','CSE HOD','Rejected','Synchronized','Instead of verifying, the HOD rejects the Submitted paper with a clear reason, such as missing publication proof.',
 ['Submitted changes to Rejected.','The reason is mandatory and becomes part of the status history.','The owning Faculty member can correct the record in an Active cycle.'],
 'Rejected is a workflow state, not deletion. The previous submission and review history are retained.',['reject','hod','logs'],'PATCH status → Rejected + required remarks','The HOD can send a submission back with a documented reason instead of verifying it.'),
 auditorReject:step('Auditor requests a correction','Auditor','Rejected','Synchronized','Instead of approving, the Auditor rejects the Verified paper and records what must be corrected.',
 ['Verified changes to Rejected.','No score is awarded by this rejection.','Faculty must correct and resubmit; another HOD verification is required.'],
 'The record does not return directly to Verified or Approved after correction.',['reject','auditor','logs'],'PATCH status → Rejected + required remarks','An Auditor rejection sends the paper back through the Faculty and HOD workflow.'),
 correct:step('Faculty corrects the evidence','Faculty','Rejected','Synchronized','Ravi edits the returned record, supplies the missing evidence, and saves the corrected details.',
 ['Only Ravi can edit this Draft/Rejected record in an Active cycle.','The updated Mongo evidence is delivered through the outbox.','This walkthrough assumes that synchronization succeeds before resubmission.'],
 'An ordinary content edit does not itself add a status-transition log. The status stays Rejected until Reopen draft is selected.',['editRule','edit','mongo'],'PATCH /api/faculty/:id → corrected fields → evidence outbox','Correction changes the evidence; reopening and resubmission are separate workflow actions.'),
 reopen:step('Reopen the corrected Draft','Faculty','Draft','Synchronized','Ravi selects Reopen draft. Rejected changes to Draft and the duplicate check is repeated.',
 ['The owner controls this transition.','A new Rejected → Draft status log is added.','The next step is Submit for review, followed by the HOD and Auditor stages again.'],
 'Rejected → Approved is not a permitted shortcut.',['rules','duplicates','logs'],'PATCH status → Draft → duplicate check → history','A corrected rejection re-enters the workflow as a Draft, preserving its earlier history.'),
 offline:step('MongoDB is temporarily unavailable','System','Draft','Pending sync','The evidence write fails after the SQL Draft and durable outbox job have committed.',
 ['The job remains pending with a recorded error for retry.','The SQL row still exists.','The UI can show that evidence synchronization is pending.'],
 'This is why the outbox exists: a temporary MongoDB failure must not silently lose the evidence job.',['mongo','outbox'],'Mongo write fails → record error → pending job retained','A pending outbox job records unfinished synchronization; the two databases are not one transaction.'),
 blocked:step('Submission is blocked until sync','Faculty','Draft','Pending sync','If Ravi tries to submit now, the backend rejects the request because evidence delivery is still pending.',
 ['The record remains Draft.','No successful status transition means no Submitted history entry.','Once MongoDB is restored, an Auditor/Admin or trusted operator can retry evidence sync.'],
 'The interface disabling a button is not the only protection: the API checks pending jobs and the actual Mongo document.',['evidenceGuard','mongo'],'Submit request → pending-evidence check → reject change','The database record cannot proceed to review with unsynchronized or missing evidence.'),
 retry:step('Retry succeeds without a duplicate','Auditor / Admin','Draft','Synchronized','After MongoDB becomes available, the pending job is retried using the same assigned document ID.',
 ['replaceOne with upsert delivers the evidence idempotently.','The job becomes processed.','Ravi can now submit, starting the ordinary review sequence.'],
 'Retrying evidence delivery does not itself submit, verify or approve the paper.',['mongo','outbox'],'Retry outbox → same ObjectId → processed → Faculty may submit','Idempotent synchronization retries delivery without creating a second evidence document.')
};
const common=['ready','login','draft','sync','submit','hodRead'];
const paths={
 approved:{label:'Normal approval',steps:[...common,'verify','auditRead','approve','finish']},
 hod:{label:'HOD requests correction',steps:[...common,'hodReject','correct','reopen','submit','hodRead','verify','auditRead','approve','finish']},
 auditor:{label:'Auditor requests correction',steps:[...common,'verify','auditRead','auditorReject','correct','reopen','submit','hodRead','verify','auditRead','approve','finish']},
 offline:{label:'MongoDB unavailable',steps:['ready','login','draft','offline','blocked','retry','submit','hodRead','verify','auditRead','approve','finish']}
};
const accounts=[['Faculty · CSE','ravi.kumar@pes.edu'],['Faculty · CSE','meena.iyer@pes.edu'],['Faculty · ECE','priya.nair@pes.edu'],['HOD · CSE','hod.cse@pes.edu'],['HOD · ECE','hod.ece@pes.edu'],['Auditor','auditor@pes.edu'],['Admin / Principal','principal@pes.edu']];
const payload=JSON.stringify({steps:S,paths,code:C,accounts}).replaceAll('<','\\u003c');
const template=await fs.readFile(root+'/docs/lifecycle.template.html','utf8');
await fs.writeFile(root+'/LIFECYCLE.html',template.replace('<!--LIFECYCLE_DATA-->',()=>payload));
console.log('Verified actual-source excerpts:',Object.keys(C).length,'; lifecycle scenarios:',Object.keys(paths).length);
