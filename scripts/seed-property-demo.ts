// Seed Linda (property manager) + a demo occupancy property showing all three
// rent shapes and neutral/amber/red/M2M-notice countdown states. IDEMPOTENT
// (fixed ids). Writes to the contracting-namespaced property subcollection.
//   dry-run:  SUPERADMIN_EMAIL=.. SUPERADMIN_PASSWORD='..' npx tsx scripts/seed-property-demo.ts
//   apply:    ... npx tsx scripts/seed-property-demo.ts --apply
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { msToYmd } from '../src/lib/propertyMgmt';
import type { Employee, ContractingProperty } from '../src/types';

const cfg={apiKey:'AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU',authDomain:'crewmaster-73f31.firebaseapp.com',projectId:'crewmaster-73f31',storageBucket:'crewmaster-73f31.firebasestorage.app',messagingSenderId:'831920078849',appId:'1:831920078849:web:8d72204b58c48bb21f0000'};
const APP_ID='crewmaster';
const APPLY=process.argv.includes('--apply');
const clean=(o:unknown)=>JSON.parse(JSON.stringify(o,(_k,v)=>v===undefined?null:v));
const DAY=86_400_000;
const now=Date.now();
const ymdIn=(d:number)=>msToYmd(now+d*DAY);

const app=initializeApp(cfg);
await signInWithEmailAndPassword(getAuth(app),process.env.SUPERADMIN_EMAIL!,process.env.SUPERADMIN_PASSWORD!);
const dbx=getFirestore(app);
const P=(...p:string[])=>doc(dbx,'artifacts',APP_ID,'public','data',...p);
const main=(await getDoc(P('appData','main'))).data() as any;
const emps:Employee[]=main?.employees||[];

const linda:Employee={ id:'emp-linda-pm', name:'Linda', status:'Active', hasLicense:false, hasClassA:false, hasHeavyMachinery:false, awayDates:[], linkedUserEmail:'linda@palermoscontracting.com', systemRole:'property_manager' };
let nextEmps=emps.filter(e=>e.id!==linda.id); nextEmps.push(linda);

const demo:ContractingProperty={
  id:'cprop-demo', name:'TEST — Occupancy demo (delete anytime)', active:true,
  notes:'Demo of the 3 rent shapes + countdown states.',
  units:[
    { id:'cunit-demo-1', name:'Main floor', tenancy:{ id:'ct-d1', status:'fixed_term', leaseStart:ymdIn(-300), leaseEnd:ymdIn(120),
      tenants:[{name:'Sarah Lee', phone:'555-0101', email:'sarah@x.com', rentAmount:1800},{name:'Roommate (contact only)', phone:'555-0102'}],
      deposit:{ collected:true, amount:1800, dateCollected:ymdIn(-300) }, createdAt:now } },
    { id:'cunit-demo-2', name:'Unit 2', tenancy:{ id:'ct-d2', status:'fixed_term', leaseStart:ymdIn(-200), leaseEnd:ymdIn(30),
      tenants:[{name:'Amir',rentAmount:600},{name:'Beth',rentAmount:600},{name:'Cody',rentAmount:600}],
      deposit:{ collected:false, note:'to collect at move-in' }, createdAt:now } },
    { id:'cunit-demo-3', name:'Basement', tenancy:{ id:'ct-d3', status:'fixed_term', leaseStart:ymdIn(-380), leaseEnd:ymdIn(-10),
      tenants:[{name:'Dana',rentAmount:600},{name:'Evan',rentAmount:700},{name:'Faye',rentAmount:500}],
      deposit:{ collected:true, amount:1800, dateCollected:ymdIn(-380) }, createdAt:now } },
    { id:'cunit-demo-4', name:'Unit 4 (M2M · move-out set)', tenancy:{ id:'ct-d4', status:'month_to_month', leaseStart:ymdIn(-500),
      moveOutAt:ymdIn(55), moveOutBy:'Linda',
      tenants:[{name:'Tom',phone:'555-0199',rentAmount:1500}], deposit:{ collected:true, amount:1500, dateCollected:ymdIn(-500) }, createdAt:now } },
  ],
};

console.log(`${APPLY?'APPLY':'DRY RUN'}`);
console.log(`Linda → property_manager (${linda.linkedUserEmail}); contractor/PM records: ${nextEmps.filter(e=>e.systemRole==='property_manager').length} PM`);
for(const u of demo.units!){
  const t=u.tenancy!; const total=t.tenants.reduce((s,x)=>s+(x.rentAmount||0),0);
  console.log(`  ${u.name.padEnd(30)} ${t.status.padEnd(14)} $${total}/mo  ${t.moveOutAt?('moveout '+t.moveOutAt):('end '+t.leaseEnd)}  deposit=${t.deposit?.collected?'collected':'NOT collected'}`);
}

if(!APPLY){ console.log('\nDRY RUN — no writes. Re-run with --apply.'); process.exit(0); }

await setDoc(P('appData','main'), { employees:clean(nextEmps) }, { merge:true });
await setDoc(P('contractingPropertyDocs',demo.id), clean(demo));
const n=(await getDocs(collection(dbx,'artifacts',APP_ID,'public','data','contractingPropertyDocs'))).size;
console.log(`\nApplied. contractingPropertyDocs=${n}. Linda seeded (linkedUserEmail is a placeholder — set her real email in Personnel).`);
process.exit(0);
