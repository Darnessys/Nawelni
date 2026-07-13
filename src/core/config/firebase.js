import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
  GoogleAuthProvider,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyBSpK6oNtoInRMGQy8HSUTSEjCTgB76Y3w',
  authDomain: 'nawelniapp.firebaseapp.com',
  projectId: 'nawelniapp',
  storageBucket: 'nawelniapp.firebasestorage.app',
  messagingSenderId: '476712190716',
  appId: '1:476712190716:web:d7ca793349f047da704d79',
  measurementId: 'G-TJX6Z7M6FF',
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
