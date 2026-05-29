import { Employee, FleetItem, InventoryItem } from './types';

// Test User sentinel — auto-bootstrapped on first load so an admin
// can impersonate via View As. Email is in a reserved `.local` TLD
// so it can never collide with a real sign-in.
export const TEST_USER_ID = 'test-user';
export const TEST_USER_EMAIL = 'testuser@crewmaster.local';
export const TEST_USER_NAME = 'Test User';

export const INITIAL_EMPLOYEES: Employee[] = [
  {
    id: TEST_USER_ID,
    name: TEST_USER_NAME,
    status: 'Active',
    hasLicense: false,
    hasClassA: false,
    hasHeavyMachinery: false,
    awayDates: [],
    isTestUser: true,
    email: TEST_USER_EMAIL,
    linkedUserEmail: TEST_USER_EMAIL,
    systemRole: 'mechanic',
    timeMasterEnabled: true,
  },
  { id: 'e1', name: 'John Doe', status: 'Active', hasLicense: true, hasClassA: true, hasHeavyMachinery: true, awayDates: [] },
  { id: 'e2', name: 'Sarah Smith', status: 'Active', hasLicense: true, hasClassA: false, hasHeavyMachinery: true, awayDates: [] },
  { id: 'e3', name: 'Mike Johnson', status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [] },
  { id: 'e4', name: 'Emma Davis', status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [] },
  { id: 'e5', name: 'Dave Wilson', status: 'Active', hasLicense: true, hasClassA: true, hasHeavyMachinery: false, awayDates: [] },
  { id: 'e6', name: 'Lisa Brown', status: 'Active', hasLicense: true, hasClassA: false, hasHeavyMachinery: false, awayDates: [] },
];

export const INITIAL_FLEET: FleetItem[] = [
  { id: 'f1', name: 'Truck 1 (F-150)', type: 'truck', status: 'Active', weightClass: 'Under 4500kg', odometer: 120500, repairTags: [], color: 'bg-green-500', serialNumber: 'SN-TRK1-998' },
  { id: 'f2', name: 'Heavy Dump Truck', type: 'truck', status: 'Active', weightClass: '10999kg+ (Class A)', odometer: 245000, repairTags: [], color: 'bg-blue-600', serialNumber: 'SN-HDUMP-044' },
  { id: 'f3', name: 'Skid Steer 01', type: 'equipment', status: 'Active', weightClass: 'N/A', odometer: 1450, repairTags: [], color: 'bg-orange-500', modelNumber: 'CAT-242D', serialNumber: 'S-SS01-X' },
  { id: 'f4', name: 'Zero Turn Mower', type: 'equipment', status: 'Active', weightClass: 'N/A', odometer: 320, repairTags: [], color: 'bg-yellow-400', modelNumber: 'SCAG-Z72', serialNumber: 'S-ZT04-Y' },
  { id: 'f5', name: 'Flatbed Trailer A', type: 'trailer', status: 'Out of Service', weightClass: 'Up to 10999kg (Yellow)', repairTags: ['priority'], color: 'bg-gray-500', isYellowSticker: true, serialNumber: 'SN-FLAT-002' },
];

export const INITIAL_INVENTORY: InventoryItem[] = [
  { id: 'inv1', name: 'Premium Fertilizer (50lb)', unit: 'Bags', stock: 120, lastAudit: '2026-03-01' },
  { id: 'inv2', name: 'Kentucky Bluegrass Seed', unit: 'Bags', stock: 45, lastAudit: '2026-02-15' },
  { id: 'inv3', name: '2-Cycle Mix Oil', unit: 'Bottles', stock: 24, lastAudit: '2026-03-10' },
];

export const DIVISIONS = ['Large Projects', 'Small Projects', 'Lawn Division'];
export const CREW_NUMBERS = [1, 2, 3, 4, 5, 6];
export const WEIGHT_CLASSES = ['Under 4500kg', 'Up to 10999kg (Yellow)', '10999kg+ (Class A)', 'N/A'];
export const ROUTE_FREQUENCIES = ['Weekly', 'Bi-Weekly 1', 'Bi-Weekly 2', 'Monthly'];
export const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const DVIR_DEFECTS = ["Brakes", "Steering", "Lights/Reflectors", "Tires/Wheels", "Suspension", "Coupling Devices", "Exhaust System", "Wipers/Washers", "Mirrors/Glass", "Horn", "Emergency Equipment"];
export const CIRCLE_CHECK_DEFECTS = ["Fluid Leaks", "Body Damage", "Tire Pressure", "Lights Functional", "Cleanliness", "Loose Equipment/Tools"];
export const TRAILER_DEFECTS = ["Tire Pressure", "Lights Working", "Hitch Properly Secured"];

export const DEFAULT_EOD_REMINDER = "Lock trailers and sea cans, charge any equipment batteries.";

