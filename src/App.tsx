import React, { useState, useEffect, useMemo } from 'react';
import logo from './public/logo/logowhite.png';
import logoBlack from './public/logo/LOGOBLACK.png';
import { LoginDemo } from './components/blocks/LoginDemo';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Users, Truck, Plus, Trash2, GripVertical,
  UserCircle, Wrench, Settings, Printer, AlertTriangle, Sun, Cloud, CloudRain, CloudLightning,
  Snowflake, X, CreditCard as IdCard, Copy, ClipboardPaste, Filter, AlignLeft, CloudSun, Activity,
  PenTool, AlertCircle, CheckCircle, Clock, List, LayoutDashboard, Save, TrendingUp, BarChart,
  Target, Award, CalendarDays, FileSignature, Map, CheckSquare, Info, Sparkles, Loader2,
  MessageSquareText, Leaf, Download, LogOut, ShieldCheck, UserPlus, Megaphone, Lock,
  Thermometer, Flame, Hourglass, Package, ClipboardList, BookOpen, ChevronDown
} from 'lucide-react';

// --- CUSTOM ICONS ---
const ClassAIcon = ({ className, title }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {title && <title>{title}</title>}
    <rect x="2" y="5" width="20" height="14" rx="2"></rect>
    <path d="M8 15l3-6 3 6"></path>
    <path d="M9.5 13h5"></path>
  </svg>
);

const SkidSteerIcon = ({ className, title }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {title && <title>{title}</title>}
    <circle cx="7" cy="17" r="2.5" />
    <circle cx="15" cy="17" r="2.5" />
    <path d="M5 14V8h5l2.5 4H16" />
    <path d="M3 14h12v3H3z" />
    <path d="M10 10l6 3h4v-2l-2-2" />
  </svg>
);

// --- FIREBASE SETUP ---
const firebaseConfig = {
  apiKey: "AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU",
  authDomain: "crewmaster-73f31.firebaseapp.com",
  projectId: "crewmaster-73f31",
  storageBucket: "crewmaster-73f31.firebasestorage.app",
  messagingSenderId: "831920078849",
  appId: "1:831920078849:web:8d72204b58c48bb21f0000"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const appId = String(rawAppId).replace(/\//g, '-');

// --- GEMINI API HELPERS ---
const callGeminiWithRetry = async (prompt, retries = 5, delay = 1000) => {
  const apiKey = "";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(res => setTimeout(res, delay));
      delay *= 2;
    }
  }
};

// --- DEFAULT DATA & CONSTANTS ---
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

const DIVISIONS = ['Large Projects', 'Small Projects', 'Lawn Division'];
const CREW_NUMBERS = [1, 2, 3, 4, 5, 6];
const WEIGHT_CLASSES = ['Under 4500kg', 'Up to 10999kg (Yellow)', '10999kg+ (Class A)', 'N/A'];
const ROUTE_FREQUENCIES = ['Weekly', 'Bi-Weekly 1', 'Bi-Weekly 2'];
const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const getCrewColors = (div, num) => {
  const palettes = {
    'Large Projects': ['bg-green-800 text-white border-green-900', 'bg-green-600 text-white border-green-700', 'bg-green-500 text-white border-green-600', 'bg-green-400 text-green-900 border-green-500', 'bg-green-300 text-green-900 border-green-400', 'bg-green-200 text-green-900 border-green-300'],
    'Lawn Division': ['bg-green-800 text-white border-green-900', 'bg-green-600 text-white border-green-700', 'bg-green-500 text-white border-green-600', 'bg-green-400 text-green-900 border-green-500', 'bg-green-300 text-green-900 border-green-400', 'bg-green-200 text-green-900 border-green-300'],
    'Small Projects': ['bg-purple-800 text-white border-purple-900', 'bg-purple-600 text-white border-purple-700', 'bg-purple-500 text-white border-purple-600', 'bg-purple-400 text-purple-900 border-purple-500', 'bg-purple-300 text-purple-900 border-purple-400', 'bg-purple-200 text-purple-900 border-purple-300']
  };
  const shades = palettes[div] || palettes['Large Projects'];
  return shades[Math.min(num - 1, 5)];
};

const getStartOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

