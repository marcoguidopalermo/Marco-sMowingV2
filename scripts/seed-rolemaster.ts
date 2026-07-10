// Seed RoleMaster: Office Manager (→ Dave) + Lawn Division Manager (→ Jonah)
// with their duties. IDEMPOTENT (fixed ids). The MASTER TOGGLE stays OFF —
// this only writes roles + duties, never enables generation.
//   dry-run:  SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' npx tsx scripts/seed-rolemaster.ts
//   apply:    ... npx tsx scripts/seed-rolemaster.ts --apply
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { computeOccurrences } from '../src/lib/roleMaster';
import type { RoleRecurrence } from '../src/types';

const cfg={apiKey:'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',authDomain:'crewmaster-73f31.firebaseapp.com',projectId:'crewmaster-73f31',storageBucket:'crewmaster-73f31.firebasestorage.app',messagingSenderId:'831920078849',appId:'1:831920078849:web:8d72204b58c48bb21f0000'};
const APP_ID='crewmaster';
const APPLY=process.argv.includes('--apply');
const clean=(o:unknown)=>JSON.parse(JSON.stringify(o,(_k,v)=>v===undefined?null:v));
const todayToronto=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

interface DutySeed { id:string; name:string; category:string; notePrompt:string; sop:string; recurrence:RoleRecurrence; }

const app=initializeApp(cfg);
await signInWithEmailAndPassword(getAuth(app),process.env.SUPERADMIN_EMAIL!,process.env.SUPERADMIN_PASSWORD!);
const dbx=getFirestore(app);
const emps=((await getDoc(doc(dbx,'artifacts',APP_ID,'public','data','appData','main'))).data() as any)?.employees||[];
const findEmp=(first:string)=>emps.find((e:any)=>(e.name||'').trim().toLowerCase().startsWith(first.toLowerCase()));
const dave=findEmp('Dave')||findEmp('David');
const jonah=findEmp('Jonah');
console.log(`${APPLY?'APPLY':'DRY RUN'} | today=${todayToronto()}`);
console.log(`Office Manager → ${dave?`${dave.name} (${dave.id})`:'!! Dave NOT FOUND'}`);
console.log(`Lawn Division Manager → ${jonah?`${jonah.name} (${jonah.id})`:'!! Jonah NOT FOUND'}`);

const sop=(n:string)=>`## ${n}\n\n_SOP placeholder — replace in RoleMaster admin with the step-by-step how-to._`;
const officeDuties: DutySeed[] = [
  {id:'duty-om-payroll', name:'Process payroll', category:'Payroll', notePrompt:'Pay period + any exceptions/adjustments', sop:sop('Process payroll'), recurrence:{kind:'biweekly',anchorDate:'2026-07-22'}},
  {id:'duty-om-remit', name:'Submit payroll remittances', category:'Payroll', notePrompt:'Period + amount remitted', sop:sop('Submit payroll remittances'), recurrence:{kind:'monthly',dayOfMonth:10}},
  {id:'duty-om-qbo', name:'Categorize QBO transactions', category:'Bookkeeping', notePrompt:'Caught up through what date', sop:sop('Categorize QBO transactions'), recurrence:{kind:'weekly',dayOfWeek:5}},
  {id:'duty-om-reconcile', name:'Reconcile bank/credit accounts', category:'Bookkeeping', notePrompt:'Accounts reconciled + discrepancies', sop:sop('Reconcile bank/credit accounts'), recurrence:{kind:'monthly',dayOfMonth:'last'}},
  {id:'duty-om-journal', name:'Journal entries', category:'Bookkeeping', notePrompt:'What was journalized', sop:sop('Journal entries'), recurrence:{kind:'monthly',dayOfMonth:'last'}},
  {id:'duty-om-invoicing', name:'Invoicing & follow-up', category:'AR', notePrompt:'# invoices sent + overdue accounts chased', sop:sop('Invoicing & follow-up'), recurrence:{kind:'weekly',dayOfWeek:5}},
  {id:'duty-om-ar', name:'Reconcile AR balances', category:'AR', notePrompt:'AR balance + flags', sop:sop('Reconcile AR balances'), recurrence:{kind:'weekly',dayOfWeek:5}},
  {id:'duty-om-ap', name:'Pay vendors/credit cards', category:'AP', notePrompt:'What was paid + anything held', sop:sop('Pay vendors/credit cards'), recurrence:{kind:'monthly',dayOfMonth:'last'}},
];
const lawnDuties: DutySeed[] = [
  {id:'duty-lm-blades', name:'Blades sharpened', category:'Equipment', notePrompt:'Which mowers were sharpened', sop:sop('Blades sharpened'), recurrence:{kind:'weekly',dayOfWeek:1}},
];

const roles = [
  {id:'role-office-manager', name:'Office Manager', description:'Payroll, bookkeeping, AR/AP for the company.', assignedEmployeeId:dave?.id, division:'all', duties:officeDuties},
  {id:'role-lawn-manager', name:'Lawn Division Manager', description:'Runs the Lawn division; equipment upkeep.', assignedEmployeeId:jonah?.id, division:'lawn', duties:lawnDuties},
];

// Dry-run: show occurrences over the next 31 days (exclude today) per duty.
const today=todayToronto();
const from=new Date(Date.parse(`${today}T12:00:00Z`)+86400000).toISOString().slice(0,10);
const to=new Date(Date.parse(`${today}T12:00:00Z`)+31*86400000).toISOString().slice(0,10);
console.log(`\nDRY-RUN occurrences in (${today}, ${to}]:`);
for(const r of roles){
  console.log(`\n[${r.name}] → ${r.assignedEmployeeId||'(unassigned)'}`);
  for(const d of r.duties){
    const occ=computeOccurrences(d.recurrence,from,to);
    console.log(`   ${d.name.padEnd(30)} ${d.category.padEnd(11)} ${JSON.stringify(d.recurrence).padEnd(46)} → ${occ.join(', ')||'(none)'}`);
  }
}

if(!APPLY){ console.log('\nDRY RUN — no writes. Re-run with --apply. (Master toggle stays OFF regardless.)'); process.exit(0); }

const now=Date.now();
for(const r of roles){
  await setDoc(doc(dbx,'artifacts',APP_ID,'public','data','roleMasterRoles',r.id), clean({
    id:r.id, name:r.name, description:r.description, assignedEmployeeId:r.assignedEmployeeId,
    division:r.division, createdBy:{email:process.env.SUPERADMIN_EMAIL,name:'Seed'}, tier:'admin', active:true, updatedAt:now,
  } as any));
  for(const d of r.duties){
    await setDoc(doc(dbx,'artifacts',APP_ID,'public','data','roleMasterDuties',d.id), clean({
      id:d.id, name:d.name, category:d.category, sop:d.sop, notePrompt:d.notePrompt,
      recurrence:d.recurrence, dueSoonDays:2, roleId:r.id, division:r.division, tier:'admin', active:true, updatedAt:now,
    } as any));
  }
  console.log(`  wrote role ${r.id} + ${r.duties.length} duties`);
}
const rc=(await getDocs(collection(dbx,'artifacts',APP_ID,'public','data','roleMasterRoles'))).size;
const dc=(await getDocs(collection(dbx,'artifacts',APP_ID,'public','data','roleMasterDuties'))).size;
console.log(`\nApplied. roleMasterRoles=${rc}, roleMasterDuties=${dc}. Master toggle: OFF (unchanged).`);
process.exit(0);
