import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert,
  ScrollView,
  Platform,
  StatusBar
} from 'react-native';
import { db, auth } from '../../src/core/config/firebase'; 
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'; 
import { 
  updateOrderWithCounterPrice, 
  rejectCounterOffer, 
  cancelOrderEntirely, 
  completeOrder 
} from '../../services/OrderService';
import { useAuth } from '../../src/features/auth/context/AuthContext';
import RatingModal from '../RatingModal';
import { submitRating, hasUserRatedOrder, getUserAverageRating } from '../../services/RatingService';

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

export default function OrderBidding({ 
  currentOrderId, 
  setCurrentOrderId, 
  onOrderFinished,
  onReset
}) {
  const { logout } = useAuth();
  
  const [orderStatus, setOrderStatus] = useState('waiting');
  const [offersList, setOffersList] = useState([]);
  const [runnerInfo, setRunnerInfo] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  const isReturningRef = useRef(false);
  const isMountedRef = useRef(true);
  const toastTimerRef = useRef(null);

  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const [showRatingModal, setShowRatingModal] = useState(false);
  const [ratedRunnerId, setRatedRunnerId] = useState(null);
  const [ratedRunnerName, setRatedRunnerName] = useState("");
  const [hasRated, setHasRated] = useState(false);
  const [isCheckingRating, setIsCheckingRating] = useState(false);

  const [runnerRatings, setRunnerRatings] = useState({});

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
    if (offersList.length === 0) return;

    const fetchRunnerRatings = async () => {
      const ratings = {};
      
      for (const offer of offersList) {
        const runnerId = offer.runnerId;
        if (!runnerId || ratings[runnerId]) continue;
        
        try {
          const ratingData = await getUserAverageRating(runnerId);
          ratings[runnerId] = ratingData;
        } catch (error) {
          console.error(`Error fetching rating for runner ${runnerId}:`, error);
        }
      }
      
      if (isMountedRef.current) {
        setRunnerRatings(ratings);
      }
    };

    fetchRunnerRatings();
  }, [offersList.length]);

  const checkIfAlreadyRated = useCallback(async (orderId, runnerId) => {
    if (!orderId || !auth.currentUser?.uid) return false;
    
    setIsCheckingRating(true);
    
    try {
      const alreadyRated = await hasUserRatedOrder(orderId, auth.currentUser.uid, "client_to_runner");
      
      if (isMountedRef.current) {
        setHasRated(alreadyRated);
        setIsCheckingRating(false);
        
        if (alreadyRated) {
          console.log("✅ العميل قيم الكابتن بالفعل - مسموح بطلب جديد");
        } else {
          console.log("⚠️ العميل ما قيمش الكابتن - فتح RatingModal");
          setRatedRunnerId(runnerId);
          setTimeout(() => {
            if (isMountedRef.current) {
              setShowRatingModal(true);
            }
          }, 500);
        }
      }
      
      return alreadyRated;
    } catch (error) {
      console.error("Error checking rating:", error);
      if (isMountedRef.current) {
        setIsCheckingRating(false);
      }
      return false;
    }
  }, []);

  useEffect(() => {
    if (!currentOrderId) {
      if (isMountedRef.current) {
        setOrderStatus('waiting');
        setOffersList([]);
        setRunnerInfo(null);
        setHasRated(false);
        setShowRatingModal(false);
      }
      return;
    }

    console.log(`👀 بدء مراقبة الطلب: ${currentOrderId}`);

    const unsubscribe = onSnapshot(
      doc(db, "orders", currentOrderId), 
      (docSnap) => {
        if (!isMountedRef.current) return;
        
        if (!docSnap.exists()) {
          console.log("📄 الـ Document غير موجود، جاري العودة...");
          handleBackToStart();
          return;
        }

        const data = docSnap.data();
        console.log(`📦 تحديث حالة الطلب: ${data.status}`);
        
        if (data.status === 'cancelled') {
          console.log("🔄 تم اكتشاف إلغاء الطلب من السيرفر، جاري العودة للرئيسية...");
          showToast("🔄 تم إلغاء هذا الطلب بنجاح", 'info');
          handleBackToStart();
          return;
        }

        if (data.status === 'pending') {
          setOrderStatus('waiting');
          setOffersList(data.offers || []); 
          setRunnerInfo(null);
        }
        
        if (data.status === 'accepted') {
          setOrderStatus('accepted');
          setOffersList([]);
          setRunnerInfo({
            id: data.runnerId || '',
            location: data.runnerLocation || '',
            finalPrice: data.deliveryFee || 0,
            runnerName: data.runnerName || "الكابتن"
          });
        }

        if (data.status === 'runner_delivered') {
          setOrderStatus('runner_delivered');
          setOffersList([]);
          setRunnerInfo({
            id: data.runnerId || '',
            finalPrice: data.deliveryFee || 0,
            runnerName: data.runnerName || "الكابتن"
          });
        }

        if (data.status === 'completed') {
          setOrderStatus('completed');
          setOffersList([]);
          
          const runnerData = {
            id: data.runnerId || '',
            finalPrice: data.deliveryFee || 0,
            runnerName: data.runnerName || "الكابتن"
          };
          setRunnerInfo(runnerData);
          
          if (!hasRated) {
            setRatedRunnerId(runnerData.id);
            setRatedRunnerName(runnerData.runnerName);
            checkIfAlreadyRated(currentOrderId, runnerData.id);
          }
        }
      },
      (error) => {
        console.error("❌ Snapshot error:", error);
        if (isMountedRef.current) {
          Alert.alert("خطأ", "حدثت مشكلة في الاتصال بقاعدة البيانات");
        }
      }
    );

    return () => {
      console.log(`👋 إلغاء مراقبة الطلب: ${currentOrderId}`);
      unsubscribe();
      isReturningRef.current = false;
    };
  }, [currentOrderId]);

  const handleAcceptRunnerOffer = async (proposedPrice, runnerId) => {
    if (isProcessingRef.current || !isMountedRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    
    try {
      await updateOrderWithCounterPrice(currentOrderId, proposedPrice, runnerId);
      showToast("✅ تم قبول العرض وتأكيد الكابتن بنجاح!", 'success');
    } catch (error) {
      console.error("Accept offer error:", error);
      Alert.alert("خطأ 🚨", "خطأ في اعتماد السعر، يرجى المحاولة مجدداً.");
    } finally {
      if (isMountedRef.current) {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    }
  };

  const handleRejectRunnerOffer = async (runnerIdToReject) => {
    if (isProcessingRef.current || !isMountedRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    
    try {
      setOffersList(prev => prev.filter(offer => offer.runnerId !== runnerIdToReject));
      await rejectCounterOffer(currentOrderId, runnerIdToReject);
      showToast("✅ تم رفض العرض بنجاح", 'info');
    } catch (error) {
      console.error("Reject offer error:", error);
      Alert.alert("خطأ 🚨", "خطأ في إلغاء العرض.");
    } finally {
      if (isMountedRef.current) {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    }
  };

  const handleConfirmReceipt = async () => {
    if (isProcessingRef.current || !isMountedRef.current) return;
    isProcessingRef.current = true;
    setIsProcessing(true);
    
    try {
      await completeOrder(currentOrderId); 
      showToast("🎉 تم تأكيد الاستلام بنجاح، بالهنا والشفا!", 'success');
    } catch (error) {
      console.error("Confirm receipt error:", error);
      Alert.alert("خطأ 🚨", "حصلت مشكلة أثناء تأكيد الاستلام.");
    } finally {
      if (isMountedRef.current) {
        isProcessingRef.current = false;
        setIsProcessing(false);
      }
    }
  };

  const handleSubmitRating = async (rating, comment) => {
    if (!currentOrderId || !ratedRunnerId) return;
    
    try {
      await submitRating(
        currentOrderId,
        auth.currentUser?.uid,
        ratedRunnerId,
        rating,
        comment,
        "client_to_runner"
      );
      
      // ⭐ تحديث الطلب: clientDismissed = true
      const orderRef = doc(db, "orders", currentOrderId);
      await updateDoc(orderRef, { clientDismissed: true });
      
      showToast("✅ شكراً لتقييمك! 🌟", 'success');
      setShowRatingModal(false);
      setHasRated(true);
    } catch (error) {
      console.error("Submit rating error:", error);
      if (error.message?.includes('بالفعل')) {
        setShowRatingModal(false);
        setHasRated(true);
        showToast("⚠️ تم تقييم هذا الكابتن مسبقاً", 'info');
      } else {
        Alert.alert("خطأ", "لم نتمكن من حفظ تقييمك. حاول مرة أخرى.");
      }
    }
  };

  const handleCancelMyOrder = () => {
    if (isProcessingRef.current || !isMountedRef.current) {
      console.log("⚠️ Already processing or unmounted");
      return;
    }
    
    if (!currentOrderId) {
      console.warn("⚠️ No order ID to cancel");
      showToast("لا يوجد طلب لإلغائه", 'info');
      return;
    }

    Alert.alert(
      "تأكيد الإلغاء ⚠️",
      "هل أنت متأكد من إلغاء هذا الطلب وسحبه من رادار المناديب؟",
      [
        { text: "تراجع", style: "cancel" },
        { 
          text: "نعم، ألغِ الطلب", 
          style: "destructive",
          onPress: async () => {
            isProcessingRef.current = true;
            setIsProcessing(true);
            try {
              console.log(`🔄 جاري إلغاء الطلب: ${currentOrderId}`);
              await cancelOrderEntirely(currentOrderId);
              console.log("✅ تم تحديث الحالة لـ cancelled بنجاح");
              showToast("✅ تم إلغاء الطلب بنجاح", 'success');
            } catch (error) {
              console.error("❌ Cancel order error:", error);
              Alert.alert("خطأ 🚨", "حصلت مشكلة أثناء إلغاء الطلب.");
            } finally {
              if (isMountedRef.current) {
                isProcessingRef.current = false;
                setIsProcessing(false);
              }
            }
          }
        }
      ]
    );
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

  const handleBackToStart = () => {
    console.log("🔙 العودة للشاشة الرئيسية");
    setOrderStatus('waiting');
    setOffersList([]);
    setRunnerInfo(null);
    setIsProcessing(false);
    isProcessingRef.current = false;
    setHasRated(false);
    setShowRatingModal(false);
    setCurrentOrderId(null);
  };

  // ===== UI =====
  
  if (orderStatus === 'completed') {
    return (
      <View style={styles.container}>
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
          <View />
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>🚪 خروج</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { borderColor: '#2ecc71', borderWidth: 2 }]}>
          <Text style={styles.giantEmoji}>🎉🥳</Text>
          <Text style={[styles.statusTitle, { color: '#2ecc71' }]}>بالهنا والشفا! طلبك وصل بالسلامة</Text>
          <Text style={styles.statusDesc}>تم إنهاء الرحلة وتوصيل الأغراض بنجاح بواسطة الكابتن.</Text>
          
          {isCheckingRating && (
            <View style={styles.checkingRatingCard}>
              <ActivityIndicator size="small" color="#F9A825" />
              <Text style={styles.checkingRatingText}>جاري التحقق من التقييم...</Text>
            </View>
          )}
          
          {!isCheckingRating && !hasRated && (
            <>
              <TouchableOpacity 
                style={[styles.actionBtn, { backgroundColor: '#F9A825', marginBottom: 10 }]} 
                onPress={() => setShowRatingModal(true)}
              >
                <Text style={styles.actionBtnText}>⭐ قيم الكابتن للمتابعة</Text>
              </TouchableOpacity>
              <Text style={styles.ratingNotice}>
                ⚠️ يجب تقييم الكابتن للمتابعة إلى طلب جديد
              </Text>
            </>
          )}
          
          {!isCheckingRating && hasRated && (
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#2ecc71' }]} onPress={handleBackToStart}>
              <Text style={styles.actionBtnText}>عمل طلب جديد 🛒</Text>
            </TouchableOpacity>
          )}
        </View>

        <RatingModal
          visible={showRatingModal}
          onClose={() => {}}
          onSubmit={handleSubmitRating}
          title="قيم الكابتن ⭐"
          subtitle="كيف كانت تجربتك مع"
          ratedPersonName={ratedRunnerName || "الكابتن"}
          required={true}
        />
      </View>
    );
  }

  if (orderStatus === 'runner_delivered') {
    return (
      <View style={styles.container}>
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
          <View />
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>🚪 خروج</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContainer}>
          <View style={[styles.card, { borderColor: '#f39c12', borderWidth: 2, backgroundColor: '#fffbf5' }]}>
            <Text style={styles.giantEmoji}>🤝📦</Text>
            <Text style={[styles.statusTitle, { color: '#d35400' }]}>هل استلمت الطلب؟</Text>
            <View style={[styles.infoBox, { backgroundColor: '#fef5e7' }]}>
              <Text style={[styles.infoBoxText, { color: '#e67e22', lineHeight: 22 }]}>
                الكابتن أفاد بأنه <Text style={{ fontWeight: 'bold' }}>وصل إليك الآن</Text> وقام بتسليم الشحنة.{'\n'}
                يرجى تأكيد الاستلام ودفع مبلغ (<Text style={{ fontWeight: 'bold' }}>{runnerInfo?.finalPrice || 0} جنيه</Text>) المتفق عليه.
              </Text>
            </View>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#2ecc71', marginTop: 15 }]} onPress={handleConfirmReceipt} disabled={isProcessing}>
              {isProcessing ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>✅ نعم، استلمت وحاسبت المندوب</Text>}
            </TouchableOpacity>
            <Text style={styles.noticeText}>* لا تضغط على الزرار إلا بعد فحص شحنتك ومحاسبة الكابتن وجهاً لوجه.</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (orderStatus === 'accepted') {
    return (
      <View style={styles.container}>
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
          <View />
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>🚪 خروج</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { borderColor: '#3498db', borderWidth: 2 }]}>
          <Text style={[styles.giantEmoji, { textAlign: 'center' }]}>💨🏍️</Text>
          <Text style={[styles.statusTitle, { color: '#3498db' }]}>أبشر يا فندم! طلبك انطلق!</Text>
          <View style={[styles.infoBox, { backgroundColor: '#e8f4f8' }]}>
            <Text style={[styles.infoBoxText, { color: '#2980b9', lineHeight: 22 }]}>
              الكابتن <Text style={{ fontWeight: 'bold' }}>{runnerInfo?.runnerName || 'غير معروف'}</Text> وافق على العرض بقيمة (<Text style={{ fontWeight: 'bold' }}>{runnerInfo?.finalPrice || 0} جنيه</Text>) وهو في طريقه إليك الآن! ✨
            </Text>
          </View>
          <Text style={styles.noticeText}>* بمجرد وصول المندوب، ستظهر لك لوحة تأكيد الاستلام فوراً.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
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
        <View />
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>🚪 خروج</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { borderColor: '#4a148c', borderWidth: 1 }]}>
          {offersList.length === 0 ? (
            <View style={{ alignItems: 'center' }}>
              <ActivityIndicator size="large" color="#4a148c" style={{ marginBottom: 10 }} />
              <Text style={[styles.statusTitle, { color: '#4a148c' }]}>جاري البحث عن كابتن... 🛵</Text>
              <Text style={styles.statusDesc}>طلبك معروض الآن في رادار المناديب، وستظهر العروض هنا فور تقديمها.</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center' }}>
              <Text style={styles.giantEmoji}>🔔</Text>
              <Text style={[styles.statusTitle, { color: '#e67e22' }]}>وصلتك عروض أسعار لايف! 🎉</Text>
            </View>
          )}

          <Text style={[styles.sectionHeader, { textAlign: 'left', writingDirection: 'rtl' }]}>🎯 العروض المقدمة لايف ({offersList.length}):</Text>

          {offersList.length === 0 ? (
            <Text style={styles.emptyText}>في انتظار أول عرض سعر من الكباتن... حمسهم برفع السعر لو تأخروا! ☕</Text>
          ) : (
            <View style={styles.offersContainer}>
              {offersList.map((offer, index) => {
                const runnerRating = runnerRatings[offer.runnerId];
                
                return (
                  <View key={index} style={styles.offerCard}>
                    <View style={styles.offerInfo}>
                      <Text style={styles.runnerName}>{offer.runnerName || 'كابتن'}</Text>
                      {runnerRating && runnerRating.totalRatings > 0 && (
                        <View style={styles.runnerRatingRow}>
                          <StarsDisplay rating={runnerRating.average} size={11} />
                          <Text style={styles.runnerRatingCount}>({runnerRating.totalRatings})</Text>
                        </View>
                      )}
                      <Text style={styles.offerSub}>يقترح توصيل طلبك بـ:</Text>
                    </View>
                    <View style={styles.offerActions}>
                      <Text style={styles.priceText}>{offer.proposedPrice || 0} ج</Text>
                      <View style={styles.btnRow}>
                        <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#2ecc71' }]} onPress={() => handleAcceptRunnerOffer(offer.proposedPrice, offer.runnerId)} disabled={isProcessing}>
                          <Text style={styles.smallBtnText}>قبول</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.smallBtn, { backgroundColor: '#e74c3c' }]} onPress={() => handleRejectRunnerOffer(offer.runnerId)} disabled={isProcessing}>
                          <Text style={styles.smallBtnText}>رفض</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ borderTopWidth: 1, borderColor: '#eee', marginVertical: 20 }} />

          <TouchableOpacity style={[styles.cancelBtn, isProcessing && { opacity: 0.6 }]} onPress={handleCancelMyOrder} disabled={isProcessing}>
            <Text style={styles.cancelBtnText}>
              {isProcessing ? "جاري سحب الطلب..." : "❌ إلغاء الطلب وسحبه من المزاد"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 10 : 40 },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  logoutBtn: {
    backgroundColor: '#e74c3c',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  logoutBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  scrollContainer: { padding: 15, paddingBottom: 30 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, alignItems: 'stretch', direction: 'rtl' },
  giantEmoji: { fontSize: 50, textAlign: 'center', marginBottom: 10 },
  statusTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'auto', marginBottom: 10, writingDirection: 'rtl'},
  statusDesc: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 15, lineHeight: 20 },
  infoBox: { backgroundColor: '#f9f9f9', padding: 12, borderRadius: 8, marginVertical: 15, borderStyle: 'dashed', borderWidth: 1, borderColor: '#ddd' },
  infoBoxText: { fontSize: 13, color: '#7f8c8d', textAlign: 'center' },
  actionBtn: { padding: 14, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  noticeText: { color: '#7f8c8d', fontSize: 11, textAlign: 'center', marginTop: 10, lineHeight: 16 },
  ratingNotice: {
    color: '#E74C3C',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 10,
  },
  checkingRatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  checkingRatingText: {
    color: '#F57F17',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeader: { fontSize: 14, fontWeight: 'bold', color: '#333', textAlign: 'right', marginTop: 15, marginBottom: 10, borderBottomWidth: 1, borderColor: '#eee', paddingBottom: 6 },
  emptyText: { textAlign: 'center', color: '#999', padding: 20, backgroundColor: '#fafafa', borderRadius: 8, borderStyle: 'dashed', borderWidth: 1, borderColor: '#ccc', fontSize: 13 },
  offersContainer: {},
  offerCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRightWidth: 5, borderRightColor: '#e67e22', padding: 12, borderRadius: 8, flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  offerInfo: { alignItems: 'flex-start', flex: 1, paddingRight: 10 },
  runnerName: { fontSize: 16, fontWeight: 'bold', color: '#e67e22', textAlign: 'right' },
  runnerRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 3,
  },
  runnerRatingCount: {
    fontSize: 9,
    color: '#888',
    fontWeight: '600',
  },
  offerSub: { color: '#555', fontSize: 12, marginTop: 2, textAlign: 'right' },
  offerActions: { alignItems: 'center' },
  priceText: { fontSize: 20, fontWeight: 'bold', color: '#212121', marginBottom: 2 },
  btnRow: { flexDirection: 'row' },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginHorizontal: 3 },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  cancelBtn: { backgroundColor: '#e74c3c', padding: 12, borderRadius: 8, alignItems: 'center' },
  cancelBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
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