import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Modal,
  Animated,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard
} from 'react-native';

const STARS = [1, 2, 3, 4, 5];

export default function RatingModal({ 
  visible, 
  onClose, 
  onSubmit, 
  title = "قيم التجربة", 
  subtitle = "كيف كانت تجربتك؟",
  ratedPersonName = "المستخدم",
  required = false // ⭐ prop جديد للتقييم الإجباري
}) {
  const [selectedRating, setSelectedRating] = useState(0);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setSelectedRating(0);
      setComment("");
      setIsSubmitting(false);
      
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true
      }).start();
    } else {
      scaleAnim.setValue(0);
    }
  }, [visible]);

  const handleStarPress = (star) => {
    setSelectedRating(star);
  };

  const handleSubmit = async () => {
    if (selectedRating === 0) return;
    if (isSubmitting || !isMountedRef.current) return;
    
    setIsSubmitting(true);
    
    try {
      await onSubmit(selectedRating, comment.trim());
      if (isMountedRef.current) {
        setSelectedRating(0);
        setComment("");
      }
    } catch (error) {
      console.error("Submit rating error:", error);
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const handleClose = () => {
    // ⭐ لو التقييم إجباري، ما نقفلش المودال
    if (required) return;
    Keyboard.dismiss();
    onClose();
  };

  const getStarEmoji = (star) => {
    return star <= selectedRating ? '⭐' : '☆';
  };

  const getRatingLabel = () => {
    if (selectedRating === 0) return "اضغط على النجوم للتقييم";
    if (selectedRating === 1) return "سيء جداً 😞";
    if (selectedRating === 2) return "مقبول 😐";
    if (selectedRating === 3) return "جيد 👍";
    if (selectedRating === 4) return "جيد جداً 😊";
    if (selectedRating === 5) return "ممتاز 🤩";
    return "";
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={handleClose}
    >
      {/* ⭐ لو مش إجباري: الضغط بره يقفل، لو إجباري: ما ينفعش */}
      <TouchableWithoutFeedback onPress={required ? undefined : handleClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.keyboardView}
            >
              <Animated.View 
                style={[
                  styles.modalContainer,
                  { transform: [{ scale: scaleAnim }] }
                ]}
              >
                {/* Header */}
                <View style={styles.header}>
                  <Text style={styles.title}>{title}</Text>
                  {/* ⭐ زر القفل - يظهر فقط لو مش إجباري */}
                  {!required && (
                    <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                      <Text style={styles.closeBtnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Subtitle */}
                <Text style={styles.subtitle}>
                  {subtitle}
                </Text>
                <Text style={styles.ratedName}>
                  {ratedPersonName}
                </Text>

                {/* Stars */}
                <View style={styles.starsContainer}>
                  {STARS.map((star) => (
                    <TouchableOpacity
                      key={star}
                      onPress={() => handleStarPress(star)}
                      disabled={isSubmitting}
                      style={styles.starButton}
                    >
                      <Text style={[
                        styles.starText,
                        star <= selectedRating && styles.starActive
                      ]}>
                        {getStarEmoji(star)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Rating Label */}
                <Text style={[
                  styles.ratingLabel,
                  selectedRating > 0 && styles.ratingLabelActive
                ]}>
                  {getRatingLabel()}
                </Text>

                {/* Comment Input */}
                <View style={styles.commentContainer}>
                  <Text style={styles.commentLabel}>أضف تعليق (اختياري)</Text>
                  <TextInput
                    style={styles.commentInput}
                    placeholder="اكتب تعليقك هنا..."
                    placeholderTextColor="#999"
                    multiline
                    maxLength={200}
                    value={comment}
                    onChangeText={setComment}
                    editable={!isSubmitting}
                    textAlignVertical="top"
                  />
                  <Text style={styles.charCount}>
                    {comment.length}/200
                  </Text>
                </View>

                {/* ⭐ رسالة التقييم الإجباري */}
                {required && selectedRating === 0 && (
                  <Text style={styles.requiredText}>
                    ⚠️ التقييم مطلوب للمتابعة
                  </Text>
                )}

                {/* Submit Button */}
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    selectedRating === 0 && styles.submitBtnDisabled,
                    isSubmitting && styles.submitBtnSubmitting
                  ]}
                  onPress={handleSubmit}
                  disabled={selectedRating === 0 || isSubmitting}
                >
                  <Text style={styles.submitBtnText}>
                    {isSubmitting ? 'جاري الإرسال...' : 'إرسال التقييم ✨'}
                  </Text>
                </TouchableOpacity>

                {/* ⭐ Skip Button - يظهر فقط لو مش إجباري */}
                {!required && (
                  <TouchableOpacity
                    style={styles.skipBtn}
                    onPress={handleClose}
                    disabled={isSubmitting}
                  >
                    <Text style={styles.skipBtnText}>تخطي التقييم</Text>
                  </TouchableOpacity>
                )}
              </Animated.View>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  keyboardView: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2C3E50',
    textAlign: 'right',
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0E6F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  closeBtnText: {
    fontSize: 16,
    color: '#6C1B8D',
    fontWeight: 'bold',
  },
  subtitle: {
    fontSize: 14,
    color: '#7F8C8D',
    textAlign: 'center',
    marginBottom: 4,
  },
  ratedName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6C1B8D',
    textAlign: 'center',
    marginBottom: 20,
  },
  starsContainer: {
    flexDirection: 'row-reverse',
    justifyContent: 'center',
    marginBottom: 12,
    gap: 8,
  },
  starButton: {
    padding: 4,
  },
  starText: {
    fontSize: 40,
    opacity: 0.3,
  },
  starActive: {
    opacity: 1,
  },
  ratingLabel: {
    fontSize: 14,
    color: '#95A5A6',
    textAlign: 'center',
    marginBottom: 20,
    fontWeight: '500',
  },
  ratingLabelActive: {
    color: '#6C1B8D',
    fontWeight: 'bold',
  },
  commentContainer: {
    width: '100%',
    marginBottom: 20,
  },
  commentLabel: {
    fontSize: 13,
    color: '#555',
    marginBottom: 8,
    textAlign: 'right',
    fontWeight: '600',
  },
  commentInput: {
    width: '100%',
    height: 80,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 12,
    fontSize: 14,
    color: '#2C3E50',
    textAlign: 'right',
  },
  charCount: {
    fontSize: 11,
    color: '#95A5A6',
    textAlign: 'left',
    marginTop: 4,
  },
  submitBtn: {
    width: '100%',
    backgroundColor: '#6C1B8D',
    paddingVertical: 14,
    borderRadius: 25,
    alignItems: 'center',
    marginBottom: 12,
    elevation: 3,
    shadowColor: '#6C1B8D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  submitBtnDisabled: {
    backgroundColor: '#D4B8E0',
    elevation: 0,
    shadowOpacity: 0,
  },
  submitBtnSubmitting: {
    opacity: 0.7,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  skipBtn: {
    paddingVertical: 8,
  },
  skipBtnText: {
    color: '#95A5A6',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  // ⭐ Style جديد للتنبيه
  requiredText: {
    color: '#E74C3C',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
});