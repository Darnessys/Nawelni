import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { collection, query, or, where, onSnapshot } from 'firebase/firestore';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nManager } from 'react-native';
import * as Updates from 'expo-updates';

import { db } from './src/core/config/firebase';
import { ACTIVE_CLIENT_STATUSES, USER_ROLE } from './src/core/constants/orderStatuses';
import { AuthProvider, useAuth } from './src/features/auth/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';

function AppContent() {
  const { user, userProfile, loading, updateUserProfile } = useAuth();
  const [orders, setOrders] = useState([]);
  const [currentOrderId, setCurrentOrderId] = useState(null);

  const isManualResetRef = useRef(false);
  const resetTimerRef = useRef(null);
  const isMountedRef = useRef(true);

  // ===== Cleanup =====
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  // ===== ✅ RTL Setup (الحل السحري) =====
  useEffect(() => {
    const setupRTL = async () => {
      try {
        if (!I18nManager.isRTL) {
          I18nManager.allowRTL(true);
          I18nManager.forceRTL(true);
          await Updates.reloadAsync();
        }
      } catch (error) {
        console.log("RTL Setup Error:", error);
      }
    };
    setupRTL();
  }, []);

  // ===== Listen to orders =====
  useEffect(() => {
    if (!userProfile?.profileComplete) {
      setOrders([]);
      setCurrentOrderId(null);
      isManualResetRef.current = false;
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      return;
    }

    console.log(`👀 بدء مراقبة الطلبات للمستخدم: ${userProfile.uid}`);

    const q = query(
      collection(db, 'orders'),
      or(
        where('status', '==', 'pending'),
        where('runnerId', '==', userProfile.uid),
        where('requesterId', '==', userProfile.uid),
      ),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!isMountedRef.current) return;
      const fetchedOrders = snapshot.docs.map((orderDoc) => ({
        id: orderDoc.id,
        ...orderDoc.data(),
      }));
      console.log(`📦 تم جلب ${fetchedOrders.length} طلب`);
      setOrders(fetchedOrders);
    }, (error) => {
      console.error("❌ Snapshot error:", error);
    });

    return () => {
      console.log("👋 إلغاء مراقبة الطلبات");
      unsubscribe();
    };
  }, [userProfile?.uid, userProfile?.profileComplete]);

  // ===== Auto-select active order =====
  useEffect(() => {
    if (!isMountedRef.current) return;
    if (userProfile?.role !== USER_ROLE.CLIENT) return;
    if (isManualResetRef.current) {
      console.log("⏳ Manual reset active, skipping auto-select");
      return;
    }
    if (currentOrderId) {
      console.log(`✅ Already have order: ${currentOrderId}`);
      return;
    }
    if (orders.length === 0) return;

    const activeOrders = orders.filter(
      (order) =>
        order.requesterId === userProfile?.uid &&
        ACTIVE_CLIENT_STATUSES.includes(order.status) &&
        order.status !== 'cancelled' &&
        order.status !== 'completed'
    );

    if (activeOrders.length > 0) {
      const activeOrder = activeOrders[0];
      console.log(`🔄 Auto-selecting active order: ${activeOrder.id}`);
      setCurrentOrderId(activeOrder.id);
    } else {
      if (currentOrderId !== null) {
        console.log("🔄 No active orders, resetting currentOrderId");
        setCurrentOrderId(null);
      }
    }
  }, [orders, userProfile?.role, userProfile?.uid, currentOrderId]);

  // ===== Custom setCurrentOrderId =====
  const handleSetCurrentOrderId = useCallback((newOrderId) => {
    console.log(`📞 setCurrentOrderId called: ${newOrderId}`);
    if (!isMountedRef.current) return;

    if (newOrderId === null) {
      isManualResetRef.current = true;
      setCurrentOrderId(null);
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      resetTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          isManualResetRef.current = false;
          console.log("✅ Manual reset flag cleared");
        }
        resetTimerRef.current = null;
      }, 1500);
    } else {
      setCurrentOrderId(newOrderId);
    }
  }, []);

  // ===== Memoized active orders =====
  const activeOrdersCount = useMemo(() => {
    return orders.filter(
      (order) =>
        order.requesterId === userProfile?.uid &&
        ACTIVE_CLIENT_STATUSES.includes(order.status) &&
        order.status !== 'cancelled' &&
        order.status !== 'completed'
    ).length;
  }, [orders, userProfile?.uid]);

  console.log(`📊 Active orders count: ${activeOrdersCount}`);

  return (
    <RootNavigator
      user={user}
      userProfile={userProfile}
      loading={loading}
      updateUserProfile={updateUserProfile}
      orders={orders}
      currentOrderId={currentOrderId}
      setCurrentOrderId={handleSetCurrentOrderId}
    />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </SafeAreaProvider>
  );
}