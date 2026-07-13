import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  TextInput, 
  ScrollView, 
  ActivityIndicator, 
  Alert, 
  Linking,
  Platform,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Geolocation from '@react-native-community/geolocation';
import Sound from 'react-native-sound';
import { acceptOrder, cancelOrderAcceptance, submitCounterOffer, withdrawCounterOffer, completeOrder } from '../../services/OrderService'; 
import { doc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../src/core/config/firebase';
import { useAuth } from '../../src/features/auth/context/AuthContext';
import RatingModal from '../RatingModal';
import { submitRating, hasUserRatedOrder, getUserAverageRating } from '../../services/RatingService';

// ⭐ إعداد الأصوات
const newOrderSound = new Sound('new_order.wav', Sound.MAIN_BUNDLE, (error) => {
  if (error) console.log('Failed to load new order sound', error);
});

const orderAcceptedSound = new Sound('order_accepted.wav', Sound.MAIN_BUNDLE, (error) => {
  if (error) console.log('Failed to load accepted sound', error);
});

// ⭐ Component صغير لعرض النجوم
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

export default function RunnerDashboard({ runnerProfile, pendingOrders = [] }) {
  const { logout } = useAuth();
  
  const [activeTab, setActiveTab] = useState('available');
  const [isProcessing, setIsProcessing] = useState(false);
  const [addresses, setAddresses] = useState({});
  const [customPrices, setCustomPrices] = useState({});
  const [rejectedOrders, setRejectedOrders] = useState([]);
  const [localOrders, setLocalOrders] = useState(pendingOrders);
  const [vehicleType, setVehicleType] = useState('motorcycle');
  
  const fetchedAddresses = useRef(new Set());
  const isMountedRef = useRef(true);
  const toastTimerRef = useRef(null);
  const prevAvailableCountRef = useRef(0);
  const prevMyOrdersCountRef = useRef(0);

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratingOrderId, setRatingOrderId] = useState(null);
  const [ratedClientId, setRatedClientId] = useState(null);
  const [ratedClientName, setRatedClientName] = useState("");
  const [ratedOrders, setRatedOrders] = useState(new Set());
  const [isLoadingRatings, setIsLoadingRatings] = useState(false);

  const [myRating, setMyRating] = useState({ average: 0, totalRatings: 0 });
  const [clientRatings, setClientRatings] = useState({});

  // ⭐ تم نقل هذا التعريف لهنا (بدل ما كان في آخر الملف) لأن useEffect بتاع صوت
  // ⭐ "قبول العرض" تحت كان بيحاول يستخدمه في الـ dependency array قبل ما يتعرف أصلاً،
  // ⭐ وده كان بيخلي الصوت يشتغل مرة واحدة بس عند فتح الشاشة ومش بيرد فعل تاني بعد كده
  const myOrders = localOrders.filter(
    order => (order.status === 'accepted' || order.status === 'runner_delivered') && 
              order.runnerId === runnerProfile?.id
  );

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

  useEffect(() => {
    if (isMountedRef.current) {
      setLocalOrders(pendingOrders);
    }
  }, [pendingOrders]);

  useEffect(() => {
    const runnerId = runnerProfile?.id || auth.currentUser?.uid;
    if (!runnerId) return;

    const fetchMyRating = async () => {
      try {
        const ratingData = await getUserAverageRating(runnerId);
        if (isMountedRef.current) {
          setMyRating(ratingData);
        }
      } catch (error) {
        console.error("Error fetching my rating:", error);
      }
    };

    fetchMyRating();
  }, [runnerProfile?.id]);

  useEffect(() => {
    const availableOrders = localOrders.filter(
      order => (!order.status || order.status === 'pending') && !rejectedOrders.includes(order.id)
    );

    const fetchClientRatings = async () => {
      const ratings = {};
      
      for (const order of availableOrders) {
        const clientId = order.requesterId;
        if (!clientId || ratings[clientId]) continue;
        
        try {
          const ratingData = await getUserAverageRating(clientId);
          ratings[clientId] = ratingData;
        } catch (error) {
          console.error(`Error fetching rating for client ${clientId}:`, error);
        }
      }
      
      if (isMountedRef.current) {
        setClientRatings(ratings);
      }
    };

    if (availableOrders.length > 0) {
      fetchClientRatings();
    }
  }, [localOrders.filter(o => !o.status || o.status === 'pending').length]);

  const fetchRatedOrders = useCallback(async (completedOrders) => {
    if (!completedOrders || completedOrders.length === 0) return;
    if (!runnerProfile?.id && !auth.currentUser?.uid) return;
    
    const runnerId = runnerProfile?.id || auth.currentUser?.uid;
    if (!runnerId) return;
    
    setIsLoadingRatings(true);
    
    const ratedSet = new Set();
    
    for (const order of completedOrders) {
      try {
        const hasRated = await hasUserRatedOrder(order.id, runnerId, "runner_to_client");
        if (hasRated) {
          ratedSet.add(order.id);
        }
      } catch (error) {
        console.error(`Error checking rating for order ${order.id}:`, error);
      }
    }
    
    if (isMountedRef.current) {
      setRatedOrders(ratedSet);
      setIsLoadingRatings(false);
      console.log(`📊 تم تحميل ${ratedSet.size} تقييم من Firestore`);
    }
  }, [runnerProfile?.id]);

  useEffect(() => {
    const completedOrders = localOrders.filter(
      order => order.status === 'completed' && 
               order.runnerId === (runnerProfile?.id || auth.currentUser?.uid) && 
               !order.runnerDismissed
    );
    
    if (completedOrders.length > 0) {
      fetchRatedOrders(completedOrders);
    }
  }, [localOrders.filter(o => o.status === 'completed').length, fetchRatedOrders]);

  useEffect(() => {
    const availableOrders = localOrders.filter(
      order => (!order.status || order.status === 'pending') && !rejectedOrders.includes(order.id)
    );
    
    const currentCount = availableOrders.length;
    const prevCount = prevAvailableCountRef.current;
    
    if (currentCount > prevCount && prevCount >= 0) {
      newOrderSound.stop(() => {
        newOrderSound.play((success) => {
          if (!success) console.log('New order sound playback failed');
        });
      });
    }
    
    prevAvailableCountRef.current = currentCount;
  }, [localOrders.filter(o => !o.status || o.status === 'pending').length]);

  useEffect(() => {
    const acceptedOrders = myOrders.filter(o => o.status === 'accepted');
    const currentCount = acceptedOrders.length;
    const prevCount = prevMyOrdersCountRef.current;
    
    if (currentCount > prevCount && prevCount >= 0) {
      orderAcceptedSound.stop(() => {
        orderAcceptedSound.play((success) => {
          if (!success) console.log('Accepted sound playback failed');
        });
      });
    }
    
    prevMyOrdersCountRef.current = currentCount;
  }, [myOrders?.length]);

  // 🚀 استراتيجية جلب الموقع الصامتة والذكية لمنع ظهور رسائل الخطأ المزعجة للرنر
  const getRunnerLocation = async () => {
    return new Promise((resolve) => {
      const fallbackCoords = { latitude: 30.0444, longitude: 31.2357 }; // القاهرة كخيار احتياطي صامت لعدم تعطيل العملية

      // المحاولة الأولى: دقة عالية (GPS وقمر صناعي) تلتلقط في 8 ثوانٍ بحد أقصى
      Geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
        },
        (error) => {
          console.log("⚠️ الرنر داخل مبنى أو الـ GPS متأخر، نجرّب الدقة العادية للشبكة صامتاً...");
          
          // المحاولة الثانية: دقة عادية (أبراج محمول ووايفاي) سريعة اللقط عند تعذر الـ GPS
          Geolocation.getCurrentPosition(
            (fallbackPosition) => {
              resolve({
                latitude: fallbackPosition.coords.latitude,
                longitude: fallbackPosition.coords.longitude,
              });
            },
            (finalError) => {
              console.log("❌ تعذرت كل محاولات تحديد الموقع، تم اعتماد الموقع الاحتياطي صامتاً لتمرير الطلب.");
              resolve(fallbackCoords); // نمرر الموقع الافتراضي صامتاً لحفظ تجربة المستخدم
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 10000 }
          );
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  };

  const translateCoordsToAddress = async (orderId, lat, lng) => {
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
        if (addr.country) parts.push(addr.country);
        
        const readableAddress = parts.length > 0 ? parts.join(' ') : data.display_name || "عنوان غير محدد";
        
        if (isMountedRef.current) {
          setAddresses(prev => ({ ...prev, [orderId]: readableAddress }));
        }
      } else {
        if (isMountedRef.current) {
          setAddresses(prev => ({ ...prev, [orderId]: data.display_name || "عنوان غير محدد" }));
        }
      }
    } catch (error) {
      console.error("Reverse geocoding error:", error);
      
      if (isMountedRef.current) {
        setAddresses(prev => ({ ...prev, [orderId]: "📍 تم تحديد الموقع" }));
      }
    }
  };

  useEffect(() => {
    if (!isMountedRef.current) return;
    
    localOrders.forEach(order => {
      if (
        order.clientLocation?.latitude && 
        order.clientLocation?.longitude &&
        !fetchedAddresses.current.has(order.id) &&
        !addresses[order.id]
      ) {
        fetchedAddresses.current.add(order.id);
        translateCoordsToAddress(
          order.id, 
          order.clientLocation.latitude, 
          order.clientLocation.longitude
        );
      }
    });
  }, [localOrders]);

  const hasUnratedCompletedOrders = () => {
    return myCompletedHistory.some(order => !ratedOrders.has(order.id));
  };

  const handleAccept = async (orderId) => {
    if (isProcessing || !isMountedRef.current) return;
    
    if (hasUnratedCompletedOrders()) {
      Alert.alert(
        "تنبيه ⚠️",
        "يجب تقييم العملاء في الطلبات المكتملة أولاً قبل قبول طلبات جديدة.",
        [{ text: "حسناً", onPress: () => setActiveTab('history') }]
      );
      return;
    }
    
    if (!runnerProfile?.id) {
      Alert.alert("خطأ", "تعذر تحديد هوية الكابتن.");
      return;
    }
    
    setIsProcessing(true);
    try {
      const coords = await getRunnerLocation();
      await acceptOrder(orderId, runnerProfile.id, coords, {
        runnerName: runnerProfile.name,
        runnerPhone: runnerProfile.phone || ''
      });
      showToast("✅ تم قبول الطلب بنجاح!", 'success');
      setActiveTab('my-orders');
    } catch (error) {
      console.error("Accept error:", error);
      Alert.alert("خطأ 🚨", "حصلت مشكلة أثناء قبول الطلب.");
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleRelease = async (orderId) => {
    if (isProcessing || !isMountedRef.current) return;
    
    setIsProcessing(true);
    try {
      await cancelOrderAcceptance(orderId);
      setLocalOrders(prev => prev.map(order =>
        order.id === orderId 
          ? { ...order, status: 'pending', runnerId: null }
          : order
      ));
      showToast("🔄 تم إلغاء القبول بنجاح", 'info');
      setActiveTab('available');
    } catch (error) {
      console.error("Release error:", error);
      Alert.alert("خطأ 🚨", "حصلت مشكلة أثناء إلغاء القبول.");
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleCompleteOrder = async (orderId) => {
    if (isProcessing || !isMountedRef.current) return;
    
    setIsProcessing(true);
    try {
      await completeOrder(orderId, 'runner_delivered');
      
      setLocalOrders(prev => prev.map(order =>
        order.id === orderId 
          ? { ...order, status: 'runner_delivered' }
          : order
      ));
      
      showToast("👍 تم إرسال طلب التأكيد للعميل", 'success');
    } catch (error) {
      console.error("Complete order error:", error);
      Alert.alert("خطأ 🚨", "حصلت مشكلة أثناء تحديث حالة الطلب.");
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleRateClient = (orderId, clientId, clientName) => {
    setRatingOrderId(orderId);
    setRatedClientId(clientId);
    setRatedClientName(clientName || "العميل");
    setShowRatingModal(true);
  };

  const handleSubmitClientRating = async (rating, comment) => {
    if (!ratingOrderId || !ratedClientId) return;
    
    try {
      await submitRating(
        ratingOrderId,
        auth.currentUser?.uid || runnerProfile?.id,
        ratedClientId,
        rating,
        comment,
        "runner_to_client"
      );
      showToast("✅ شكراً لتقييمك! 🌟", 'success');
      setRatedOrders(prev => new Set([...prev, ratingOrderId]));
      setShowRatingModal(false);
    } catch (error) {
      console.error("Submit rating error:", error);
      if (error.message?.includes('بالفعل')) {
        setRatedOrders(prev => new Set([...prev, ratingOrderId]));
        setShowRatingModal(false);
        showToast("⚠️ تم تقييم هذا العميل مسبقاً", 'info');
      } else {
        Alert.alert("خطأ", "لم نتمكن من حفظ تقييمك. حاول مرة أخرى.");
      }
    }
  };

  const handleDismissOrderFromHistory = (orderId) => {
    if (!ratedOrders.has(orderId)) {
      Alert.alert(
        "تنبيه ⚠️",
        "يجب تقييم العميل أولاً قبل إخفاء الطلب.",
        [{ text: "حسناً" }]
      );
      return;
    }
    
    if (isProcessing || !isMountedRef.current) return;

    Alert.alert(
      "تأكيد التنظيف 🧹",
      "هل تريد مسح هذا الطلب من شاشتك الحالية؟",
      [
        { text: "تراجع", style: "cancel" },
        {
          text: "نعم، إخفاء",
          style: "destructive",
          onPress: async () => {
            setIsProcessing(true);
            try {
              const orderRef = doc(db, "orders", orderId);
              await updateDoc(orderRef, { runnerDismissed: true });
              setLocalOrders(prev => prev.filter(order => order.id !== orderId));
              showToast("✅ تمت أرشفة الطلب بنجاح", 'success');
            } catch (error) {
              console.error("Dismiss error:", error);
              Alert.alert("خطأ 🚨", "حصلت مشكلة أثناء إخفاء الطلب.");
            } finally {
              if (isMountedRef.current) {
                setIsProcessing(false);
              }
            }
          }
        }
      ]
    );
  };

  const handleCounterOffer = async (orderId) => {
    if (isProcessing || !isMountedRef.current) return;
    
    if (hasUnratedCompletedOrders()) {
      Alert.alert(
        "تنبيه ⚠️",
        "يجب تقييم العملاء في الطلبات المكتملة أولاً قبل تقديم عروض جديدة.",
        [{ text: "حسناً", onPress: () => setActiveTab('history') }]
      );
      return;
    }
    
    const priceProposed = customPrices[orderId];
    if (!priceProposed || parseInt(priceProposed) <= 0) {
      Alert.alert("تنبيه 💰", "اكتب سعر منطقي أولاً يا كابتن!");
      return;
    }

    const currentOrder = localOrders.find(o => o.id === orderId);
    if (currentOrder && Array.isArray(currentOrder.offers)) {
      const isSamePrice = currentOrder.offers.some(
        offer => offer.runnerId === runnerProfile.id && 
                 Number(offer.proposedPrice) === Number(priceProposed)
      );

      if (isSamePrice) {
        Alert.alert("تنبيه ⚠️", "أنت قدمت نفس العرض بالفعل!");
        return;
      }
    }

    setIsProcessing(true);
    try {
      const coords = await getRunnerLocation();
      await submitCounterOffer(
        orderId, 
        runnerProfile.id, 
        runnerProfile.name, 
        parseInt(priceProposed),
        coords,
        vehicleType
      );
      
      setLocalOrders(prev => prev.map(order =>
        order.id === orderId 
          ? { 
              ...order, 
              offers: [...(order.offers || []), {
                runnerId: runnerProfile.id,
                runnerName: runnerProfile.name,
                proposedPrice: parseInt(priceProposed),
                timestamp: new Date()
              }]
            }
          : order
      ));
      
      showToast(`💰 تم إرسال عرضك بـ (${priceProposed} ج)`, 'success');
      setCustomPrices(prev => ({ ...prev, [orderId]: '' }));
    } catch (error) {
      console.error("Counter offer error:", error);
      Alert.alert("خطأ 🚨", "فشل إرسال عرض السعر!");
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleWithdrawOffer = async (orderId) => {
    if (isProcessing || !isMountedRef.current) return;
    
    setIsProcessing(true);
    try {
      await withdrawCounterOffer(orderId, runnerProfile.id);
      
      setLocalOrders(prev => prev.map(order =>
        order.id === orderId 
          ? { 
              ...order, 
              offers: order.offers?.filter(o => o.runnerId !== runnerProfile.id) || []
            }
          : order
      ));
      
      showToast("🔄 تم سحب عرض السعر بنجاح!", 'info');
      setCustomPrices(prev => ({ ...prev, [orderId]: '' }));
    } catch (error) {
      console.error("Withdraw error:", error);
      Alert.alert("خطأ 🚨", "حصلت مشكلة أثناء سحب العرض.");
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  };
  
  const handlePriceChange = (orderId, value) => {
    setCustomPrices(prev => ({ ...prev, [orderId]: value }));
  };

  const openInGoogleMaps = (lat, lng) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
    
    Linking.openURL(url).catch(() => {
      if (Platform.OS === 'ios') {
        const iosUrl = `http://maps.apple.com/?daddr=${lat},${lng}`;
        Linking.openURL(iosUrl).catch(() => {
          Alert.alert("خطأ 🚨", "لا يمكن فتح تطبيق الخرائط.");
        });
      } else {
        Alert.alert("خطأ 🚨", "لا يمكن فتح تطبيق الخرائط.");
      }
    });
  };

  const formatFirebaseDate = (timestamp) => {
    if (!timestamp) return 'غير محدد';
    
    if (timestamp?.seconds) {
      return new Date(timestamp.seconds * 1000).toLocaleString('ar-EG');
    }
    
    if (timestamp.toDate) {
      return timestamp.toDate().toLocaleString('ar-EG');
    }
    
    try {
      return new Date(timestamp).toLocaleString('ar-EG');
    } catch {
      return 'غير محدد';
    }
  };

  // ⭐ دالة مساعدة لاستخراج تاريخ حقيقي (Date) من completedAt بغض النظر عن شكله
  // (Firestore Timestamp له .seconds أو .toDate، وأحياناً بيوصل كـ string/Date عادي)
  const getCompletedDate = (timestamp) => {
    if (!timestamp) return null;
    if (timestamp?.seconds) return new Date(timestamp.seconds * 1000);
    if (timestamp.toDate) return timestamp.toDate();
    try {
      const d = new Date(timestamp);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
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

  const availableOrders = localOrders.filter(order => 
    (!order.status || order.status === 'pending') &&
    !rejectedOrders.includes(order.id)
  );
  
  const myCompletedHistory = localOrders.filter(
    order => order.status === 'completed' && 
              order.runnerId === runnerProfile?.id && 
              !order.runnerDismissed
  );

  const totalEarnings = myCompletedHistory.reduce((sum, order) => {
    const fee = parseFloat(order.deliveryFee) || 0;
    return sum + fee;
  }, 0);

  // ⭐ إضافة جديدة: حساب الأرباح (يومي/أسبوعي/شهري/إجمالي كل الوقت)
  // ⭐ بيعتمد على *كل* الطلبات المكتملة بتاعة المندوب بغض النظر عن إخفائها (runnerDismissed)
  // ⭐ عشان الإجمالي الحقيقي مايقلش لما المندوب يخفي طلبات قديمة من شاشته
  const allCompletedOrdersEver = localOrders.filter(
    order => order.status === 'completed' && order.runnerId === runnerProfile?.id
  );

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // آخر 7 أيام شاملة النهاردة
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let dailyEarnings = 0;
  let weeklyEarnings = 0;
  let monthlyEarnings = 0;
  let allTimeEarnings = 0;

  allCompletedOrdersEver.forEach(order => {
    const fee = parseFloat(order.deliveryFee) || 0;
    allTimeEarnings += fee;

    const completedDate = getCompletedDate(order.completedAt);
    if (!completedDate) return;

    if (completedDate >= startOfToday) dailyEarnings += fee;
    if (completedDate >= sevenDaysAgo) weeklyEarnings += fee;
    if (completedDate >= startOfMonth) monthlyEarnings += fee;
  });
  
  const isRunnerBusy = myOrders.length > 0;

  return (
    <SafeAreaView style={styles.container}>
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
          <Text style={styles.headerTitle}>مرحباً {runnerProfile?.name}</Text>
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

      <View style={styles.tabSwitcher}>
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'available' && styles.activeTabBtn]} 
          onPress={() => setActiveTab('available')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'available' && styles.activeTabBtnText]}>
            📥 السوق ({availableOrders.length})
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'my-orders' && styles.activeTabBtn]} 
          onPress={() => setActiveTab('my-orders')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'my-orders' && styles.activeTabBtnText]}>
            🏍️ الحالية ({myOrders.length})
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'history' && styles.activeTabHistoryBtn]} 
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabBtnText, activeTab === 'history' && styles.activeTabBtnText]}>
            📦 شغلي السابق ({myCompletedHistory.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContainer} 
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'available' && (
          <View style={styles.tabContent}>
            <Text style={[styles.sectionTitle, { textAlign: 'Auto' }]}>الطلبات المتاحة الآن:</Text>
            
            {isLoadingRatings && (
              <View style={styles.loadingRatingsCard}>
                <ActivityIndicator size="small" color="#F9A825" />
                <Text style={styles.loadingRatingsText}>جاري تحميل التقييمات...</Text>
              </View>
            )}
            
            {!isLoadingRatings && hasUnratedCompletedOrders() && (
              <View style={styles.ratingAlertCard}>
                <Text style={styles.ratingAlertTitle}>⚠️ تنبيه تقييمات</Text>
                <Text style={styles.ratingAlertDesc}>
                  لديك طلبات مكتملة لم تقم بتقييم عملائها بعد. يجب التقييم أولاً.
                </Text>
                <TouchableOpacity 
                  style={styles.ratingAlertBtn}
                  onPress={() => setActiveTab('history')}
                >
                  <Text style={styles.ratingAlertBtnText}>الذهاب للتقييمات ←</Text>
                </TouchableOpacity>
              </View>
            )}
            
            {isRunnerBusy ? (
              <View style={styles.busyCard}>
                <Text style={styles.busyTitle}>⚠️ عفواً يا كابتن {runnerProfile?.name}!</Text>
                <Text style={styles.busyDesc}>لا يمكنك تقديم عروض جديدة لأن لديك طلب جاري توصيله.</Text>
                <Text style={styles.busySub}>قم بإنهاء الطلب الحالي أولاً.</Text>
              </View>
            ) : hasUnratedCompletedOrders() ? (
              <Text style={styles.emptyText}>يجب تقييم العملاء أولاً. راجع شغلك السابق 👆</Text>
            ) : availableOrders.length === 0 ? (
              <Text style={styles.emptyText}>لا توجد طلبات جديدة حالياً! ☕</Text>
            ) : (
              availableOrders.map((order) => {
                const myExistingOffer = Array.isArray(order.offers) 
                  ? order.offers.find(offer => offer.runnerId === runnerProfile?.id) 
                  : null;
                const hasSubmittedOffer = !!myExistingOffer;
                const clientRating = clientRatings[order.requesterId];

                return (
                  <View key={order.id} style={[
                    styles.orderCard, 
                    { 
                      borderRightColor: hasSubmittedOffer ? '#e67e22' : '#6C1B8D',
                      backgroundColor: hasSubmittedOffer ? '#fffcf9' : '#fff'
                    }
                  ]}>
                    {clientRating && clientRating.totalRatings > 0 && (
                      <View style={styles.clientRatingRow}>
                        <Text style={styles.clientRatingLabel}>تقييم العميل:</Text>
                        <StarsDisplay rating={clientRating.average} size={12} />
                      </View>
                    )}
                    
                    <Text style={styles.orderItem}>
                      <Text style={{ fontWeight: 'bold', textAlign: 'Auto'}}>📦 الطلب:</Text> {order.itemDescription}
                    </Text>
                    <Text style={styles.orderFee}>
                      <Text style={{ fontWeight: 'bold', textAlign: 'Auto'}}>💰 قيمة التوصيل:</Text> 
                      <Text style={styles.feeBadge}>{order.deliveryFee} جنيه</Text>
                    </Text>
                    
                    {hasSubmittedOffer && (
                      <View style={styles.submittedOfferBox}>
                        <Text style={[styles.submittedOfferText, { textAlign: 'center' }]}>
                          ⏳ أنت قدمت عرضاً بقيمة: {myExistingOffer.proposedPrice} جنيه
                        </Text>
                      </View>
                    )}

                    <View style={styles.addressBox}>
                      <Text style={[styles.addressTitle, { textAlign: 'Auto'}]}>📍 مكان التوصيل:</Text>
                      <Text style={[styles.addressText, { textAlign: 'Auto'}]}>
                        {order.clientLocation 
                          ? (addresses[order.id] || "🔄 جاري قراءة العنوان...") 
                          : "العميل لم يحدد موقع ❌"}
                      </Text>
                    </View>

                    <View style={styles.actionsContainer}>
                      {!hasSubmittedOffer && (
                        <TouchableOpacity 
                          style={styles.acceptBtn} 
                          disabled={isProcessing} 
                          onPress={() => handleAccept(order.id)}
                        >
                          <Text style={styles.acceptBtnText}>
                            {isProcessing ? "جاري القبول..." : "قبول بالسعر الحالي 🚀"}
                          </Text>
                        </TouchableOpacity>
                      )}

                      <View style={styles.bidRow}>
                        <TextInput 
                          style={[
                            styles.priceInput, 
                            { textAlign: 'center' },
                            hasSubmittedOffer && { backgroundColor: '#e0e0e0' }
                          ]}
                          keyboardType="numeric"
                          placeholder="اكتب سعرك..."
                          value={hasSubmittedOffer ? String(myExistingOffer.proposedPrice) : (customPrices[order.id] || '')}
                          onChangeText={(val) => handlePriceChange(order.id, val)}
                          editable={!(isProcessing || hasSubmittedOffer)}
                        />
                        {hasSubmittedOffer ? (
                          <TouchableOpacity 
                            style={styles.withdrawBtn} 
                            disabled={isProcessing} 
                            onPress={() => handleWithdrawOffer(order.id)}
                          >
                            <Text style={styles.btnText}>إلغاء العرض 🗑️</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity 
                            style={styles.counterBtn} 
                            disabled={isProcessing} 
                            onPress={() => handleCounterOffer(order.id)}
                          >
                            <Text style={styles.btnText}>تقديم عرض 💰</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {activeTab === 'my-orders' && (
          <View style={styles.tabContent}>
            <Text style={[styles.sectionTitle, { textAlign: 'Auto' }]}>طلباتك الجاري توصيلها:</Text>
            {myOrders.length === 0 ? (
              <Text style={styles.emptyText}>مفيش طلبات في إيدك حالياً. 🦾</Text>
            ) : (
              myOrders.map((order) => (
                <View key={order.id} style={[
                  styles.orderCard, 
                  { 
                    borderRightColor: order.status === 'runner_delivered' ? '#F9A825' : '#2ecc71' 
                  }
                ]}>
                  <Text style={styles.orderItem}>
                    <Text style={{ fontWeight: 'bold', textAlign: 'auto' }}>📦 الطلب:</Text> {order.itemDescription}
                  </Text>
                  <Text style={styles.orderFee}>
                    <Text style={{ fontWeight: 'bold', textAlign: 'auto' }}>💰 القيمة المعتمدة:</Text> 
                    <Text style={[styles.feeBadge, { backgroundColor: order.status === 'runner_delivered' ? '#F9A825' : '#2ecc71' }]}>
                      {order.deliveryFee} جنيه
                    </Text>
                  </Text>
                  
                  <View style={[styles.addressBox, { backgroundColor: '#F8F0FA' }]}>
                    <Text style={[styles.addressTitle, { color: '#6C1B8D' }]}>
                      📍 عنوان العميل:
                    </Text>
                    <Text style={[styles.addressText, { color: '#6C1B8D', textAlign: 'auto' }]}>
                      {addresses[order.id] || "🔄 جاري قراءة العنوان..."}
                    </Text>
                  </View>

                  <View style={styles.runnerActionsRow}>
                    {order.clientLocation && (
                      <TouchableOpacity 
                        style={styles.mapsBtn} 
                        onPress={() => openInGoogleMaps(
                          order.clientLocation.latitude, 
                          order.clientLocation.longitude
                        )}
                      >
                        <Text style={styles.btnText}>🗺️ الخريطة</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity 
                      style={[styles.releaseBtn, (isProcessing || order.status === 'runner_delivered') && { opacity: 0.5 }]} 
                      disabled={isProcessing || order.status === 'runner_delivered'} 
                      onPress={() => handleRelease(order.id)}
                    >
                      <Text style={styles.btnText}>❌ كنسل</Text>
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      style={[styles.completeBtn, { backgroundColor: order.status === 'runner_delivered' ? '#d35400' : '#6C1B8D' }]} 
                      disabled={isProcessing || order.status === 'runner_delivered'} 
                      onPress={() => handleCompleteOrder(order.id)}
                    >
                      <Text style={styles.btnText}>
                        {isProcessing ? "جاري الحفظ..." : order.status === 'runner_delivered' ? "⏳ مستني العميل" : "✅ وصلت للبيت"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.tabContent}>
            <View style={styles.earningsCard}>
              <Text style={styles.earningsTitle}>💰 إجمالي أرباحك: {totalEarnings} جنيه</Text>
              <Text style={styles.earningsSub}>* الطلبات المكتملة الظاهرة حالياً في القائمة تحت (قبل إخفائها).</Text>
            </View>

            {/* ⭐ كروت الأرباح الجديدة: يومي / أسبوعي / شهري / إجمالي كل الوقت */}
            {/* ⭐ دي بتحسب من كل الطلبات المكتملة فعلياً بغض النظر عن الإخفاء */}
            <View style={styles.earningsSummaryRow}>
              <View style={styles.earningsSummaryCard}>
                <Text style={styles.earningsSummaryLabel}>اليوم</Text>
                <Text style={styles.earningsSummaryValue}>{dailyEarnings}</Text>
                <Text style={styles.earningsSummaryUnit}>جنيه</Text>
              </View>
              <View style={styles.earningsSummaryCard}>
                <Text style={styles.earningsSummaryLabel}>آخر 7 أيام</Text>
                <Text style={styles.earningsSummaryValue}>{weeklyEarnings}</Text>
                <Text style={styles.earningsSummaryUnit}>جنيه</Text>
              </View>
              <View style={styles.earningsSummaryCard}>
                <Text style={styles.earningsSummaryLabel}>الشهر</Text>
                <Text style={styles.earningsSummaryValue}>{monthlyEarnings}</Text>
                <Text style={styles.earningsSummaryUnit}>جنيه</Text>
              </View>
              <View style={[styles.earningsSummaryCard, styles.earningsSummaryCardTotal]}>
                <Text style={styles.earningsSummaryLabel}>الإجمالي الكلي</Text>
                <Text style={styles.earningsSummaryValue}>{allTimeEarnings}</Text>
                <Text style={styles.earningsSummaryUnit}>جنيه</Text>
              </View>
            </View>

            {isLoadingRatings && (
              <View style={styles.loadingRatingsCard}>
                <ActivityIndicator size="small" color="#F9A825" />
                <Text style={styles.loadingRatingsText}>جاري تحميل التقييمات...</Text>
              </View>
            )}

            <Text style={[styles.sectionTitle, { textAlign: 'auto' }]}>الطلبات المكتملة:</Text>
            {myCompletedHistory.length === 0 ? (
              <Text style={styles.emptyText}>سجل الطلبات المكتملة فارغ. 📭</Text>
            ) : (
              myCompletedHistory.map((order) => {
                const isRated = ratedOrders.has(order.id);
                
                return (
                  <View key={order.id} style={[
                    styles.orderCard, 
                    { borderRightColor: isRated ? '#27ae60' : '#F9A825' }
                  ]}>
                    <Text style={styles.orderItem}>
                      <Text style={{ fontWeight: 'bold', textAlign: 'auto' }}>📦 الطلب:</Text> {order.itemDescription}
                    </Text>
                    <Text style={styles.orderFee}>
                      <Text style={{ fontWeight: 'bold', textAlign: 'auto' }}>💰 صافي حسابك: </Text> 
                      <Text style={{ color: '#27ae60', fontWeight: 'bold', textAlign: 'auto' }}>{order.deliveryFee} جنيه</Text>
                    </Text>
                    <Text style={[styles.dateText, { textAlign: 'auto' }]}>
                      ⏱️ اكتمل بتاريخ: {formatFirebaseDate(order.completedAt)}
                    </Text>
                    
                    {!isRated && !isLoadingRatings && (
                      <>
                        <TouchableOpacity 
                          style={[styles.actionBtn, { backgroundColor: '#F9A825', marginBottom: 8 }]} 
                          onPress={() => handleRateClient(order.id, order.requesterId, order.clientName)}
                          disabled={isProcessing}
                        >
                          <Text style={styles.actionBtnText}>⭐ قيم العميل (مطلوب)</Text>
                        </TouchableOpacity>
                        <Text style={styles.ratingRequiredText}>
                          ⚠️ التقييم مطلوب قبل إخفاء الطلب
                        </Text>
                      </>
                    )}
                    
                    {isRated && (
                      <View style={styles.ratedBadge}>
                        <Text style={styles.ratedBadgeText}>✅ تم التقييم</Text>
                      </View>
                    )}
                    
                    <TouchableOpacity 
                      style={[styles.dismissBtn, !isRated && styles.dismissBtnDisabled]} 
                      disabled={isProcessing || !isRated} 
                      onPress={() => handleDismissOrderFromHistory(order.id)}
                    >
                      <Text style={[styles.dismissBtnText, !isRated && styles.dismissBtnTextDisabled]}>
                        🗑️ إخفاء الكارت
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      <RatingModal
        visible={showRatingModal}
        onClose={() => {}}
        onSubmit={handleSubmitClientRating}
        title="قيم العميل ⭐"
        subtitle="كيف كانت تجربتك مع"
        ratedPersonName={ratedClientName || "العميل"}
        required={true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : StatusBar.currentHeight + 5,
    paddingBottom: 20,
    backgroundColor: '#6C1B8D',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    elevation: 4,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  headerLeft: {
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  myRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  myRatingCount: {
    fontSize: 10,
    color: '#FFD700',
    fontWeight: '600',
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
  tabSwitcher: { 
    flexDirection: 'row',
    backgroundColor: '#F0E6F5',
    padding: 4, 
    borderRadius: 14, 
    margin: 15,
    borderWidth: 1,
    borderColor: '#D4B8E0',
  },
  tabBtn: { 
    flex: 1, 
    paddingVertical: 10, 
    alignItems: 'center', 
    borderRadius: 10,
    marginHorizontal: 2,
  },
  activeTabBtn: { 
    backgroundColor: '#6C1B8D',
    elevation: 2,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  activeTabHistoryBtn: { 
    backgroundColor: '#2ecc71' 
  },
  tabBtnText: { 
    fontSize: 12, 
    fontWeight: 'bold', 
    color: '#6C1B8D',
  },
  activeTabBtnText: { 
    color: '#FFFFFF',
  },
  scrollContainer: { 
    paddingHorizontal: 15, 
    paddingBottom: 20 
  },
  tabContent: { 
    alignItems: 'stretch' 
  },
  sectionTitle: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: '#6C1B8D',
    textAlign: 'right', 
    marginBottom: 15 
  },
  orderCard: { 
    backgroundColor: '#fff', 
    padding: 15, 
    borderRadius: 8, 
    marginBottom: 15, 
    borderRightWidth: 5, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 3, 
    elevation: 2 
  },
  clientRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 8,
    gap: 6,
  },
  clientRatingLabel: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
  },
  orderItem: { 
    fontSize: 15, 
    color: '#333', 
    textAlign: 'right', 
    marginBottom: 6 
  },
  orderFee: { 
    fontSize: 14, 
    color: '#666', 
    textAlign: 'right', 
    marginBottom: 10 
  },
  feeBadge: { 
    fontWeight: 'bold', 
    color: '#6C1B8D',
  },
  addressBox: { 
    backgroundColor: '#f4f6f6', 
    padding: 10, 
    borderRadius: 8, 
    marginBottom: 12, 
    borderWidth: 1, 
    borderColor: '#ddd' 
  },
  addressTitle: { 
    fontSize: 13, 
    fontWeight: 'bold', 
    color: '#555', 
    textAlign: 'right', 
    marginBottom: 3 
  },
  addressText: { 
    fontSize: 13, 
    color: '#666', 
    textAlign: 'right', 
    lineHeight: 18 
  },
  submittedOfferBox: { 
    backgroundColor: '#fff2e6', 
    borderColor: '#ffcc99', 
    borderWidth: 1, 
    padding: 10, 
    borderRadius: 6, 
    marginVertical: 8 
  },
  submittedOfferText: { 
    color: '#d35400', 
    fontSize: 13, 
    fontWeight: 'bold', 
    textAlign: 'right' 
  },
  actionsContainer: { 
    flexDirection: 'column',
  },
  acceptBtn: { 
    backgroundColor: '#6C1B8D',
    padding: 12, 
    borderRadius: 8, 
    alignItems: 'center',
    marginBottom: 8,
    elevation: 2,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  acceptBtnText: { 
    color: '#fff', 
    fontSize: 14, 
    fontWeight: 'bold' 
  },
  bidRow: { 
    flexDirection: 'row-reverse', 
    alignItems: 'center',
  },
  priceInput: { 
    flex: 1, 
    backgroundColor: '#fff', 
    borderWidth: 1, 
    borderColor: '#D4B8E0',
    borderRadius: 8, 
    padding: 10, 
    textAlign: 'left',
    writingDirection: 'ltr',
    fontWeight: 'bold', 
    fontSize: 14, 
    height: 44,
    marginHorizontal: 4,
  },
  counterBtn: { 
    backgroundColor: '#9B4DCA',
    paddingVertical: 12, 
    paddingHorizontal: 15, 
    borderRadius: 8, 
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#9B4DCA',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  withdrawBtn: { 
    backgroundColor: '#e74c3c', 
    paddingVertical: 12, 
    paddingHorizontal: 15, 
    borderRadius: 8, 
    justifyContent: 'center' 
  },
  btnText: { 
    color: '#fff', 
    fontSize: 13, 
    fontWeight: 'bold', 
    textAlign: 'center' 
  },
  runnerActionsRow: { 
    flexDirection: 'row-reverse',
  },
  mapsBtn: { 
    flex: 1, 
    backgroundColor: '#3498db', 
    padding: 11, 
    borderRadius: 6,
    marginHorizontal: 3,
  },
  releaseBtn: { 
    flex: 1, 
    backgroundColor: '#e74c3c', 
    padding: 11, 
    borderRadius: 6,
    marginHorizontal: 3,
  },
  completeBtn: { 
    flex: 1.5, 
    padding: 11, 
    borderRadius: 6, 
    justifyContent: 'center',
    marginHorizontal: 3,
  },
  busyCard: { 
    backgroundColor: '#fdf2e9', 
    borderWidth: 2, 
    borderColor: '#F9A825',
    borderStyle: 'dashed', 
    padding: 20, 
    borderRadius: 12, 
    alignItems: 'center', 
    marginTop: 15 
  },
  busyTitle: { 
    color: '#d35400', 
    fontWeight: 'bold', 
    fontSize: 15, 
    marginBottom: 5 
  },
  busyDesc: { 
    color: '#d35400', 
    fontSize: 13, 
    textAlign: 'center', 
    marginBottom: 5 
  },
  busySub: { 
    color: '#7f8c8d', 
    fontSize: 12, 
    textAlign: 'center' 
  },
  emptyText: { 
    textAlign: 'center', 
    color: '#999', 
    fontSize: 14, 
    padding: 30 
  },
  earningsCard: { 
    backgroundColor: '#ebf5fb', 
    borderColor: '#a9dfbf', 
    borderWidth: 1, 
    padding: 15, 
    borderRadius: 10, 
    marginBottom: 20, 
    alignItems: 'center' 
  },
  earningsTitle: { 
    color: '#27ae60', 
    fontWeight: 'bold', 
    fontSize: 15, 
    marginBottom: 4 
  },
  earningsSub: { 
    color: '#7f8c8d', 
    fontSize: 11 
  },
  // ⭐ ستايلات جديدة لكروت الأرباح الأربعة (يومي/أسبوعي/شهري/إجمالي)
  earningsSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  earningsSummaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#eee',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  earningsSummaryCardTotal: {
    backgroundColor: '#F8F0FA',
    borderColor: '#D4B8E0',
  },
  earningsSummaryLabel: {
    fontSize: 11,
    color: '#7f8c8d',
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'center',
  },
  earningsSummaryValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#6C1B8D',
  },
  earningsSummaryUnit: {
    fontSize: 10,
    color: '#9B4DCA',
    marginTop: 1,
  },
  dateText: { 
    fontSize: 12, 
    color: '#95a5a6', 
    textAlign: 'right', 
    marginVertical: 5 
  },
  actionBtn: { 
    width: '100%',
    padding: 12, 
    borderRadius: 8, 
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { 
    color: '#fff', 
    fontSize: 14, 
    fontWeight: 'bold' 
  },
  dismissBtn: { 
    width: '100%', 
    marginTop: 10, 
    padding: 10, 
    backgroundColor: '#f2f4f4', 
    borderWidth: 1, 
    borderColor: '#ccc', 
    borderRadius: 6 
  },
  dismissBtnDisabled: {
    backgroundColor: '#e0e0e0',
    borderColor: '#ccc',
    opacity: 0.5,
  },
  dismissBtnText: { 
    color: '#7f8c8d', 
    fontWeight: 'bold', 
    fontSize: 12, 
    textAlign: 'center' 
  },
  dismissBtnTextDisabled: {
    color: '#bbb',
  },
  loadingRatingsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    padding: 12,
    marginBottom: 15,
    gap: 10,
  },
  loadingRatingsText: {
    color: '#F57F17',
    fontSize: 13,
    fontWeight: '600',
  },
  ratingAlertCard: {
    backgroundColor: '#FFF3CD',
    borderWidth: 1,
    borderColor: '#F9A825',
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    alignItems: 'center',
  },
  ratingAlertTitle: {
    color: '#D35400',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 5,
  },
  ratingAlertDesc: {
    color: '#856404',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 18,
  },
  ratingAlertBtn: {
    backgroundColor: '#F9A825',
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  ratingAlertBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  ratingRequiredText: {
    color: '#E74C3C',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 5,
  },
  ratedBadge: {
    backgroundColor: '#D5F5E3',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    alignSelf: 'center',
    marginBottom: 8,
  },
  ratedBadgeText: {
    color: '#27AE60',
    fontWeight: 'bold',
    fontSize: 12,
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