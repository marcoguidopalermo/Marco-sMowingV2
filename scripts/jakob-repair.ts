import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { buildDivisionMtd, buildMtd } from '../src/lib/mtd';
import { crewTotals, accumulateEmployeeEff } from '../src/lib/efficiency';

const cfg={apiKey:'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',authDomain:'crewmaster-73f31.firebaseapp.com',projectId:'crewmaster-73f31',storageBucket:'crewmaster-73f31.firebasestorage.app',messagingSenderId:'831920078849',appId:'1:831920078849:web:8d72204b58c48bb21f0000'};
const APPLY = process.argv.includes('--apply');
const DATE = '2026-07-03';
const RESTORE = 4.3;

const app=initializeApp(cfg);
await signInWithEmailAndPassword(getAuth(app),process.env.SUPERADMIN_EMAIL!,process.env.SUPERADMIN_PASSWORD!);
const dbx=getFirestore(app);
const ref=doc(dbx,'artifacts','crewmaster','public','data','appData','main');
const snap=await getDoc(ref);
const d:any=snap.data();
const perf=d.performance, sched=d.schedules, emps=d.employees, settings=d.settings||null;
const jakob=emps.find((e:any)=>(e.name||'').trim()==='Jakob Wildschut');
const jid=jakob.id;
const nm=(id:string)=>emps.find((e:any)=>e.id===id)?.name||id;
const day=perf[DATE]||{};
const largeEntry=Object.entries<any>(day).find(([,l])=>l.division==='Large Projects'&&l.crewNumber===1);
const lawnEntry=Object.entries<any>(day).find(([,l])=>l.division==='Lawn Division'&&l.crewNumber===3);
if(!largeEntry){console.log('Large Projects #1 not found on',DATE);process.exit(1);}
const [largeId,largeLog]=largeEntry; const [lawnId,lawnLog]=lawnEntry||['',null];
console.log(`${APPLY?'APPLY':'DRY RUN'} | worker=${jakob.name.trim()} (${jid})`);
console.log(`Large Projects #1 crewId=${largeId} approval=${largeLog.approvalStatus}`);
console.log(`Lawn Division #3 crewId=${lawnId} approval=${lawnLog?.approvalStatus}`);
console.log(`\nBEFORE:`);
console.log(`  Large #1 Jakob AH = ${largeLog.employeeAH?.[jid] ?? '(absent)'} | manualAH=${JSON.stringify(largeLog.manualAH||{})}`);
console.log(`  Lawn #3  Jakob AH = ${lawnLog?.employeeAH?.[jid] ?? '(absent)'}`);
const {cBH:lcBH,cAH:lcAH}=crewTotals(largeLog,new Set());
const accB:any={}; accumulateEmployeeEff(largeLog,accB,new Set());
const sumB=Object.values<any>(accB).reduce((s,x)=>s+x.bh,0);
console.log(`  Large #1 day: cBH=${lcBH.toFixed(1)} cAH=${lcAH.toFixed(1)} | Σ eBH=${sumB.toFixed(2)} (==cBH? ${Math.abs(sumB-lcBH)<0.05})`);
const testU=new Set(emps.filter((e:any)=>e.isTestUser).map((e:any)=>e.id));
const largeMtdB=buildDivisionMtd('2026-07-32','Large Projects',perf,sched,emps,settings);
console.log(`  Large Projects July MTD: BH=${largeMtdB.divisionBH} AH=${largeMtdB.divisionAH} adj%=${largeMtdB.divisionAdjustedEfficiency}`);
for(const div of ['Lawn Division','Large Projects']){const dm=buildDivisionMtd('2026-07-32',div,perf,sched,emps,settings);const mine=dm.perEmployee.find((e:any)=>e.empId===jid);if(mine)console.log(`  Jakob July ${div}: BH=${mine.bh} AH=${mine.ah}`);}

if(!APPLY){console.log('\nDRY RUN — no write. Re-run with --apply.');process.exit(0);}

