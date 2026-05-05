import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { loadAuthState, logout } from '../services/api';
import { COLORS } from '../utils/format';

import LoginScreen        from '../screens/LoginScreen';
import OverviewScreen     from '../screens/OverviewScreen';
import InvestimentiScreen from '../screens/InvestimentiScreen';
import MutuiScreen        from '../screens/MutuiScreen';
import MovimentiScreen    from '../screens/MovimentiScreen';
import PatrimonioScreen   from '../screens/PatrimonioScreen';
import BeniRealiScreen    from '../screens/BeniRealiScreen';
import ImportScreen       from '../screens/ImportScreen';
import AdvisorScreen         from '../screens/AdvisorScreen';
import FondoPensioneScreen  from '../screens/FondoPensioneScreen';
import FuturoScreen          from '../screens/FuturoScreen';
import PolizzeScreen         from '../screens/PolizzeScreen';

const Tab   = createBottomTabNavigator();
const Stack = createStackNavigator();

const tabBarStyle = {
  backgroundColor: '#0D1525',
  borderTopColor: COLORS.border,
  height: 60,
};

function LogoutButton() {
  const clearAuth = useStore(s => s.clearAuth);
  const handleLogout = async () => {
    await logout();
    clearAuth();
  };
  return (
    <TouchableOpacity onPress={handleLogout} style={{ marginRight: 16 }}>
      <Ionicons name="log-out-outline" size={22} color={COLORS.subtext} />
    </TouchableOpacity>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle:    { backgroundColor: '#0D1525', shadowColor: COLORS.border },
        headerTintColor: COLORS.text,
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
        headerRight: () => <LogoutButton />,
        tabBarStyle,
        tabBarActiveTintColor:   COLORS.primary,
        tabBarInactiveTintColor: COLORS.subtext,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
        tabBarIcon: ({ color, size, focused }) => {
          const icons: Record<string, string> = {
            Overview:     focused ? 'home'           : 'home-outline',
            Investimenti: focused ? 'trending-up'    : 'trending-up-outline',
            Movimenti:    focused ? 'wallet'         : 'wallet-outline',
            Mutui:        focused ? 'business'       : 'business-outline',
            Patrimonio:   focused ? 'pie-chart'      : 'pie-chart-outline',
            'Beni Reali':     focused ? 'diamond'        : 'diamond-outline',
            'Prev. Compl.':   focused ? 'shield-checkmark' : 'shield-checkmark-outline',
            Polizze:          focused ? 'shield'           : 'shield-outline',
            Futuro:           focused ? 'analytics'        : 'analytics-outline',

            Advisor:      focused ? 'sparkles'       : 'sparkles-outline',
            Importa:      focused ? 'cloud-upload'   : 'cloud-upload-outline',
          };
          return <Ionicons name={(icons[route.name] || 'ellipse') as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Overview"     component={OverviewScreen}    options={{ title: 'Overview' }} />
      <Tab.Screen name="Investimenti" component={InvestimentiScreen} options={{ title: 'Invest.' }} />
      <Tab.Screen name="Movimenti"    component={MovimentiScreen}   options={{ title: 'Movimenti' }} />
      <Tab.Screen name="Mutui"        component={MutuiScreen}       options={{ title: 'Mutui' }} />
      <Tab.Screen name="Patrimonio"   component={PatrimonioScreen}  options={{ title: 'Patrimonio' }} />
      <Tab.Screen name="Beni Reali"   component={BeniRealiScreen}        options={{ title: 'Beni' }} />
      <Tab.Screen name="Prev. Compl." component={FondoPensioneScreen}    options={{ title: 'Prev.' }} />
      <Tab.Screen name="Polizze"      component={PolizzeScreen}           options={{ title: 'Polizze' }} />
      <Tab.Screen name="Futuro"       component={FuturoScreen}            options={{ title: 'Futuro' }} />

      <Tab.Screen name="Advisor"      component={AdvisorScreen}          options={{ title: 'AI Advisor' }} />
      <Tab.Screen name="Importa"      component={ImportScreen}      options={{ title: 'Importa' }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const isAuthenticated = useStore(s => s.auth.isAuthenticated);
  const setAuth = useStore(s => s.setAuth);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const saved = loadAuthState();
    if (saved) setAuth({ ...saved, isAuthenticated: true });
    setChecking(false);
  }, []);

  if (checking) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer>
      <MainTabs />
    </NavigationContainer>
  );
}
