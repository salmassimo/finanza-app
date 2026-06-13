import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
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
type MenuGroup = { sezione: string; icon: string; items: MenuItem[] };

const MENU: MenuGroup[] = [
  {
    sezione: 'Panoramica', icon: 'grid',
    items: [
      { name: 'Overview',   title: 'Overview',    icon: 'home',       component: OverviewScreen },
      { name: 'Patrimonio', title: 'Patrimonio',  icon: 'pie-chart',  component: PatrimonioScreen },
      { name: 'Futuro',     title: 'Futuro',      icon: 'analytics',  component: FuturoScreen },
    ],
  },
  {
    sezione: 'Investimenti', icon: 'trending-up',
    items: [
      { name: 'Investimenti', title: 'Investimenti',   icon: 'trending-up', component: InvestimentiScreen },
      { name: 'News',         title: 'News & Mercati',  icon: 'newspaper',   component: NewsScreen },
      { name: 'Advisor',      title: 'AI Advisor',      icon: 'sparkles',    component: AdvisorScreen },
    ],
  },
  {
    sezione: 'Conti & Spese', icon: 'wallet',
    items: [
      { name: 'Movimenti', title: 'Movimenti', icon: 'wallet',   component: MovimentiScreen },
      { name: 'Mutui',     title: 'Mutui',     icon: 'business', component: MutuiScreen },
      { name: 'Polizze',   title: 'Polizze',   icon: 'shield',   component: PolizzeScreen },
    ],
  },
  {
    sezione: 'Beni & Previdenza', icon: 'diamond',
    items: [
      { name: 'BeniReali',  title: 'Beni Reali',    icon: 'diamond',          component: BeniRealiScreen },
      { name: 'PrevCompl',  title: 'Prev. Compl.',  icon: 'shield-checkmark', component: FondoPensioneScreen },
    ],
  },
  {
    sezione: 'Sistema', icon: 'cloud-upload',
    items: [
      { name: 'Importa', title: 'Importa dati', icon: 'cloud-upload', component: ImportScreen },
    ],
  },
];

const ALL_ITEMS = MENU.flatMap(g => g.items);
const groupOf = (routeName: string) =>
  MENU.find(g => g.items.some(i => i.name === routeName)) || MENU[0];

// ── Top navigation a due livelli ───────────────────────────────────────
function TopNav({ navigation, current }: { navigation: any; current: string }) {
  const activeGroup = groupOf(current);
  const clearAuth = useStore(s => s.clearAuth);

  const handleLogout = async () => {
    await logout();
    clearAuth();
  };

  return (
    <View style={styles.nav}>
      {/* Riga 1: brand + gruppi */}
      <View style={styles.row1}>
        <View style={styles.brand}>
          <View style={styles.brandIcon}>
            <Ionicons name="cash" size={18} color={COLORS.primary} />
          </View>
          <Text style={styles.brandText}>Finanza</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.groupsScroll} contentContainerStyle={styles.groupsRow}>
          {MENU.map(g => {
            const active = g.sezione === activeGroup.sezione;
            return (
              <TouchableOpacity
                key={g.sezione}
                style={[styles.groupBtn, active && styles.groupBtnActive]}
                onPress={() => navigation.navigate(g.items[0].name)}
              >
                <Ionicons name={(active ? g.icon : `${g.icon}-outline`) as any} size={15} color={active ? COLORS.primary : COLORS.subtext} />
                <Text style={[styles.groupText, active && styles.groupTextActive]}>{g.sezione}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity style={styles.logout} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
        </TouchableOpacity>
      </View>

      {/* Riga 2: voci del gruppo attivo */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.subScroll} contentContainerStyle={styles.subRow}>
        {activeGroup.items.map(item => {
          const active = item.name === current;
          return (
            <TouchableOpacity
              key={item.name}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => navigation.navigate(item.name)}
            >
              <Ionicons name={(active ? item.icon : `${item.icon}-outline`) as any} size={16} color={active ? COLORS.primary : COLORS.subtext} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.title}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function MainNav() {
  return (
    <Drawer.Navigator
      // Drawer nascosto: la navigazione avviene dalla top nav custom
      drawerContent={() => null}
      screenOptions={({ navigation, route }) => ({
        header: () => <TopNav navigation={navigation} current={route.name} />,
        drawerType: 'front',
        drawerStyle: { width: 0 },
        swipeEnabled: false,
        overlayColor: 'transparent',
        sceneContainerStyle: { backgroundColor: COLORS.bg },
      })}
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
      <MainNav />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  nav: { backgroundColor: '#0B1322', borderBottomWidth: 1, borderBottomColor: COLORS.border },

  row1: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: COLORS.primary + '20', alignItems: 'center', justifyContent: 'center' },
  brandText: { color: COLORS.text, fontSize: 15, fontWeight: '800' },

  groupsScroll: { flex: 1 },
  groupsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  groupBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  groupBtnActive: { backgroundColor: COLORS.primary + '18' },
  groupText: { color: COLORS.subtext, fontSize: 12, fontWeight: '700' },
  groupTextActive: { color: COLORS.primary },

  logout: { padding: 6 },

  subScroll: { borderTopWidth: 1, borderTopColor: COLORS.border + '55' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 7 },
  tabActive: { backgroundColor: COLORS.primary + '14', borderWidth: 1, borderColor: COLORS.primary + '44' },
  tabText: { color: COLORS.subtext, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: COLORS.primary, fontWeight: '800' },
});
