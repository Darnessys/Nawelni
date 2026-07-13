import React, { createContext, useContext, useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth'; // ✅ إضافة signOut
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../core/config/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(null);
  
  // ✅ Refs للتحكم
  const isMountedRef = useRef(true);
  const retryTimeoutRef = useRef(null);

  // ===== Cleanup on unmount =====
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, []);

  // ===== Fetch user profile with retry =====
  const fetchUserProfile = useCallback(async (uid, retryCount = 0) => {
    if (!isMountedRef.current) return null;
    
    try {
      console.log(`📥 جلب بيانات المستخدم: ${uid} (محاولة ${retryCount + 1})`);
      
      const userDoc = await getDoc(doc(db, 'users', uid));

      if (!isMountedRef.current) return null;

      if (userDoc.exists()) {
        const data = userDoc.data();
        console.log(`✅ تم جلب بيانات المستخدم: ${data.name || 'بدون اسم'}`);
        return { uid, ...data };
      } else {
        console.log(`⚠️ لا يوجد مستند للمستخدم: ${uid}`);
        return { uid, profileComplete: false };
      }
    } catch (error) {
      console.error(`❌ خطأ في جلب البروفايل (محاولة ${retryCount + 1}):`, error);
      
      // ✅ Retry logic (3 مرات كحد أقصى)
      if (retryCount < 3 && isMountedRef.current) {
        console.log(`🔄 إعادة محاولة جلب البروفايل بعد 2 ثانية...`);
        
        return new Promise((resolve) => {
          retryTimeoutRef.current = setTimeout(async () => {
            const result = await fetchUserProfile(uid, retryCount + 1);
            resolve(result);
          }, 2000);
        });
      }
      
      // ✅ بعد فشل كل المحاولات
      if (isMountedRef.current) {
        setProfileError('تعذر تحميل بيانات الحساب. تحقق من الاتصال وحاول مرة أخرى.');
      }
      return { uid, profileComplete: false };
    }
  }, []);

  // ===== Auth state listener =====
  useEffect(() => {
    console.log('🔐 بدء مراقبة حالة المصادقة...');
    
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!isMountedRef.current) return;
      
      setProfileError(null);

      if (!currentUser) {
        console.log('🚪 المستخدم غير مسجل دخول');
        setUser(null);
        setUserProfile(null);
        setLoading(false);
        return;
      }

      console.log(`👤 المستخدم مسجل دخول: ${currentUser.uid}`);
      setUser(currentUser);

      // ✅ جلب البروفايل مع retry
      const profile = await fetchUserProfile(currentUser.uid);
      
      if (isMountedRef.current) {
        setUserProfile(profile);
        setLoading(false);
      }
    });

    return () => {
      console.log('👋 إلغاء مراقبة المصادقة');
      unsubscribe();
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [fetchUserProfile]);

  // ===== Update user profile =====
  const updateUserProfile = useCallback((updatedProfile) => {
    if (!isMountedRef.current) return;
    
    console.log(`📝 تحديث بروفايل المستخدم: ${updatedProfile?.uid}`);
    
    // ✅ دمج البيانات مع الحفاظ على الـ uid
    setUserProfile((prev) => ({
      uid: prev?.uid || updatedProfile?.uid,
      ...prev,
      ...updatedProfile,
    }));
    
    // ✅ إعادة تعيين الـ error
    setProfileError(null);
  }, []);

  // ===== Reset profile error =====
  const resetProfileError = useCallback(() => {
    setProfileError(null);
  }, []);

  // ==========================================
  // ✅ ✅ ✅ دالة تسجيل الخروج (Logout)
  // ==========================================
  const logout = useCallback(async () => {
    try {
      console.log('🚪 جاري تسجيل الخروج...');
      await signOut(auth);
      console.log('✅ تم تسجيل الخروج بنجاح');
      
      if (isMountedRef.current) {
        setUser(null);
        setUserProfile(null);
        setLoading(false);
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ خطأ في تسجيل الخروج:', error);
      return { success: false, error: error.message };
    }
  }, []);

  // ===== Context value =====
  const value = useMemo(
    () => ({
      user,
      userProfile,
      loading,
      profileError,
      isAuthenticated: Boolean(user),
      isProfileComplete: userProfile?.profileComplete === true,
      updateUserProfile,
      resetProfileError,
      logout, // ✅ إضافة دالة الخروج
    }),
    [user, userProfile, loading, profileError, updateUserProfile, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ===== Hook with error handling =====
export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}