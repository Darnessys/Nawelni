import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  TextInput, 
  ScrollView, 
  ActivityIndicator, 
  Alert, 
  SafeAreaView, 
  Linking,
  Platform,
  StatusBar
} from 'react-native';
import * as Location from 'expo-location';
import { acceptOrder, cancelOrderAcceptance, submitCounterOffer, withdrawCounterOffer, completeOrder } from '../../services/OrderService'; 
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebaseConfig';
import { useAuth } from '../../src/features/auth/context/AuthContext';

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

  useEffect(() => {
    if (isMountedRef.current) {
      setLocalOrders(pendingOrders);
    }
  }, [pendingOrders]);

  const getRunnerLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("تنبيه ⚠️", "تم رفض صلاحية الموقع.");
        return null;
      }
      const location = await Location.getCurrentPositionAsync({ 
        accuracy: Location.Accuracy.High 
      });
      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      };
    } catch (error) {
      console.error("GPS Error:", error);
      return null;
    }
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
      
      try {
        const apiKey = process.env.LOCATIONIQ_API_KEY;
        if (apiKey) {
          const response = await fetch(
            `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lng}&format=json&accept-language=ar`
          );
          const data = await response.json();
          if (isMountedRef.current) {
            setAddresses(prev => ({ ...prev, [orderId]: data.display_name || "📍 تم تحديد الموقع" }));
          }
          return;
        }
      } catch (fallbackError) {
        console.error("Fallback error:", fallbackError);
      }
      
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

  // ===== Handlers =====
  
  const handleAccept = async (orderId) => {
    if (isProcessing || !isMountedRef.current) return;
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

  const handleDismissOrderFromHistory = (orderId) => {
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
  
  const myOrders = localOrders.filter(
    order => (order.status === 'accepted' || order.status === 'runner_delivered') && 
              order.runnerId === runnerProfile?.id
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
        <Text style={styles.headerTitle}>مرحباً {runnerProfile?.name}</Text>
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
            <Text style={styles.sectionTitle}>طلبات متاحة في الرادار:</Text>
            
            {isRunnerBusy ? (
              <View style={styles.busyCard}>
                <Text style={styles.busyTitle}>⚠️ عفواً يا كابتن {runnerProfile?.name}!</Text>
                <Text style={styles.busyDesc}>لا يمكنك تقديم عروض جديدة لأن لديك طلب جاري توصيله.</Text>
                <Text style={styles.busySub}>قم بإنهاء الطلب الحالي أولاً.</Text>
              </View>
            ) : availableOrders.length === 0 ? (
              <Text style={styles.emptyText}>لا توجد طلبات جديدة حالياً! ☕</Text>
            ) : (
              availableOrders.map((order) => {
                const myExistingOffer = Array.isArray(order.offers) 
                  ? order.offers.find(offer => offer.runnerId === runnerProfile?.id) 
                  : null;
                const hasSubmittedOffer = !!myExistingOffer;

                return (
                  <View key={order.id} style={[
                    styles.orderCard, 
                    { 
                      borderRightColor: hasSubmittedOffer ? '#e67e22' : '#6C1B8D',
                      backgroundColor: hasSubmittedOffer ? '#fffcf9' : '#fff'
                    }
                  ]}>
                    <Text style={styles.orderItem}>
                      <Text style={{ fontWeight: 'bold' }}>📦 الطلب:</Text> {order.itemDescription}
                    </Text>
                    <Text style={styles.orderFee}>
                      <Text style={{ fontWeight: 'bold' }}>💰 قيمة التوصيل:</Text> 
                      <Text style={styles.feeBadge}>{order.deliveryFee} جنيه</Text>
                    </Text>
                    
                    {hasSubmittedOffer && (
                      <View style={styles.submittedOfferBox}>
                        <Text style={styles.submittedOfferText}>
                          ⏳ أنت قدمت عرضاً بقيمة: {myExistingOffer.proposedPrice} جنيه
                        </Text>
                      </View>
                    )}

                    <View style={styles.addressBox}>
                      <Text style={styles.addressTitle}>📍 مكان التوصيل:</Text>
                      <Text style={styles.addressText}>
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
                          style={[styles.priceInput, hasSubmittedOffer && { backgroundColor: '#e0e0e0' }]}
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
            <Text style={styles.sectionTitle}>طلباتك الجاري توصيلها:</Text>
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
                    <Text style={{ fontWeight: 'bold' }}>📦 الطلب:</Text> {order.itemDescription}
                  </Text>
                  <Text style={styles.orderFee}>
                    <Text style={{ fontWeight: 'bold' }}>💰 القيمة المعتمدة:</Text> 
                    <Text style={[styles.feeBadge, { backgroundColor: order.status === 'runner_delivered' ? '#F9A825' : '#2ecc71' }]}>
                      {order.deliveryFee} جنيه
                    </Text>
                  </Text>
                  
                  <View style={[styles.addressBox, { backgroundColor: '#F8F0FA' }]}>
                    <Text style={[styles.addressTitle, { color: '#6C1B8D' }]}>
                      📍 عنوان العميل:
                    </Text>
                    <Text style={[styles.addressText, { color: '#6C1B8D' }]}>
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
              <Text style={styles.earningsSub}>* الطلبات المكتملة التي تم تأكيدها من العميل.</Text>
            </View>

            <Text style={styles.sectionTitle}>الطلبات المكتملة:</Text>
            {myCompletedHistory.length === 0 ? (
              <Text style={styles.emptyText}>سجل الطلبات المكتملة فارغ. 📭</Text>
            ) : (
              myCompletedHistory.map((order) => (
                <View key={order.id} style={[styles.orderCard, { borderRightColor: '#27ae60' }]}>
                  <Text style={styles.orderItem}>
                    <Text style={{ fontWeight: 'bold' }}>📦 الطلب:</Text> {order.itemDescription}
                  </Text>
                  <Text style={styles.orderFee}>
                    <Text style={{ fontWeight: 'bold' }}>💰 صافي حسابك:</Text> 
                    <Text style={{ color: '#27ae60', fontWeight: 'bold' }}>{order.deliveryFee} جنيه</Text>
                  </Text>
                  <Text style={styles.dateText}>
                    ⏱️ اكتمل بتاريخ: {formatFirebaseDate(order.completedAt)}
                  </Text>
                  
                  <TouchableOpacity 
                    style={styles.dismissBtn} 
                    disabled={isProcessing} 
                    onPress={() => handleDismissOrderFromHistory(order.id)}
                  >
                    <Text style={styles.dismissBtnText}>🗑️ إخفاء الكارت</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
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
  
  tabSwitcher: { 
    flexDirection: 'row-reverse', 
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
    textAlign: 'center', 
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
  dateText: { 
    fontSize: 12, 
    color: '#95a5a6', 
    textAlign: 'right', 
    marginVertical: 5 
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
  dismissBtnText: { 
    color: '#7f8c8d', 
    fontWeight: 'bold', 
    fontSize: 12, 
    textAlign: 'center' 
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