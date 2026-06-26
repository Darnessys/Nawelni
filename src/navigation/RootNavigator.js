import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, ActivityIndicator, Text } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { colors } from '../core/theme';
import { USER_ROLE } from '../core/constants/orderStatuses';

import Login from '../../screens/auth/Login';
import CompleteProfile from '../../screens/auth/CompleteProfile';
import RunnerDashboard from '../../screens/runner/RunnerDashboard';
import CreateOrder from '../../screens/client/CreateOrder';
import OrderBidding from '../../screens/client/OrderBidding';

const Stack = createNativeStackNavigator();

const screenOptions = { headerShown: false };

function LoadingScreen() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={styles.loadingText}>جاري تأمين اتصال ناولني...</Text>
    </View>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Login" component={Login} />
    </Stack.Navigator>
  );
}

function ProfileStack({ userProfile, updateUserProfile }) {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="CompleteProfile">
        {() => (
          <CompleteProfile
            currentUserProfile={userProfile}
            onProfileSave={updateUserProfile}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

function RunnerStack({ userProfile, orders }) {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="RunnerDashboard">
        {() => (
          <RunnerDashboard
            runnerProfile={{ id: userProfile.uid, name: userProfile.name }}
            pendingOrders={orders}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

// ===== Client Stack with Navigation Control =====
function ClientStack({
  userProfile,
  orders,
  currentOrderId,
  setCurrentOrderId,
}) {
  const navigation = useNavigation();
  const currentOrderData = orders.find((order) => order.id === currentOrderId);
  const prevOrderIdRef = useRef(currentOrderId);
  const isNavigatingRef = useRef(false);

  console.log(`📍 ClientStack - currentOrderId: ${currentOrderId}`);

  // ✅ راقب التغيير وروح لـ OrderBidding أو CreateOrder
  useEffect(() => {
    // منع التكرار
    if (isNavigatingRef.current) return;
    
    const prevId = prevOrderIdRef.current;
    const currentId = currentOrderId;
    
    console.log(`🔄 Navigation check - prev: ${prevId}, current: ${currentId}`);
    
    // ✅ لو currentOrderId اختلف عن السابق
    if (prevId !== currentId) {
      if (currentId) {
        // ✅ فيه orderId => روح لـ OrderBidding
        console.log(`🔄 Navigating to OrderBidding: ${currentId}`);
        isNavigatingRef.current = true;
        navigation.navigate('OrderBidding');
        setTimeout(() => {
          isNavigatingRef.current = false;
        }, 500);
      } else {
        // ✅ مفيش orderId => روح لـ CreateOrder
        console.log(`🔄 Navigating to CreateOrder`);
        isNavigatingRef.current = true;
        navigation.navigate('CreateOrder');
        setTimeout(() => {
          isNavigatingRef.current = false;
        }, 500);
      }
    }
    
    prevOrderIdRef.current = currentId;
  }, [currentOrderId, navigation]);

  // ✅ إذا كان currentOrderId = null، اعرض CreateOrder فقط
  if (!currentOrderId) {
    console.log("🏠 No order ID, showing CreateOrder");
    return (
      <Stack.Navigator
        key="create-only"
        screenOptions={{ ...screenOptions, gestureEnabled: false }}
        initialRouteName="CreateOrder"
      >
        <Stack.Screen name="CreateOrder">
          {() => {
            console.log("🏠 Rendering CreateOrder (no order)");
            return (
              <CreateOrder
                setCurrentOrderId={setCurrentOrderId}
                clientId={userProfile.uid}
                clientName={userProfile.name}
              />
            );
          }}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  // ✅ إذا كان فيه orderId، اعرض الـ Navigator مع الشاشتين
  const stackKey = `bidding-${currentOrderId}`;
  console.log(`💰 Showing OrderBidding for: ${currentOrderId}`);

  return (
    <Stack.Navigator
      key={stackKey}
      screenOptions={{ ...screenOptions, gestureEnabled: false }}
      initialRouteName="OrderBidding"
    >
      <Stack.Screen name="CreateOrder">
        {() => {
          console.log("🏠 Rendering CreateOrder (with order)");
          return (
            <CreateOrder
              setCurrentOrderId={setCurrentOrderId}
              clientId={userProfile.uid}
              clientName={userProfile.name}
            />
          );
        }}
      </Stack.Screen>
      <Stack.Screen name="OrderBidding">
        {() => {
          console.log("💰 Rendering OrderBidding");
          return (
            <OrderBidding
              currentOrderId={currentOrderId}
              setCurrentOrderId={setCurrentOrderId}
              currentOrderData={currentOrderData}
              onOrderFinished={() => {
                console.log("📞 Order finished - resetting to CreateOrder");
                setCurrentOrderId(null);
              }}
              onReset={() => {
                console.log("📞 Order reset - going back to CreateOrder");
                setCurrentOrderId(null);
              }}
            />
          );
        }}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

export default function RootNavigator({
  user,
  userProfile,
  loading,
  updateUserProfile,
  orders,
  currentOrderId,
  setCurrentOrderId,
}) {
  if (loading) {
    return <LoadingScreen />;
  }

  console.log(`📍 RootNavigator - currentOrderId: ${currentOrderId}`);

  const renderNavigator = () => {
    if (!user) {
      console.log("🔐 No user, showing AuthStack");
      return <AuthStack />;
    }

    if (userProfile && !userProfile.profileComplete) {
      console.log("📝 Profile incomplete, showing ProfileStack");
      return (
        <ProfileStack
          userProfile={userProfile}
          updateUserProfile={updateUserProfile}
        />
      );
    }

    if (userProfile?.role === USER_ROLE.RUNNER) {
      console.log("🏍️ Runner, showing RunnerStack");
      return <RunnerStack userProfile={userProfile} orders={orders} />;
    }

    if (userProfile?.role === USER_ROLE.CLIENT) {
      console.log("👤 Client, showing ClientStack");
      return (
        <ClientStack
          userProfile={userProfile}
          orders={orders}
          currentOrderId={currentOrderId}
          setCurrentOrderId={setCurrentOrderId}
        />
      );
    }

    console.log("⚠️ Fallback to AuthStack");
    return <AuthStack />;
  };

  return <NavigationContainer>{renderNavigator()}</NavigationContainer>;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 15,
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});