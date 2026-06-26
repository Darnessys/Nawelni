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
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'; 
import * as Location from 'expo-location';
import { db, auth } from '../../firebaseConfig';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { createOrder } from '../../services/OrderService';
import { colors } from '../../src/core/theme';
import { ACTIVE_CLIENT_STATUSES } from '../../src/core/constants/orderStatuses';
import { useAuth } from '../../src/features/auth/context/AuthContext';

// Voice recognition - safe import
let ExpoSpeechRecognitionModule = null;
let useSpeechRecognitionEvent = () => {};

try {
  const SpeechModule = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = SpeechModule.ExpoSpeechRecognitionModule;
  useSpeechRecognitionEvent = SpeechModule.useSpeechRecognitionEvent;
} catch (e) {
  console.log("Speech Recognition not available in Expo Go");
}

export default function CreateOrder({ 
  setCurrentOrderId, 
  onOrderCreated, 
  clientId, 
  clientName 
}) {
  const { logout } = useAuth();
  
  const isVoiceSupported = !!ExpoSpeechRecognitionModule;
  const [activeTab, setActiveTab] = useState(isVoiceSupported ? 'voice' : 'text');
  
  const [voiceStatus, setVoiceStatus] = useState('idle');
  const [orderText, setOrderText] = useState('');
  const [deliveryFee, setDeliveryFee] = useState(40);
  const [clientCoords, setClientCoords] = useState(null);
  const [addressText, setAddressText] = useState("جاري تحديد الموقع... 🗺️");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingActiveOrder, setIsCheckingActiveOrder] = useState(true);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const hasCheckedOrder = useRef(false);
  const isMountedRef = useRef(true);
  const toastTimerRef = useRef(null);

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

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

  useSpeechRecognitionEvent("start", () => {
    if (isVoiceSupported && isMountedRef.current) setVoiceStatus('recording');
  });

  useSpeechRecognitionEvent("end", () => {
    if (isVoiceSupported && isMountedRef.current) {
      setVoiceStatus(prev => (orderText.trim() === '' ? 'idle' : 'review'));
    }
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (isVoiceSupported && isMountedRef.current && event.results && event.results.length > 0) {
      setOrderText(event.results[0].transcript);
      setVoiceStatus('review');
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (isVoiceSupported && isMountedRef.current) {
      console.error("Speech Error:", event.error);
      setVoiceStatus('idle');
    }
  });

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
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
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
      
      try {
        const apiKey = process.env.LOCATIONIQ_API_KEY;
        if (apiKey) {
          const response = await fetch(
            `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lng}&format=json&accept-language=ar`
          );
          const data = await response.json();
          return data.display_name || "تم تحديد الموقع الجغرافي";
        }
      } catch (fallbackError) {
        console.error("Fallback error:", fallbackError);
      }
      
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
          const activeOrder = querySnapshot.docs[0];
          setCurrentOrderId(activeOrder.id);
          if (onOrderCreated) onOrderCreated();
        }
      } catch (error) {
        console.error("Error checking active order:", error);
      } finally {
        if (isMountedRef.current) {
          setIsCheckingActiveOrder(false);
        }
      }
    };

    checkActiveOrder();
  }, [clientId, setCurrentOrderId, onOrderCreated]);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (isMounted) {
          const fallback = { latitude: 30.0444, longitude: 31.2357 };
          setClientCoords(fallback);
          setAddressText("📍 القاهرة (موقع افتراضي)");
        }
        return;
      }

      try {
        const location = await Location.getCurrentPositionAsync({});
        if (isMounted) {
          const { latitude, longitude } = location.coords;
          setClientCoords({ latitude, longitude });
          const addr = await getAddress(latitude, longitude);
          setAddressText(addr);
        }
      } catch (err) {
        if (isMounted) {
          setAddressText("✅ تم تحديد الموقع (بدون عنوان مفصل)");
        }
      }
    })();

    return () => { isMounted = false; };
  }, [getAddress]);

  useEffect(() => {
    if (voiceStatus === 'recording') {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { 
            toValue: 1.1, 
            duration: 600, 
            useNativeDriver: true 
          }),
          Animated.timing(pulseAnim, { 
            toValue: 1, 
            duration: 600, 
            useNativeDriver: true 
          }),
        ])
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [voiceStatus, pulseAnim]);

  const handleRecordClick = async () => {
    if (!isVoiceSupported) {
      Alert.alert(
        "تنبيه 💡", 
        "ميزة الصوت تحتاج إلى Development Build ولا تعمل في Expo Go.\nيمكنك كتابة طلبك الآن!"
      );
      return;
    }

    if (voiceStatus === 'idle' || voiceStatus === 'review') {
      setOrderText('');
      try {
        const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!result.granted) {
          Alert.alert("تنبيه", "يجب الموافقة على صلاحية المايك");
          return;
        }
        setVoiceStatus('recording');
        ExpoSpeechRecognitionModule.start({ lang: "ar-EG" });
      } catch (e) {
        console.error(e);
        setVoiceStatus('idle');
        Alert.alert("خطأ", "حدث مشكلة في تشغيل المايك");
      }
    } else if (voiceStatus === 'recording') {
      try {
        setVoiceStatus('review');
        ExpoSpeechRecognitionModule.stop();
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleResetVoice = () => {
    if (isVoiceSupported) {
      try { 
        ExpoSpeechRecognitionModule.abort(); 
      } catch(e) {}
    }
    setOrderText('');
    setVoiceStatus('idle');
  };

  const switchTab = (tab) => {
    if (activeTab === 'voice' && voiceStatus === 'recording') {
      Alert.alert('تنبيه', 'هل تريد إيقاف التسجيل والتبديل؟', [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'تبديل', onPress: () => {
          handleResetVoice();
          setActiveTab(tab);
        }}
      ]);
    } else {
      setActiveTab(tab);
      handleResetVoice();
    }
  };

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
    if (activeTab === 'voice' && orderText.trim() === '') {
      Alert.alert('تنبيه', 'سجل طلبك صوتياً أولاً');
      return;
    }
    if (!orderText.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const activeClientId = clientId || auth.currentUser?.uid;
      if (!activeClientId) {
        Alert.alert('تنبيه', 'تعذر تحديد حسابك. أعد تسجيل الدخول.');
        setIsSubmitting(false);
        return;
      }

      const finalCoords = clientCoords || { 
        latitude: 30.0444, 
        longitude: 31.2357 
      };

      const orderId = await createOrder(
        activeClientId,
        clientName || auth.currentUser?.email?.split('@')[0] || 'عميل ناولني',
        orderText.trim(),
        deliveryFee,
        finalCoords,
      );

      setCurrentOrderId(orderId);
      if (onOrderCreated) onOrderCreated();
      handleResetVoice();
      
      showToast('✅ تم إرسال الطلب بنجاح!', 'success');
      
    } catch (error) {
      console.error('Error adding order:', error);
      Alert.alert('عذراً', 'تعذر إرسال الطلب. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const isReadyToSend = orderText.trim().length > 0;

  if (isCheckingActiveOrder) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>جاري فحص الطلبات المعلقة...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
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
        <Text style={styles.headerTitle}>ناولني 🛵</Text>
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

          <View style={styles.tabSwitcher}>
            <TouchableOpacity 
              style={[styles.tabBtn, activeTab === 'voice' && styles.tabBtnActive]} 
              onPress={() => switchTab('voice')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'voice' && styles.tabBtnTextActive]}>
                🎤 تسجيل صوتي
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tabBtn, activeTab === 'text' && styles.tabBtnActive]} 
              onPress={() => switchTab('text')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'text' && styles.tabBtnTextActive]}>
                ✍️ كتابة طلب
              </Text>
            </TouchableOpacity>
          </View>

          {activeTab === 'voice' ? (
            <View style={styles.viewZone}>
              {voiceStatus !== 'review' || orderText.trim() === '' ? (
                <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                  <TouchableOpacity 
                    style={[
                      styles.giantRecordBtn, 
                      voiceStatus === 'recording' && styles.giantRecordBtnRecording
                    ]} 
                    onPress={handleRecordClick}
                  >
                    <Text style={styles.micIcon}>
                      {voiceStatus === 'recording' ? '🛑' : '🎤'}
                    </Text>
                    <Text style={[
                      styles.recordBtnText, 
                      voiceStatus === 'recording' && styles.recordBtnTextRecording
                    ]}>
                      {voiceStatus === 'recording' 
                        ? 'أنا سامعك.. اضغط للتوقف' 
                        : 'اضغط وامرنا بالطلب صوتياً'}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              ) : (
                <View style={styles.reviewZone}>
                  <View style={styles.audioCard}>
                    <TouchableOpacity 
                      style={styles.deleteBtn} 
                      onPress={handleResetVoice}
                    >
                      <Text style={styles.deleteBtnText}>🗑️ إعادة</Text>
                    </TouchableOpacity>
                    <Text style={styles.audioCardText}>✨ نص طلبك:</Text>
                  </View>
                  <TextInput 
                    style={styles.textArea} 
                    multiline 
                    value={orderText} 
                    onChangeText={setOrderText} 
                    placeholder="عدل النص لو حابب..."
                    maxLength={500}
                    placeholderTextColor="#999"
                  />
                </View>
              )}
            </View>
          ) : (
            <View style={styles.inputWrapper}>
              <Text style={styles.fieldLabel}>📜 اكتب طلبك:</Text>
              <TextInput 
                style={styles.textArea} 
                placeholder="اكتب هنا كل اللي محتاجه ليتم عرضه على اقرب مندوب توصيل ليك" 
                multiline 
                value={orderText} 
                onChangeText={setOrderText}
                maxLength={500}
                placeholderTextColor="#999"
              />
            </View>
          )}

          <View style={styles.deliveryCard}>
            <Text style={styles.deliveryLabel}>💰 قيمة التوصيل المقترحة</Text>
            <View style={styles.counterRow}>
              <TouchableOpacity 
                onPress={() => setDeliveryFee(prev => Math.max(15, prev - 5))} 
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
              {clientCoords 
                ? addressText 
                : 'جاري تحديد موقعك... 🛰️'}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 10,
    color: '#6C1B8D',
    fontWeight: '600',
    fontSize: 14,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#6C1B8D', 
  },
  contentContainer: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight + 5,
    paddingVertical: 12,
    backgroundColor: '#6C1B8D',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    elevation: 4,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  logoutBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  logoutBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  container: { 
    padding: 20,
    paddingBottom: 40,
  },
  welcomeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  headerText: {
    color: '#2C3E50',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  tabSwitcher: {
    flexDirection: 'row',
    backgroundColor: '#F0E6F5',
    padding: 4,
    borderRadius: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#D4B8E0',
  },
  tabBtn: { 
    flex: 1, 
    padding: 12, 
    alignItems: 'center', 
    borderRadius: 10,
  },
  tabBtnActive: { 
    backgroundColor: '#6C1B8D',
    elevation: 2,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  tabBtnText: { 
    color: '#6C1B8D', 
    fontWeight: '600', 
    fontSize: 14,
  },
  tabBtnTextActive: { 
    color: '#FFFFFF',
  },
  viewZone: { 
    height: 180, 
    justifyContent: 'center', 
    alignItems: 'center', 
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  giantRecordBtn: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#F8F0FA',
    borderWidth: 3,
    borderColor: '#6C1B8D',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
    elevation: 4,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  giantRecordBtnRecording: { 
    backgroundColor: '#E74C3C', 
    borderColor: '#C0392B',
  },
  micIcon: { 
    fontSize: 32, 
    marginBottom: 5,
  },
  recordBtnText: { 
    fontSize: 11, 
    color: '#6C1B8D', 
    textAlign: 'center', 
    fontWeight: '600',
  },
  recordBtnTextRecording: { 
    color: '#FFFFFF',
  },
  reviewZone: { 
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  audioCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8F0FA',
    padding: 10,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#D4B8E0',
  },
  audioCardText: { 
    color: '#6C1B8D', 
    fontSize: 13, 
    fontWeight: '600', 
    textAlign: 'right',
  },
  deleteBtn: { 
    backgroundColor: '#F0E6F5', 
    paddingVertical: 6, 
    paddingHorizontal: 12, 
    borderRadius: 20,
  },
  deleteBtnText: { 
    color: '#E74C3C', 
    fontSize: 12, 
    fontWeight: 'bold',
  },
  inputWrapper: { 
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  fieldLabel: { 
    fontSize: 13, 
    color: '#6C1B8D', 
    fontWeight: '600', 
    marginBottom: 8, 
    textAlign: 'right',
  },
  textArea: {
    width: '100%',
    height: 110,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 12,
    fontSize: 15,
    color: '#2C3E50',
    // 👇 ده السحر اللي بيخلي النص يحود تلقائياً حسب لغة الحرف الأول
    writingDirection: 'auto', 
  },
  deliveryCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E8E0F0',
    alignItems: 'center',
    width: '100%',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  deliveryLabel: { 
    fontWeight: 'bold', 
    marginBottom: 8, 
    color: '#6C1B8D', 
    fontSize: 14,
  },
  counterRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center',
  },
  counterBtn: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    justifyContent: 'center', 
    alignItems: 'center',
    marginHorizontal: 12,
  },
  counterBtnMinus: { 
    backgroundColor: '#9B4DCA',
    borderWidth: 1,
    borderColor: '#D4B8E0',
  },
  counterBtnPlus: { 
    backgroundColor: '#6C1B8D',
    elevation: 2,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  counterBtnText: { 
    color: '#FFFFFF', 
    fontSize: 22, 
    fontWeight: 'bold',
  },
  deliveryValue: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    color: '#6C1B8D',
    minWidth: 60,
    textAlign: 'center',
  },
  currencyText: {
    fontSize: 16,
    color: '#9B4DCA',
    fontWeight: '600',
  },
  locationBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E8E0F0',
    borderRightWidth: 5,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  locationBoxReady: { 
    borderRightColor: '#6C1B8D',
    backgroundColor: '#F8F0FA',
  },
  locationBoxPending: { 
    borderRightColor: '#F9A825',
    backgroundColor: '#FFF8E1',
  },
  locationIcon: {
    marginRight: 10,
  },
  locationIconText: {
    fontSize: 20,
  },
  locationText: { 
    fontSize: 13, 
    fontWeight: '500', 
    textAlign: 'right', 
    lineHeight: 18,
    flex: 1,
  },
  locationTextReady: { 
    color: '#2C3E50',
  },
  locationTextPending: { 
    color: '#F9A825',
  },
  submitBtn: {
    width: '100%',
    padding: 16,
    backgroundColor: '#D4B8E0',
    borderRadius: 50,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnReady: {
    backgroundColor: '#6C1B8D',
    elevation: 4,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  submitBtnText: { 
    color: '#FFFFFF', 
    fontSize: 16, 
    fontWeight: 'bold',
  },
  attribution: {
    textAlign: 'center',
    color: '#999',
    fontSize: 10,
    marginTop: 16,
    marginBottom: 8,
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