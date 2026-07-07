import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Alert
} from 'react-native';
import { auth, db } from '../../firebaseConfig';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signInWithCredential,
  GoogleAuthProvider 
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export default function Login({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const isMountedRef = useRef(true);
  const toastTimerRef = useRef(null);
  
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    // 🎯 التعديل السحري: نمرر معرف الأندرويد مباشرة في خانة الـ clientId لو المنصة أندرويد
    clientId: Platform.OS === 'android' 
      ? '476712190716-um7873sqr5g5l57jr933qrs2k6sbcruj.apps.googleusercontent.com' // الـ Android Client ID
      : '476712190716-s09vbbl0nk7il6inrv6mgs4s7184pcim.apps.googleusercontent.com', // الـ Web Client ID
    
    scopes: ['profile', 'email'],
  });

  // ⭐ معالجة نتيجة Google Sign-In
  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = GoogleAuthProvider.credential(id_token);
      handleGoogleSignIn(credential);
    }
  }, [response]);

  const handleGoogleSignIn = async (credential) => {
    if (!isMountedRef.current) return;
    setGoogleLoading(true);
    
    try {
      const userCredential = await signInWithCredential(auth, credential);
      const user = userCredential.user;

      const userDoc = await getDoc(doc(db, "users", user.uid));

      if (userDoc.exists()) {
        const userData = userDoc.data();
        if (userData.profileComplete) {
          showToast(`👋 مرحباً بك ${userData.name || 'عزيزي'}`, 'success');
        } else {
          showToast("📝 مرحباً! يرجى استكمال بيانات حسابك", 'info');
        }
      } else {
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
        showToast("🎉 تم إنشاء حسابك! يرجى استكمال البيانات", 'success');
      }
    } catch (error) {
      console.log('⚠️ Google Sign-In Error:', error.code, error.message);
      
      if (isMountedRef.current) {
        switch (error.code) {
          case 'auth/account-exists-with-different-credential':
            showToast("📧 هذا الإيميل مسجل بطريقة أخرى", 'error');
            break;
          case 'auth/network-request-failed':
            showToast("🌐 تحقق من اتصالك بالإنترنت", 'error');
            break;
          default:
            showToast("❌ فشل تسجيل الدخول بـ Google. حاول مرة أخرى", 'error');
        }
      }
    } finally {
      if (isMountedRef.current) {
        setGoogleLoading(false);
      }
    }
  };

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
      toastTimerRef.current = null;
    }
    
    toastTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setToast({ show: false, message: '', type: 'success' });
      }
      toastTimerRef.current = null;
    }, 3000);
  };

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) {
      showToast('⚠️ برجاء كتابة البريد الإلكتروني وكلمة المرور', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('⚠️ كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
      return;
    }

    setLoading(true);
    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const userData = {
          uid: user.uid,
          email: user.email,
          name: '',
          phone: '',
          role: null,
          profileComplete: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        await setDoc(doc(db, "users", user.uid), userData);
        showToast("✅ تم إنشاء الحساب بنجاح! يرجى استكمال البيانات", 'success');

      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        const userDoc = await getDoc(doc(db, "users", user.uid));

        if (userDoc.exists()) {
          const userData = userDoc.data();

          if (userData.profileComplete) {
            showToast(`👋 مرحباً بك مجدداً ${userData.name || 'عزيزي'}`, 'success');
          } else {
            showToast("📝 مرحباً! يرجى استكمال بيانات حسابك", 'info');
          }
        } else {
          const newUserData = {
            uid: user.uid,
            email: user.email,
            name: '',
            phone: '',
            role: null,
            profileComplete: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          await setDoc(doc(db, "users", user.uid), newUserData);
          showToast("📝 تم إنشاء حسابك! يرجى استكمال البيانات", 'info');
        }
      }
    } catch (error) {
      console.log('⚠️ تم التقاط خطأ Firebase بنجاح:', error.code, error.message);

      if (isMountedRef && !isMountedRef.current) return;

      switch (error.code) {
        case 'auth/network-request-failed':
          showToast("🌐 تحقق من اتصالك بالإنترنت وأعد المحاولة", 'error');
          break;
        case 'auth/wrong-password':
          showToast("🔑 كلمة المرور غير صحيحة، حاول مرة أخرى", 'error');
          break;
        case 'auth/user-not-found':
          showToast("📧 لا يوجد حساب بهذا البريد الإلكتروني", 'error');
          break;
        case 'auth/invalid-credential':
          showToast("❌ البريد الإلكتروني أو كلمة المرور غير صحيحة", 'error');
          break;
        case 'auth/email-already-in-use':
          showToast("📧 هذا البريد مسجل بالفعل، يرجى تسجيل الدخول", 'error');
          break;
        case 'auth/invalid-email':
          showToast("📧 البريد الإلكتروني غير صحيح", 'error');
          break;
        case 'auth/weak-password':
          showToast("🔐 كلمة المرور ضعيفة، استخدم 6 أحرف على الأقل", 'error');
          break;
        default:
          showToast(`❌ حدث خطأ: ${error.message || 'يرجى المحاولة مرة أخرى'}`, 'error');
      }
    } finally {
      if (isMountedRef && isMountedRef.current) {
        setLoading(false);
      } else {
        setLoading(false);
      }
    }
  };

  const toggleMode = () => {
    setIsRegistering(!isRegistering);
    setEmail('');
    setPassword('');
    setShowPassword(false);
    setToast({ show: false, message: '', type: 'success' });
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
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

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.emoji}>🛵</Text>
            <Text style={styles.title}>
              {isRegistering ? '✨ إنشاء حساب جديد' : '👋 مرحباً بك في ناولني'}
            </Text>
            <Text style={styles.subtitle}>
              {isRegistering
                ? 'أدخل بياناتك لبدء رحلتك مع ناولني'
                : 'سجل دخولك لتوصيل أو طلب الأغراض'}
            </Text>
          </View>

          {/* ⭐ Google Sign-In Button */}
          <TouchableOpacity
            style={styles.googleButton}
            onPress={() => {
              console.log(request?.redirectUri);
              promptAsync();
            }}
            disabled={!request || googleLoading || loading}
          >
            {googleLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <View style={styles.googleButtonContent}>
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleButtonText}>
                  تسجيل الدخول بحساب Google
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* ⭐ فاصل */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>أو</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* ✅ حقل البريد الإلكتروني */}
          <View style={styles.inputBlock}>
            <Text style={styles.inputLabel}>📧 البريد الإلكتروني</Text>
            <TextInput
              style={[styles.input, styles.inputLTR]}
              placeholder="example@email.com"
              placeholderTextColor="#999"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading && !googleLoading}
            />
          </View>

          {/* ✅ حقل كلمة المرور */}
          <View style={styles.inputBlock}>
            <Text style={styles.inputLabel}>🔑 كلمة المرور</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                style={[styles.input, styles.passwordInput, styles.inputLTR]}
                placeholder="••••••••"
                placeholderTextColor="#999"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                editable={!loading && !googleLoading}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword(!showPassword)}
                disabled={loading || googleLoading}
              >
                <Text style={styles.eyeText}>
                  {showPassword ? '🙈' : '👁️'}
                </Text>
              </TouchableOpacity>
            </View>
            {isRegistering && (
              <Text style={styles.hintText}>* كلمة المرور يجب أن تكون 6 أحرف على الأقل</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.mainButton, (loading || googleLoading) && styles.mainButtonDisabled]}
            onPress={handleAuth}
            disabled={loading || googleLoading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.mainButtonText}>
                {isRegistering ? '🚀 إنشاء حساب' : '🔒 تسجيل الدخول'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={toggleMode}
            disabled={loading || googleLoading}
          >
            <Text style={styles.switchButtonText}>
              {isRegistering
                ? '📋 لديك حساب بالفعل؟ سجل دخول'
                : '🆕 ليس لديك حساب؟ اصنع حساباً جديداً'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.versionText}>ناولني v1.0.0</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#7f8c8d',
    textAlign: 'center',
    lineHeight: 18,
  },
  
  // ⭐ Google Button Styles
  googleButton: {
    backgroundColor: '#4285F4',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
    elevation: 2,
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIcon: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginRight: 10,
    backgroundColor: '#fff',
    color: '#4285F4',
    width: 24,
    height: 24,
    textAlign: 'center',
    lineHeight: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  googleButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  
  // ⭐ Divider Styles
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#999',
    fontSize: 13,
  },
  
  inputBlock: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e8e8e8',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#34495e',
    marginBottom: 6,
    textAlign: 'auto',
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#333',
  },
  inputLTR: {
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  passwordContainer: {
    justifyContent: 'center',
  },
  passwordInput: {
    paddingEnd: 50,
  },
  eyeButton: {
    position: 'absolute',
    end: 12,
    padding: 4,
  },
  eyeText: {
    fontSize: 20,
  },
  hintText: {
    fontSize: 11,
    color: '#95a5a6',
    textAlign: 'right',
    marginTop: 4,
  },
  mainButton: {
    backgroundColor: '#4a148c',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    elevation: 2,
  },
  mainButtonDisabled: {
    opacity: 0.7,
  },
  mainButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  switchButton: {
    marginTop: 16,
    alignItems: 'center',
    padding: 8,
  },
  switchButtonText: {
    color: '#4a148c',
    fontSize: 14,
    fontWeight: '600',
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