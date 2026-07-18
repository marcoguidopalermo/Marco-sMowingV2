// Seed ContractingMaster (Palermo's) — Feaver Rd billing history (v1.1+1.2).
// Tony (GC/PM manager) + Kris (Lead Carpenter) reconciled to SINGLE records,
// the T&M rate card, the Feaver Rd project (Matthew Murray barn renovation)
// with 4 phases, retainers + PROG-001 + window-package invoices, the closed
// report backing PROG-001, and the open billing period from Jul 14. IDEMPOTENT
// (fixed ids). Writes ONLY contracting-namespaced data + employees/settings.
//   dry-run:  SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' npx tsx scripts/seed-contracting.ts
//   apply:    ... npx tsx scripts/seed-contracting.ts --apply
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { DEFAULT_CONTRACTING_RATES, withHst, computeReportTotals, receiptBilled } from '../src/lib/contracting';
import type { Employee, ContractingProject, ContractingInvoice, ContractingProgressReport } from '../src/types';

const cfg={apiKey:'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',authDomain:'crewmaster-73f31.firebaseapp.com',projectId:'crewmaster-73f31',storageBucket:'crewmaster-73f31.firebasestorage.app',messagingSenderId:'831920078849',appId:'1:831920078849:web:8d72204b58c48bb21f0000'};
const APP_ID='crewmaster';
const APPLY=process.argv.includes('--apply');
const clean=(o:unknown)=>JSON.parse(JSON.stringify(o,(_k,v)=>v===undefined?null:v));
const D=(iso:string)=>Date.parse(iso); // July 2026 is EDT (-04:00)
const JUL1=D('2026-07-01T00:00:00-04:00');
const JUL14=D('2026-07-14T00:00:00-04:00');
const JUL28=D('2026-07-28T00:00:00-04:00');
const JUL30=D('2026-07-30T00:00:00-04:00');
const now=Date.now();
const fmt=(n:number)=>n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

const app=initializeApp(cfg);
await signInWithEmailAndPassword(getAuth(app),process.env.SUPERADMIN_EMAIL!,process.env.SUPERADMIN_PASSWORD!);
const dbx=getFirestore(app);
const path=(...p:string[])=>doc(dbx,'artifacts',APP_ID,'public','data',...p);
const mainRef=path('appData','main');
const main=(await getDoc(mainRef)).data() as any;
const emps: Employee[]=main?.employees||[];

console.log(`${APPLY?'APPLY':'DRY RUN'} | employees on file: ${emps.length}`);

// ── Contractors — reconcile to ONE record each (fixed ids + name dedupe) ──
const tony: Employee={ id:'emp-tony-palermo', name:'Tony Palermo', status:'Active', hasLicense:true, hasClassA:false, hasHeavyMachinery:false, awayDates:[],
  linkedUserEmail:'tony@palermoscontracting.com', systemRole:'contractor', contractingBillingRole:'gc_pm', contractingManager:true };
const kris: Employee={ id:'emp-kris-carpenter', name:'Kris', status:'Active', hasLicense:true, hasClassA:false, hasHeavyMachinery:false, awayDates:[],
  linkedUserEmail:'kris@palermoscontracting.com', systemRole:'contractor', contractingBillingRole:'skilled_carpenter' };
const canonical=new Set([tony.id,kris.id]);
const dupeNames=new Set([tony.name.toLowerCase(),kris.name.toLowerCase(),'kris palermo','tony']);
// Drop stray contractor duplicates (same name, non-canonical id) — never a
// Marco's-side employee (only systemRole==='contractor' records are pruned).
let nextEmps=emps.filter(e=>canonical.has(e.id) || !(e.systemRole==='contractor' && dupeNames.has((e.name||'').trim().toLowerCase())));
const upsert=(list:Employee[], e:Employee)=>{ const i=list.findIndex(x=>x.id===e.id); if(i>=0) list[i]={...list[i],...e}; else list.push(e); };
upsert(nextEmps,tony); upsert(nextEmps,kris);
console.log(`  Tony Palermo → contractor · GC/PM · MANAGER (${tony.linkedUserEmail})`);
console.log(`  Kris         → contractor · Lead Carpenter $120 (${kris.linkedUserEmail})`);
console.log(`  Contractor records after dedupe: ${nextEmps.filter(e=>e.systemRole==='contractor').length} (expect 2)`);
console.log(`  Rate card    → GC/PM $${DEFAULT_CONTRACTING_RATES.gc_pm} · Carpenter $${DEFAULT_CONTRACTING_RATES.skilled_carpenter} · Labour $${DEFAULT_CONTRACTING_RATES.general_labour}`);