// Default crew-size efficiency allowance — additive % added to raw
// efficiency to correct for drive/coordination overhead on bigger
// crews. Editable from Manage Resources → App Settings; absent
// values fall back to this table. Rows are sorted ascending; the
// applied pct is the highest row whose minSize ≤ size.
import type { CrewSizeAllowanceRow } from './types';
export const DEFAULT_CREW_SIZE_ALLOWANCE: CrewSizeAllowanceRow[] = [
  { minSize: 1, pct: 0 },
  { minSize: 3, pct: 10 },
  { minSize: 4, pct: 15 },
  { minSize: 5, pct: 20 },
];
export const EOD_WARNING_HOUR = 22;
export const PERMISSION_DENIED = 'Permission denied.';

export const LAWN_JOKES: string[] = [
  "Why did the lawn mower break up with the grass? It just wasn't cutting it anymore.",
  "What do you call a lazy lawnmower? A grasshopper that retired.",
  "I told my friend a joke about lawnmowers. He didn't laugh — guess it didn't cut deep enough.",
  "Why don't trees use the internet? Too many bad logs.",
  "What did the lawn say after a long day? I'm grass-pin' for breath!",
  "Why are gardeners terrible at telling lies? Because they always rake up the truth.",
  "I was going to tell a joke about gardening, but it was too cheesy. It needed more thyme.",
  "What's a tree's favorite drink? Root beer.",
  "Why did the leaf go to the doctor? It was feeling a little green.",
  "I'm reading a book about anti-gravity weeds. It's impossible to put down.",
  "Why did the dandelion blush? Because it saw the salad dressing.",
  "What do you call a mushroom that throws a great party? A fungi.",
  "Did you hear about the lazy lawn? It just kept loafing around.",
  "Why are weeds the best comedians? Their jokes really grow on you.",
  "What did the gardener say at the office party? Lettuce turnip the beet!",
  "Why couldn't the bicycle stand up by itself? It was two tired — like me at the end of mowing day.",
  "What do you call a sleeping lawnmower? A snore-ass.",
  "Why did the gardener plant a light bulb? He wanted to grow a power plant.",
  "What's a lawn's least favorite music? Heavy metal — too much tearing.",
  "Why are lawnmowers so good at gossip? They cut and run.",
  "I named my lawnmower 'Dexter' — every Sunday it goes on a killing spree.",
  "What did one weed say to the other? Lettuce out of here!",
  "Why was the gardener so calm? Because he knew when to leaf things alone.",
  "What's a tree's favorite type of math? Trigonom-tree.",
  "What did the dirt say when it rained? If this keeps up, my name is mud.",
  "Why did the sunflower blush? It saw the garden hose.",
  "What's the difference between a bad joke and a good lawn? One is grass, one is just... grass-tier.",
  "Why don't lawnmowers ever get invited to parties? They always cut things short.",
  "What do you call a polite lawnmower? Mow-courteous.",
  "Why did the rose break up with the cactus? Too many sharp comments.",
  "I was going to mow the lawn, but then I sat down and grass roots took over.",
  "What's a gardener's favorite kind of pie? Grass-roots.",
  "Why are gardeners always optimistic? They always see the seedling of hope.",
  "What did the soil say to the seed? You'll grow on me.",
  "Why did the lawnmower feel rich? It was rolling in green.",
  "What do you call a lawnmower with attitude? A grass-hole.",
  "Why are leaves always so sad in November? Because they're falling apart.",
  "What's a lawn's favorite exercise? Squats — for short grass.",
  "Why don't dandelions ever lose at poker? Because they're great at bluffing in the wind.",
  "What did the foreman say when the crew finished early? Don't grass it up to me, I'll believe it when I see it.",
  "Why did the maple tree start a podcast? To get to the root of every story.",
  "What did the lawnmower say to the grass? Have a nice trim, see ya next week.",
  "Why was the gardener arrested? For mulching with intent to weed.",
  "What's a hedge trimmer's favorite music? Anything with sharp cuts.",
  "Why did the lawn refuse to argue? It didn't want to mow over old ground.",
  "What did one blade of grass say to another? Hang in there, the weekend's almost mowed in.",
  "Why was the gardener nervous about retirement? He was afraid of letting things go to seed.",
  "What's a tree's favorite social media? Grama-gram.",
  "Why did the lawn become a philosopher? It spent too much time getting to the root of things.",
  "What's the best part of a long workday? When the boss says 'good growth team' and finally lets you go home.",
];

export const getDailyJoke = (dateStr: string): string => {
  if (LAWN_JOKES.length === 0) return '';
  // Anchor at noon local so YYYY-MM-DD isn't parsed as UTC midnight
  // (which silently rolls back to "yesterday" in any timezone west of UTC).
  const d = new Date(`${dateStr}T12:00:00`);
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
  return LAWN_JOKES[Math.abs(dayOfYear) % LAWN_JOKES.length];
};
