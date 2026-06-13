import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, useWindowDimensions, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator, DrawerContentScrollView } from '@react-navigation/drawer';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../store/useStore';
import { loadAuthState, logout } from '../services/api';
import { COLORS } from '../utils/format';

import OverviewScreen     from '../screens/OverviewScreen';
import InvestimentiScreen from '../screens/InvestimentiScreen';
import MutuiScreen        from '../screens/MutuiScreen';
import MovimentiScreen    from '../screens/MovimentiScreen';
import PatrimonioScreen   from '../screens/PatrimonioScreen';
import BeniRealiScreen    from '../screens/BeniRealiScreen';
import ImportScreen       from '../screens/ImportScreen';
import AdvisorScreen      from '../screens/AdvisorScreen';
import FondoPensioneScreen from '../screens/FondoPensioneScreen';
import FuturoScreen       from '../screens/FuturoScreen';
import PolizzeScreen      from '../screens/PolizzeScreen';
import NewsScreen         from '../screens/NewsScreen';
import LoginScreen        from '../screens/LoginScreen';

const Drawer = createDrawerNavigator();

// ── Struttura menu raggruppata ─────────────────────────────────────────
type MenuItem = { name: string; title: string; icon: string; component: React.ComponentType<any> };
type MenuGroup = { sezione: string; items: MenuItem[] };

const MENU: MenuGroup[] = [
  {
    sezione: 'Panoramica',
    items: [
      { name: 'Overview',   title: 'Overview',    icon: 'home',       component: OverviewScreen },
      { name: 'Patrimonio', title: 'Patrimonio',  icon: 'pie-chart',  component: PatrimonioScreen },
      { name: 'Futuro',     title: 'Futuro',      icon: 'analytics',  component: FuturoScreen },
    ],
  },
  {
    sezione: 'Investimenti',
    items: [
      { name: 'Investimenti', title: 'Investimenti',   icon: 'trending-up', component: InvestimentiScreen },
      { name: 'News',         title: 'News & Mercati',  icon: 'newspaper',   component: NewsScreen },
      { name: 'Advisor',      title: 'AI Advisor',      icon: 'sparkles',    component: AdvisorScreen },
    ],
  },
  {
    sezione: 'Conti & Spese',
    items: [
      { name: 'Movimenti', title: 'Movimenti', icon: 'wallet',   component: MovimentiScreen },
      { name: 'Mutui',     title: 'Mutui',     icon: 'business', component: MutuiScreen },
      { name: 'Polizze',   title: 'Polizze',   icon: 'shield',   component: PolizzeScreen },
    ],
  },
  {
    sezione: 'Beni & Previdenza',
    items: [
      { name: 'BeniReali',    title: 'Beni Reali',     icon: 'diamond',          component: BeniRealiScreen },
      { name: 'PrevCompl',    title: 'Prev. Compl.',   icon: 'shield-checkmark', component: FondoPensioneScreen },
    ],
  },
  {
    sezione: 'Sistema',
    items: [
      { name: 'Importa', title: 'Importa dati', icon: 'cloud-upload', component: ImportScreen },
    ],
  },
];

const ALL_ITEMS = MENU.flatMap(g => g.items);

// ── Contenuto custom della sidebar ─────────────────────────────────────
function CustomDrawer(props: any) {
  const { state, navigation } = props;
  const activeRoute = state.routeNames[state.index];
  const clearAuth = useStore(s => s.clearAuth);

  const handleLogout = async () => {
    await logout();
    clearAuth();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0B1322' }}>
      <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: 0 }}>
        {/* Brand */}
        <View style={styles.brand}>
          <View style={styles.brandIcon}>
            <Ionicons name="cash" size={20} color={COLORS.primary} />
          </View>
          <View>
            <Text style={styles.brandTitle}>Finanza</Text>
            <Text style={styles.brandSub}>Personale</Text>
          </View>
        </View>

        {/* Gruppi */}
        {MENU.map(group => (
          <View key={group.sezione} style={styles.group}>
            <Text style={styles.groupLabel}>{group.sezione.toUpperCase()}</Text>
            {group.items.map(item => {
              const active = item.name === activeRoute;
              return (
                <TouchableOpacity
                  key={item.name}
                  style={[styles.item, active && styles.itemActive]}
                  onPress={() => navigation.navigate(item.name)}
                >
                  <Ionicons
                    name={(active ? item.icon : `${item.icon}-outline`) as any}
                    size={19}
                    color={active ? COLORS.primary : COLORS.subtext}
                  />
                  <Text style={[styles.itemText, active && styles.itemTextActive]}>{item.title}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </DrawerContentScrollView>

      {/* Logout */}
      <TouchableOpacity style={styles.logout} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={19} color={COLORS.danger} />
        <Text style={styles.logoutText}>Esci</Text>
      </TouchableOpacity>
    </View>
  );
}

function MainDrawer() {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: '#0D1525' },
        headerTintColor: COLORS.text,
        headerTitleStyle: { fontWeight: '800', fontSize: 16 },
        drawerType: isWide ? 'permanent' : 'front',
        drawerStyle: { backgroundColor: '#0B1322', borderRightColor: COLORS.border, borderRightWidth: 1, width: 248 },
        sceneContainerStyle: { backgroundColor: COLORS.bg },
        swipeEdgeWidth: 60,
      }}
    >
      {ALL_ITEMS.map(item => (
        <Drawer.Screen
          key={item.name}
          name={item.name}
          component={item.component}
          options={{ title: item.title }}
        />
      ))}
    </Drawer.Navigator>
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
      <MainDrawer />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingVertical: 20,
    borderBottomWidth: 1, borderBottomColor: COLORS.border + '66', marginBottom: 8,
  },
  brandIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: COLORS.primary + '20', alignItems: 'center', justifyContent: 'center' },
  brandTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', lineHeight: 18 },
  brandSub: { color: COLORS.subtext, fontSize: 11, letterSpacing: 1 },

  group: { marginBottom: 10, paddingHorizontal: 10 },
  groupLabel: { color: COLORS.subtext, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, paddingHorizontal: 8, marginBottom: 4 },

  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  itemActive: { backgroundColor: COLORS.primary + '18' },
  itemText: { color: COLORS.subtext, fontSize: 13, fontWeight: '600' },
  itemTextActive: { color: COLORS.primary, fontWeight: '800' },

  logout: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 22, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: COLORS.border + '66',
  },
  logoutText: { color: COLORS.danger, fontSize: 13, fontWeight: '700' },
});
