// End-to-end T&M walk against LIVE Firestore, fully ISOLATED: creates a
// throwaway project, runs the whole chain (clock → unbilled detect → attach →
// material → live preview → end/mint → next-opens → one-report-ever), asserts
// every number, then DELETES everything it wrote (try/finally). Mirrors the
// exact mint sequence in App.endContractingReport.
//   SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' npx tsx scripts/e2e-contracting.ts
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where } from 'firebase/firestore';
import { DEFAULT_CONTRACTING_RATES as RC, labourForReport, computeReportTotals, unbilledLabour, nextProgNumber, withHst } from '../src/lib/contracting';

const cfg={apiKey:'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',authDomain:'crewmaster-73f31.firebaseapp.com',projectId:'crewmaster-73f31',storageBucket:'crewmaster-73f31.firebasestorage.app',messagingSenderId:'831920078849',appId:'1:831920078849:web:8d72204b58c48bb21f0000'};
const APP_ID='crewmaster';
const clean=(o:unknown)=>JSON.parse(JSON.stringify(o,(_k,v)=>v===undefined?null:v));
let pass=0,fail=0; const ok=(l:string,c:boolean,got:any='')=>{c?pass++:fail++;console.log(`${c?'✅':'❌'} ${l}${got!==''?` = ${got}`:''}`);};
const H=3_600_000;

const app=initializeApp(cfg);
await signInWithEmailAndPassword(getAuth(app),process.env.SUPERADMIN_EMAIL!,process.env.SUPERADMIN_PASSWORD!);
const dbx=getFirestore(app);
const P=(...p:string[])=>doc(dbx,'artifacts',APP_ID,'public','data',...p);
const TAG='e2e-'+(await getDoc(P('appData','main'))).id.slice(0,4); // stable-ish tag; all ids carry it for cleanup

const projId=`cproj-${TAG}`, phaseId=`cph-${TAG}`, r1Id=`crep-${TAG}-1`;
const wrote:{coll:string;id:string}[]=[];
const put=async(coll:string,id:string,data:any)=>{await setDoc(P(coll,id),clean(data));wrote.push({coll,id});};

