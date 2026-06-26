import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  where, 
  onSnapshot, 
  updateDoc, 
  doc, 
  getDoc,
  getDocs,
  deleteDoc,
  runTransaction,
  limit,
  arrayRemove,
  arrayUnion
} from "firebase/firestore";
import { db } from "../firebaseConfig";

// ==========================================
// 1. إنشاء الطلب
// ==========================================
export const createOrder = async (requesterId, clientName, itemDescription, deliveryFee, clientCoords = null) => {
  try {
    // ✅ Validation
    if (!requesterId) throw new Error("requesterId مطلوب");
    if (!itemDescription || itemDescription.trim().length === 0) throw new Error("وصف الطلب مطلوب");
    if (!deliveryFee || Number(deliveryFee) <= 0) throw new Error("قيمة التوصيل يجب أن تكون أكبر من 0");
    
    const docRef = await addDoc(collection(db, "orders"), {
      requesterId: requesterId,
      clientName: clientName || "عميل",
      itemDescription: itemDescription.trim(),
      deliveryFee: Number(deliveryFee),
      originalFee: Number(deliveryFee),
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      clientLocation: clientCoords ? {
        latitude: clientCoords.latitude,
        longitude: clientCoords.longitude
      } : null,
      runnerId: null,
      runnerName: null,
      runnerPhone: null,
      runnerLocation: null,
      offers: [],
      runnerDismissed: false,
      cancelledAt: null,
      cancelledBy: null,
      completedAt: null,
      deliveredAt: null,
      acceptedAt: null,
      offerCount: 0,
      lowestOffer: null
    });
    
    console.log("✅ الطلب اتسجل برقم: ", docRef.id);
    return docRef.id;
  } catch (e) {
    console.error("❌ خطأ في createOrder: ", e);
    throw e;
  }
};

// ==========================================
// 2. مراقبة الطلبات (مع فلترة متقدمة)
// ==========================================
export const watchForNewOrders = (onOrdersChanged, filters = {}) => {
  let constraints = [where("status", "==", "pending")];
  
  // ✅ دعم فلترة حسب المدينة
  if (filters.city) {
    constraints.push(where("city", "==", filters.city));
  }
  
  // ✅ دعم الـ Pagination
  if (filters.limit && filters.limit > 0) {
    constraints.push(limit(filters.limit));
  }
  
  const q = query(collection(db, "orders"), ...constraints);
  
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const orders = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    onOrdersChanged(orders);
  }, (error) => {
    console.error("❌ Snapshot error:", error);
    // ✅ إرسال الخطأ للـ callback
    if (onOrdersChanged) {
      onOrdersChanged([], error);
    }
  });

  return unsubscribe;
};

// ==========================================
// 3. قبول الطلب
// ==========================================
export const acceptOrder = async (orderId, runnerId, runnerCoords = null, additionalInfo = {}) => {
  try {
    // ✅ Validation
    if (!orderId) throw new Error("orderId مطلوب");
    if (!runnerId) throw new Error("runnerId مطلوب");
    
    const orderRef = doc(db, "orders", orderId);
    
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
      
      const orderData = orderSnap.data();
      
      if (orderData.status !== "pending") {
        throw new Error("الطلب غير متاح للقبول");
      }
      
      transaction.update(orderRef, {
        status: "accepted",
        runnerId: runnerId,
        runnerName: additionalInfo.runnerName || "كابتن",
        runnerPhone: additionalInfo.runnerPhone || "",
        runnerLocation: runnerCoords ? {
          latitude: runnerCoords.latitude,
          longitude: runnerCoords.longitude
        } : null,
        offers: [],
        offerCount: 0,
        lowestOffer: null,
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    
    console.log("✅ تم قبول الطلب بنجاح (بـ Transaction)");
    return { success: true };
  } catch (e) {
    console.error("❌ خطأ في acceptOrder: ", e);
    throw e;
  }
};

// ==========================================
// 4. إلغاء قبول الطلب
// ==========================================
export const cancelOrderAcceptance = async (orderId) => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    
    const orderRef = doc(db, "orders", orderId);
    
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
      
      const orderData = orderSnap.data();
      
      if (orderData.status !== "accepted") {
        throw new Error("الطلب ليس في حالة قبول");
      }
      
      const originalPrice = orderData.originalFee || orderData.deliveryFee || 0;

      transaction.update(orderRef, {
        status: "pending",
        runnerId: null,
        runnerName: null,
        runnerPhone: null,
        runnerLocation: null,
        deliveryFee: originalPrice,
        offers: [],
        offerCount: 0,
        lowestOffer: null,
        updatedAt: serverTimestamp()
      });
    });
    
    console.log("✅ تم إلغاء قبول الطلب ورجع للسوق (بـ Transaction)");
    return { success: true };
  } catch (e) {
    console.error("❌ خطأ في cancelOrderAcceptance: ", e);
    throw e;
  }
};

