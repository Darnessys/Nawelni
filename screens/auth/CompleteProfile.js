import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Alert,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar
} from 'react-native';
import { db } from '../../firebaseConfig';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';

export default function CompleteProfile({ currentUserProfile, onProfileSave }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(false);
  
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const isMountedRef = useRef(true);
  const toastTimerRef = useRef(null);

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

  const handleSave = async () => {
    if (!currentUserProfile?.uid) {
      Alert.alert('خطأ', 'تعذر تحديد هوية المستخدم');
      return;
    }

    if (!role) {
      Alert.alert('تنبيه ⚠️', 'برجاء اختيار نوع الحساب (عميل أو كابتن)');
      return;
    }

    if (!name.trim()) {
      Alert.alert('تنبيه ⚠️', 'برجاء إدخال اسمك الكامل');
      return;
    }

    const phoneRegex = /^01[0-9]{9}$/;
    if (!phoneRegex.test(phone)) {
      Alert.alert('تنبيه ⚠️', 'برجاء إدخال رقم هاتف صحيح مكون من 11 رقم (مثال: 01xxxxxxxxx)');
      return;
    }

    if (role === 'runner' && !vehicle) {
      Alert.alert('تنبيه ⚠️', 'برجاء اختيار وسيلة التوصيل الخاصة بك');
      return;
    }

    setLoading(true);

    try {
      const userDocRef = doc(db, "users", currentUserProfile.uid);

      const updatedData = {
        name: name.trim(),
        phone: phone,
        role: role,
        vehicle: role === 'runner' ? vehicle : null,
        profileComplete: true,
        updatedAt: serverTimestamp()
      };

      await updateDoc(userDocRef, updatedData);

      showToast('✅ تم حفظ البيانات بنجاح!', 'success');

      onProfileSave({
        ...currentUserProfile,
        ...updatedData
      });

    } catch (error) {
      console.error("❌ خطأ أثناء استكمال البيانات:", error);

      if (error.code === 'permission-denied') {
        Alert.alert('🔒 خطأ في الصلاحيات', 'تأكد من أنك تمتلك الصلاحية لتعديل البيانات');
      } else {
        Alert.alert('عفواً! 🚨', 'حدث خطأ أثناء حفظ البيانات، يرجى المحاولة مرة أخرى.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
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
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.emoji}>📋</Text>
              <Text style={styles.title}>استكمال بيانات بروفايلك</Text>
              <Text style={styles.subtitle}>
                خطوة واحدة تفصلك عن الانطلاق في ناولني ✨
              </Text>
            </View>

            <Text style={styles.label}>👤 اختر نوع الحساب:</Text>
            <View style={styles.selectorContainer}>
              <TouchableOpacity
                style={[
                  styles.selectorButton,
                  role === 'client' && styles.clientActive,
                  loading && styles.selectorDisabled
                ]}
                onPress={() => !loading && setRole('client')}
                disabled={loading}
              >
                <Text style={[
                  styles.selectorText,
                  role === 'client' && styles.textActive
                ]}>
                  👑 صاحب طلب
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.selectorButton,
                  role === 'runner' && styles.runnerActive,
                  loading && styles.selectorDisabled
                ]}
                onPress={() => !loading && setRole('runner')}
                disabled={loading}
              >
                <Text style={[
                  styles.selectorText,
                  role === 'runner' && styles.textActive
                ]}>
                  🏍️ كابتن توصيل
                </Text>
              </TouchableOpacity>
            </View>

            {role === 'runner' && (
              <View>
                <Text style={styles.label}>🛵 وسيلة التوصيل الخاصة بك:</Text>
                <View style={styles.selectorContainer}>
                  <TouchableOpacity
                    style={[
                      styles.selectorButton,
                      vehicle === 'bicycle' && styles.runnerActive,
                      loading && styles.selectorDisabled
                    ]}
                    onPress={() => !loading && setVehicle('bicycle')}
                    disabled={loading}
                  >
                    <Text style={[
                      styles.selectorText,
                      vehicle === 'bicycle' && styles.textActive
                    ]}>
                      🚲 عجلة / حُر
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.selectorButton,
                      vehicle === 'motorcycle' && styles.runnerActive,
                      loading && styles.selectorDisabled
                    ]}
                    onPress={() => !loading && setVehicle('motorcycle')}
                    disabled={loading}
                  >
                    <Text style={[
                      styles.selectorText,
                      vehicle === 'motorcycle' && styles.textActive
                    ]}>
                      🏍️ موتوسيكل
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.selectorButton,
                      vehicle === 'car' && styles.runnerActive,
                      loading && styles.selectorDisabled
                    ]}
                    onPress={() => !loading && setVehicle('car')}
                    disabled={loading}
                  >
                    <Text style={[
                      styles.selectorText,
                      vehicle === 'car' && styles.textActive
                    ]}>
                      🚗 سيارة
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <Text style={styles.label}>👤 الاسم الكامل</Text>
            <TextInput
              /* 🔹 تم دمج ستايل الـ nameInput لإجبار خانة الاسم فقط على الاتجاه اليمين */
              style={[styles.input, styles.nameInput, loading && styles.inputDisabled]}
              placeholder="أدخل اسمك الكامل..."
              placeholderTextColor="#999"
              value={name}
              onChangeText={setName}
              editable={!loading}
            />

            <Text style={styles.label}>📱 رقم الهاتف (للتواصل):</Text>
            <TextInput
              style={[styles.input, loading && styles.inputDisabled]}
              placeholder="01xxxxxxxxx"
              placeholderTextColor="#999"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={11}
              editable={!loading}
            />
            <Text style={styles.hintText}>* رقم هاتف صحيح مكون من 11 رقم (يبدأ بـ 01)</Text>

            <TouchableOpacity
              style={[
                styles.submitButton,
                loading && styles.submitButtonDisabled
              ]}
              onPress={handleSave}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>🚀 حفظ الحساب والانطلاق</Text>
              )}
            </TouchableOpacity>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5'
  },
  keyboardView: {
    flex: 1
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8
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
    marginBottom: 4
  },
  subtitle: {
    fontSize: 13,
    color: '#7f8c8d',
    textAlign: 'center',
    lineHeight: 18
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#34495e',
    marginBottom: 8,
    textAlign: 'left'
  },
  input: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 4,
    fontSize: 15,
    color: '#333',
    textAlign: 'left' /* الافتراضي يفضل يسار عشان الأرقام والـ placeholder */
  },
  nameInput: {
    textAlign: 'right' /* 🔹 هنا الإجبار لخانة الاسم فقط لتروح يمين غصب عنها */
  },
  inputDisabled: {
    opacity: 0.7,
  },
  hintText: {
    fontSize: 11,
    color: '#95a5a6',
    textAlign: 'left',
    marginBottom: 16,
  },
  selectorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between', 
    marginBottom: 20,
  },
  selectorButton: { 
    flex: 1, 
    borderWidth: 2, 
    borderColor: '#ddd', 
    borderRadius: 10, 
    padding: 12, 
    alignItems: 'center', 
    backgroundColor: '#fff',
    marginHorizontal: 4,
  },
  selectorDisabled: {
    opacity: 0.5,
  },
  clientActive: { 
    backgroundColor: '#4a148c', 
    borderColor: '#4a148c' 
  },
  runnerActive: { 
    backgroundColor: '#2ecc71', 
    borderColor: '#2ecc71' 
  },
  selectorText: { 
    color: '#333', 
    fontWeight: 'bold', 
    fontSize: 13 
  },
  textActive: { 
    color: '#fff' 
  },
  submitButton: { 
    backgroundColor: '#4a148c', 
    padding: 16, 
    borderRadius: 10, 
    alignItems: 'center', 
    marginTop: 8,
    elevation: 2,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: { 
    color: '#fff', 
    fontSize: 16, 
    fontWeight: 'bold' 
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