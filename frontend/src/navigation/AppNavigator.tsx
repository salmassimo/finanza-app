import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions, Modal, Pressable } from 'react-native';
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
import ContiScreen        from '../screens/ContiScreen';
import RedditoScreen      from '../screens/RedditoScreen';
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
      { name: 'Conti',     title: 'Conti',     icon: 'card',     component: ContiScreen },
      { name: 'Reddito',   title: 'Reddito',   icon: 'cash',     component: RedditoScreen },
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

// ── Navigazione responsive: top-nav (desktop) / hamburger (mobile) ──────
function TopNav({ navigation, current }: { navigation: any; current: string }) {
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const clearAuth = useStore(s => s.clearAuth);

  const handleLogout = async () => {
    await logout();
    clearAuth();
  };

  return isMobile
    ? <MobileNav navigation={navigation} current={current} onLogout={handleLogout} />
    : <DesktopNav navigation={navigation} current={current} onLogout={handleLogout} />;
}

// ── Desktop: top nav a due livelli ──────────────────────────────────────
function DesktopNav({ navigation, current, onLogout }: { navigation: any; current: string; onLogout: () => void }) {
  const activeGroup = groupOf(current);
  return (
    <View style={styles.nav}>
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

        <TouchableOpacity style={styles.logout} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.danger} />
        </TouchableOpacity>
      </View>

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

// ── Mobile: barra compatta + menu a tendina (hamburger) ─────────────────
function MobileNav({ navigation, current, onLogout }: { navigation: any; current: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const currentTitle = ALL_ITEMS.find(i => i.name === current)?.title || 'Finanza';

  const go = (name: string) => { setOpen(false); navigation.navigate(name); };

  return (
    <View style={styles.mNav}>
      <TouchableOpacity style={styles.mIconBtn} onPress={() => setOpen(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="menu" size={26} color={COLORS.text} />
      </TouchableOpacity>
      <Text style={styles.mTitle} numberOfLines={1}>{currentTitle}</Text>
      <TouchableOpacity style={styles.mIconBtn} onPress={onLogout} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Ionicons name="log-out-outline" size={22} color={COLORS.danger} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
            {/* Header del menu */}
            <View style={styles.sheetHeader}>
              <View style={styles.brand}>
                <View style={styles.brandIcon}>
                  <Ionicons name="cash" size={18} color={COLORS.primary} />
                </View>
                <Text style={styles.brandText}>Finanza</Text>
              </View>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={26} color={COLORS.subtext} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {MENU.map(group => (
                <View key={group.sezione} style={styles.mGroup}>
                  <Text style={styles.mGroupLabel}>{group.sezione.toUpperCase()}</Text>
                  {group.items.map(item => {
                    const active = item.name === current;
                    return (
                      <TouchableOpacity
                        key={item.name}
                        style={[styles.mItem, active && styles.mItemActive]}
                        onPress={() => go(item.name)}
                      >
                        <Ionicons name={(active ? item.icon : `${item.icon}-outline`) as any} size={20} color={active ? COLORS.primary : COLORS.subtext} />
                        <Text style={[styles.mItemText, active && styles.mItemTextActive]}>{item.title}</Text>
                        {active && <Ionicons name="checkmark" size={18} color={COLORS.primary} style={{ marginLeft: 'auto' }} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
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

  // ── Mobile ──
  mNav: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0B1322', borderBottomWidth: 1, borderBottomColor: COLORS.border,
    paddingHorizontal: 12, paddingTop: 14, paddingBottom: 12,
  },
  mIconBtn: { padding: 4 },
  mTitle: { flex: 1, color: COLORS.text, fontSize: 17, fontWeight: '800' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#0B1322',
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
    borderBottomWidth: 1, borderColor: COLORS.border,
    paddingBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: COLORS.border + '66',
  },

  mGroup: { paddingHorizontal: 10, paddingTop: 12 },
  mGroupLabel: { color: COLORS.subtext, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, paddingHorizontal: 10, marginBottom: 4 },
  mItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 10 },
  mItemActive: { backgroundColor: COLORS.primary + '18' },
  mItemText: { color: COLORS.text, fontSize: 15, fontWeight: '600' },
  mItemTextActive: { color: COLORS.primary, fontWeight: '800' },
});
