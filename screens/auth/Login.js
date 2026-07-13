import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  ActivityIndicator, 
  Platform,
  StatusBar,
  Alert
} from 'react-native';
import { auth, db } from '../../src/core/config/firebase';
import { SafeAreaView } from 'react-native-safe-area-context';
import { 
  GoogleAuthProvider, 
  signInWithCredential 
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

// ⚙️ تهيئة إعدادات جوجل نيتف
GoogleSignin.configure({
  webClientId: '476712190716-s09vbbl0nk7il6inrv6mgs4s7184pcim.apps.googleusercontent.com', // الـ Web Client ID الخاص بك من الفايربيز
  offlineAccess: true,
});

export default function Login({ navigation }) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const isMountedRef = useRef(true);
  const toastTimerRef = useRef(null);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  const showToast = (message, type = 'success') => {
    if (!isMountedRef.current) return;
    
    setToast({ show: true, message, type });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    
    toastTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setToast({ show: false, message: '', type: 'success' });
      }
      toastTimerRef.current = null;
    }, 3000);
  };

  const signInWithGoogleNative = async () => {
    if (!isMountedRef.current || googleLoading) return;
    setGoogleLoading(true);

    try {
      // 1. التأكد من وجود خدمات جوجل على الجهاز (خاصة الأندرويد)
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      
      // 2. فتح شاشة تسجيل الدخول الأصلية للنظام
      const signInResult = await GoogleSignin.signIn();
      
      // 3. استخراج الـ ID Token
      const idToken = signInResult.data?.idToken || signInResult.idToken;
      
      if (!idToken) {
        throw new Error("لم يتم استقبال الـ Token من جوجل بشكل صحيح.");
      }

      // 4. ربط الكريدينشال بـ Firebase Auth
      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(auth, credential);
      const user = userCredential.user;

      // 5. فحص بيانات المستخدم في Firestore
      const userDoc = await getDoc(doc(db, "users", user.uid));

      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.profileComplete) {
          showToast(`👋 مرحباً بك ${userData.name || 'عزيزي'}`, 'success');
        } else {
          showToast("📝 مرحباً! يرجى استكمال بيانات حسابك", 'info');
        }
      } else {
        // إنشاء مستخدم جديد تماماً لأول مرة
        const userData = {
          uid: user.uid,
          email: user.email,
          name: user.displayName || '',
          phone: '',
          role: null,
          profileComplete: false,
          photoURL: user.photoURL || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        await setDoc(doc(db, "users", user.uid), userData);
        showToast("🎉 تم إنشاء حسابك بنجاح بـ Google!", 'success');
      }

    } catch (error) {
      console.log('⚠️ Native Google Sign-In Error:', error);
      
      if (isMountedRef.current) {
        if (error.code === 'auth/account-exists-with-different-credential') {
          showToast("📧 هذا الإيميل مسجل بطريقة أخرى مسبقاً", 'error');
        } else if (error.code === '7') { // Network Error في مكتبة جوجل نيتف
          showToast("🌐 تحقق من اتصالك بالإنترنت", 'error');
        } else {
          showToast("❌ فشل تسجيل الدخول بحساب Google", 'error');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setGoogleLoading(false);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />

      {toast.show && (
        <View style={[
          styles.toast,
          { 
            backgroundColor: toast.type === 'success' ? '#2ecc71' : 
                             toast.type === 'info' ? '#3498db' : '#e74c3c' 
          }
        ]}>
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      )}

      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.emoji}>🛵</Text>
            <Text style={styles.title}>مرحباً بك في ناولني</Text>
            <Text style={styles.subtitle}>
              سجل دخولك كعميل أو مندوب بضغطة زر واحدة عبر حساب Google لتبدأ رحلتك
            </Text>
          </View>

          {/* 🎯 زر تسجيل الدخول الوحيد بجوجل نيتف */}
          <TouchableOpacity
            style={[styles.googleButton, googleLoading && styles.googleButtonDisabled]}
            onPress={signInWithGoogleNative}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <View style={styles.googleButtonContent}>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleButtonText}>
                  تسجيل الدخول بواسطة Google
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.secureText}>🔒 تسجيل دخول آمن ومشفر بنسبة 100%</Text>
          <Text style={styles.versionText}>ناولني v1.0.0</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#7f8c8d',
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 10,
  },
  googleButton: {
    backgroundColor: '#4285F4',
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#4285F4',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  googleButtonDisabled: {
    opacity: 0.8,
    backgroundColor: '#a0c2f9',
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIcon: {
    backgroundColor: '#fff',
    color: '#4285F4',
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 12,
    width: 26,
    height: 26,
    textAlign: 'center',
    lineHeight: 26,
    borderRadius: 13,
    overflow: 'hidden',
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secureText: {
    textAlign: 'center',
    color: '#95a5a6',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
  },
  versionText: {
    textAlign: 'center',
    color: '#bdc3c7',
    fontSize: 11,
    marginTop: 16,
  },
  toast: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 30,
    left: 20,
    right: 20,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  toastText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    textAlign: 'center',
  },
});