const formatDate = (date) => date.toISOString().split('T')[0];
const addDays = (date, days) => { const result = new Date(date); result.setDate(result.getDate() + days); return result; };
const isExpiringSoon = (dateStr) => {
  if (!dateStr) return false;
  const diffDays = Math.ceil((new Date(dateStr) - new Date().setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  return diffDays <= 30 && diffDays >= 0;
};
const isExpired = (dateStr) => {
  if (!dateStr) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(dateStr) < today;
};
const isOdoStale = (dateStr) => !dateStr || Math.ceil((new Date().setHours(0, 0, 0, 0) - new Date(dateStr)) / (1000 * 60 * 60 * 24)) >= 30;
const needsAudit = (dateStr) => !dateStr || Math.ceil((new Date().setHours(0, 0, 0, 0) - new Date(dateStr)) / (1000 * 60 * 60 * 24)) > 14;

export default function App() {
  // --- STATE ---
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [weather, setWeather] = useState({});
  const [toast, setToast] = useState(null);

  const displayEmail = user?.email || "marcoguidopalermo@gmail.com";

  // Navigation & Views
  const [currentView, setCurrentView] = useState('schedule');
  const [scheduleMode, setScheduleMode] = useState('weekly');
  const [selectedDailyDate, setSelectedDailyDate] = useState(formatDate(new Date()));
  const [crewFilter, setCrewFilter] = useState('All');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [copiedDay, setCopiedDay] = useState(null);

  // Modals & Forms State
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [isWeatherModalOpen, setIsWeatherModalOpen] = useState(false);
  const [aiModal, setAiModal] = useState({ isOpen: false, title: '', content: '', isLoading: false });
  const [manageTab, setManageTab] = useState('employees');
  const [fleetFilter, setFleetFilter] = useState('All');

  const [localEmployees, setLocalEmployees] = useState([]);
  const [localFleet, setLocalFleet] = useState([]);
  const [localRoutes, setLocalRoutes] = useState([]);
  const [localAdmins, setLocalAdmins] = useState([]);
  const [localInventory, setLocalInventory] = useState([]);
  const [newAdminEmail, setNewAdminEmail] = useState('');

  // MechanicMaster State
  const [mechanicView, setMechanicView] = useState('tracker');
  const [repairModal, setRepairModal] = useState({ isOpen: false, fleetId: null, fixNotes: '', cost: '' });
  const [editingOdoId, setEditingOdoId] = useState(null);
  const [tempOdo, setTempOdo] = useState('');

  // PerformanceMaster State
  const [perfDate, setPerfDate] = useState(formatDate(new Date()));
  const [perfTab, setPerfTab] = useState('entry');
  const [reportStartDate, setReportStartDate] = useState(formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [reportEndDate, setReportEndDate] = useState(formatDate(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)));
  const [dailyLogs, setDailyLogs] = useState({});
  const [routeModalCrewId, setRouteModalCrewId] = useState(null);
  const [routeFilters, setRouteFilters] = useState({ division: 'Lawn Division', targetDay: 'Monday', frequency: 'Weekly' });
  const [selectedRouteIds, setSelectedRouteIds] = useState(new Set());

  // Bulletin Board State
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [isAdminOnly, setIsAdminOnly] = useState(false);

  // Core App Data Structure
  const [appData, setAppData] = useState({
    schedules: {},
    employees: INITIAL_EMPLOYEES,
    fleet: INITIAL_FLEET,
    routes: [],
    inventory: INITIAL_INVENTORY,
    repairLog: [],
    bulletins: [{ id: 'b1', title: "Welcome to Marco's Mowing ERP", content: 'The new system is live. Check out the Daily View and the new Inventory tracking!', date: formatDate(new Date()), isAdminOnly: false, author: 'System' }],
    dailyAbsences: {},
    performance: {},
    authorizedEmails: [displayEmail]
  });

  // --- INIT EFFECTS ---
  useEffect(() => {
    fetch('https://api.open-meteo.com/v1/forecast?latitude=48.3809&longitude=-89.2477&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto')
      .then(res => res.json())
      .then(data => {
        const weatherMap = {};
        data.daily.time.forEach((dateStr, i) => { weatherMap[dateStr] = { max: Math.round(data.daily.temperature_2m_max[i]), min: Math.round(data.daily.temperature_2m_min[i]), code: data.daily.weathercode[i] }; });
        setWeather(weatherMap);
      }).catch(() => console.error("Weather fetch failed"));
  }, []);

  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    const dataRef = doc(db, 'artifacts', appId, 'public', 'data', 'appData', 'main');
    return onSnapshot(dataRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setAppData({
          schedules: data.schedules || {}, employees: data.employees || INITIAL_EMPLOYEES,
          fleet: data.fleet || INITIAL_FLEET, routes: data.routes || [],
          inventory: data.inventory || INITIAL_INVENTORY, repairLog: data.repairLog || [],
          bulletins: data.bulletins || [], dailyAbsences: data.dailyAbsences || {},
          performance: data.performance || {}, authorizedEmails: data.authorizedEmails || [displayEmail]
        });
      } else { setDoc(dataRef, appData).catch(err => console.error("Init err:", err)); }
      setLoading(false); setErrorMsg(null);
    }, () => { setErrorMsg("Cloud disconnected."); setLoading(false); });
  }, [user]);

  useEffect(() => {
    const savedLogs = appData.performance?.[perfDate] || {};
    const initialLogs = {};
    const schedules = appData.schedules[perfDate] || [];

    Object.keys(savedLogs).forEach(cId => {
      if (savedLogs[cId].isAdHoc) initialLogs[cId] = { ...savedLogs[cId] };
    });

    schedules.forEach(crew => {
      const saved = savedLogs[crew.id] || { jobs: [], employeeAH: {}, deductions: {} };
      initialLogs[crew.id] = {
        division: crew.division || 'Large Projects', crewNumber: crew.crewNumber || 1, isAdHoc: false,
        jobs: saved.jobs || [], employeeAH: saved.employeeAH || {}, deductions: saved.deductions || {}
      };
      crew.employees.forEach(eId => {
        if (initialLogs[crew.id].employeeAH[eId] === undefined) initialLogs[crew.id].employeeAH[eId] = '';
        if (initialLogs[crew.id].deductions[eId] === undefined) initialLogs[crew.id].deductions[eId] = '';
      });
    });
    setDailyLogs(initialLogs);
  }, [perfDate, appData.schedules, appData.performance]);

  // Derived variables
  const startOfWeek = getStartOfWeek(currentDate);
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(startOfWeek, i));

  const showToastMsg = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4500); };
  const getEmpName = (id) => appData.employees.find(e => e.id === id)?.name || 'Unknown';
  const getInvName = (id) => appData.inventory.find(i => i.id === id)?.name || 'Unknown Item';

  const handlePrevWeek = () => setCurrentDate(addDays(currentDate, -7));
  const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));
  const handleToday = () => setCurrentDate(new Date());

  const handlePrint = () => {
    try {
      window.focus();
      window.print();
      setTimeout(() => { showToastMsg("If the print dialog didn't open, please press Ctrl+P (Windows) or Cmd+P (Mac)."); }, 500);
    } catch (err) {
      showToastMsg("Browser blocked printing. Please press Ctrl+P (Windows) or Cmd+P (Mac).");
    }
  };


  const syncToCloud = async (newData) => {
    setAppData(newData);
    if (!user) return;
    try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appData', 'main'), newData); }
    catch (err) { console.error("Error saving:", err); }
  };

  const handleCopyDay = (dateString) => { setCopiedDay({ date: dateString, crews: appData.schedules[dateString] || [] }); showToastMsg(`Copied ${dateString}`); };
  const handlePasteDay = (targetDateString) => {
    if (!copiedDay) return;
    const newCrews = copiedDay.crews.map(c => ({ ...c, id: `crew-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` }));
    const pastedEmpIds = new Set(newCrews.flatMap(c => c.employees));
    const pastedFleetIds = new Set(newCrews.flatMap(c => c.fleet));

    let existingDayCrews = (appData.schedules[targetDateString] || []).map(c => ({
      ...c,
      employees: c.employees.filter(id => !pastedEmpIds.has(id)),
      fleet: c.fleet.filter(id => !pastedFleetIds.has(id))
    }));
    syncToCloud({ ...appData, schedules: { ...appData.schedules, [targetDateString]: [...existingDayCrews, ...newCrews] } });
    showToastMsg(`Pasted to ${targetDateString}`);
  };

  const getWeatherIcon = (code) => {
    if (code === undefined) return null;
    if (code === 0) return <Sun className="w-5 h-5 text-yellow-500" />;
    if (code >= 1 && code <= 3) return <Cloud className="w-5 h-5 text-gray-400" />;
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className="w-5 h-5 text-green-500" />;
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return <Snowflake className="w-5 h-5 text-green-300" />;
    if (code >= 95 && code <= 99) return <CloudLightning className="w-5 h-5 text-purple-500" />;
    return <Cloud className="w-5 h-5 text-gray-400" />;
  };

  const getWeatherDescription = (code) => {
    if (code === undefined) return 'Unknown';
    if (code === 0) return 'Clear skies';
    if (code >= 1 && code <= 3) return 'Partly cloudy to overcast';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain or showers expected';
    if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'Snow expected';
    if (code >= 95 && code <= 99) return 'Thunderstorms likely';
    return 'Cloudy';
  };

  const handleGenerateMorningBriefing = async (dateString, crew, dayWeather) => {
    const crewEmps = crew.employees.map(id => appData.employees.find(e => e.id === id)).filter(Boolean);
    const crewFleet = crew.fleet.map(id => appData.fleet.find(f => f.id === id)).filter(Boolean);

    setAiModal({ isOpen: true, title: `Morning Briefing: ${crew.division} ${crew.crewNumber}`, content: '', isLoading: true });

    const weatherString = dayWeather ? `${dayWeather.max}°C / ${dayWeather.min}°C, ${getWeatherDescription(dayWeather.code)}` : 'Weather unknown.';
    const empString = crewEmps.map(e => e.name).join(', ') || 'No employees assigned yet.';
    const fleetString = crewFleet.map(f => f.name).join(', ') || 'No fleet assigned yet.';

    const prompt = `Act as an expert operations manager for a landscaping company. Write a short, bulleted morning huddle briefing to be read by the foreman of this crew before they head out.
    Date: ${dateString}
    Weather: ${weatherString}
    Crew Name: ${crew.division} ${crew.crewNumber}
    Team Members: ${empString}
    Assigned Fleet/Equipment: ${fleetString}
    Manager Notes: ${crew.notes || 'None'}

    Make the briefing highly practical, energetic, and professional. 
    1. Acknowledge the weather (e.g., remind them to stay hydrated if hot, or drive safe if raining).
    2. Remind them to do circle checks on their specific assigned fleet.
    3. Incorporate the manager notes as their primary objective.
    Keep the whole response under 150 words. Do not use generic filler.`;

    try {
      const response = await callGeminiWithRetry(prompt);
      setAiModal(prev => ({ ...prev, isLoading: false, content: response }));
    } catch (error) {
      setAiModal(prev => ({ ...prev, isLoading: false, content: "Failed to generate briefing. Please try again." }));
      console.error(error);
    }
  };

  const handleGeneratePerformanceInsight = async (log, cId) => {
    const sumBH = log.jobs.reduce((s, j) => s + Number(j.bh || 0), 0);
    const sumAH = Object.values(log.employeeAH).reduce((s, v) => s + Number(v || 0), 0);
    const eff = sumAH > 0 ? ((sumBH / sumAH) * 100).toFixed(1) : 0;
    const jobList = log.jobs.length > 0 ? log.jobs.map(j => `${j.desc} (${j.bh} BH)`).join(', ') : 'No jobs recorded.';

    setAiModal({ isOpen: true, title: `Performance Insight: ${log.division} ${log.crewNumber}`, content: '', isLoading: true });

    const prompt = `Act as a sharp, analytical landscaping operations analyst. Review this daily crew log and provide a constructive assessment to the business owner.
    Crew: ${log.division} ${log.crewNumber}
    Date Logged: ${perfDate}
    Total Budgeted Hours (Target allowed): ${sumBH.toFixed(1)}
    Total Actual Hours (Clocked by crew): ${sumAH.toFixed(1)}
    Efficiency Score: ${eff}% (Company baseline target is 80%. >90% is excellent, <80% needs improvement).
    Jobs Completed Today: ${jobList}

    Provide a 3-bullet-point operational assessment.
    - Bullet 1: Assess their efficiency score (were they profitable or did they bleed hours?).
    - Bullet 2: Look at the ratio of jobs completed vs total hours and provide an insight.
    - Bullet 3: Give one piece of constructive, practical advice for the owner to discuss with this foreman.
    Keep it extremely concise (under 100 words total). Format with simple bullet points.`;

    try {
      const response = await callGeminiWithRetry(prompt);
      setAiModal(prev => ({ ...prev, isLoading: false, content: response }));
    } catch (error) {
      setAiModal(prev => ({ ...prev, isLoading: false, content: "Failed to generate insights. Please try again." }));
      console.error(error);
    }
  };


  // --- ACTIONS ---
  const toggleSickDay = (empId, dateStr) => {
    const newAbsences = { ...appData.dailyAbsences };
    if (!newAbsences[dateStr]) newAbsences[dateStr] = [];

    let newSchedules = { ...appData.schedules };

    if (newAbsences[dateStr].includes(empId)) {
      newAbsences[dateStr] = newAbsences[dateStr].filter(id => id !== empId);
    } else {
      newAbsences[dateStr].push(empId);
      // Auto remove from any crews today
      if (newSchedules[dateStr]) {
        newSchedules[dateStr] = newSchedules[dateStr].map(crew => ({
          ...crew, employees: crew.employees.filter(id => id !== empId)
        }));
      }
    }
    syncToCloud({ ...appData, dailyAbsences: newAbsences, schedules: newSchedules });
  };

  const handleRepairComplete = () => {
    const { fleetId, fixNotes, cost } = repairModal;
    const fItem = appData.fleet.find(f => f.id === fleetId);

    const newLogEntry = {
      id: `rep-${Date.now()}`, equipmentId: fleetId, equipmentName: fItem.name,
      date: formatDate(new Date()), fixNotes, cost: Number(cost) || 0
    };

    const newFleet = appData.fleet.map(f => f.id === fleetId ? { ...f, status: 'Active', repairTags: [] } : f);
    syncToCloud({ ...appData, fleet: newFleet, repairLog: [newLogEntry, ...appData.repairLog] });
    setRepairModal({ isOpen: false, fleetId: null, fixNotes: '', cost: '' });
    showToastMsg("Repair logged successfully.");
  };

  const toggleRepairTag = (fleetId, tag) => {
    const newFleet = appData.fleet.map(f => {
      if (f.id !== fleetId) return f;
      const tags = f.repairTags || [];
      return { ...f, repairTags: tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag] };
    });
    syncToCloud({ ...appData, fleet: newFleet });
  };

  const addCrewToDay = (dateString) => {
    const daySchedules = appData.schedules[dateString] || [];
    const lpCrews = daySchedules.filter(c => c.division === 'Large Projects');
    let nextNum = 1;
    while (lpCrews.some(c => c.crewNumber === nextNum)) nextNum++;

    const newSchedules = {
      ...appData.schedules,
      [dateString]: [...daySchedules, { id: `crew-${Date.now()}`, division: 'Large Projects', crewNumber: nextNum, notes: '', employees: [], fleet: [], inventory: [] }]
    };
    syncToCloud({ ...appData, schedules: newSchedules });
  };

  const updateCrewItem = (dateString, crewId, type, action, itemData) => {
    const daySchedules = appData.schedules[dateString] || [];
    const newSchedules = { ...appData.schedules };

    newSchedules[dateString] = daySchedules.map(crew => {
      if (crew.id !== crewId) return crew;
      const updated = { ...crew };

      if (type === 'employee' || type === 'fleet') {
        const list = updated[type === 'employee' ? 'employees' : 'fleet'];
        if (action === 'add' && !list.includes(itemData)) list.push(itemData);
        if (action === 'remove') updated[type === 'employee' ? 'employees' : 'fleet'] = list.filter(id => id !== itemData);
      } else if (type === 'inventory') {
        let invList = updated.inventory || [];
        if (action === 'add') {
          const existing = invList.find(i => i.id === itemData.id);
          if (existing) existing.qty += itemData.qty; else invList.push(itemData);
          // Deduct from global stock
          const newInv = appData.inventory.map(inv => inv.id === itemData.id ? { ...inv, stock: inv.stock - itemData.qty } : inv);
          setAppData(prev => ({ ...prev, inventory: newInv })); // optimistic local update
        }
        if (action === 'remove') {
          const item = invList.find(i => i.id === itemData);
          if (item) {
            // Return to global stock
            const newInv = appData.inventory.map(inv => inv.id === itemData ? { ...inv, stock: inv.stock + item.qty } : inv);
            setAppData(prev => ({ ...prev, inventory: newInv }));
            updated.inventory = invList.filter(i => i.id !== itemData);
          }
        }
      }
      return updated;
    });
    syncToCloud({ ...appData, schedules: newSchedules });
  };

  const onDragStart = (e, type, item) => {
    if (type === 'fleet' && item.status !== 'Active') { e.preventDefault(); showToastMsg(`Cannot assign: ${item.status}`); return; }
    if (type === 'employee') {
      const dateStr = scheduleMode === 'daily' ? selectedDailyDate : formatDate(currentDate);
      if (item.status === 'Away' || (appData.dailyAbsences[dateStr] && appData.dailyAbsences[dateStr].includes(item.id))) { e.preventDefault(); showToastMsg(`${item.name} is unavailable.`); return; }
    }
    e.dataTransfer.setData('text/plain', JSON.stringify({ type, id: item.id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDrop = (e, dateString, crewId) => {
    e.preventDefault();
    try {
      const { type, id } = JSON.parse(e.dataTransfer.getData('text/plain'));

      // Auto-remove from existing crew on the same day if re-assigned
      const daySchedules = appData.schedules[dateString] || [];
      const existingCrew = daySchedules.find(c => c[type === 'employee' ? 'employees' : 'fleet'].includes(id));
      if (existingCrew && existingCrew.id !== crewId) {
        updateCrewItem(dateString, existingCrew.id, type, 'remove', id);
      }
      updateCrewItem(dateString, crewId, type, 'add', id);
    } catch (err) { }
  };

  // --- RENDERERS ---
  const renderSidebarItem = (item, type, contextDate = null) => {
    const isEmp = type === 'employee';
    let isDraggable = true, visClass = 'bg-white border-gray-200 hover:border-green-400', subText = null;
    const isAbsentToday = isEmp && contextDate && appData.dailyAbsences[contextDate]?.includes(item.id);

    if (!isEmp) {
      if (item.status !== 'Active') { isDraggable = false; visClass = 'border-red-200 opacity-60 bg-red-50'; subText = <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase font-bold">{item.status}</span>; }
    } else {
      if (item.status === 'Away') { isDraggable = false; visClass = 'border-orange-200 bg-orange-50'; subText = <span className="text-[10px] bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full font-bold">Away Indef.</span>; }
      else if (isAbsentToday) { isDraggable = false; visClass = 'border-rose-200 bg-rose-50 opacity-70'; subText = <span className="text-[10px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full font-bold">Sick / Absent</span>; }
    }

    const Icon = isEmp ? UserCircle : (item.type === 'equipment' ? SkidSteerIcon : (item.type === 'trailer' ? Wrench : Truck));
    return (
      <div key={item.id} draggable={isDraggable} onDragStart={(e) => onDragStart(e, type, item)} className={`flex items-center gap-3 p-2.5 mb-2 border rounded-lg shadow-sm transition-all ${visClass} ${isDraggable ? 'cursor-grab' : ''}`}>
        {isDraggable ? <GripVertical className="w-4 h-4 text-gray-400" /> : <div className="w-4" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm text-gray-900 flex items-center gap-1.5 truncate">
            {item.name}
            {isEmp && item.hasLicense && <IdCard className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />}
            {isEmp && item.hasClassA && <ClassAIcon className="w-3.5 h-3.5 text-purple-600 flex-shrink-0" />}
            {isEmp && item.hasHeavyMachinery && <SkidSteerIcon className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" />}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {isEmp ? <span className="text-[10px] bg-gray-100 text-gray-600 border border-gray-200 px-1.5 rounded uppercase font-bold">{item.role}</span> : <span className="text-[10px] bg-gray-100 text-gray-600 border border-gray-200 px-1.5 rounded uppercase font-bold">{item.type}</span>}
            {subText}
          </div>
        </div>
        {isEmp && contextDate && isAdmin && (
          <button onClick={() => toggleSickDay(item.id, contextDate)} className={`p-1.5 rounded-lg border transition-colors ${isAbsentToday ? 'bg-rose-100 border-rose-300 text-rose-600' : 'bg-gray-50 border-gray-200 text-gray-400 hover:text-rose-500 hover:bg-rose-50'}`} title="Toggle Absence">
            <Thermometer className="w-4 h-4" />
          </button>
        )}
        {!isEmp && <Icon className={`w-5 h-5 flex-shrink-0 ${isDraggable ? 'text-gray-500' : 'text-red-400'}`} />}
      </div>
    );
  };

  const renderCrewCard = (dateString, crew, dayWeather) => {
    const crewEmps = crew.employees.map(id => appData.employees.find(e => e.id === id)).filter(Boolean);
    const crewFleet = crew.fleet.map(id => appData.fleet.find(f => f.id === id)).filter(Boolean);
    const crewInv = crew.inventory || [];

    const warnings = [];
    if (crewFleet.some(f => f.type === 'truck') && crewEmps.length > 0 && !crewEmps.some(e => e.hasLicense || e.hasClassA)) warnings.push("Needs licensed driver");
    if (crewFleet.some(f => f.weightClass === '10999kg+ (Class A)') && crewEmps.length > 0 && !crewEmps.some(e => e.hasClassA)) warnings.push("Needs Class A Driver");

    const colorClasses = getCrewColors(crew.division, crew.crewNumber);
    const availableEmps = appData.employees.filter(e => e.status !== 'Away' && !appData.dailyAbsences[dateString]?.includes(e.id) && !crew.employees.includes(e.id));
    const availableFleet = appData.fleet.filter(f => f.status === 'Active' && !crew.fleet.includes(f.id));

    return (
      <div key={crew.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-4 print:break-inside-avoid print:shadow-none flex flex-col" onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, dateString, crew.id)}>

        {/* Header Ribbon */}
        <div className={`px-3 py-2 flex justify-between items-center ${colorClasses}`}>
          <div className="flex items-center gap-2 w-full">
            <select className="text-sm font-bold bg-transparent outline-none flex-1 appearance-none cursor-pointer text-inherit" value={crew.division} onChange={(e) => { const newSchedules = { ...appData.schedules }; newSchedules[dateString] = newSchedules[dateString].map(c => c.id === crew.id ? { ...c, division: e.target.value } : c); syncToCloud({ ...appData, schedules: newSchedules }); }}>
              {DIVISIONS.map(d => <option key={d} value={d} className="text-gray-900">{d}</option>)}
            </select>
            <select className="text-sm font-bold bg-transparent outline-none w-10 text-center appearance-none cursor-pointer text-inherit border-l border-white/20 pl-2" value={crew.crewNumber} onChange={(e) => { const newSchedules = { ...appData.schedules }; newSchedules[dateString] = newSchedules[dateString].map(c => c.id === crew.id ? { ...c, crewNumber: Number(e.target.value) } : c); syncToCloud({ ...appData, schedules: newSchedules }); }}>
              {CREW_NUMBERS.map(n => <option key={n} value={n} className="text-gray-900">#{n}</option>)}
            </select>
            {isAdmin && <button onClick={() => { const newSchedules = { ...appData.schedules }; newSchedules[dateString] = newSchedules[dateString].filter(c => c.id !== crew.id); syncToCloud({ ...appData, schedules: newSchedules }); }} className="text-white/60 hover:text-white ml-auto"><Trash2 className="w-4 h-4" /></button>}
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="bg-orange-50 border-b border-orange-100 px-3 py-1.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-orange-800 font-semibold">{warnings.join(" • ")}</div>
          </div>
        )}

        <div className="p-3 space-y-3 flex-1 flex flex-col">
          <div className="print:hidden flex items-center justify-between">
            <button onClick={() => handleGenerateMorningBriefing(dateString, crew, dayWeather)} className="text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded hover:bg-teal-100 flex items-center gap-1 transition-colors">
              <Sparkles className="w-3 h-3" /> AI Briefing
            </button>
          </div>
          <textarea className="w-full text-xs p-2 bg-gray-50 border border-gray-200 rounded-lg resize-none outline-none focus:bg-white focus:border-green-400 focus:ring-1 ring-green-400" placeholder="Manager notes / targets..." rows="2" defaultValue={crew.notes || ''} onBlur={(e) => { const newSchedules = { ...appData.schedules }; newSchedules[dateString] = newSchedules[dateString].map(c => c.id === crew.id ? { ...c, notes: e.target.value } : c); syncToCloud({ ...appData, schedules: newSchedules }); }} />

          {/* Personnel Section */}
          <div className="bg-slate-50 rounded-lg border border-slate-200 p-2 flex flex-col gap-1.5 min-h-[50px]">
            <div className="flex justify-between items-center text-xs font-bold text-slate-700 uppercase tracking-wide px-1">
              <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Personnel</span>
            </div>
            {crewEmps.map(emp => (
              <div key={emp.id} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-slate-200 text-sm shadow-sm group">
                <span className="truncate flex items-center gap-1.5 font-medium text-slate-800">
                  {emp.name} {emp.hasLicense && <IdCard className="w-3.5 h-3.5 text-green-600" />} {emp.hasClassA && <ClassAIcon className="w-3.5 h-3.5 text-purple-600" />} {emp.hasHeavyMachinery && <SkidSteerIcon className="w-3.5 h-3.5 text-orange-600" />}
                </span>
                <button onClick={() => updateCrewItem(dateString, crew.id, 'employee', 'remove', emp.id)} className="text-gray-300 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            ))}
            {isAdmin && availableEmps.length > 0 && (
              <div className="relative mt-1">
                <select className="w-full text-xs text-slate-500 font-bold bg-white border border-dashed border-slate-300 rounded p-1.5 appearance-none cursor-pointer outline-none hover:bg-slate-50" onChange={(e) => { if (e.target.value) updateCrewItem(dateString, crew.id, 'employee', 'add', e.target.value); e.target.value = ''; }} defaultValue="">
                  <option value="" disabled>+ Assign Employee...</option>
                  {availableEmps.map(e => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Fleet Section */}
          <div className="bg-gray-100 rounded-lg border border-gray-200 p-2 flex flex-col gap-1.5 min-h-[50px]">
            <div className="flex justify-between items-center text-xs font-bold text-gray-700 uppercase tracking-wide px-1">
              <span className="flex items-center gap-1.5"><Truck className="w-3.5 h-3.5" /> Fleet & Equip</span>
            </div>
            {crewFleet.map(veh => (
              <div key={veh.id} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-gray-200 text-sm shadow-sm">
                <span className="truncate text-gray-800 font-medium flex items-center gap-1.5">
                  {veh.name}
                  {veh.repairTags?.includes('priority') && <Flame className="w-3 h-3 text-red-500" title="Priority Repair" />}
                  {veh.repairTags?.includes('waiting') && <Hourglass className="w-3 h-3 text-orange-500" title="Waiting on Parts" />}
                </span>
                <button onClick={() => updateCrewItem(dateString, crew.id, 'fleet', 'remove', veh.id)} className="text-gray-300 hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            ))}
            {isAdmin && availableFleet.length > 0 && (
              <div className="relative mt-1">
                <select className="w-full text-xs text-gray-500 font-bold bg-white border border-dashed border-gray-300 rounded p-1.5 appearance-none cursor-pointer outline-none hover:bg-gray-50" onChange={(e) => { if (e.target.value) updateCrewItem(dateString, crew.id, 'fleet', 'add', e.target.value); e.target.value = ''; }} defaultValue="">
                  <option value="" disabled>+ Assign Fleet...</option>
                  {availableFleet.map(f => <option key={f.id} value={f.id}>{f.name} ({f.type})</option>)}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-2 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Inventory Section */}
          <div className="bg-emerald-50/50 rounded-lg border border-emerald-100 p-2 flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-xs font-bold text-emerald-800 uppercase tracking-wide px-1">
              <span className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Inventory</span>
            </div>
            {crewInv.map(inv => (
              <div key={inv.id} className="flex items-center justify-between bg-white px-2 py-1.5 rounded border border-emerald-200 text-sm shadow-sm">
                <span className="truncate text-emerald-900 font-medium flex-1 mr-2">{getInvName(inv.id)}</span>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">{inv.qty}x</span>
                <button onClick={() => updateCrewItem(dateString, crew.id, 'inventory', 'remove', inv.id)} className="text-gray-300 hover:text-red-500 ml-2"><X className="w-4 h-4" /></button>
              </div>
            ))}
            {isAdmin && (
              <div className="flex gap-1 mt-1">
                <div className="relative flex-1">
                  <select id={`inv-sel-${crew.id}`} className="w-full text-xs text-emerald-700 font-bold bg-white border border-dashed border-emerald-300 rounded p-1.5 appearance-none cursor-pointer outline-none hover:bg-emerald-50" defaultValue="">
                    <option value="" disabled>Item...</option>
                    {appData.inventory.map(i => <option key={i.id} value={i.id} disabled={i.stock <= 0}>{i.name} (Stk: {i.stock})</option>)}
                  </select>
                </div>
                <input type="number" id={`inv-qty-${crew.id}`} placeholder="Qty" className="w-12 text-xs border border-dashed border-emerald-300 rounded p-1.5 outline-none text-center bg-white text-emerald-900 font-bold" defaultValue="1" min="1" />
                <button onClick={() => {
                  const sel = document.getElementById(`inv-sel-${crew.id}`);
                  const qty = document.getElementById(`inv-qty-${crew.id}`);
                  if (sel.value && qty.value > 0) {
                    updateCrewItem(dateString, crew.id, 'inventory', 'add', { id: sel.value, qty: Number(qty.value) });
                    sel.value = ''; qty.value = '1';
                  }
                }} className="bg-emerald-100 text-emerald-700 border border-emerald-200 p-1.5 rounded hover:bg-emerald-200 transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMechanicBoard = () => {
    const oosFleet = appData.fleet.filter(f => f.status === 'Out of Service');
    const repairFleet = appData.fleet.filter(f => f.status === 'In Repair');

    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-100 p-6 print:bg-white overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><PenTool className="w-6 h-6 text-green-600" /> MechanicMaster Pro</h2>
          <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            <button onClick={() => setMechanicView('tracker')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'tracker' ? 'bg-green-50 text-green-700' : 'text-gray-500 hover:text-gray-700'}`}><List className="w-4 h-4" /> Fleet List</button>
            <button onClick={() => setMechanicView('kanban')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'kanban' ? 'bg-green-50 text-green-700' : 'text-gray-500 hover:text-gray-700'}`}><LayoutDashboard className="w-4 h-4" /> Repair Board</button>
            <button onClick={() => setMechanicView('log')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-md ${mechanicView === 'log' ? 'bg-green-50 text-green-700' : 'text-gray-500 hover:text-gray-700'}`}><ClipboardList className="w-4 h-4" /> Repair Log</button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Company CVOR</h4>
            <div className="flex items-center gap-2 mt-1">
              <input type="date" value={appData.cvorExpiry || ''} onChange={(e) => syncToCloud({ ...appData, cvorExpiry: e.target.value })} className="bg-gray-50 border border-gray-200 rounded p-1.5 text-sm text-gray-800 font-medium outline-none" />
              {isExpiringSoon(appData.cvorExpiry) && <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded font-bold">Expiring!</span>}
            </div>
          </div>
          <div className="flex-1 min-w-[200px] bg-red-50 border border-red-100 rounded-lg p-3">
            <h4 className="text-xs font-bold text-red-800 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Missing Odo Updates</h4>
            <p className="text-sm text-red-600 font-medium mt-1">{appData.fleet.filter(f => f.type !== 'trailer' && isOdoStale(f.lastOdometerUpdate)).length} vehicles unupdated in 30 days.</p>
          </div>
        </div>

        {mechanicView === 'kanban' ? (
          <div className="flex gap-6 flex-1 min-h-[300px]">
            <div className="flex-1 bg-red-50/50 rounded-xl border border-red-100 p-4 flex flex-col" onDragOver={e => e.preventDefault()} onDrop={e => {
              e.preventDefault(); try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); if (d.type === 'fleet') syncToCloud({ ...appData, fleet: appData.fleet.map(f => f.id === d.id ? { ...f, status: 'Out of Service' } : f) }); } catch (err) { }
            }}>
              <h4 className="font-bold text-red-800 mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Out of Service</div><span className="bg-red-200 text-red-800 text-xs px-2 py-0.5 rounded-full">{oosFleet.length}</span></h4>
              <div className="flex-1 overflow-y-auto space-y-3">
                {oosFleet.map(f => (
                  <div key={f.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'fleet', id: f.id }))} className="bg-white p-3 rounded-lg border border-red-200 shadow-sm cursor-grab group">
                    <div className="font-bold text-gray-800">{f.name}</div>
                    <div className="text-xs text-gray-500 capitalize">{f.type} • {f.weightClass}</div>
                    <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => toggleRepairTag(f.id, 'priority')} className={`p-1 rounded text-xs font-bold border ${f.repairTags?.includes('priority') ? 'bg-red-100 text-red-700 border-red-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}><Flame className="w-3.5 h-3.5 inline mr-1" /> Priority</button>
                      <button onClick={() => toggleRepairTag(f.id, 'waiting')} className={`p-1 rounded text-xs font-bold border ${f.repairTags?.includes('waiting') ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}><Hourglass className="w-3.5 h-3.5 inline mr-1" /> Parts</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 bg-orange-50/50 rounded-xl border border-orange-100 p-4 flex flex-col" onDragOver={e => e.preventDefault()} onDrop={e => {
              e.preventDefault(); try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); if (d.type === 'fleet') syncToCloud({ ...appData, fleet: appData.fleet.map(f => f.id === d.id ? { ...f, status: 'In Repair' } : f) }); } catch (err) { }
            }}>
              <h4 className="font-bold text-orange-800 mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><PenTool className="w-4 h-4" /> In Repair</div><span className="bg-orange-200 text-orange-800 text-xs px-2 py-0.5 rounded-full">{repairFleet.length}</span></h4>
              <div className="flex-1 overflow-y-auto space-y-3">
                {repairFleet.map(f => (
                  <div key={f.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'fleet', id: f.id }))} className="bg-white p-3 rounded-lg border border-orange-200 shadow-sm cursor-grab group">
                    <div className="font-bold text-gray-800">{f.name}</div>
                    <div className="text-xs text-gray-500 capitalize mb-2">{f.type} • {f.weightClass}</div>
                    <textarea className="w-full text-xs p-1.5 bg-orange-50/50 border border-orange-100 rounded resize-none outline-none focus:border-orange-300" placeholder="Mechanic notes..." defaultValue={f.mechanicNotes || ''} onBlur={(e) => syncToCloud({ ...appData, fleet: appData.fleet.map(v => v.id === f.id ? { ...v, mechanicNotes: e.target.value } : v) })} rows="2" />
                    <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => toggleRepairTag(f.id, 'priority')} className={`p-1 rounded text-xs font-bold border ${f.repairTags?.includes('priority') ? 'bg-red-100 text-red-700 border-red-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}><Flame className="w-3.5 h-3.5 inline mr-1" /> Priority</button>
                      <button onClick={() => toggleRepairTag(f.id, 'waiting')} className={`p-1 rounded text-xs font-bold border ${f.repairTags?.includes('waiting') ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`}><Hourglass className="w-3.5 h-3.5 inline mr-1" /> Parts</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 bg-green-50/50 rounded-xl border border-green-100 p-4 flex flex-col" onDragOver={e => e.preventDefault()} onDrop={e => {
              e.preventDefault(); try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); if (d.type === 'fleet') setRepairModal({ isOpen: true, fleetId: d.id, fixNotes: '', cost: '' }); } catch (err) { }
            }}>
              <h4 className="font-bold text-green-800 mb-3 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Complete (Return to Active)</h4>
              <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-green-300 rounded-lg bg-green-50/50 text-green-600/70 text-sm font-medium transition-colors hover:bg-green-100/50"><CheckCircle className="w-8 h-8 mb-2 opacity-50" />Drop here to complete & log repair</div>
            </div>
          </div>
        ) : mechanicView === 'log' ? (
          <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-800">Historical Repair Log</h3>
              <span className="text-xs font-medium bg-white border border-gray-200 px-2 py-1 rounded text-gray-500">Total YTD Cost: ${appData.repairLog.reduce((s, r) => s + (Number(r.cost) || 0), 0).toFixed(2)}</span>
            </div>
            <table className="w-full text-left border-collapse">
              <thead><tr className="bg-white border-b border-gray-200 text-xs text-gray-500 uppercase"><th className="p-4">Date</th><th className="p-4">Equipment</th><th className="p-4">Details</th><th className="p-4 text-right">Cost</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {appData.repairLog.length === 0 ? <tr><td colSpan="4" className="p-8 text-center text-gray-400 italic border-none">No repairs logged yet.</td></tr> : appData.repairLog.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-4 font-medium text-sm text-gray-700">{log.date}</td>
                    <td className="p-4 font-bold text-gray-900 text-sm">{log.equipmentName}</td>
                    <td className="p-4 text-sm text-gray-600">{log.fixNotes}</td>
                    <td className="p-4 text-right font-mono font-bold text-rose-600">${Number(log.cost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead><tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase"><th className="p-4">Vehicle</th><th className="p-4">Odometer/Hours</th><th className="p-4">Maintenance</th><th className="p-4">Registration</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {appData.fleet.map(f => {
                    const isOdoOutdated = f.type !== 'trailer' && isOdoStale(f.lastOdometerUpdate);
                    const needsOil = f.nextOilChange && f.odometer >= f.nextOilChange;
                    const needsInsp = f.nextInspection && f.odometer >= f.nextInspection;
                    return (
                      <tr key={f.id} className="hover:bg-gray-50">
                        <td className="p-4"><div className="font-bold text-gray-800 flex items-center gap-2">{f.name}{f.status !== 'Active' && <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded">{f.status}</span>}{f.isRental && <span className="bg-purple-100 text-purple-800 text-[10px] px-1.5 py-0.5 rounded">Rental</span>}</div><div className="text-xs text-gray-500 mt-1">{f.type.toUpperCase()} • {f.weightClass}</div></td>
                        <td className="p-4 align-top">
                          {f.type === 'trailer' ? <span className="text-gray-400 text-sm italic">N/A</span> : (
                            <div className="flex flex-col gap-1">
                              {editingOdoId === f.id ? (
                                <div className="flex items-center gap-2"><input type="number" autoFocus className="w-24 border border-green-400 rounded px-2 py-1 text-sm outline-none" value={tempOdo} onChange={e => setTempOdo(e.target.value)} /><button onClick={() => { syncToCloud({ ...appData, fleet: appData.fleet.map(v => v.id === f.id ? { ...v, odometer: Number(tempOdo), lastOdometerUpdate: formatDate(new Date()) } : v) }); setEditingOdoId(null); showToastMsg("Updated"); }} className="bg-green-600 text-white p-1 rounded hover:bg-green-700"><Save className="w-4 h-4" /></button><button onClick={() => setEditingOdoId(null)} className="text-gray-400"><X className="w-4 h-4" /></button></div>
                              ) : (
                                <div className="flex items-center gap-2 cursor-pointer group" onClick={() => { setEditingOdoId(f.id); setTempOdo(f.odometer || ''); }}><span className="font-semibold text-gray-800 text-sm">{f.odometer ? f.odometer.toLocaleString() : '0'} {f.type === 'equipment' ? 'hrs' : 'km'}</span><PenTool className="w-3 h-3 text-gray-300 group-hover:text-green-500" /></div>
                              )}
                              <div className={`text-[10px] font-medium flex items-center gap-1 ${isOdoOutdated ? 'text-red-600' : 'text-gray-400'}`}><Clock className="w-3 h-3" /> Last: {f.lastOdometerUpdate || 'Never'} {isOdoOutdated && "(Stale)"}</div>
                            </div>
                          )}
                        </td>
                        <td className="p-4 align-top">
                          {f.type !== 'trailer' && (
                            <div className="space-y-1.5 text-xs">
                              <div className="flex justify-between items-center bg-gray-50 px-2 py-1 rounded"><span className="text-gray-500">Oil:</span><span className={`font-semibold ${needsOil ? 'text-red-600' : 'text-gray-800'}`}>{f.nextOilChange ? f.nextOilChange.toLocaleString() : 'Not Set'}{needsOil && <AlertTriangle className="w-3 h-3 inline ml-1" />}</span></div>
                              <div className="flex justify-between items-center bg-gray-50 px-2 py-1 rounded"><span className="text-gray-500">Insp:</span><span className={`font-semibold ${needsInsp ? 'text-red-600' : 'text-gray-800'}`}>{f.nextInspection ? f.nextInspection.toLocaleString() : 'Not Set'}{needsInsp && <AlertTriangle className="w-3 h-3 inline ml-1" />}</span></div>
                            </div>
                          )}
                        </td>
                        <td className="p-4 align-top">
                          <div className="space-y-1.5 text-xs">
                            {f.type !== 'equipment' && <><div className={`flex justify-between items-center px-2 py-1 rounded ${isExpiringSoon(f.regExpiry) || isExpired(f.regExpiry) ? 'bg-red-50 text-red-700 font-bold' : 'bg-gray-50 text-gray-600'}`}><span>Reg:</span><span>{f.regExpiry || 'Not set'}</span></div>{['Up to 10999kg (Yellow)', '10999kg+ (Class A)'].includes(f.weightClass) || f.type === 'trailer' ? <div className={`flex justify-between items-center px-2 py-1 rounded ${isExpiringSoon(f.safetyExpiry) || isExpired(f.safetyExpiry) ? 'bg-red-50 text-red-700 font-bold' : 'bg-gray-50 text-gray-600'}`}><span>Safety:</span><span>{f.safetyExpiry || 'Not set'}</span></div> : null}</>}
                            {f.isRental && <div className="flex justify-between items-center bg-purple-50 text-purple-800 px-2 py-1 rounded font-bold"><span>Return:</span><span>{f.rentalEnd || 'Not set'}</span></div>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPerformanceBoard = () => {
    const calcReports = () => {
      let totals = { bh: 0, ah: 0, jobs: 0 };
      let divStats = {}; DIVISIONS.forEach(d => divStats[d] = { bh: 0, ah: 0, jobs: 0 });
      let crewStats = {}; let empStats = {};

      Object.entries(appData.performance || {}).forEach(([date, dayLogs]) => {
        if (date >= reportStartDate && date <= reportEndDate) {
          Object.entries(dayLogs).forEach(([crewId, log]) => {
            const div = log.division || 'Large Projects';
            const cName = `${div} ${log.crewNumber || 1}`;

            let cBH = log.jobs.reduce((s, j) => s + Number(j.bh || 0), 0);
            let rawAH = Object.values(log.employeeAH).reduce((s, v) => s + Number(v || 0), 0);
            let deducAH = Object.values(log.deductions || {}).reduce((s, v) => s + Number(v || 0), 0);
            let cAH = Math.max(0, rawAH - deducAH); // Net AH
            let jCount = log.jobs.length;

            totals.bh += cBH; totals.ah += cAH; totals.jobs += jCount;
            if (divStats[div]) { divStats[div].bh += cBH; divStats[div].ah += cAH; divStats[div].jobs += jCount; }

            if (!crewStats[cName]) crewStats[cName] = { div, bh: 0, ah: 0, jobs: 0 };
            crewStats[cName].bh += cBH; crewStats[cName].ah += cAH; crewStats[cName].jobs += jCount;

            Object.entries(log.employeeAH).forEach(([empId, ah]) => {
              const baseAH = Number(ah || 0);
              const indvDeduc = Number(log.deductions?.[empId] || 0);
              const eAH = Math.max(0, baseAH - indvDeduc);

              if (eAH > 0) {
                const eBH = cAH > 0 ? cBH * (eAH / cAH) : 0;
                if (!empStats[empId]) empStats[empId] = { name: getEmpName(empId), bh: 0, ah: 0 };
                empStats[empId].ah += eAH; empStats[empId].bh += eBH;
              }
            });
          });
        }
      });
      return { totals, divStats, crewStats, empStats };
    };

    const r = calcReports();
    const overallEff = r.totals.ah > 0 ? ((r.totals.bh / r.totals.ah) * 100).toFixed(1) : 0;

    const getCompletedRouteIdsForWeek = () => {
      const perfWeekStart = getStartOfWeek(perfDate);
      const completedIds = new Set();
      for (let i = 0; i < 7; i++) {
        const d = formatDate(addDays(perfWeekStart, i));
        const dayLogs = appData.performance[d] || {};
        Object.values(dayLogs).forEach(log => { log.jobs.forEach(job => { if (job.routeId) completedIds.add(job.routeId); }); });
        if (d === perfDate && Object.keys(dailyLogs).length > 0) {
          Object.values(dailyLogs).forEach(log => { log.jobs.forEach(job => { if (job.routeId) completedIds.add(job.routeId); }); });
        }
      }
      return completedIds;
    };

    const addSelectedRoutes = () => {
      if (!routeModalCrewId) return;
      const newLogs = { ...dailyLogs };
      selectedRouteIds.forEach(rId => {
        const route = appData.routes.find(r => r.id === rId);
        if (route) newLogs[routeModalCrewId].jobs.push({ desc: route.name, bh: route.bh, routeId: route.id });
      });
      setDailyLogs(newLogs);
      setRouteModalCrewId(null); setSelectedRouteIds(new Set());
    };

    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-100 p-6 print:bg-white overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2"><TrendingUp className="w-6 h-6 text-emerald-600" /> PerformanceMaster</h2>
          <div className="flex bg-white rounded-lg p-1 border border-gray-200 shadow-sm">
            <button onClick={() => setPerfTab('entry')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-md ${perfTab === 'entry' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}><CalendarDays className="w-4 h-4" /> Daily Entry</button>
            <button onClick={() => setPerfTab('reports')} className={`flex items-center gap-2 px-4 py-1.5 text-sm font-bold rounded-md ${perfTab === 'reports' ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:text-gray-700'}`}><BarChart className="w-4 h-4" /> Advanced Reports</button>
          </div>
        </div>

        {perfTab === 'entry' ? (
          <div className="max-w-4xl mx-auto w-full pb-20 relative">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 flex justify-between items-center sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <span className="font-bold text-gray-700">Select Date to Log:</span>
                <input type="date" value={perfDate} onChange={e => setPerfDate(e.target.value)} className="border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-emerald-400 outline-none font-medium" />
              </div>
              <button onClick={() => { syncToCloud({ ...appData, performance: { ...appData.performance, [perfDate]: dailyLogs } }); showToastMsg("Saved!"); }} className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2 rounded-lg font-bold shadow flex items-center gap-2">
                <Save className="w-4 h-4" /> Save Daily Data
              </button>
            </div>

            {Object.keys(dailyLogs).length === 0 ? (
              <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-10 flex flex-col items-center justify-center text-gray-500">
                <CalendarIcon className="w-10 h-10 mb-3 opacity-20" />
                <p>No crews scheduled or logged for this date.</p>
                <button onClick={() => setDailyLogs(p => ({ ...p, [`adhoc-${Date.now()}`]: { division: 'Large Projects', crewNumber: 1, jobs: [], employeeAH: {}, deductions: {}, isAdHoc: true } }))} className="mt-4 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium shadow-sm hover:bg-gray-50">+ Add Unscheduled Crew</button>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(dailyLogs).map(([cId, log]) => {
                  const sumBH = log.jobs.reduce((s, j) => s + Number(j.bh || 0), 0);
                  const rawAH = Object.values(log.employeeAH).reduce((s, v) => s + Number(v || 0), 0);
                  const deducAH = Object.values(log.deductions || {}).reduce((s, v) => s + Number(v || 0), 0);
                  const sumAH = Math.max(0, rawAH - deducAH);
                  const eff = sumAH > 0 ? ((sumBH / sumAH) * 100).toFixed(1) : 0;

                  let effColor = 'text-gray-500 bg-gray-100 border-gray-200';
                  if (sumAH > 0) {
                    if (eff >= 90) effColor = 'text-purple-700 bg-purple-100 border-purple-300 shadow-purple-100';
                    else if (eff >= 80) effColor = 'text-emerald-700 bg-emerald-100 border-emerald-300 shadow-emerald-100';
                    else if (eff >= 70) effColor = 'text-yellow-700 bg-yellow-100 border-yellow-300 shadow-yellow-100';
                    else effColor = 'text-red-700 bg-red-100 border-red-300 shadow-red-100';
                  }

                  return (
                    <div key={cId} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden relative">
                      {log.isAdHoc && <div className="absolute top-0 left-0 w-1 h-full bg-orange-400"></div>}
                      <div className="bg-gray-50 border-b border-gray-200 p-3 flex justify-between items-center pl-4">
                        <div className="flex-1 flex gap-2 items-center">
                          {log.isAdHoc ? <span className="text-[10px] bg-orange-100 text-orange-800 uppercase px-1.5 py-0.5 rounded font-bold">Ad-Hoc</span> : null}
                          <select value={log.division} onChange={e => setDailyLogs(p => ({ ...p, [cId]: { ...p[cId], division: e.target.value } }))} className="font-bold text-gray-800 bg-white border border-gray-300 rounded px-2 py-1 outline-none disabled:bg-transparent disabled:border-transparent" disabled={!log.isAdHoc}>
                            {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <select value={log.crewNumber} onChange={e => setDailyLogs(p => ({ ...p, [cId]: { ...p[cId], crewNumber: Number(e.target.value) } }))} className="font-bold text-gray-800 bg-white border border-gray-300 rounded px-2 py-1 outline-none disabled:bg-transparent disabled:border-transparent" disabled={!log.isAdHoc}>
                            {CREW_NUMBERS.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleGeneratePerformanceInsight(log, cId)} disabled={sumAH === 0} className="text-teal-600 bg-teal-50 border border-teal-200 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-teal-100 transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Sparkles className="w-3.5 h-3.5" /> AI Insight
                          </button>
                          <div className={`px-4 py-2 rounded-lg border shadow-sm font-bold flex flex-col items-center ${effColor}`}>
                            <span className="text-xs uppercase tracking-wide opacity-80 mb-0.5">Efficiency</span>
                            <span className="text-2xl leading-none">{sumAH > 0 ? `${eff}%` : '--'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <h4 className="font-semibold text-gray-700 mb-3 flex justify-between border-b pb-2"><span className="flex items-center gap-1.5"><Target className="w-4 h-4 text-emerald-600" /> Completed Jobs (BH)</span><span className="text-sm bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-bold">Total: {sumBH.toFixed(1)} BH</span></h4>
                          <div className="space-y-2">
                            {log.jobs.map((job, jIdx) => (
                              <div key={jIdx} className="flex items-center gap-2 bg-gray-50 p-1.5 rounded border border-gray-200">
                                <FileSignature className="w-4 h-4 text-gray-400 ml-1 flex-shrink-0" />
                                <input type="text" placeholder="Job Desc" value={job.desc} onChange={e => setDailyLogs(p => { const n = { ...p }; n[cId].jobs[jIdx].desc = e.target.value; return n; })} className="flex-1 min-w-0 border border-gray-300 rounded p-1.5 text-sm outline-none bg-white font-medium" />
                                <input type="number" placeholder="BH" value={job.bh} onChange={e => setDailyLogs(p => { const n = { ...p }; n[cId].jobs[jIdx].bh = e.target.value; return n; })} className="w-16 border border-gray-300 rounded p-1.5 text-sm outline-none bg-white font-mono font-bold text-emerald-700" />
                                <button onClick={() => setDailyLogs(p => { const n = { ...p }; n[cId].jobs.splice(jIdx, 1); return n; })} className="text-red-400 hover:text-red-600 p-1"><X className="w-4 h-4" /></button>
                              </div>
                            ))}
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => { setRouteFilters({ division: log.division, targetDay: 'Monday', frequency: 'Weekly' }); setRouteModalCrewId(cId); }} className="flex-1 text-xs font-bold text-green-600 border border-dashed border-green-300 bg-green-50/50 rounded p-2 hover:bg-green-100 flex items-center justify-center gap-1"><Map className="w-3.5 h-3.5" /> + Route Database</button>
                              <button onClick={() => setDailyLogs(p => { const n = { ...p }; n[cId].jobs.push({ desc: '', bh: '' }); return n; })} className="w-10 flex items-center justify-center text-xs font-bold text-emerald-600 border border-dashed border-emerald-300 rounded p-2 hover:bg-emerald-50"><Plus className="w-4 h-4" /></button>
                            </div>
                          </div>
                        </div>

                        <div>
                          <h4 className="font-semibold text-gray-700 mb-3 flex justify-between border-b pb-2"><span className="flex items-center gap-1.5"><Clock className="w-4 h-4 text-green-600" /> Clocked Hours (AH)</span><span className="text-sm bg-green-50 text-green-800 px-2 py-0.5 rounded font-bold">Total: {sumAH.toFixed(1)} AH</span></h4>
                          <div className="space-y-2">
                            {Object.entries(log.employeeAH).map(([empId, hrs]) => (
                              <div key={empId} className="flex flex-col bg-gray-50 border border-gray-200 rounded p-1.5 pl-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium text-gray-700 truncate mr-2">{getEmpName(empId)}</span>
                                  <div className="flex items-center gap-2">
                                    <input type="number" placeholder="Hrs" value={hrs} onChange={e => setDailyLogs(p => { const n = { ...p }; n[cId].employeeAH[empId] = e.target.value; return n; })} className="w-16 border border-gray-300 rounded p-1.5 text-sm text-center bg-white outline-none font-mono font-bold text-green-700" />
                                    {log.isAdHoc ?
                                      <button onClick={() => setDailyLogs(p => { const n = { ...p }; delete n[cId].employeeAH[empId]; delete n[cId].deductions[empId]; return n; })} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button> :
                                      <div className="w-4" />
                                    }
                                  </div>
                                </div>
                                {/* DEDUCTIONS ROW */}
                                <div className="flex items-center justify-end gap-2 mt-1 border-t border-gray-200 pt-1 border-dashed">
                                  <span className="text-[10px] uppercase font-bold text-gray-400">Deductions:</span>
                                  <div className="flex items-center">
                                    <span className="text-xs font-bold text-rose-500 mr-1">-</span>
                                    <input type="number" placeholder="0" value={log.deductions?.[empId] || ''} onChange={e => setDailyLogs(p => { const n = { ...p }; if (!n[cId].deductions) n[cId].deductions = {}; n[cId].deductions[empId] = e.target.value; return n; })} className="w-12 border border-rose-200 rounded p-1 text-xs text-center bg-rose-50 outline-none text-rose-700 font-mono" title="Subtract hours for breakdowns, meetings, etc." />
                                  </div>
                                </div>
                              </div>
                            ))}
                            <select onChange={e => { const v = e.target.value; setDailyLogs(p => { const n = { ...p }; n[cId].employeeAH[v] = ''; return n; }); e.target.value = ""; }} defaultValue="" className="w-full text-xs font-bold text-green-600 border border-dashed border-green-300 rounded p-2 hover:bg-green-50 outline-none cursor-pointer text-center appearance-none">
                              <option value="" disabled>+ Add Unscheduled Employee</option>
                              {appData.employees.filter(e => !log.employeeAH.hasOwnProperty(e.id)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* --- SMART ROUTE SELECTION MODAL --- */}
            {routeModalCrewId && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-green-50">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-green-900"><Map className="w-5 h-5" /> Select Completed Routes</h2>
                    <button onClick={() => { setRouteModalCrewId(null); setSelectedRouteIds(new Set()); }} className="text-gray-500 hover:text-gray-800"><X className="w-6 h-6" /></button>
                  </div>

                  {/* DYNAMIC FILTERS */}
                  <div className="flex flex-wrap gap-2 p-3 bg-white border-b border-gray-200">
                    <select className="border border-gray-300 rounded p-1.5 text-sm font-bold text-gray-700 outline-none bg-gray-50 flex-1 min-w-[140px]" value={routeFilters.division} onChange={e => setRouteFilters({ ...routeFilters, division: e.target.value })}>
                      <option value="All">All Divisions</option>
                      {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select className="border border-gray-300 rounded p-1.5 text-sm font-bold text-gray-700 outline-none bg-gray-50 flex-1 min-w-[140px]" value={routeFilters.targetDay} onChange={e => setRouteFilters({ ...routeFilters, targetDay: e.target.value })}>
                      <option value="All">All Days</option>
                      {DAYS_OF_WEEK.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <div className="flex bg-gray-100 rounded border border-gray-300 overflow-hidden">
                      {ROUTE_FREQUENCIES.map(tab => (
                        <button key={tab} onClick={() => setRouteFilters({ ...routeFilters, frequency: tab })} className={`px-3 py-1.5 text-xs font-bold ${routeFilters.frequency === tab ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>{tab}</button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                    <div className="space-y-4">
                      {(() => {
                        const completedIds = getCompletedRouteIdsForWeek();
                        const availableRoutes = appData.routes.filter(r =>
                          (routeFilters.division === 'All' || r.division === routeFilters.division) &&
                          (routeFilters.targetDay === 'All' || r.targetDay === routeFilters.targetDay) &&
                          r.frequency === routeFilters.frequency &&
                          !completedIds.has(r.id)
                        );

                        if (availableRoutes.length === 0) {
                          return <div className="text-center p-8 text-gray-400 border-2 border-dashed border-gray-300 rounded-xl">No remaining routes match your filters.</div>;
                        }

                        return (
                          <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                            <div className="bg-gray-100 px-3 py-2 border-b border-gray-200 font-bold text-gray-700 text-sm flex justify-between items-center">
                              Available Routes
                              <button onClick={() => {
                                const newSelection = new Set(selectedRouteIds);
                                const allSelected = availableRoutes.every(r => newSelection.has(r.id));
                                availableRoutes.forEach(r => allSelected ? newSelection.delete(r.id) : newSelection.add(r.id));
                                setSelectedRouteIds(newSelection);
                              }} className="text-xs text-green-600 hover:underline flex items-center gap-1 font-semibold">
                                <CheckSquare className="w-3.5 h-3.5" /> Select All
                              </button>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {availableRoutes.map(route => (
                                <label key={route.id} className="flex items-center gap-3 p-3 hover:bg-green-50 cursor-pointer transition-colors">
                                  <input type="checkbox" checked={selectedRouteIds.has(route.id)} onChange={(e) => {
                                    const newSelection = new Set(selectedRouteIds);
                                    if (e.target.checked) newSelection.add(route.id); else newSelection.delete(route.id);
                                    setSelectedRouteIds(newSelection);
                                  }} className="w-4 h-4 text-green-600 rounded border-gray-300 focus:ring-green-500" />
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-gray-800 text-sm truncate">{route.name}</div>
                                    <div className="text-xs text-gray-500 font-medium">{route.division} • Crew {route.crewNumber} • {route.targetDay}</div>
                                  </div>
                                  <div className="font-mono text-sm font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 flex-shrink-0">
                                    {route.bh} BH
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="p-4 border-t border-gray-200 bg-white flex justify-end gap-3">
                    <button onClick={() => { setRouteModalCrewId(null); setSelectedRouteIds(new Set()); }} className="px-4 py-2 font-medium text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                    <button onClick={addSelectedRoutes} disabled={selectedRouteIds.size === 0} className="px-6 py-2 font-bold text-white bg-green-600 hover:bg-green-700 rounded shadow disabled:opacity-50 disabled:cursor-not-allowed">
                      Add {selectedRouteIds.size} Routes
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-6xl mx-auto w-full space-y-6 pb-20">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-4 items-center">
              <span className="font-bold text-gray-700"><Filter className="w-4 h-4 inline mr-2" /> Time Range:</span>
              <input type="date" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} className="border border-gray-300 rounded p-1.5 text-sm" />
              <span className="text-gray-400">to</span>
              <input type="date" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} className="border border-gray-300 rounded p-1.5 text-sm" />

              <div className="flex gap-2 ml-auto">
                <button onClick={() => { const today = new Date(); setReportStartDate(formatDate(today)); setReportEndDate(formatDate(today)); }} className="text-xs font-bold bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">Today</button>
                <button onClick={() => { setReportStartDate(formatDate(startOfWeek)); setReportEndDate(formatDate(addDays(startOfWeek, 6))); }} className="text-xs font-bold bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">This Week</button>
                <button onClick={() => { const d = new Date(); setReportStartDate(formatDate(new Date(d.getFullYear(), d.getMonth(), 1))); setReportEndDate(formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0))); }} className="text-xs font-bold bg-gray-100 px-3 py-1.5 rounded hover:bg-gray-200">This Month</button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center"><div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">Total Budgeted Hrs</div><div className="text-3xl font-black text-emerald-600">{r.totals.bh.toFixed(1)}</div></div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center"><div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">Total Actual Hrs</div><div className="text-3xl font-black text-green-600">{r.totals.ah.toFixed(1)}</div></div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-col items-center"><div className="text-gray-500 font-bold uppercase tracking-wider text-[10px] mb-1">Total Jobs Done</div><div className="text-3xl font-black text-teal-600">{r.totals.jobs}</div></div>
              <div className="bg-gray-800 rounded-xl shadow-sm p-4 flex flex-col items-center relative overflow-hidden">
                <Target className="absolute -right-4 -bottom-4 w-20 h-20 text-gray-700 opacity-50" /><div className="text-gray-300 font-bold uppercase text-[10px] mb-1 z-10">Overall Efficiency</div>
                <div className={`text-4xl font-black z-10 ${overallEff >= 90 ? 'text-purple-400' : (overallEff >= 80 ? 'text-emerald-400' : (overallEff >= 70 ? 'text-yellow-400' : 'text-red-400'))}`}>{overallEff}%</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* DIVISION TABLE */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 border-b border-gray-200 p-3"><h3 className="font-bold text-gray-800 flex items-center gap-2"><Award className="w-4 h-4 text-gray-500" /> Divisions</h3></div>
                <table className="w-full text-left">
                  <thead><tr className="border-b border-gray-200 text-[10px] text-gray-500 uppercase"><th className="p-3">Name</th><th className="p-3 text-center">Jobs</th><th className="p-3 text-right">BH</th><th className="p-3 text-right">AH</th><th className="p-3 text-right">Eff %</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {DIVISIONS.map(d => {
                      const s = r.divStats[d]; const score = s.ah > 0 ? ((s.bh / s.ah) * 100).toFixed(1) : 0;
                      return <tr key={d}><td className="p-3 font-bold text-gray-800 text-sm">{d}</td><td className="p-3 text-center font-bold text-teal-600 text-sm">{s.jobs}</td><td className="p-3 text-right text-emerald-600 font-medium text-sm">{s.bh.toFixed(1)}</td><td className="p-3 text-right text-green-600 font-medium text-sm">{s.ah.toFixed(1)}</td><td className="p-3 text-right font-bold text-sm">{s.ah > 0 ? `${score}%` : '--'}</td></tr>
                    })}
                  </tbody>
                </table>
              </div>

              {/* CREWS TABLE */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 border-b border-gray-200 p-3"><h3 className="font-bold text-gray-800 flex items-center gap-2"><Truck className="w-4 h-4 text-gray-500" /> Crews</h3></div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-200 text-[10px] text-gray-500 uppercase"><th className="p-3">Crew</th><th className="p-3 text-center">Jobs</th><th className="p-3 text-right">BH</th><th className="p-3 text-right">AH</th><th className="p-3 text-right">Eff %</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {Object.entries(r.crewStats).sort((a, b) => b[1].bh - a[1].bh).map(([name, s]) => {
                        const score = s.ah > 0 ? ((s.bh / s.ah) * 100).toFixed(1) : 0;
                        return <tr key={name}><td className="p-3 font-bold text-gray-800 text-sm">{name} <div className="text-[10px] text-gray-400 font-normal">{s.div}</div></td><td className="p-3 text-center font-bold text-teal-600 text-sm">{s.jobs}</td><td className="p-3 text-right text-emerald-600 font-medium text-sm">{s.bh.toFixed(1)}</td><td className="p-3 text-right text-green-600 font-medium text-sm">{s.ah.toFixed(1)}</td><td className="p-3 text-right font-bold text-sm">{s.ah > 0 ? `${score}%` : '--'}</td></tr>
                      })}
                      {Object.keys(r.crewStats).length === 0 ? <tr><td colSpan="5" className="p-4 text-center text-gray-400 text-sm">No crew data in this range.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* EMPLOYEE TABLE */}
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden lg:col-span-2">
                <div className="bg-gray-50 border-b border-gray-200 p-3"><h3 className="font-bold text-gray-800 flex items-center gap-2"><Users className="w-4 h-4 text-gray-500" /> Employee Breakdown (Proportional Split)</h3></div>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-white"><tr className="border-b border-gray-200 text-xs text-gray-500 uppercase"><th className="p-3">Employee</th><th className="p-3 text-right">Earned BH</th><th className="p-3 text-right">Net Clocked AH</th><th className="p-3 text-right">Indiv Eff %</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {Object.entries(r.empStats).sort((a, b) => b[1].bh - a[1].bh).map(([eId, s]) => {
                        const score = s.ah > 0 ? ((s.bh / s.ah) * 100).toFixed(1) : 0;
                        let color = 'text-gray-500';
                        if (s.ah > 0) { if (score >= 90) color = 'text-purple-600'; else if (score >= 80) color = 'text-emerald-600'; else if (score >= 70) color = 'text-yellow-600'; else color = 'text-red-600'; }
                        return <tr key={eId} className="hover:bg-gray-50"><td className="p-3 font-bold text-gray-800 text-sm">{s.name}</td><td className="p-3 text-right text-emerald-600 font-medium text-sm">{s.bh.toFixed(1)}</td><td className="p-3 text-right text-green-600 font-medium text-sm">{s.ah.toFixed(1)}</td><td className={`p-3 text-right font-black text-sm ${color}`}>{s.ah > 0 ? `${score}%` : '--'}</td></tr>
                      })}
                      {Object.keys(r.empStats).length === 0 ? <tr><td colSpan="4" className="p-4 text-center text-gray-400 text-sm">No employee data in this range.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    );
  };

  const renderBulletinBoard = () => {
    const handlePost = () => {
      if (!newTitle || !newContent) return;
      const newBulletin = { id: `b-${Date.now()}`, title: newTitle, content: newContent, date: formatDate(new Date()), isAdminOnly, author: displayEmail };
      syncToCloud({ ...appData, bulletins: [newBulletin, ...appData.bulletins] });
      setNewTitle(''); setNewContent(''); setIsAdminOnly(false);
    };

    const visibleBulletins = appData.bulletins.filter(b => isAdmin ? true : !b.isAdminOnly);

    return (
      <div className="flex-1 flex flex-col h-full overflow-y-auto bg-slate-100 p-6 print:bg-white">
        <div className="max-w-4xl mx-auto w-full space-y-6">
          <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <div>
              <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3"><Megaphone className="w-8 h-8 text-lime-500" /> Company Bulletin Board</h2>
              <p className="text-slate-500 font-medium mt-1">Announcements, policy updates, and team messages.</p>
            </div>
          </div>

          {isAdmin && (
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-3">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 border-b pb-2"><PenTool className="w-4 h-4" /> Post New Bulletin</h3>
              <input type="text" placeholder="Bulletin Title" value={newTitle} onChange={e => setNewTitle(e.target.value)} className="font-bold text-lg border-none bg-slate-50 p-3 rounded-xl outline-none focus:ring-2 focus:ring-lime-400" />
              <textarea placeholder="Write your message here..." rows="3" value={newContent} onChange={e => setNewContent(e.target.value)} className="border-none bg-slate-50 p-3 rounded-xl outline-none resize-none focus:ring-2 focus:ring-lime-400 text-sm" />
              <div className="flex justify-between items-center mt-2">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={isAdminOnly} onChange={e => setIsAdminOnly(e.target.checked)} className="w-4 h-4 text-lime-500 rounded focus:ring-lime-500" />
                  <Lock className="w-4 h-4 text-slate-400" /> Admin Only (Hidden from Employees)
                </label>
                <button onClick={handlePost} disabled={!newTitle || !newContent} className="bg-lime-500 hover:bg-lime-600 text-slate-900 px-6 py-2 rounded-xl font-bold transition-colors shadow-sm disabled:opacity-50">Post Bulletin</button>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {visibleBulletins.length === 0 ? <div className="text-center p-10 text-slate-400 font-medium">No bulletins to display.</div> :
              visibleBulletins.map(b => (
                <div key={b.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
                  {b.isAdminOnly && <div className="absolute top-0 right-0 bg-rose-500 text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-bl-lg flex items-center gap-1 shadow-sm"><Lock className="w-3 h-3" /> Admin Only</div>}
                  <div className="p-5">
                    <h3 className="text-xl font-bold text-slate-800 mb-1 pr-24">{b.title}</h3>
                    <div className="text-xs text-slate-400 font-medium mb-4 flex items-center gap-2">
                      <CalendarIcon className="w-3.5 h-3.5" /> {b.date} • By {b.author}
                    </div>
                    <div className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed">{b.content}</div>
                  </div>
                  {isAdmin && (
                    <div className="bg-slate-50 border-t border-slate-100 p-2 flex justify-end">
                      <button onClick={() => syncToCloud({ ...appData, bulletins: appData.bulletins.filter(x => x.id !== b.id) })} className="text-xs font-bold text-rose-500 hover:text-rose-700 flex items-center gap-1 px-3 py-1 rounded-lg hover:bg-rose-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /> Delete Post</button>
                    </div>
                  )}
                </div>
              ))
            }
          </div>
        </div>
      </div>
    );
  };

  // --- MAIN APP (UNLOCKED PREVIEW MODE) ---
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white"><Loader2 className="w-8 h-8 animate-spin text-lime-500" /></div>;
  
  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      alert(err.message);
    }
  };

  if (!user) return (
    <LoginDemo 
      onSubmit={(email, pass) => signInWithEmailAndPassword(auth, email, pass).catch(err => alert(err.message))} 
      onGoogleSubmit={handleGoogleLogin}
    />
  );

  const isAdmin = appData.authorizedEmails.includes(displayEmail.toLowerCase()) || displayEmail.toLowerCase() === 'admin@crewmaster.com';

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden print:h-auto print:bg-white relative">
      {toast && <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-xl shadow-2xl z-50 flex items-center gap-3 animate-in fade-in"><AlertTriangle className="w-5 h-5 text-lime-400" /><span className="font-medium text-sm">{toast}</span></div>}

      {/* LEFT SIDEBAR: RESOURCES */}
      <div className="w-72 bg-gray-50 border-r border-gray-200 flex flex-col h-full shadow-lg z-10 print:hidden shrink-0">
        <div className="p-4 bg-white border-b border-gray-200 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-center py-2">
            <img src={logoBlack} alt="Logo" className="h-16 w-auto" />
          </div>
          <div className="flex flex-col bg-gray-200 rounded-lg p-1 mt-1 gap-1">
            <button onClick={() => setCurrentView('schedule')} className={`flex items-center justify-between px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'schedule' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><span className="flex items-center gap-2"><CalendarDays className="w-4 h-4" /> Schedule</span></button>
            <button onClick={() => setCurrentView('mechanic')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'mechanic' ? 'bg-white shadow-sm text-green-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><Wrench className="w-4 h-4" /> MechanicMaster</button>
            <button onClick={() => setCurrentView('performance')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'performance' ? 'bg-white shadow-sm text-emerald-700' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><TrendingUp className="w-4 h-4" /> PerformanceMaster</button>
            <button onClick={() => setCurrentView('bulletins')} className={`flex items-center gap-2 px-3 py-2 text-sm font-bold rounded-md transition-all ${currentView === 'bulletins' ? 'bg-white shadow-sm text-lime-600' : 'text-gray-600 hover:text-gray-800 hover:bg-gray-300/50'}`}><Megaphone className="w-4 h-4" /> Bulletin Board</button>
          </div>
          {isAdmin && (
            <button onClick={() => { setLocalEmployees(JSON.parse(JSON.stringify(appData.employees))); setLocalFleet(JSON.parse(JSON.stringify(appData.fleet))); setLocalRoutes(JSON.parse(JSON.stringify(appData.routes || []))); setLocalAdmins(appData.authorizedEmails || []); setLocalInventory(JSON.parse(JSON.stringify(appData.inventory || []))); setIsManageModalOpen(true); }} className="flex justify-center items-center gap-2 w-full bg-white border border-gray-300 hover:border-green-500 hover:text-green-600 text-gray-700 px-3 py-2 rounded-lg font-medium shadow-sm transition-all text-sm mt-2"><Settings className="w-4 h-4" /> Manage Resources</button>
          )}
        </div>

        {currentView === 'schedule' ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div><h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center justify-between"><span className="flex items-center gap-2"><Users className="w-4 h-4" /> Personnel</span></h2><div className="space-y-1">{appData.employees.map(emp => renderSidebarItem(emp, 'employee', scheduleMode === 'daily' ? selectedDailyDate : formatDate(currentDate)))}</div></div>
            <div><h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2"><Truck className="w-4 h-4" /> Fleet & Equip</h2><div className="space-y-1">{appData.fleet.map(f => renderSidebarItem(f, 'fleet'))}</div></div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4"></div>
        )}

        {/* BOTTOM SIDEBAR */}
        <div className="p-4 border-t border-gray-200 bg-white space-y-3">
          <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-200">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="bg-lime-100 p-1.5 rounded-full"><UserCircle className="w-5 h-5 text-lime-700"/></div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-slate-800 truncate">{displayEmail}</div>
                <div className={`text-[10px] font-black uppercase tracking-wider ${isAdmin ? 'text-lime-600' : 'text-slate-500'}`}>{isAdmin ? 'Admin' : 'Employee'}</div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => signOut(auth)} className="flex items-center justify-center gap-2 w-full text-sm text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-2 rounded font-bold transition shadow-sm">
              <LogOut size={16} /> Sign Out
            </button>
          </div>
        </div>
      </div>

      {currentView === 'mechanic' ? renderMechanicBoard() : currentView === 'performance' ? renderPerformanceBoard() : currentView === 'bulletins' ? renderBulletinBoard() : (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-100 print:bg-white print:overflow-visible relative">
          <div className="bg-white border-b border-gray-200 p-4 flex flex-wrap items-center justify-between shadow-sm print:shadow-none print:border-b-2 print:border-gray-800 print:mb-4 gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center bg-gray-100 rounded-lg p-1 print:hidden">
                <button onClick={() => setScheduleMode('weekly')} className={`px-3 py-1.5 text-sm font-bold rounded ${scheduleMode === 'weekly' ? 'bg-white shadow-sm text-green-700' : 'text-gray-500 hover:text-gray-700'}`}><CalendarDays className="w-4 h-4 inline mr-1" /> 7-Day</button>
                <button onClick={() => setScheduleMode('daily')} className={`px-3 py-1.5 text-sm font-bold rounded ${scheduleMode === 'daily' ? 'bg-white shadow-sm text-green-700' : 'text-gray-500 hover:text-gray-700'}`}><CalendarIcon className="w-4 h-4 inline mr-1" /> Daily</button>
              </div>

              <div className="flex items-center bg-gray-100 rounded-lg p-1 print:hidden">
                <button onClick={() => scheduleMode === 'weekly' ? handlePrevWeek() : setSelectedDailyDate(formatDate(addDays(selectedDailyDate, -1)))} className="p-1.5 hover:bg-white rounded shadow-sm text-gray-600"><ChevronLeft className="w-4 h-4" /></button>
                <button onClick={() => scheduleMode === 'weekly' ? handleToday() : setSelectedDailyDate(formatDate(new Date()))} className="px-3 py-1.5 text-xs font-bold uppercase hover:bg-white rounded shadow-sm text-gray-700 mx-1">Today</button>
                <button onClick={() => scheduleMode === 'weekly' ? handleNextWeek() : setSelectedDailyDate(formatDate(addDays(selectedDailyDate, 1)))} className="p-1.5 hover:bg-white rounded shadow-sm text-gray-600"><ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="text-gray-800 text-lg font-black tracking-wide print:text-xl mr-2">
                {scheduleMode === 'weekly' ? `Week of ${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : new Date(selectedDailyDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>

              <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-lg px-2 py-1.5 shadow-sm print:hidden">
                <Filter className="w-4 h-4 text-gray-500" />
                <select className="text-sm font-bold text-gray-700 bg-transparent outline-none cursor-pointer" value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)}>
                  <option value="All">All Divisions</option>
                  {DIVISIONS.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>

              <button onClick={() => setIsWeatherModalOpen(true)} className="flex items-center gap-2 bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-lg text-sm font-bold hover:bg-green-100 transition-colors print:hidden shadow-sm"><CloudSun className="w-4 h-4" /> Weather</button>
              <button onClick={handlePrint} className="flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors print:hidden shadow-sm"><Printer className="w-4 h-4" /> Print</button>
            </div>
          </div>

          <div className={`flex-1 overflow-x-auto print:overflow-visible ${scheduleMode === 'weekly' ? 'overflow-y-hidden' : 'overflow-y-auto p-6'}`}>
            {scheduleMode === 'weekly' ? (
              <div className="flex h-full min-w-max p-4 gap-4 print:p-0 print:flex-wrap print:w-full print:min-w-0 print:gap-2">
                {weekDays.map((date) => {
                  const dateString = formatDate(date);
                  let daySchedules = appData.schedules[dateString] || [];
                  if (crewFilter !== 'All') daySchedules = daySchedules.filter(c => c.division === crewFilter);
                  const isToday = formatDate(new Date()) === dateString;
                  const dayWeather = weather[dateString];

                  return (
                    <div key={dateString} className="flex flex-col w-[350px] bg-gray-50/50 rounded-2xl border border-gray-200 overflow-hidden shadow-sm h-full print:w-[32%] print:h-auto print:mb-4 print:rounded-none print:border print:shadow-none print:break-inside-avoid">
                      <div className={`p-3 border-b border-gray-200 flex justify-between items-start ${isToday ? 'bg-green-50 border-green-100' : 'bg-white'}`}>
                        <div>
                          <div className={`text-sm font-bold uppercase ${isToday ? 'text-green-600' : 'text-gray-500 print:text-gray-800'}`}>{date.toLocaleDateString('en-US', { weekday: 'long' })}</div>
                          <div className={`text-lg font-light ${isToday ? 'text-green-800' : 'text-gray-800'}`}>{date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1 print:hidden">
                            {copiedDay && copiedDay.date !== dateString && <button onClick={() => handlePasteDay(dateString)} className="p-1.5 bg-green-50 border border-green-200 rounded-lg shadow-sm text-green-700 hover:bg-green-100"><ClipboardPaste className="w-4 h-4" /></button>}
                            <button onClick={() => handleCopyDay(dateString)} className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm text-gray-600 hover:text-green-600"><Copy className="w-4 h-4" /></button>
                            {isAdmin && <button onClick={() => addCrewToDay(dateString)} className="p-1.5 bg-green-600 text-white rounded-lg shadow-sm hover:bg-green-700 transition-colors"><Plus className="w-4 h-4" /></button>}
                          </div>
                          {dayWeather && (
                            <button onClick={() => setIsWeatherModalOpen(true)} className="flex items-center gap-1 mt-1 bg-white px-1.5 py-0.5 rounded border border-gray-200 hover:bg-gray-50 print:hidden shadow-sm">
                              {getWeatherIcon(dayWeather.code)}
                              <div className="text-[10px] font-bold text-gray-600"><span className="text-red-500">{dayWeather.max}°</span> / <span className="text-green-500">{dayWeather.min}°</span></div>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex-1 p-3 overflow-y-auto print:overflow-visible print:p-2">
                        {daySchedules.length === 0 ? <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2 border-2 border-dashed border-gray-200 rounded-xl min-h-[150px] print:hidden"><Users className="w-8 h-8 opacity-20" /><span className="text-sm font-medium">No crews scheduled</span></div> : daySchedules.map(crew => renderCrewCard(dateString, crew, dayWeather))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              // --- DAILY VIEW GRID ---
              <div className="max-w-7xl mx-auto w-full">
                {(() => {
                  let daySchedules = appData.schedules[selectedDailyDate] || [];
                  if (crewFilter !== 'All') daySchedules = daySchedules.filter(c => c.division === crewFilter);
                  const dayWeather = weather[selectedDailyDate];

                  return (
                    <div className="space-y-6">
                      {/* Daily Header */}
                      <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-200 shadow-sm print:hidden">
                        <div className="flex items-center gap-6">
                          <div className="flex items-center gap-3">
                            {dayWeather ? getWeatherIcon(dayWeather.code) : <Cloud className="w-8 h-8 text-gray-300" />}
                            <div>
                              <div className="text-sm font-bold text-gray-500 uppercase tracking-widest">Weather Forecast</div>
                              <div className="font-medium text-gray-800">{dayWeather ? getWeatherDescription(dayWeather.code) : 'Data unavailable'} {dayWeather && <span className="ml-2 font-bold"><span className="text-red-500">{dayWeather.max}°</span> / <span className="text-green-500">{dayWeather.min}°</span></span>}</div>
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          {copiedDay && copiedDay.date !== selectedDailyDate && <button onClick={() => handlePasteDay(selectedDailyDate)} className="px-4 py-2 font-bold bg-green-50 border border-green-200 rounded-lg shadow-sm text-green-700 hover:bg-green-100 flex items-center gap-2"><ClipboardPaste className="w-4 h-4" /> Paste Copied Day</button>}
                          <button onClick={() => handleCopyDay(selectedDailyDate)} className="px-4 py-2 font-bold bg-white border border-gray-200 rounded-lg shadow-sm text-gray-600 hover:text-green-600 flex items-center gap-2"><Copy className="w-4 h-4" /> Copy Day</button>
                          {isAdmin && <button onClick={() => addCrewToDay(selectedDailyDate)} className="px-4 py-2 font-bold bg-green-600 text-white rounded-lg shadow hover:bg-green-700 transition-colors flex items-center gap-2"><Plus className="w-4 h-4" /> Add Crew</button>}
                        </div>
                      </div>

                      {/* Grid of Crew Cards */}
                      {daySchedules.length === 0 ? (
                        <div className="bg-white border-2 border-dashed border-gray-300 rounded-2xl p-20 flex flex-col items-center justify-center text-gray-400">
                          <CalendarIcon className="w-16 h-16 mb-4 opacity-20" />
                          <p className="text-xl font-medium text-gray-500">No crews scheduled for this day.</p>
                          {isAdmin && <button onClick={() => addCrewToDay(selectedDailyDate)} className="mt-6 px-6 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg font-bold hover:bg-green-100">Click here to add one</button>}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-start">
                          {daySchedules.map(crew => renderCrewCard(selectedDailyDate, crew, dayWeather))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MANAGE RESOURCES MODAL */}
      {isManageModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 shrink-0"><h2 className="text-xl font-black flex items-center gap-2 text-slate-800"><Settings className="w-5 h-5 text-lime-500" /> Manage Resources</h2><button onClick={() => setIsManageModalOpen(false)} className="text-gray-500 hover:text-gray-800"><X className="w-6 h-6" /></button></div>
            <div className="flex border-b border-gray-200 overflow-x-auto bg-white shrink-0">
              <button onClick={() => setManageTab('employees')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'employees' ? 'text-green-600 border-green-600 bg-green-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Users className="w-4 h-4" /> Personnel</button>
              <button onClick={() => setManageTab('fleet')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'fleet' ? 'text-green-600 border-green-600 bg-green-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Truck className="w-4 h-4" /> Fleet & Equip</button>
              <button onClick={() => setManageTab('inventory')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'inventory' ? 'text-emerald-600 border-emerald-600 bg-emerald-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Package className="w-4 h-4" /> InventoryMaster</button>
              <button onClick={() => setManageTab('routes')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'routes' ? 'text-emerald-600 border-emerald-600 bg-emerald-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><Map className="w-4 h-4" /> Routes Database</button>
              <button onClick={() => setManageTab('permissions')} className={`px-6 py-3 font-bold text-sm flex items-center gap-2 border-b-2 transition-colors ${manageTab === 'permissions' ? 'text-lime-600 border-lime-600 bg-lime-50/50' : 'text-gray-500 border-transparent hover:bg-gray-50'}`}><ShieldCheck className="w-4 h-4" /> Permissions</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 relative">
              {manageTab === 'employees' && (
                <div className="space-y-3">
                  {localEmployees.map((emp, idx) => (
                    <div key={emp.id} className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                      <div className="flex flex-wrap gap-3 items-center">
                        <input className="flex-1 min-w-[150px] border border-gray-300 rounded-lg p-2 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-green-400" value={emp.name} onChange={e => { const ne = [...localEmployees]; ne[idx].name = e.target.value; setLocalEmployees(ne); }} />
                        <select className="border border-gray-300 rounded-lg p-2 text-sm font-semibold bg-gray-50" value={emp.role} onChange={e => { const ne = [...localEmployees]; ne[idx].role = e.target.value; setLocalEmployees(ne); }}><option value="Foreman">Foreman</option><option value="Operator">Operator</option><option value="Driver">Driver</option><option value="Laborer">Laborer</option></select>
                        <select className="border border-gray-300 rounded-lg p-2 text-sm font-bold bg-gray-50" value={emp.status} onChange={e => { const ne = [...localEmployees]; ne[idx].status = e.target.value; setLocalEmployees(ne); }}><option value="Active">Active</option><option value="Away">Away (Indefinite)</option></select>
                        <label className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 font-semibold"><input type="checkbox" checked={emp.hasLicense || false} onChange={e => { const ne = [...localEmployees]; ne[idx].hasLicense = e.target.checked; setLocalEmployees(ne); }} className="rounded text-green-600 focus:ring-green-500 w-4 h-4" /><IdCard className="w-4 h-4 text-green-600" /> License</label>
                        <label className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 font-semibold"><input type="checkbox" checked={emp.hasClassA || false} onChange={e => { const ne = [...localEmployees]; ne[idx].hasClassA = e.target.checked; setLocalEmployees(ne); }} className="rounded text-purple-600 focus:ring-purple-500 w-4 h-4" /><ClassAIcon className="w-4 h-4 text-purple-600" /> Class A</label>
                        <label className="flex items-center gap-1.5 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 font-semibold"><input type="checkbox" checked={emp.hasHeavyMachinery || false} onChange={e => { const ne = [...localEmployees]; ne[idx].hasHeavyMachinery = e.target.checked; setLocalEmployees(ne); }} className="rounded text-orange-600 focus:ring-orange-500 w-4 h-4" /><SkidSteerIcon className="w-4 h-4 text-orange-600" /> Heavy Equip</label>
                        <button onClick={() => setLocalEmployees(localEmployees.filter(e => e.id !== emp.id))} className="text-red-400 hover:bg-red-50 p-2 rounded-lg transition-colors ml-auto"><Trash2 className="w-5 h-5" /></button>
                      </div>
                      <div className="flex flex-col gap-2 bg-orange-50/50 p-3 rounded-lg border border-orange-100">
                        <div className="flex items-center justify-between"><span className="text-xs font-bold text-orange-800 uppercase flex items-center gap-1.5"><CalendarIcon className="w-3.5 h-3.5" /> Scheduled Away Dates</span><button onClick={() => { const ne = [...localEmployees]; if (!ne[idx].awayDates) ne[idx].awayDates = []; ne[idx].awayDates.push({ start: '', end: '' }); setLocalEmployees(ne); }} className="text-xs font-bold text-green-600 hover:underline bg-green-50 px-2 py-1 rounded">+ Add Dates</button></div>
                        {(!emp.awayDates || emp.awayDates.length === 0) ? <div className="text-xs text-orange-600/60 italic font-medium pl-1">No away dates scheduled.</div> : <div className="space-y-2">{emp.awayDates.map((dateRange, dIdx) => <div key={dIdx} className="flex items-center gap-3 bg-white p-1.5 rounded-lg border border-orange-200 shadow-sm w-fit"><input type="date" className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700" value={dateRange.start || ''} onChange={e => { const ne = [...localEmployees]; ne[idx].awayDates[dIdx].start = e.target.value; setLocalEmployees(ne); }} /><span className="text-sm font-bold text-orange-400">to</span><input type="date" className="border-none bg-transparent outline-none p-1 text-sm font-bold text-gray-700" value={dateRange.end || ''} onChange={e => { const ne = [...localEmployees]; ne[idx].awayDates[dIdx].end = e.target.value; setLocalEmployees(ne); }} /><button onClick={() => { const ne = [...localEmployees]; ne[idx].awayDates.splice(dIdx, 1); setLocalEmployees(ne); }} className="text-red-400 hover:bg-red-50 p-1.5 rounded ml-2"><X className="w-3.5 h-3.5" /></button></div>)}</div>}
                      </div>
                    </div>
                  ))}
                  <button onClick={() => setLocalEmployees([...localEmployees, { id: `e-${Date.now()}`, name: 'New Employee', role: 'Laborer', status: 'Active', hasLicense: false, hasClassA: false, hasHeavyMachinery: false, awayDates: [] }])} className="w-full py-4 border-2 border-dashed border-green-300 text-green-600 rounded-xl font-bold hover:bg-green-50 transition-colors flex items-center justify-center gap-2"><Plus className="w-5 h-5" /> Add Employee</button>
                </div>
              )}

              {manageTab === 'fleet' && (
                <div className="space-y-4">
                  {/* Fleet Filters */}
                  <div className="flex bg-white rounded-lg border border-gray-300 overflow-hidden w-fit shadow-sm">
                    {['All', 'truck', 'trailer', 'equipment'].map(type => (
                      <button key={type} onClick={() => setFleetFilter(type)} className={`px-4 py-2 text-sm font-bold capitalize transition-colors ${fleetFilter === type ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{type}</button>
                    ))}
                  </div>

                  {localFleet.filter(f => fleetFilter === 'All' || f.type === fleetFilter).map((f, idx) => {
                    const realIdx = localFleet.findIndex(lf => lf.id === f.id);
                    return (
                      <div key={f.id} className="flex flex-col gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                        <div className="flex flex-wrap gap-3 items-center">
                          <input className="flex-1 min-w-[150px] border border-gray-300 rounded-lg p-2 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-green-400" value={f.name} onChange={e => { const nf = [...localFleet]; nf[realIdx].name = e.target.value; setLocalFleet(nf); }} />
                          <select className="border border-gray-300 rounded-lg p-2 text-sm font-semibold bg-gray-50 capitalize" value={f.type} onChange={e => { const nf = [...localFleet]; nf[realIdx].type = e.target.value; setLocalFleet(nf); }}><option value="truck">Truck</option><option value="trailer">Trailer</option><option value="equipment">Equipment</option></select>
                          <select className="border border-gray-300 rounded-lg p-2 text-sm font-bold bg-gray-50" value={f.status} onChange={e => { const nf = [...localFleet]; nf[realIdx].status = e.target.value; setLocalFleet(nf); }}><option value="Active">Active</option><option value="Out of Service">Out of Service</option><option value="In Repair">In Repair</option></select>
                          <button onClick={() => setLocalFleet(localFleet.filter(item => item.id !== f.id))} className="text-red-400 hover:bg-red-50 p-2 rounded-lg transition-colors ml-auto"><Trash2 className="w-5 h-5" /></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-1">
                          <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Compliance & Weights</h5>
                            <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-700 w-20">Class:</span><select className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-semibold bg-white" value={f.weightClass || 'N/A'} onChange={e => { const nf = [...localFleet]; nf[realIdx].weightClass = e.target.value; setLocalFleet(nf); }}>{WEIGHT_CLASSES.map(wc => <option key={wc} value={wc}>{wc}</option>)}</select></div>
                            <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-700 w-20">Reg Exp:</span><input type="date" className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-semibold bg-white" value={f.regExpiry || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].regExpiry = e.target.value; setLocalFleet(nf); }} /></div>
                            <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-700 w-20">Safety Exp:</span><input type="date" className="flex-1 border border-slate-300 rounded p-1.5 text-xs font-semibold bg-white" value={f.safetyExpiry || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].safetyExpiry = e.target.value; setLocalFleet(nf); }} /></div>
                          </div>
                          <div className="flex flex-col gap-2 bg-green-50/50 p-3 rounded-lg border border-green-100">
                            <h5 className="text-[10px] font-black text-green-800 uppercase tracking-widest">Maintenance Targets</h5>
                            <div className="flex items-center gap-2"><span className="text-xs font-bold text-green-900 w-24">Next Oil:</span><input type="number" className="flex-1 border border-green-200 rounded p-1.5 text-xs font-mono font-bold bg-white" value={f.nextOilChange || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].nextOilChange = Number(e.target.value); setLocalFleet(nf); }} /></div>
                            <div className="flex items-center gap-2"><span className="text-xs font-bold text-green-900 w-24">Next Insp:</span><input type="number" className="flex-1 border border-green-200 rounded p-1.5 text-xs font-mono font-bold bg-white" value={f.nextInspection || ''} onChange={e => { const nf = [...localFleet]; nf[realIdx].nextInspection = Number(e.target.value); setLocalFleet(nf); }} /></div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <button onClick={() => setLocalFleet([...localFleet, { id: `f-${Date.now()}`, name: 'New Item', type: 'equipment', status: 'Active', weightClass: 'N/A', regExpiry: '', safetyExpiry: '', odometer: '', nextOilChange: '', nextInspection: '', lastOdometerUpdate: '', isRental: false, rentalEnd: '', repairTags: [] }])} className="w-full py-4 border-2 border-dashed border-green-300 text-green-600 rounded-xl font-bold hover:bg-green-50 transition-colors flex items-center justify-center gap-2"><Plus className="w-5 h-5" /> Add Fleet/Equipment</button>
                </div>
              )}

              {manageTab === 'inventory' && (
                <div className="space-y-4">
                  <div className="bg-emerald-50 border border-emerald-200 p-5 rounded-xl flex items-start gap-4 shadow-sm">
                    <Package className="w-8 h-8 text-emerald-600 shrink-0" />
                    <div>
                      <h3 className="font-bold text-emerald-900 text-lg">InventoryMaster System</h3>
                      <p className="text-emerald-800 text-sm mt-1 leading-relaxed">Add supplies and materials here. When crews are assigned these items on the Schedule Board, stock will dynamically decrease. Perform an Audit to reset the current stock level. Items not audited in 14 days will show a warning.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {localInventory.map((inv, idx) => {
                      const isAuditDue = needsAudit(inv.lastAudit);
                      return (
                        <div key={inv.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                          {isAuditDue && <div className="bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest text-center py-1 flex items-center justify-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Audit Overdue</div>}
                          <div className="p-4 flex-1 flex flex-col gap-3">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Item Name</span>
                              <input className="w-full font-bold text-lg text-slate-800 border-b border-dashed border-slate-300 outline-none focus:border-emerald-500 py-1" value={inv.name} onChange={e => { const ni = [...localInventory]; ni[idx].name = e.target.value; setLocalInventory(ni); }} />
                            </div>
                            <div className="flex gap-3">
                              <div className="flex-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Current Stock</span>
                                <div className="flex items-center gap-2 mt-1">
                                  <input type="number" className="w-20 font-mono font-black text-xl text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-1.5 outline-none text-center" value={inv.stock} onChange={e => { const ni = [...localInventory]; ni[idx].stock = Number(e.target.value); setLocalInventory(ni); }} />
                                  <select className="border border-slate-200 rounded p-1.5 text-xs font-bold text-slate-600 bg-slate-50 outline-none" value={inv.unit} onChange={e => { const ni = [...localInventory]; ni[idx].unit = e.target.value; setLocalInventory(ni); }}>
                                    <option value="Bags">Bags</option><option value="Bottles">Bottles</option><option value="Yards">Yards</option><option value="Units">Units</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                            <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
                              <div className="text-[10px] font-bold text-slate-400">Last Audit: <span className="text-slate-600">{inv.lastAudit || 'Never'}</span></div>
                              <div className="flex gap-2">
                                <button onClick={() => { const ni = [...localInventory]; ni[idx].lastAudit = formatDate(new Date()); setLocalInventory(ni); showToastMsg(`${inv.name} audited!`); }} className="bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-700 text-xs font-bold px-3 py-1.5 rounded transition-colors flex items-center gap-1"><CheckSquare className="w-3.5 h-3.5" /> Audit Now</button>
                                <button onClick={() => setLocalInventory(localInventory.filter(i => i.id !== inv.id))} className="text-red-400 hover:text-red-600 p-1.5"><Trash2 className="w-4 h-4" /></button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <button onClick={() => setLocalInventory([...localInventory, { id: `inv-${Date.now()}`, name: 'New Material', unit: 'Units', stock: 0, lastAudit: formatDate(new Date()) }])} className="min-h-[200px] border-2 border-dashed border-emerald-300 text-emerald-600 rounded-xl font-bold hover:bg-emerald-50 transition-colors flex flex-col items-center justify-center gap-2"><Plus className="w-8 h-8" /><br />Add Inventory Item</button>
                  </div>
                </div>
              )}

              {manageTab === 'routes' && (
                <div className="space-y-3">
                  <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-4 rounded-xl flex items-start gap-3 shadow-sm">
                    <Map className="w-6 h-6 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold text-lg">Route Database Setup</p>
                      <p className="mt-1 font-medium">Define your recurring lawns and properties here. Assign them to a specific Division and Crew, and select their frequency (Weekly or staggered Bi-Weekly). Managers can instantly pull these into their daily logs from the Performance Board.</p>
                    </div>
                  </div>
                  {localRoutes.map((route, idx) => (
                    <div key={route.id} className="flex flex-col lg:flex-row gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm items-center">
                      <div className="w-full lg:w-1/3 flex flex-col gap-1.5">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Property Name</span>
                        <input className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold text-slate-800 outline-none focus:border-green-500" placeholder="e.g. 123 Main St" value={route.name} onChange={e => { const nr = [...localRoutes]; nr[idx].name = e.target.value; setLocalRoutes(nr); }} />
                      </div>
                      <div className="w-full lg:w-24 flex flex-col gap-1.5">
                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">BH (Hours)</span>
                        <input type="number" step="0.1" className="w-full border border-emerald-300 bg-emerald-50 rounded-lg p-2 text-sm font-mono font-bold text-emerald-800 outline-none" value={route.bh} onChange={e => { const nr = [...localRoutes]; nr[idx].bh = Number(e.target.value); setLocalRoutes(nr); }} />
                      </div>
                      <div className="w-full lg:flex-1 flex flex-col gap-1.5">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Assigned Crew</span>
                        <div className="flex gap-2">
                          <select className="flex-1 border border-slate-300 rounded-lg p-2 text-sm font-bold bg-slate-50 outline-none" value={route.division} onChange={e => { const nr = [...localRoutes]; nr[idx].division = e.target.value; setLocalRoutes(nr); }}>
                            {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <select className="w-20 border border-slate-300 rounded-lg p-2 text-sm font-bold bg-slate-50 outline-none" value={route.crewNumber} onChange={e => { const nr = [...localRoutes]; nr[idx].crewNumber = Number(e.target.value); setLocalRoutes(nr); }}>
                            {CREW_NUMBERS.map(n => <option key={n} value={n}>#{n}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="w-full lg:w-36 flex flex-col gap-1.5">
                        <span className="text-[10px] font-black text-green-600 uppercase tracking-widest">Frequency</span>
                        <select className="w-full border border-green-200 bg-green-50 text-green-800 rounded-lg p-2 text-sm font-bold outline-none" value={route.frequency} onChange={e => { const nr = [...localRoutes]; nr[idx].frequency = e.target.value; setLocalRoutes(nr); }}>
                          {ROUTE_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                      <div className="w-full lg:w-36 flex flex-col gap-1.5">
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Target Day</span>
                        <select className="w-full border border-slate-300 rounded-lg p-2 text-sm font-bold bg-white outline-none" value={route.targetDay} onChange={e => { const nr = [...localRoutes]; nr[idx].targetDay = e.target.value; setLocalRoutes(nr); }}>
                          {DAYS_OF_WEEK.map(day => <option key={day} value={day}>{day}</option>)}
                        </select>
                      </div>
                      <button onClick={() => setLocalRoutes(localRoutes.filter(r => r.id !== route.id))} className="text-red-400 p-2 hover:bg-red-50 rounded-lg transition-colors mt-auto lg:mb-1"><Trash2 className="w-5 h-5" /></button>
                    </div>
                  ))}
                  <button onClick={() => setLocalRoutes([...localRoutes, { id: `r-${Date.now()}`, name: '', bh: 1.0, division: 'Lawn Division', crewNumber: 1, frequency: 'Weekly', targetDay: 'Monday' }])} className="w-full py-4 border-2 border-dashed border-emerald-400 text-emerald-600 rounded-xl font-bold hover:bg-emerald-50 transition-colors flex justify-center items-center gap-2"><Plus className="w-5 h-5" /> Add New Route</button>
                </div>
              )}

              {manageTab === 'permissions' && (
                <div className="space-y-6 max-w-3xl">
                  <div className="bg-lime-50 border border-lime-200 p-5 rounded-xl flex items-start gap-4 shadow-sm">
                    <ShieldCheck className="w-8 h-8 text-lime-600 shrink-0" />
                    <div>
                      <h4 className="font-bold text-lime-900 text-lg">Access Management</h4>
                      <p className="text-lime-800 text-sm mt-1 leading-relaxed">Add email addresses here to give your managers Admin access. Admins can schedule crews, log repairs, and post to the Bulletin Board. Only the Super Admin ({displayEmail}) can delete other admins.</p>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Grant Admin Access</label>
                    <div className="flex gap-3">
                      <input type="email" placeholder="manager@company.com" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} className="flex-1 p-3 border border-slate-300 rounded-lg outline-none focus:border-lime-500 focus:ring-1 ring-lime-500 font-bold text-slate-800" />
                      <button onClick={() => { if (newAdminEmail.includes('@') && !localAdmins.includes(newAdminEmail.toLowerCase())) { setLocalAdmins([...localAdmins, newAdminEmail.toLowerCase()]); setNewAdminEmail(''); } }} className="bg-slate-800 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 hover:bg-slate-700 transition-colors shadow-sm"><UserPlus size={18} /> Add Admin</button>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-sm">
                    {localAdmins.map((email) => (
                      <div key={email} className="p-4 flex justify-between items-center hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="bg-slate-100 p-2 rounded-full text-slate-400"><UserCircle size={24} /></div>
                          <span className="text-base font-bold text-slate-800">{email}</span>
                          {email === displayEmail && <span className="text-[10px] bg-lime-100 text-lime-700 px-2.5 py-1 rounded-full font-black uppercase tracking-widest border border-lime-200">Super Admin</span>}
                        </div>
                        {email !== displayEmail && (
                          <button onClick={() => setLocalAdmins(localAdmins.filter(x => x !== email))} className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-lg transition-colors"><Trash2 size={18} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-white flex justify-end gap-4 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
              <button onClick={() => setIsManageModalOpen(false)} className="px-6 py-2.5 font-bold text-gray-500 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={() => { syncToCloud({ ...appData, employees: localEmployees, fleet: localFleet, routes: localRoutes, authorizedEmails: localAdmins, inventory: localInventory }); setIsManageModalOpen(false); showToastMsg("System Resources updated successfully!"); }} className="px-8 py-2.5 font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow transition-colors">Save All Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* REPAIR LOG MODAL */}
      {repairModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-200 bg-green-50 flex justify-between items-center">
              <h2 className="text-xl font-bold flex items-center gap-2 text-green-900"><CheckCircle className="w-6 h-6 text-green-600" /> Log Repair Completion</h2>
              <button onClick={() => setRepairModal({ isOpen: false, fleetId: null, fixNotes: '', cost: '' })} className="text-gray-500 hover:text-gray-800"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-5 bg-white">
              <div>
                <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">What was fixed?</label>
                <textarea rows="3" placeholder="Replaced spark plugs, oil change, greased tracks..." value={repairModal.fixNotes} onChange={e => setRepairModal({ ...repairModal, fixNotes: e.target.value })} className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:ring-2 focus:ring-green-500 resize-none font-medium"></textarea>
              </div>
              <div>
                <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-2">Cost of Parts / Outsourced Labor ($)</label>
                <input type="number" placeholder="0.00" value={repairModal.cost} onChange={e => setRepairModal({ ...repairModal, cost: e.target.value })} className="w-full border border-gray-300 rounded-lg p-3 font-mono font-bold text-lg outline-none focus:ring-2 focus:ring-green-500" />
              </div>
            </div>
            <div className="p-5 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setRepairModal({ isOpen: false, fleetId: null, fixNotes: '', cost: '' })} className="px-5 py-2.5 font-bold text-gray-600 hover:bg-gray-200 rounded-lg">Cancel</button>
              <button onClick={handleRepairComplete} className="px-6 py-2.5 font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow">Save to Repair Log</button>
            </div>
          </div>
        </div>
      )}

      {/* WEATHER MODAL */}
      {isWeatherModalOpen && <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"><div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col"><div className="p-4 border-b border-gray-200 flex justify-between items-center bg-green-50"><h2 className="text-xl font-bold flex items-center gap-2 text-green-900"><CloudSun className="w-6 h-6 text-green-600" /> 7-Day Weather Forecast</h2><button onClick={() => setIsWeatherModalOpen(false)}><X className="w-6 h-6" /></button></div><div className="p-6 overflow-y-auto max-h-[70vh]"><div className="space-y-3">{weekDays.map(date => { const dStr = formatDate(date); const w = weather[dStr]; if (!w) return null; return (<div key={dStr} className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-200 rounded-lg"><div className="w-24 font-bold text-gray-700">{date.toLocaleDateString('en-US', { weekday: 'long' })}</div><div className="flex items-center gap-3 w-32">{getWeatherIcon(w.code)}<div className="text-sm font-medium"><span className="text-red-600">{w.max}°</span> / <span className="text-green-600">{w.min}°</span></div></div><div className="flex-1 text-sm text-gray-600 font-medium">{getWeatherDescription(w.code)}</div></div>); })}</div></div></div></div>}

      {/* GENERAL AI MODAL */}
      {aiModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95">
            <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gradient-to-r from-teal-50 to-purple-50">
              <h2 className="text-lg font-bold flex items-center gap-2 text-teal-900">
                <Sparkles className="w-5 h-5 text-teal-600" /> {aiModal.title}
              </h2>
              <button onClick={() => setAiModal({ ...aiModal, isOpen: false })} className="text-gray-500 hover:text-gray-800">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh] text-gray-800 text-sm leading-relaxed">
              {aiModal.isLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-teal-500 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin" />
                  <p className="font-bold tracking-wide animate-pulse">Gemini AI is analyzing...</p>
                </div>
              ) : (
                <div className="whitespace-pre-wrap">
                  {aiModal.content.split('\n').map((line, i) => {
                    if (line.startsWith('* ') || line.startsWith('- ')) return <li key={i} className="ml-4 mb-2 font-medium text-slate-700">{line.substring(2).replace(/\*\*(.*?)\*\*/g, '$1')}</li>;
                    if (line.trim() === '') return <br key={i} />;
                    return <p key={i} className="mb-2 font-semibold text-slate-800">{line.replace(/\*\*(.*?)\*\*/g, '$1')}</p>;
                  })}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button onClick={() => setAiModal({ ...aiModal, isOpen: false })} className="px-6 py-2.5 font-bold text-teal-700 bg-teal-100 hover:bg-teal-200 rounded-lg transition-colors">
                Close Insight
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