// ── Feaver Rd — Matthew Murray barn renovation ──────────────────────────
const chk=(id:string,text:string,required:boolean,done:boolean)=>({id,text,required,done,doneBy:done?'Tony Palermo':undefined,doneAt:done?JUL1:undefined});
const feaver: ContractingProject={
  id:'cproj-feaver-rd', name:'Feaver Rd', status:'in_progress',
  client:{ name:'Matthew Murray', contact:'3290 Feaver Rd' }, propertyRef:'3290 Feaver Rd',
  notes:'INTERNAL — barn renovation: architectural → framing → finishes → envelope. Window package pre-approved.',
  createdBy:{id:'seed',name:'Seed'}, createdAt:JUL1, updatedAt:now,
  phases:[
    { id:'cph-feaver-1', name:'Phase 1 — Architectural design', type:'fixed', fixedPrice:90805, status:'in_progress',
      description:'Full architectural design package.',
      checklist:[ chk('c11','Concept + schematic design',true,true), chk('c12','Permit drawings issued',true,true), chk('c13','Final stamped set delivered',true,false) ] },
    { id:'cph-feaver-2', name:'Phase 2 — Interior framing', type:'fixed', fixedPrice:172400, status:'in_progress',
      description:'Interior framing — retainer billed, balance on completion.',
      checklist:[ chk('c21','Materials on site',true,true), chk('c22','Framing complete + inspected',true,false), chk('c23','Deficiencies cleared',true,false) ] },
    { id:'cph-feaver-3', name:'Phase 3 — Interior finishes', type:'tm', status:'in_progress',
      description:'Interior finishes billed time & materials.', tmStartAt:JUL1,
      checklist:[ chk('c31','Client sign-off on finishes',true,false) ] },
    { id:'cph-feaver-4', name:'Phase 4 — Exterior envelope', type:'tm', status:'planned',
      description:'Exterior envelope billed time & materials.', tmStartAt:JUL14,
      note:'Window package $19,400 (Everlast) — client approval on file; payable before ordering.',
      checklist:[ chk('c41','Envelope watertight',true,false) ] },
  ],
};

// ── Invoices ────────────────────────────────────────────────────────────
const mkInv=(id:string,number:string,phaseId:string,kind:ContractingInvoice['kind'],pre:number,extra:Partial<ContractingInvoice>):ContractingInvoice=>{
  const w=withHst(pre);
  return { id,number,projectId:feaver.id,phaseId,kind,amountPreHst:w.preHst,hst:w.hst,total:w.total,
    createdBy:{id:'seed',name:'Seed'},createdAt:JUL1,...extra };
};
// Retainers — PAID.
const invP1=mkInv('cinv-feaver-p1-ret','INV-1001','cph-feaver-1','retainer',50000,{ scopeDescription:'Architectural design — retainer.', issuedAt:JUL1, dueAt:JUL14, paid:true, paidAt:JUL14, paidBy:'Tony Palermo' });
const invP2=mkInv('cinv-feaver-p2-ret','INV-1002','cph-feaver-2','retainer',75000,{ scopeDescription:'Interior framing — retainer.', issuedAt:JUL1, dueAt:JUL14, paid:true, paidAt:JUL14, paidBy:'Tony Palermo' });
// PROG-001 (Jul 1–13): $98,970 materials + $7,470 labour = $106,440 — ISSUED (outstanding), due Jul 30.
const progPre=98970+7470;
const invProg1=mkInv('cinv-feaver-prog-001','PROG-001','cph-feaver-3','tm',progPre,{ periodStart:JUL1, periodEnd:JUL14, reportId:'crep-feaver-3-r1', scopeDescription:'Interior finishes — labour and materials, Jul 1–13.', issuedAt:JUL14, dueAt:JUL30, paid:false });
// Window package — Phase 4, ISSUED (outstanding), payable before ordering.
const invWin=mkInv('cinv-feaver-windows','INV-1003','cph-feaver-4','tm',19400,{ scopeDescription:'Exterior window package (Everlast) — pre-approved, payable before ordering.', issuedAt:JUL14, dueAt:JUL28, paid:false });