// ==========================================
// 5. تقديم عرض سعر
// ==========================================
export const submitCounterOffer = async (orderId, runnerId, runnerName, proposedPrice, runnerCoords = null, vehicleType = "ماشياً") => {
  try {
    // ✅ Validation
    if (!orderId) throw new Error("orderId مطلوب");
    if (!runnerId) throw new Error("runnerId مطلوب");
    if (!proposedPrice || Number(proposedPrice) <= 0) throw new Error("السعر يجب أن يكون أكبر من 0");
    
    const orderRef = doc(db, "orders", orderId);
    let result = { success: false, reason: "" };
    
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
      
      const orderData = orderSnap.data();
      
      if (orderData.status === "accepted") {
        result = { success: false, reason: "already_accepted" };
        return;
      }
      
      let currentOffers = orderData.offers || [];
      
      const offerPayload = {
        runnerId: runnerId,
        runnerName: runnerName || "كابتن",
        proposedPrice: Number(proposedPrice),
        createdAt: new Date(),
        vehicleType: vehicleType || "ماشياً",
        runnerLocation: runnerCoords ? {
          latitude: runnerCoords.latitude,
          longitude: runnerCoords.longitude
        } : null
      };

      const existingOfferIndex = currentOffers.findIndex(
        offer => offer.runnerId === runnerId
      );

      if (existingOfferIndex !== -1) {
        currentOffers[existingOfferIndex] = offerPayload;
      } else {
        currentOffers.push(offerPayload);
      }
      
      const lowestPrice = currentOffers.reduce(
        (min, offer) => Math.min(min, offer.proposedPrice),
        Infinity
      );
      
      transaction.update(orderRef, {
        offers: currentOffers,
        offerCount: currentOffers.length,
        lowestOffer: lowestPrice !== Infinity ? lowestPrice : null,
        updatedAt: serverTimestamp()
      });
      
      result = { success: true };
    });
    
    if (result.success) {
      console.log(`✅ تم تحديث عرض المندوب ${runnerName} بـ ${proposedPrice} ج`);
    }
    return result;
  } catch (e) {
    console.error("❌ خطأ في submitCounterOffer: ", e);
    throw e;
  }
};

