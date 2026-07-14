import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: "AIzaSyCQjueOGMf4CtjHOJ2xLCdmZ2leyeEBctU",
  authDomain: "crewmaster-73f31.firebaseapp.com",
  projectId: "crewmaster-73f31",
  storageBucket: "crewmaster-73f31.firebasestorage.app",
  messagingSenderId: "831920078849",
  appId: "1:831920078849:web:8d72204b58c48bb21f0000"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, 'us-central1');
// Firebase Storage — file bytes (repair photos, fleet docs, policies,
// duty-completion photos) live here; Firestore only ever holds the
// lightweight metadata (url/path/size). Same project + region.
export const storage = getStorage(app);

export const __app_id = 'crewmaster';
export const rawAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
export const appId = String(rawAppId).replace(/\//g, '-');