// Closed report #1 backing PROG-001, and the OPEN report #2 (starts Jul 14).
const r1snap=computeReportTotals(
  [{ contractorId:kris.id, name:'Kris', billingRole:'skilled_carpenter', hours:62.25 }], // 62.25 × 120 = 7,470
  [{ id:'r1r1', description:'Materials (framing/finishes) — Jul 1–13', cost:98970, markupPct:0, billed:receiptBilled(98970,0) }],
  DEFAULT_CONTRACTING_RATES,
);
const rep1: ContractingProgressReport={ id:'crep-feaver-3-r1', projectId:feaver.id, phaseId:'cph-feaver-3', startAt:JUL1, endAt:JUL14, status:'invoiced', reportNumber:1, receipts:[], manualTime:[], snapshot:r1snap, createdAt:JUL1, updatedAt:JUL14 };
const rep2: ContractingProgressReport={ id:'crep-feaver-3-r2', projectId:feaver.id, phaseId:'cph-feaver-3', startAt:JUL14, status:'open', reportNumber:2, receipts:[], manualTime:[], createdAt:JUL14, updatedAt:now };

const invoices=[invP1,invP2,invProg1,invWin];
console.log('\nInvoices (pre-HST · incl-HST · status):');
for(const i of invoices) console.log(`  ${i.number.padEnd(9)} ${i.phaseId.padEnd(14)} ${i.kind.padEnd(9)} $${fmt(i.amountPreHst).padStart(12)}  →  $${fmt(i.total).padStart(13)}  ${i.paid?'PAID':'ISSUED'}`);

// Billables panel reconciliation (pre-HST).
const invoiced=invoices.reduce((s,i)=>s+i.amountPreHst,0);
const paid=invoices.filter(i=>i.paid).reduce((s,i)=>s+i.amountPreHst,0);
const outstanding=invoiced-paid;
const p1bal=90805-invP1.amountPreHst, p2bal=172400-invP2.amountPreHst;
console.log('\nBillables panel (pre-HST, computed):');
console.log(`  invoiced    = $${fmt(invoiced)}  (50,000 + 75,000 + 106,440 + 19,400)`);
console.log(`  paid        = $${fmt(paid)}  (two retainers)`);
console.log(`  outstanding = $${fmt(outstanding)}  (PROG-001 + windows)`);
console.log(`  upcoming    = Phase 1 balance $${fmt(p1bal)} (incl $${fmt(p1bal*1.13)}) + Phase 2 balance $${fmt(p2bal)} — pending completion`);
console.log(`  NOTE: spec quoted $249,810 / $124,810; the itemized invoices sum to $${fmt(invoiced)} / $${fmt(outstanding)} (authoritative — spec off by $1,030).`);
console.log(`\nReports: #1 CLOSED (backs PROG-001, total $${fmt(r1snap.total)}) · #2 OPEN from Jul 14 (accumulates all time clocked since).`);

if(!APPLY){ console.log('\nDRY RUN — no writes. Re-run with --apply.'); process.exit(0); }

await setDoc(mainRef,{ employees:clean(nextEmps), settings:{ ...(main?.settings||{}), contractingRates:DEFAULT_CONTRACTING_RATES } },{ merge:true });
await setDoc(path('contractingProjects',feaver.id), clean(feaver));
for(const i of invoices) await setDoc(path('contractingInvoices',i.id), clean(i));
await setDoc(path('contractingProgressReports',rep1.id), clean(rep1));
await setDoc(path('contractingProgressReports',rep2.id), clean(rep2));

const pc=(await getDocs(collection(dbx,'artifacts',APP_ID,'public','data','contractingProjects'))).size;
const ic=(await getDocs(collection(dbx,'artifacts',APP_ID,'public','data','contractingInvoices'))).size;
const rc=(await getDocs(collection(dbx,'artifacts',APP_ID,'public','data','contractingProgressReports'))).size;
console.log(`\nApplied. contractingProjects=${pc}, contractingInvoices=${ic}, contractingProgressReports=${rc}. Tony+Kris + rate card on main.`);
process.exit(0);