// ==========================================
// 6. قبول عرض المندوب
// ==========================================
export const updateOrderWithCounterPrice = async (orderId, finalPrice, winnerRunnerId) => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    if (!winnerRunnerId) throw new Error("winnerRunnerId مطلوب");
    if (!finalPrice || Number(finalPrice) <= 0) throw new Error("السعر يجب أن يكون أكبر من 0");
    
    const orderRef = doc(db, "orders", orderId);
    let result = { success: false, reason: "" };
    
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
      
      const orderData = orderSnap.data();
      
      if (orderData.status !== "pending") {
        result = { success: false, reason: "not_pending" };
        return;
      }
      
      const currentOffers = orderData.offers || [];
      
      const matchingOffers = currentOffers.filter(
        offer => offer.runnerId === winnerRunnerId
      );
      
      if (matchingOffers.length === 0) {
        result = { success: false, reason: "no_offer" };
        return;
      }
      
      const latestOffer = matchingOffers[matchingOffers.length - 1];
      
      if (Number(latestOffer.proposedPrice) !== Number(finalPrice)) {
        result = { success: false, reason: "price_mismatch" };
        return;
      }
      
      transaction.update(orderRef, {
        status: "accepted",
        deliveryFee: finalPrice,
        runnerId: winnerRunnerId,
        runnerName: latestOffer.runnerName,
        runnerLocation: latestOffer.runnerLocation,
        offers: [],
        offerCount: 0,
        lowestOffer: null,
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      result = { success: true };
    });
    
    if (result.success) {
      console.log(`✅ تم قبول عرض المندوب بـ ${finalPrice} ج`);
    }
    return result;
  } catch (e) {
    console.error("❌ خطأ في updateOrderWithCounterPrice: ", e);
    throw e;
  }
};

// ==========================================
// 7. رفض عرض المندوب
// ==========================================
export const rejectCounterOffer = async (orderId, runnerId) => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    if (!runnerId) throw new Error("runnerId مطلوب");
    
    const orderRef = doc(db, "orders", orderId);
    let result = { success: false, reason: "" };
    
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
      
      const orderData = orderSnap.data();
      
      if (orderData.status === "accepted") {
        result = { success: false, reason: "already_accepted" };
        return;
      }
      
      const currentOffers = orderData.offers || [];
      const updatedOffers = currentOffers.filter(
        offer => offer.runnerId !== runnerId
      );
      
      const lowestPrice = updatedOffers.length > 0 ? 
        updatedOffers.reduce((min, offer) => Math.min(min, offer.proposedPrice), Infinity) :
        null;
      
      transaction.update(orderRef, {
        offers: updatedOffers,
        offerCount: updatedOffers.length,
        lowestOffer: lowestPrice,
        updatedAt: serverTimestamp()
      });
      
      result = { success: true };
    });
    
    if (result.success) {
      console.log(`✅ تم رفض عرض المندوب ${runnerId}`);
    }
    return result;
  } catch (e) {
    console.error("❌ خطأ في rejectCounterOffer: ", e);
    throw e;
  }
};

// ==========================================
// 8. سحب العرض
// ==========================================
export const withdrawCounterOffer = async (orderId, runnerId) => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    if (!runnerId) throw new Error("runnerId مطلوب");
    
    const orderRef = doc(db, "orders", orderId);
    let result = { success: false, reason: "" };
    
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
      
      const orderData = orderSnap.data();
      
      if (orderData.status === "accepted") {
        result = { success: false, reason: "already_accepted" };
        return;
      }
      
      const currentOffers = orderData.offers || [];
      const updatedOffers = currentOffers.filter(
        offer => offer.runnerId !== runnerId
      );
      
      const lowestPrice = updatedOffers.length > 0 ?
        updatedOffers.reduce((min, offer) => Math.min(min, offer.proposedPrice), Infinity) :
        null;
      
      transaction.update(orderRef, {
        offers: updatedOffers,
        offerCount: updatedOffers.length,
        lowestOffer: lowestPrice,
        updatedAt: serverTimestamp()
      });
      
      result = { success: true };
    });
    
    if (result.success) {
      console.log(`✅ تم سحب عرض المندوب ${runnerId}`);
    }
    return result;
  } catch (e) {
    console.error("❌ خطأ في withdrawCounterOffer: ", e);
    throw e;
  }
};