// REPAIR: restore target AH + manualAH on both sides; re-approve target.
const nextLarge={...largeLog,
  employeeAH:{...largeLog.employeeAH,[jid]:RESTORE},
  manualAH:{...(largeLog.manualAH||{}),[jid]:true},
  approvalStatus:'approved',
  approvedAt:new Date().toISOString(),
  approvedBy:process.env.SUPERADMIN_EMAIL,
  approvedByName:'Marco Palermo (AH-split clobber repair)',
};
const upd:any={[`performance.${DATE}.${largeId}`]:nextLarge};
if(lawnLog){ upd[`performance.${DATE}.${lawnId}`]={...lawnLog,manualAH:{...(lawnLog.manualAH||{}),[jid]:true}}; }
await updateDoc(ref,upd);
// audit
await import('firebase/firestore').then(async ({collection,addDoc})=>{
  await addDoc(collection(dbx,'artifacts','crewmaster','private','data','performanceActivityLog'),{
    type:'ah_manually_edited',timestamp:Date.now(),
    targetDate:DATE,crewId:largeId,crewLabel:'Large Projects #1',
    userId:process.env.SUPERADMIN_EMAIL,userName:'Marco Palermo',userRole:'admin',
    workerId:jid,workerName:jakob.name.trim(),
    valueBefore:0,valueAfter:RESTORE,valueLabel:'AH',
    reason:'AH-split clobber repair',
    reasonNote:`Restored ${RESTORE}h target-side AH wiped by the pre-58a0e14 clobber bug (source Lawn #3 kept its 9.1→4.8 subtraction). manualAH-flagged on both crews so the fixed writers preserve it.`,
  });
});
console.log('\nRepair written + audited. Re-reading to verify...');
const snap2=await getDoc(ref); const d2:any=snap2.data();
const perf2=d2.performance; const day2=perf2[DATE];
const largeLog2=day2[largeId];
console.log(`\nAFTER:`);
console.log(`  Large #1 Jakob AH = ${largeLog2.employeeAH?.[jid]} | manualAH=${JSON.stringify(largeLog2.manualAH||{})}`);
console.log(`  Lawn #3  Jakob AH = ${day2[lawnId]?.employeeAH?.[jid]} | manualAH=${JSON.stringify(day2[lawnId]?.manualAH||{})}`);
const {cBH:lcBH2}=crewTotals(largeLog2,new Set());
const accA:any={}; accumulateEmployeeEff(largeLog2,accA,new Set());
const sumA=Object.values<any>(accA).reduce((s,x)=>s+x.bh,0);
console.log(`  Large #1 day: cBH=${lcBH2.toFixed(1)} | Σ eBH=${sumA.toFixed(2)} (==cBH? ${Math.abs(sumA-lcBH2)<0.05})`);
const largeMtdA=buildDivisionMtd('2026-07-32','Large Projects',perf2,sched,emps,settings);
console.log(`  Large Projects July MTD: BH=${largeMtdA.divisionBH} AH=${largeMtdA.divisionAH} adj%=${largeMtdA.divisionAdjustedEfficiency}`);
for(const div of ['Lawn Division','Large Projects']){const dm=buildDivisionMtd('2026-07-32',div,perf2,sched,emps,settings);const mine=dm.perEmployee.find((e:any)=>e.empId===jid);if(mine)console.log(`  Jakob July ${div}: BH=${mine.bh} AH=${mine.ah}`);}
let jTotAH=0; for(const div of ['Lawn Division','Large Projects']){const dm=buildDivisionMtd('2026-07-32',div,perf2,sched,emps,settings);const mine=dm.perEmployee.find((e:any)=>e.empId===jid);if(mine)jTotAH+=mine.ah;}
console.log(`  Jakob 07-03 total across crews (July MTD AH): ${jTotAH.toFixed(1)} (expect ~9.1)`);
process.exit(0);
