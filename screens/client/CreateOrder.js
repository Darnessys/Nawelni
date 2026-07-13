import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  ActivityIndicator, 
  Animated,
  Alert,
  Platform,
  StatusBar,
  PermissionsAndroid
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Geolocation from '@react-native-community/geolocation';
import { db, auth } from '../../src/core/config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { createOrder } from '../../services/OrderService';
import { colors } from '../../src/core/theme';
import { ACTIVE_CLIENT_STATUSES } from '../../src/core/constants/orderStatuses';
import { useAuth } from '../../src/features/auth/context/AuthContext';
import { getUserAverageRating } from '../../services/RatingService';

const StarsDisplay = ({ rating, size = 14, color = '#F9A825' }) => {
  if (!rating || rating === 0) {
    return <Text style={{ fontSize: size, color: '#ccc' }}>جديد</Text>;
  }
  
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
  
  let stars = '';
  for (let i = 0; i < fullStars; i++) stars += '⭐';
  if (hasHalf) stars += '✨';
  for (let i = 0; i < emptyStars; i++) stars += '☆';
  
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Text style={{ fontSize: size }}>{stars}</Text>
      <Text style={{ fontSize: size - 2, color: color, fontWeight: '600' }}>{rating}</Text>
    </View>
  );
};

export default function CreateOrder({ 
  setCurrentOrderId, 
  onOrderCreated, 
  clientId, 
  clientName 
}) {
  const { logout } = useAuth();
  
  const [orderText, setOrderText] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(40);
  const [clientCoords, setClientCoords] = useState(null);
  const [addressText, setAddressText] = useState("جاري تحديد الموقع... 🗺️");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingActiveOrder, setIsCheckingActiveOrder] = useState(true);
  const [myRating, setMyRating] = useState({ average: 0, totalRatings: 0 });

  const hasCheckedOrder = useRef(false);
  const isMountedRef = useRef(true);
  const toastTimerRef = useRef(null);

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const currentUserId = clientId || auth.currentUser?.uid;
    if (!currentUserId) return;

    const fetchMyRating = async () => {
      try {
        const ratingData = await getUserAverageRating(currentUserId);
        if (isMountedRef.current) {
          setMyRating(ratingData);
        }
      } catch (error) {
        console.error("Error fetching my rating:", error);
      }
    };

    fetchMyRating();
  }, [clientId]);

  const getAddress = useCallback(async (lat, lng) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ar&zoom=18&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'Nawelni/1.0 (https://nawelni.com; contact@nawelni.com)'
          }
        }
      );
      
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      
      if (data.address) {
        const addr = data.address;
        const parts = [];
        if (addr.house_number) parts.push(addr.house_number);
        if (addr.road) parts.push(addr.road);
        if (addr.suburb) parts.push(addr.suburb);
        if (addr.city_district) parts.push(addr.city_district);
        if (addr.city) parts.push(addr.city);
        if (addr.state) parts.push(addr.state);
        
        return parts.length > 0 ? parts.join(' ') : data.display_name || "تم تحديد الموقع";
      }
      return data.display_name || "تم تحديد الموقع الجغرافي";
    } catch (error) {
      console.error("Reverse geocoding error:", error);
      return "تم تحديد الموقع الجغرافي";
    }
  }, []);

  useEffect(() => {
    if (hasCheckedOrder.current || !isMountedRef.current) return;
    hasCheckedOrder.current = true;

    const checkActiveOrder = async () => {
      const currentUserId = clientId || auth.currentUser?.uid;
      if (!currentUserId) {
        if (isMountedRef.current) setIsCheckingActiveOrder(false);
        return;
      }

      try {
        const ordersRef = collection(db, "orders");
        const q = query(
          ordersRef,
          where('requesterId', '==', currentUserId),
          where('status', 'in', ACTIVE_CLIENT_STATUSES),
        );
        
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty && isMountedRef.current) {
          const activeOrders = querySnapshot.docs.filter(
            doc => doc.data().status !== 'completed'
          );
          if (activeOrders.length > 0) {
            const activeOrder = activeOrders[0];
            setCurrentOrderId(activeOrder.id);
            if (onOrderCreated) onOrderCreated();
          }
        }
      } catch (error) {
        console.error("Error checking active order:", error);
      } finally {
        if (isMountedRef.current) setIsCheckingActiveOrder(false);
      }
    };

    checkActiveOrder();
  }, [clientId, setCurrentOrderId, onOrderCreated]);

  useEffect(() => {
    let isMounted = true;
    const fallback = { latitude: 30.0444, longitude: 31.2357 };

    const requestLocationPermission = async () => {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'صلاحية الموقع',
            message: 'ناولني يحتاج الوصول لموقعك لتحديد عنوان التوصيل بدقة',
            buttonPositive: 'موافق',
            buttonNegative: 'إلغاء',
          }
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          if (isMounted) {
            setClientCoords(fallback);
            setAddressText("📍 القاهرة (موقع افتراضي)");
          }
          return;
        }
      }

      Geolocation.getCurrentPosition(
        async (position) => {
          if (isMounted) {
            const { latitude, longitude } = position.coords;
            setClientCoords({ latitude, longitude });
            const addr = await getAddress(latitude, longitude);
            if (isMounted) setAddressText(addr);
          }
        },
        async (error) => {
          console.log("⚠️ فشلت الدقة العالية، نجرّب الدقة العادية...", error);
          
          Geolocation.getCurrentPosition(
            async (fallbackPosition) => {
              if (isMounted) {
                const { latitude, longitude } = fallbackPosition.coords;
                setClientCoords({ latitude, longitude });
                const addr = await getAddress(latitude, longitude);
                if (isMounted) setAddressText(addr);
              }
            },
            async (finalError) => {
              console.error("❌ فشلت جميع محاولات الـ GPS:", finalError);
              if (isMounted) {
                setClientCoords(fallback);
                setAddressText("📍 القاهرة (موقع افتراضي)");
              }
            },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
          );
        },
        { 
          enableHighAccuracy: true, 
          timeout: 12000,       
          maximumAge: 0,        
          distanceFilter: 0     
        }
      );
    };

    requestLocationPermission();

    return () => { isMounted = false; };
  }, [getAddress]);

  const handleLogout = async () => {
    Alert.alert(
      "تأكيد الخروج ⚠️",
      "هل أنت متأكد من تسجيل الخروج؟",
      [
        { text: "تراجع", style: "cancel" },
        {
          text: "نعم، سجل خروج",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await logout();
              if (result.success) {
                showToast("✅ تم تسجيل الخروج بنجاح", 'success');
              } else {
                Alert.alert("خطأ", result.error || "حدث خطأ أثناء تسجيل الخروج");
              }
            } catch (error) {
              Alert.alert("خطأ", "حدث خطأ أثناء تسجيل الخروج");
            }
          }
        }
      ]
    );
  };

  const handleSend = async () => {
    if (!orderText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const activeClientId = clientId || auth.currentUser?.uid;
      if (!activeClientId) {
        Alert.alert('تنبيه', 'تعذر تحديد حسابك. أعد تسجيل الدخول.');
        setIsSubmitting(false);
        return;
      }

      const finalCoords = clientCoords || { latitude: 30.0444, longitude: 31.2357 };

      const orderId = await createOrder(
        activeClientId,
        clientName || auth.currentUser?.email?.split('@')[0] || 'عميل ناولني',
        orderText.trim(),
        deliveryFee,
        finalCoords,
      );

      setCurrentOrderId(orderId);
      if (onOrderCreated) onOrderCreated();
      setOrderText('');
      showToast('✅ تم إرسال الطلب بنجاح!', 'success');
    } catch (error) {
      console.error('Error adding order:', error);
      Alert.alert('عذراً', 'تعذر إرسال الطلب. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  const isReadyToSend = orderText.trim().length > 0;

  if (isCheckingActiveOrder) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors?.primary || '#6C1B8D'} />
        <Text style={styles.loadingText}>جاري فحص الطلبات المعلقة...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
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

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>ناولني 🛵</Text>
          {myRating.totalRatings > 0 && (
            <View style={styles.myRatingRow}>
              <StarsDisplay rating={myRating.average} size={12} color="#FFD700" />
              <Text style={styles.myRatingCount}>({myRating.totalRatings})</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>🚪 خروج</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.contentContainer}>
        <ScrollView 
          contentContainerStyle={styles.container} 
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.welcomeCard}>
            <Text style={styles.headerText}>
              أهلاً بيك يا {clientName || ''}، محتاج إيه؟ 🛵
            </Text>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.fieldLabel}>📜 اكتب طلبك:</Text>
            <TextInput 
              style={[styles.textArea, { textAlign: 'right', writingDirection: 'rtl' }]} 
              placeholder="اكتب هنا كل اللي محتاجه ليتم عرضه على اقرب مندوب توصيل ليك" 
              multiline 
              value={orderText} 
              onChangeText={setOrderText}
              maxLength={500}
              placeholderTextColor="#999"
            />
          </View>

          <View style={styles.deliveryCard}>
            <Text style={styles.deliveryLabel}>💰 قيمة التوصيل المقترحة</Text>
            <View style={styles.counterRow}>
              <TouchableOpacity 
                onPress={() => setDeliveryFee(prev => Math.max(10, prev - 5))} 
                style={[styles.counterBtn, styles.counterBtnMinus]}
              >
                <Text style={styles.counterBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.deliveryValue}>
                {deliveryFee ?? 0} <Text style={styles.currencyText}>ج</Text>
              </Text>
              <TouchableOpacity 
                onPress={() => setDeliveryFee(prev => prev + 5)} 
                style={[styles.counterBtn, styles.counterBtnPlus]}
              >
                <Text style={styles.counterBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[
            styles.locationBox, 
            clientCoords ? styles.locationBoxReady : styles.locationBoxPending
          ]}>
            <View style={styles.locationIcon}>
              <Text style={styles.locationIconText}>📍</Text>
            </View>
            <Text style={[
              styles.locationText,
              clientCoords ? styles.locationTextReady : styles.locationTextPending
            ]}>
              {clientCoords ? addressText : 'جاري تحديد موقعك... 🛰️'}
            </Text>
          </View>

          <TouchableOpacity 
            style={[styles.submitBtn, isReadyToSend && styles.submitBtnReady]} 
            onPress={handleSend}
            disabled={!isReadyToSend || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>🚀 تأييد وإرسال الطلب</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.attribution}>🗺️ بيانات الخرائط من OpenStreetMap</Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F5' },
  loadingText: { marginTop: 10, color: '#6C1B8D', fontWeight: '600', fontSize: 14 },
  safeArea: { flex: 1, backgroundColor: '#6C1B8D' },
  contentContainer: { flex: 1, backgroundColor: '#F5F5F5', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight + 5, paddingVertical: 12, backgroundColor: '#6C1B8D', borderBottomLeftRadius: 20, borderBottomRightRadius: 20, elevation: 4, shadowColor: '#6C1B8D', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  headerLeft: { flexDirection: 'column', alignItems: 'flex-start' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF', letterSpacing: 1 },
  myRatingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  myRatingCount: { fontSize: 10, color: '#FFD700', fontWeight: '600' },
  logoutBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  logoutBtnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  container: { padding: 20, paddingBottom: 40 },
  welcomeCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 },
  headerText: { color: '#2C3E50', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  inputWrapper: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 },
  fieldLabel: { fontSize: 13, color: '#6C1B8D', fontWeight: '600', marginBottom: 8, textAlign: 'auto' },
  textArea: { width: '100%', height: 110, backgroundColor: '#F8F9FA', borderRadius: 12, borderWidth: 1, borderColor: '#E0E0E0', padding: 12, fontSize: 15, color: '#2C3E50' },
  deliveryCard: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, marginTop: 16, borderWidth: 1, borderColor: '#E8E0F0', alignItems: 'center', width: '100%', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 },
  deliveryLabel: { fontWeight: 'bold', marginBottom: 8, color: '#6C1B8D', fontSize: 14 },
  counterRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center' },
  counterBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginHorizontal: 12 },
  counterBtnMinus: { backgroundColor: '#9B4DCA', borderWidth: 1, borderColor: '#D4B8E0' },
  counterBtnPlus: { backgroundColor: '#6C1B8D', elevation: 2, shadowColor: '#6C1B8D', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
  counterBtnText: { color: '#FFFFFF', fontSize: 22, fontWeight: 'bold' },
  deliveryValue: { fontSize: 24, fontWeight: 'bold', color: '#6C1B8D', minWidth: 60, textAlign: 'center' },
  currencyText: { fontSize: 16, color: '#9B4DCA', fontWeight: '600' },
  locationBox: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#E8E0F0', borderRightWidth: 5, width: '100%', flexDirection: 'row', alignItems: 'center', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4 },
  locationBoxReady: { borderRightColor: '#6C1B8D', backgroundColor: '#F8F0FA' },
  locationBoxPending: { borderRightColor: '#F9A825', backgroundColor: '#FFF8E1' },
  locationIcon: { marginRight: 10 },
  locationIconText: { fontSize: 20 },
  locationText: { fontSize: 13, fontWeight: '500', textAlign: 'auto', lineHeight: 18, flex: 1 },
  locationTextReady: { color: '#2C3E50' },
  locationTextPending: { color: '#F9A825' },
  submitBtn: { width: '100%', padding: 16, backgroundColor: '#D4B8E0', borderRadius: 50, alignItems: 'center', marginTop: 20 },
  submitBtnReady: { backgroundColor: '#6C1B8D', elevation: 4, shadowColor: '#6C1B8D', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12 },
  submitBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  attribution: { textAlign: 'center', color: '#999', fontSize: 10, marginTop: 16, marginBottom: 8 },
  toast: { position: 'absolute', top: Platform.OS === 'ios' ? 50 : 30, left: 20, right: 20, padding: 14, borderRadius: 12, alignItems: 'center', zIndex: 9999, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
  toastText: { color: '#fff', fontWeight: '600', fontSize: 14, textAlign: 'center' },
});