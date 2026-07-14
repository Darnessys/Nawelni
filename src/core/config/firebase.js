import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
  GoogleAuthProvider,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ✅ تحميل البيانات من متغيرات البيئة (آمن أكثر)
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || 'AIzaSyBSpK6oNtoInRMGQy8HSUTSEjCTgB76Y3w',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || 'nawelniapp.firebaseapp.com',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || 'nawelniapp',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || 'nawelniapp.firebasestorage.app',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '476712190716',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || '1:476712190716:web:d7ca793349f047da704d79',
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || 'G-TJX6Z7M6FF',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

export const db = getFirestore(app);
export { auth };
export const googleProvider = new GoogleAuthProvider();
