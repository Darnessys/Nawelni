import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  where, 
  getDocs,
  runTransaction,
  doc,
  getDoc
} from "firebase/firestore";
import { db } from "../firebaseConfig";

// ==========================================
// 1. إرسال تقييم (عميل → كابتن) أو (كابتن → عميل)
// ==========================================
export const submitRating = async (orderId, raterId, ratedUserId, rating, comment = "", role = "client_to_runner") => {
  try {
    // ✅ Validation
    if (!orderId) throw new Error("orderId مطلوب");
    if (!raterId) throw new Error("raterId مطلوب");
    if (!ratedUserId) throw new Error("ratedUserId مطلوب");
    if (!rating || rating < 1 || rating > 5) throw new Error("التقييم يجب أن يكون بين 1 و 5");
    
    // ✅ التحقق من عدم وجود تقييم مسبق لنفس الطلب من نفس الشخص
    const ratingsRef = collection(db, "ratings");
    const q = query(
      ratingsRef,
      where("orderId", "==", orderId),
      where("raterId", "==", raterId),
      where("role", "==", role)
    );
    
    const existingRatings = await getDocs(q);
    if (!existingRatings.empty) {
      throw new Error("لقد قمت بتقييم هذا الطلب بالفعل");
    }
    
    // ✅ إضافة التقييم
    const ratingData = {
      orderId: orderId,
      raterId: raterId,
      ratedUserId: ratedUserId,
      rating: Number(rating),
      comment: comment.trim(),
      role: role, // "client_to_runner" أو "runner_to_client"
      createdAt: serverTimestamp()
    };
    
    const docRef = await addDoc(ratingsRef, ratingData);
    
    console.log(`✅ تم تسجيل التقييم بنجاح: ${docRef.id}`);
    return { success: true, id: docRef.id };
    
  } catch (e) {
    console.error("❌ خطأ في submitRating:", e);
    throw e;
  }
};

// ==========================================
// 2. جلب متوسط تقييم مستخدم
// ==========================================
export const getUserAverageRating = async (userId) => {
  try {
    if (!userId) throw new Error("userId مطلوب");
    
    const ratingsRef = collection(db, "ratings");
    const q = query(ratingsRef, where("ratedUserId", "==", userId));
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return {
        average: 0,
        totalRatings: 0,
        distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
      };
    }
    
    let totalRating = 0;
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    
    snapshot.docs.forEach(doc => {
      const rating = doc.data().rating;
      totalRating += rating;
      if (distribution[rating] !== undefined) {
        distribution[rating]++;
      }
    });
    
    const average = totalRating / snapshot.size;
    
    return {
      average: Math.round(average * 10) / 10, // تقريب لرقم عشري واحد
      totalRatings: snapshot.size,
      distribution: distribution
    };
    
  } catch (e) {
    console.error("❌ خطأ في getUserAverageRating:", e);
    throw e;
  }
};

// ==========================================
// 3. التحقق إذا كان المستخدم قيم الطلب بالفعل
// ==========================================
export const hasUserRatedOrder = async (orderId, userId, role = "client_to_runner") => {
  try {
    if (!orderId || !userId) return false;
    
    const ratingsRef = collection(db, "ratings");
    const q = query(
      ratingsRef,
      where("orderId", "==", orderId),
      where("raterId", "==", userId),
      where("role", "==", role)
    );
    
    const snapshot = await getDocs(q);
    return !snapshot.empty;
    
  } catch (e) {
    console.error("❌ خطأ في hasUserRatedOrder:", e);
    return false;
  }
};

// ==========================================
// 4. جلب كل تقييمات مستخدم
// ==========================================
export const getUserRatings = async (userId, limitCount = 20) => {
  try {
    if (!userId) throw new Error("userId مطلوب");
    
    const ratingsRef = collection(db, "ratings");
    const q = query(ratingsRef, where("ratedUserId", "==", userId));
    
    const snapshot = await getDocs(q);
    
    const ratings = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || new Date()
    }));
    
    // ترتيب تنازلي حسب التاريخ
    ratings.sort((a, b) => b.createdAt - a.createdAt);
    
    // تطبيق limit
    return ratings.slice(0, limitCount);
    
  } catch (e) {
    console.error("❌ خطأ في getUserRatings:", e);
    throw e;
  }
};