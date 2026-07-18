// One-time migration: merge Feaver Rd Phase 4 (Exterior envelope) INTO Phase 3
// (Interior finishes) → "Phase 3/4 — Interior Finishes & Exterior Envelope".
// Phase 3 SURVIVES (keeps id cph-feaver-3), so PROG-001, both reports, and its
// time entries never move; INV-1003 (windows, on Phase 4) re-points to it.
// Snapshots stay frozen — only phaseId references move. IDEMPOTENT (re-run =
// no-op once Phase 4 is gone). Uses the same planPhaseMerge as the in-app
// "Merge phases" action, so the two never diverge.
//   dry-run:  SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' npx tsx scripts/merge-feaver-phases.ts
//   apply:    ... npx tsx scripts/merge-feaver-phases.ts --apply
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { planPhaseMerge, projectBillables } from '../src/lib/contracting';
import type { ContractingInvoice, ContractingProgressReport, ContractingTimeEntry } from '../src/types';

const cfg={apiKey:'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',authDomain:'crewmaster-73f31.firebaseapp.com',projectId:'crewmaster-73f31',storageBucket:'crewmaster-73f31.firebasestorage.app',messagingSenderId:'831920078849',appId:'1:831920078849:web:8d72204b58c48bb21f0000'};
const APP_ID='crewmaster';
const APPLY=process.argv.includes('--apply');
const clean=(o:unknown)=>JSON.parse(JSON.stringify(o,(_k,v)=>v===undefined?null:v));
const PROJ='cproj-feaver-rd', SOURCE='cph-feaver-4', TARGET='cph-feaver-3';
const MERGED_NAME='Phase 3/4 — Interior Finishes & Exterior Envelope';
const money=(n:number)=>`$${(Number(n)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

const app=initializeApp(cfg);
await signInWithEmailAndPassword(getAuth(app),process.env.SUPERADMIN_EMAIL!,process.env.SUPERADMIN_PASSWORD!);
const dbx=getFirestore(app);
const P=(...p:string[])=>doc(dbx,'artifacts',APP_ID,'public','data',...p);
const coll=(name:string)=>collection(dbx,'artifacts',APP_ID,'public','data',name);
const byProject=async<T>(name:string):Promise<T[]>=>(await getDocs(query(coll(name),where('projectId','==',PROJ)))).docs.map(d=>d.data() as T);

const project=(await getDoc(P('contractingProjects',PROJ))).data() as any;
if(!project){ console.log('!! Feaver Rd project not found.'); process.exit(1); }
const invoices=await byProject<ContractingInvoice>('contractingInvoices');
const reports=await byProject<ContractingProgressReport>('contractingProgressReports');
const times=await byProject<ContractingTimeEntry>('contractingTimeEntries');

console.log(`${APPLY?'APPLY':'DRY RUN'}`);
console.log(`Phases before: ${project.phases.map((p:any)=>`${p.id}(${p.name})`).join(', ')}`);

// Idempotency: source gone → already merged.
if(!project.phases.some((p:any)=>p.id===SOURCE)){
  console.log('\nPhase 4 already merged (source absent) — nothing to do.');
  const merged=project.phases.find((p:any)=>p.id===TARGET);
  console.log(`Merged phase: ${merged?.name}`);
  process.exit(0);
}

const rollupBefore=projectBillables(project,invoices,reports);
const openBefore=reports.filter(r=>r.status==='open').length;
const plan=planPhaseMerge(project,SOURCE,TARGET,MERGED_NAME,invoices,reports,times);
if(plan.error||!plan.mergedProject){ console.log('!! '+(plan.error||'merge failed')); process.exit(1); }

console.log(`\nRe-point: ${plan.invoiceIds.length} invoice(s) [${plan.invoiceIds.join(', ')}], ${plan.reportIds.length} report(s), ${plan.timeEntryIds.length} time entr(y/ies) from ${SOURCE} → ${TARGET}`);
console.log(`Survivor open report: ${plan.keptReport ? `${plan.keptReport.id} (#${plan.keptReport.reportNumber}, ${(plan.keptReport.manualTime||[]).length} manual + ${(plan.keptReport.receipts||[]).length} receipt lines after fold)` : '(unchanged target report)'}`);
console.log(`Fold-in + delete duplicate open report(s): ${plan.deleteReportIds.length} [${plan.deleteReportIds.join(', ')}]`);
console.log(`Merged phase name: "${plan.mergedProject.phases.find(p=>p.id===TARGET)?.name}"`);
console.log(`Merged note: ${plan.mergedProject.phases.find(p=>p.id===TARGET)?.note || '(none)'}`);
console.log(`Checklist items on merged phase: ${plan.mergedProject.phases.find(p=>p.id===TARGET)?.checklist.length}`);
console.log(`Rollup (unchanged by merge): invoiced ${money(rollupBefore.invoicedPreHst)} · collected ${money(rollupBefore.collectedPreHst)} · outstanding ${money(rollupBefore.outstandingPreHst)} · remaining fixed ${money(rollupBefore.remainingFixedPreHst)}`);

if(!APPLY){ console.log('\nDRY RUN — no writes. Re-run with --apply.'); process.exit(0); }

const now=Date.now();
for(const id of plan.invoiceIds) await setDoc(P('contractingInvoices',id), clean({phaseId:TARGET}), {merge:true});
for(const id of plan.reportIds) await setDoc(P('contractingProgressReports',id), clean({phaseId:TARGET}), {merge:true});
for(const id of plan.timeEntryIds) await setDoc(P('contractingTimeEntries',id), clean({phaseId:TARGET}), {merge:true});
if(plan.keptReport) await setDoc(P('contractingProgressReports',plan.keptReport.id), clean({...plan.keptReport, updatedAt:now}));
for(const id of plan.deleteReportIds) await deleteDoc(P('contractingProgressReports',id));
await setDoc(P('contractingProjects',PROJ), clean({...plan.mergedProject, updatedAt:now}));
// Audit onto settings (bounded).
const main=(await getDoc(P('appData','main'))).data() as any;
const log=[...(main?.settings?.contractingAuditLog||[]), {action:'phase.merge', detail:`Feaver Rd: "${plan.sourceName}" → "${plan.targetName}" (re-pointed ${plan.invoiceIds.length} inv / ${plan.reportIds.length} rpt / ${plan.timeEntryIds.length} time)`, by:'Migration script', at:now}].slice(-200);
await setDoc(P('appData','main'), {settings:{...(main?.settings||{}), contractingAuditLog:log}}, {merge:true});

// Verify post-merge.
const after=(await getDoc(P('contractingProjects',PROJ))).data() as any;
const invAfter=await byProject<ContractingInvoice>('contractingInvoices');
const repAfter=await byProject<ContractingProgressReport>('contractingProgressReports');
const rollupAfter=projectBillables(after,invAfter,repAfter);
const openAfter=repAfter.filter(r=>r.status==='open').length;
const inv1003=invAfter.find(i=>i.number==='INV-1003');
const prog1=invAfter.find(i=>i.number==='PROG-001');
console.log('\n── POST-MERGE VERIFY ──');
console.log(`Phases after: ${after.phases.map((p:any)=>p.name).join(', ')} (count ${project.phases.length} → ${after.phases.length})`);
console.log(`INV-1003 phaseId → ${inv1003?.phaseId} ${inv1003?.phaseId===TARGET?'✅':'❌'}`);
console.log(`PROG-001 phaseId → ${prog1?.phaseId} ${prog1?.phaseId===TARGET?'✅':'❌'}`);
console.log(`Open reports: ${openBefore} → ${openAfter} ${openAfter===1?'✅ exactly one':'❌'}`);
console.log(`Rollup invoiced ${money(rollupBefore.invoicedPreHst)} → ${money(rollupAfter.invoicedPreHst)} ${rollupBefore.invoicedPreHst===rollupAfter.invoicedPreHst?'✅ unchanged':'❌'}`);
console.log(`Rollup outstanding ${money(rollupBefore.outstandingPreHst)} → ${money(rollupAfter.outstandingPreHst)} ${rollupBefore.outstandingPreHst===rollupAfter.outstandingPreHst?'✅ unchanged':'❌'}`);
console.log('\nApplied.');
process.exit(0);
