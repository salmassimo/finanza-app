import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { COLORS, fmt, fmtPct, colorPL } from '../../utils/format';

// ── KPI Card ──────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  negative?: boolean;
}
export const KpiCard: React.FC<KpiCardProps> = ({ label, value, sub, highlight, negative }) => (
  <View style={[styles.kpiCard, highlight && styles.kpiCardHighlight]}>
    <Text style={styles.kpiLabel}>{label}</Text>
    <Text style={[styles.kpiValue, highlight && styles.kpiValueHighlight, negative && styles.kpiValueNeg]}>
      {value}
    </Text>
    {sub && <Text style={styles.kpiSub}>{sub}</Text>}
  </View>
);

// ── Section Card ──────────────────────────────────────
interface CardProps {
  title?: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}
export const Card: React.FC<CardProps> = ({ title, children, headerRight }) => (
  <View style={styles.card}>
    {(title || headerRight) && (
      <View style={styles.cardHeader}>
        {title && <Text style={styles.cardTitle}>{title?.toUpperCase()}</Text>}
        {headerRight}
      </View>
    )}
    {children}
  </View>
);

// ── Row Item ──────────────────────────────────────────
interface RowItemProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  onPress?: () => void;
}
export const RowItem: React.FC<RowItemProps> = ({ label, value, sub, valueColor, onPress }) => (
  <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
    <View>
      <Text style={styles.rowLabel}>{label}</Text>
      {sub && <Text style={styles.rowSub}>{sub}</Text>}
    </View>
    <Text style={[styles.rowValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
  </TouchableOpacity>
);

// ── Badge ─────────────────────────────────────────────
interface BadgeProps { label: string; color: string }
export const Badge: React.FC<BadgeProps> = ({ label, color }) => (
  <View style={[styles.badge, { backgroundColor: color + '28', borderColor: color + '66' }]}>
    <Text style={[styles.badgeText, { color }]}>{label}</Text>
  </View>
);

// ── P&L Row ───────────────────────────────────────────
interface PLRowProps { varEur?: number; varPct?: number }
export const PLBadge: React.FC<PLRowProps> = ({ varEur, varPct }) => {
  const col = colorPL(varEur);
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={[styles.plEur, { color: col }]}>
        {varEur !== undefined ? (varEur >= 0 ? '+' : '') + fmt(varEur) : '—'}
      </Text>
      <Text style={[styles.plPct, { color: col }]}>{fmtPct(varPct)}</Text>
    </View>
  );
};

// ── Progress Bar ──────────────────────────────────────
interface ProgressBarProps { pct: number; color?: string }
export const ProgressBar: React.FC<ProgressBarProps> = ({ pct, color = COLORS.primary }) => (
  <View style={styles.progressWrap}>
    <View style={[styles.progressFill, { width: `${Math.min(Math.max(pct, 0), 100)}%`, backgroundColor: color }]} />
  </View>
);

// ── Loading / Error ───────────────────────────────────
export const LoadingView = () => (
  <View style={styles.center}>
    <ActivityIndicator size="large" color={COLORS.primary} />
  </View>
);

export const ErrorView = ({ message }: { message: string }) => (
  <View style={styles.center}>
    <Text style={{ color: COLORS.danger }}>{message}</Text>
  </View>
);

// ── Button ────────────────────────────────────────────
interface BtnProps { label: string; onPress: () => void; color?: string; loading?: boolean }
export const Btn: React.FC<BtnProps> = ({ label, onPress, color = COLORS.primary, loading }) => (
  <TouchableOpacity style={[styles.btn, { borderColor: color + '66' }]} onPress={onPress} disabled={loading}>
    {loading
      ? <ActivityIndicator size="small" color={color} />
      : <Text style={[styles.btnText, { color }]}>{label}</Text>}
  </TouchableOpacity>
);

// ── Styles ─────────────────────────────────────────────
const styles = StyleSheet.create({
  kpiCard:          { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, padding: 16, flex: 1 },
  kpiCardHighlight: { backgroundColor: '#0C1F35', borderColor: COLORS.primary + '66' },
  kpiLabel:         { fontSize: 9, letterSpacing: 2, color: COLORS.subtext, textTransform: 'uppercase', fontWeight: '700', marginBottom: 6 },
  kpiValue:         { fontSize: 20, fontWeight: '800', color: '#fff' },
  kpiValueHighlight:{ color: COLORS.primary },
  kpiValueNeg:      { color: COLORS.danger },
  kpiSub:           { fontSize: 10, color: COLORS.subtext, marginTop: 3 },

  card:        { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, padding: 16, marginBottom: 12 },
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  cardTitle:   { fontSize: 9, letterSpacing: 2, color: COLORS.subtext, fontWeight: '700' },

  row:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border + '44' },
  rowLabel:  { color: '#D1E8F5', fontSize: 13 },
  rowSub:    { color: COLORS.subtext, fontSize: 10, marginTop: 2 },
  rowValue:  { color: '#F1F5F9', fontWeight: '700', fontSize: 13 },

  badge:     { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  plEur:  { fontSize: 13, fontWeight: '600' },
  plPct:  { fontSize: 11, fontWeight: '500' },

  progressWrap: { height: 6, backgroundColor: '#1A2E45', borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  progressFill: { height: '100%', borderRadius: 3 },

  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.bg },

  btn:     { borderWidth: 1, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 6, alignItems: 'center' },
  btnText: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
});