// ==========================================
// 9. إكمال الطلب
// ==========================================
export const completeOrder = async (orderId, targetStatus = "completed") => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    if (!['completed', 'runner_delivered'].includes(targetStatus)) {
      throw new Error("حالة غير صالحة");
    }
    
    const orderRef = doc(db, "orders", orderId);
    
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
      
      const orderData = orderSnap.data();
      
      if (orderData.status === "completed") {
        throw new Error("الطلب مكتمل بالفعل");
      }
      
      const updateData = {
        status: targetStatus,
        updatedAt: serverTimestamp()
      };

      if (targetStatus === "completed") {
        updateData.completedAt = serverTimestamp();
      } else if (targetStatus === "runner_delivered") {
        updateData.deliveredAt = serverTimestamp();
      }

      transaction.update(orderRef, updateData);
    });
    
    console.log(`✅ تم تحديث حالة الطلب إلى: ${targetStatus} (بـ Transaction)`);
    return { success: true };
  } catch (e) {
    console.error("❌ خطأ في completeOrder:", e);
    throw e;
  }
};

// ==========================================
// 10. إلغاء الطلب
// ==========================================
export const cancelOrderEntirely = async (orderId, cancelledBy = "client") => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    
    const orderRef = doc(db, "orders", orderId);
    
    await runTransaction(db, async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("الطلب غير موجود");
      
      const orderData = orderSnap.data();
      
      if (orderData.status === "completed") {
        throw new Error("لا يمكن إلغاء طلب مكتمل");
      }
      
      transaction.update(orderRef, {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledBy: cancelledBy,
        offers: [],
        offerCount: 0,
        lowestOffer: null,
        updatedAt: serverTimestamp()
      });
    });
    
    console.log(`✅ تم إلغاء الطلب بواسطة: ${cancelledBy}`);
    return { success: true };
  } catch (e) {
    console.error("❌ خطأ في cancelOrderEntirely:", e);
    throw e;
  }
};

// ==========================================
// 11. الحصول على طلب
// ==========================================
export const getOrder = async (orderId) => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    
    const orderRef = doc(db, "orders", orderId);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists()) return null;
    return { id: orderSnap.id, ...orderSnap.data() };
  } catch (e) {
    console.error("❌ خطأ في getOrder:", e);
    throw e;
  }
};

// ==========================================
// 12. الحصول على عروض طلب
// ==========================================
export const getOrderOffers = async (orderId, limitCount = 20) => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    if (limitCount <= 0) limitCount = 20;
    
    const offersRef = collection(db, `orders/${orderId}/offers`);
    const q = query(offersRef, limit(limitCount));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("❌ خطأ في getOrderOffers:", e);
    throw e;
  }
};

// ==========================================
// 13. الحصول على طلبات المندوب
// ==========================================
export const getRunnerOrders = async (runnerId, status = null) => {
  try {
    if (!runnerId) throw new Error("runnerId مطلوب");
    
    let constraints = [where("runnerId", "==", runnerId)];
    if (status) {
      constraints.push(where("status", "==", status));
    }
    
    const q = query(collection(db, "orders"), ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("❌ خطأ في getRunnerOrders:", e);
    throw e;
  }
};

// ==========================================
// 14. الحصول على طلبات العميل
// ==========================================
export const getClientOrders = async (clientId, status = null) => {
  try {
    if (!clientId) throw new Error("clientId مطلوب");
    
    let constraints = [where("requesterId", "==", clientId)];
    if (status) {
      constraints.push(where("status", "==", status));
    }
    
    const q = query(collection(db, "orders"), ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (e) {
    console.error("❌ خطأ في getClientOrders:", e);
    throw e;
  }
};

// ==========================================
// 15. حذف طلب (للاستخدام الداخلي فقط)
// ==========================================
export const deleteOrder = async (orderId) => {
  try {
    if (!orderId) throw new Error("orderId مطلوب");
    
    const orderRef = doc(db, "orders", orderId);
    await deleteDoc(orderRef);
    console.log(`✅ تم حذف الطلب ${orderId}`);
    return { success: true };
  } catch (e) {
    console.error("❌ خطأ في deleteOrder:", e);
    throw e;
  }
};