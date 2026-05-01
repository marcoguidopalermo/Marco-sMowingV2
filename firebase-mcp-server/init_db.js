import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const INITIAL_EMPLOYEES = [
  { id: 'e1', name: 'John Doe', role: 'Foreman', status: 'Active', hasLicense: true, hasClassA: true, hasHeavyMachinery: true, awayDates: [] },
  { id: 'e2', name: 'Sarah Smith', role: 'Operator', status: 'Active', hasLicense: true, hasClassA: false, hasHeavyMachinery: true, awayDates: [] },
  { id: 'e3', name: 'Mike Johnson', role: 'Laborer', status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [] },
  { id: 'e4', name: 'Emma Davis', role: 'Laborer', status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [] },
  { id: 'e5', name: 'Dave Wilson', role: 'Driver', status: 'Active', hasLicense: true, hasClassA: true, hasHeavyMachinery: false, awayDates: [] },
  { id: 'e6', name: 'Lisa Brown', role: 'Foreman', status: 'Active', hasLicense: true, hasClassA: false, hasHeavyMachinery: false, awayDates: [] },
];

const INITIAL_FLEET = [
  { id: 'f1', name: 'Truck 1 (F-150)', type: 'truck', status: 'Active', weightClass: 'Under 4500kg', odometer: 120500, repairTags: [] },
  { id: 'f2', name: 'Heavy Dump Truck', type: 'truck', status: 'Active', weightClass: '10999kg+ (Class A)', odometer: 245000, repairTags: [] },
  { id: 'f3', name: 'Skid Steer 01', type: 'equipment', status: 'Active', weightClass: 'N/A', odometer: 1450, repairTags: [] },
  { id: 'f4', name: 'Zero Turn Mower', type: 'equipment', status: 'Active', weightClass: 'N/A', odometer: 320, repairTags: [] },
  { id: 'f5', name: 'Flatbed Trailer A', type: 'trailer', status: 'Out of Service', weightClass: 'Up to 10999kg (Yellow)', repairTags: ['priority'] },
];

const INITIAL_INVENTORY = [
  { id: 'inv1', name: 'Premium Fertilizer (50lb)', unit: 'Bags', stock: 120, lastAudit: '2026-03-01' },
  { id: 'inv2', name: 'Kentucky Bluegrass Seed', unit: 'Bags', stock: 45, lastAudit: '2026-02-15' },
  { id: 'inv3', name: '2-Cycle Mix Oil', unit: 'Bottles', stock: 24, lastAudit: '2026-03-10' },
];

const initialData = {
  employees: INITIAL_EMPLOYEES,
  fleet: INITIAL_FLEET,
  schedules: {},
  routes: [],
  inventory: INITIAL_INVENTORY,
  repairLog: [],
  bulletins: [{ id: 'b1', title: "Welcome to Marco's Mowing ERP", content: 'The new system is live. Check out the Daily View and the new Inventory tracking!', date: new Date().toISOString().split('T')[0], isAdminOnly: false, author: 'System' }],
  dailyAbsences: {},
  performance: {},
  authorizedEmails: ['marcoguidopalermo@gmail.com', 'admin@crewmaster.com']
};

async function init() {
  try {
    await db.collection('artifacts').doc('default-app-id').set(initialData);
    console.log("✅ SUCCESS! Firestore initialized with default data.");
  } catch (e) {
    console.error("❌ ERROR!", e.message);
  }
  process.exit(0);
}

init();