try {
  // ── Setup: a T&M project + phase, and an OPEN report R1 (startAt T0) ──────
  const T0=1_000_000*H;                      // arbitrary fixed base (no Date.now needed for asserts)
  const NOW=T0+10*H;
  await put('contractingProjects',projId,{ id:projId,name:`E2E ${TAG}`,status:'in_progress',phases:[{id:phaseId,name:'E2E T&M',type:'tm',status:'in_progress',checklist:[],tmStartAt:T0}],createdAt:T0 });
  await put('contractingProgressReports',r1Id,{ id:r1Id,projectId:projId,phaseId,startAt:T0,status:'open',reportNumber:1,receipts:[],manualTime:[] });

  // ── Kris clocks: A inside the period, B in a gap BEFORE it opened ─────────
  const A={ id:`cte-${TAG}-A`,projectId:projId,phaseId,contractorId:'kris',contractorName:'Kris',billingRole:'skilled_carpenter',clockIn:T0+1*H,clockOut:T0+3*H,status:'open' };  // 2h
  const B={ id:`cte-${TAG}-B`,projectId:projId,phaseId,contractorId:'kris',contractorName:'Kris',billingRole:'skilled_carpenter',clockIn:T0-40*H,clockOut:T0-37*H,status:'open' }; // 3h gap
  await put('contractingTimeEntries',A.id,A);
  await put('contractingTimeEntries',B.id,B);

  // Read the phase's entries back from Firestore (prove the round-trip).
  const teSnap=await getDocs(query(collection(dbx,'artifacts',APP_ID,'public','data','contractingTimeEntries'),where('projectId','==',projId)));
  const entries=teSnap.docs.map(d=>d.data() as any);
  const r1=(await getDoc(P('contractingProgressReports',r1Id))).data() as any;

  ok('2 time entries persisted',entries.length===2,entries.length);
  const lab0=labourForReport(r1,entries,NOW);
  ok('A auto-attaches to open report (2h)',lab0.reduce((s,l)=>s+l.hours,0)===2,lab0.reduce((s,l)=>s+l.hours,0));
  const unb0=unbilledLabour(projId,entries,[r1],RC,NOW);
  ok('B detected as UNBILLED (gap)',unb0.length===1&&unb0[0].entry.id===B.id,unb0.map(u=>u.entry.id).join(','));

  // ── Tony attaches B, then enters a material (flooring 10,000 +50%) ────────
  await setDoc(P('contractingTimeEntries',B.id),clean({...B,reportId:r1Id}));
  await setDoc(P('contractingProgressReports',r1Id),clean({...r1,receipts:[{id:`crc-${TAG}`,description:'Flooring',cost:10000,markupPct:50,billed:15000}]}));

  const entries2=(await getDocs(query(collection(dbx,'artifacts',APP_ID,'public','data','contractingTimeEntries'),where('projectId','==',projId)))).docs.map(d=>d.data() as any);
  const r1b=(await getDoc(P('contractingProgressReports',r1Id))).data() as any;
  const unb1=unbilledLabour(projId,entries2,[r1b],RC,NOW);
  ok('B leaves unbilled list after attach',unb1.length===0,unb1.length);

  // ── LIVE PREVIEW: A(2h) + B(3h) = 5h × $120 = $600 labour + $15,000 mat ──
  const lab1=labourForReport(r1b,entries2,NOW);
  const preview=computeReportTotals(lab1,r1b.receipts,RC);
  ok('preview labour = 5h × $120 = $600',preview.labourSubtotal===600,preview.labourSubtotal);
  ok('preview materials = $15,000',preview.materialsSubtotal===15000,preview.materialsSubtotal);
  ok('preview pre-HST = $15,600',preview.subtotalPreHst===15600,preview.subtotalPreHst);
  ok('preview total incl HST = $17,628',preview.total===17628,preview.total);

  // ── END REPORT (mirror App.endContractingReport) ─────────────────────────
  const ended={...r1b,endAt:NOW};
  const snapshot=computeReportTotals(labourForReport(ended,entries2,NOW),r1b.receipts,RC);
  const billed=entries2.filter((te:any)=>!te.manual&&te.status!=='invoiced'&&te.phaseId===phaseId&&(te.reportId===r1Id||(!te.reportId&&te.clockOut&&te.clockIn>=r1b.startAt&&te.clockIn<NOW)));
  const number=nextProgNumber((await getDocs(query(collection(dbx,'artifacts',APP_ID,'public','data','contractingInvoices'),where('projectId','==',projId)))).docs.map(d=>d.data() as any));
  const invId=`cinv-${TAG}`;
  const w=withHst(snapshot.subtotalPreHst);
  await put('contractingInvoices',invId,{ id:invId,number,projectId:projId,phaseId,kind:'tm',periodStart:r1b.startAt,periodEnd:NOW,amountPreHst:w.preHst,hst:w.hst,total:w.total,reportId:r1Id,issuedAt:NOW,dueAt:NOW+14*86400000,paid:false });
  await setDoc(P('contractingProgressReports',r1Id),clean({...ended,status:'invoiced',snapshot}));
  for(const te of billed) await setDoc(P('contractingTimeEntries',te.id),clean({...te,status:'invoiced',reportId:r1Id}));
  const r2Id=`crep-${TAG}-2`;
  await put('contractingProgressReports',r2Id,{ id:r2Id,projectId:projId,phaseId,startAt:NOW,status:'open',reportNumber:2,receipts:[],manualTime:[] });

  // ── Assert the minted state from Firestore ───────────────────────────────
  const inv=(await getDoc(P('contractingInvoices',invId))).data() as any;
  ok('invoice minted sequential',number==='PROG-001',number);
  ok('invoice total frozen = $17,628',inv.total===17628,inv.total);
  ok('invoice linked to report',inv.reportId===r1Id);
  const r1final=(await getDoc(P('contractingProgressReports',r1Id))).data() as any;
  ok('report now invoiced + snapshot frozen',r1final.status==='invoiced'&&r1final.snapshot?.total===17628,r1final.snapshot?.total);
  const entries3=(await getDocs(query(collection(dbx,'artifacts',APP_ID,'public','data','contractingTimeEntries'),where('projectId','==',projId)))).docs.map(d=>d.data() as any);
  ok('both entries frozen invoiced',entries3.every((t:any)=>t.status==='invoiced'),entries3.map((t:any)=>t.status).join(','));
  const r2=(await getDoc(P('contractingProgressReports',r2Id))).data() as any;
  ok('next report #2 auto-opened at boundary',r2.status==='open'&&r2.startAt===NOW&&r2.reportNumber===2,`${r2.reportNumber}/${r2.status}`);
  ok('one-report-ever: invoiced B not billable on R2',labourForReport(r2,entries3,NOW+H).length===0);
} finally {
  // ── Cleanup: delete everything this walk wrote ───────────────────────────
  let del=0; for(const {coll,id} of wrote){ try{ await deleteDoc(P(coll,id)); del++; }catch{} }
  console.log(`\nCleaned up ${del}/${wrote.length} test docs.`);
}
console.log(`\n${fail===0?'✅ E2E PASS':'❌ E2E FAIL'}: ${pass} passed, ${fail} failed`);
process.exit(fail===0?0:1);
