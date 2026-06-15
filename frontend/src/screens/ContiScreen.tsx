import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { COLORS, fmt, fmtShort } from '../utils/format';
import api from '../services/api';

const getConti      = () => api.get('/conti/').then(r => r.data);
const getPatrimonio = () => api.get('/patrimonio/corrente').then(r => r.data);

const n = (v: any) => Number(v) || 0;

const TIPO_META: Record<string, { label: string; icon: string; color: string }> = {
  conto_corrente: { label: 'Conto corrente', icon: 'business',  color: COLORS.primary },
  deposito:       { label: 'Deposito',        icon: 'lock-closed', color: COLORS.success },
  carta_credito:  { label: 'Carta di credito', icon: 'card',     color: COLORS.danger },
  investimento:   { label: 'Investimento',    icon: 'trending-up', color: COLORS.purple },
  altro:          { label: 'Altro',           icon: 'ellipse',   color: COLORS.subtext },
};

function ContoRow({ c }: { c: any }) {
  const meta = TIPO_META[c.tipo] || TIPO_META.altro;
  const isCarta = c.tipo === 'carta_credito';
  const saldo = c.saldo_corrente != null ? n(c.saldo_corrente) : null;
  return (
    <View style={st.row}>
      <View style={st.rowLeft}>
        <View style={[st.iconWrap, { backgroundColor: meta.color + '22' }]}>
          <Ionicons name={meta.icon as any} size={16} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.rowName}>{c.nome}</Text>
          <Text style={st.rowSub}>{c.banca || meta.label}{c.rilevato_at ? ` · agg. ${new Date(c.rilevato_at).toLocaleDateString('it-IT')}` : ''}</Text>
        </View>
      </View>
      <Text style={[st.rowValue, { color: isCarta && saldo ? COLORS.danger : COLORS.text }]}>
        {saldo != null ? fmt(saldo) : '—'}
      </Text>
    </View>
  );
}

export default function ContiScreen() {
  const { data: conti = [], isLoading, refetch, isRefetching } = useQuery({ queryKey: ['conti'], queryFn: getConti });
  const { data: pat } = useQuery({ queryKey: ['patrimonio-live'], queryFn: getPatrimonio, retry: 1 });

  const list = conti as any[];
  const correnti = list.filter(c => c.tipo === 'conto_corrente');
  const depositi = list.filter(c => c.tipo === 'deposito');
  const carte    = list.filter(c => c.tipo === 'carta_credito');
  const altri    = list.filter(c => !['conto_corrente', 'deposito', 'carta_credito'].includes(c.tipo));

  // Totali: preferisci il backend (patrimonio), fallback alla somma della lista
  const sumSaldo = (arr: any[]) => arr.reduce((s, c) => s + n(c.saldo_corrente), 0);
  const totCorrenti = n(pat?.saldo_conto_corrente) || sumSaldo(correnti);
  const totDepositi = n(pat?.saldo_deposito) || sumSaldo(depositi);
  const debitoCarta = n(pat?.debito_carta);
  const liquidita   = n(pat?.liquidita_effettiva) || (totCorrenti + totDepositi - debitoCarta);

  return (
    <ScrollView
      style={st.container}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isLoading || isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />}
    >
      {/* Totale liquidità */}
      <View style={st.totalBox}>
        <Text style={st.totalLabel}>LIQUIDITÀ TOTALE</Text>
        <Text style={st.totalVal}>{fmt(liquidita)}</Text>
        <Text style={st.totalSub}>
          Correnti {fmtShort(totCorrenti)}{totDepositi > 0 ? ` + Depositi ${fmtShort(totDepositi)}` : ''}{debitoCarta > 0 ? ` − Carta ${fmtShort(debitoCarta)}` : ''}
        </Text>
      </View>

      {correnti.length > 0 && (
        <View style={st.section}>
          <Text style={st.sectionTitle}>CONTI CORRENTI · {fmtShort(totCorrenti)}</Text>
          {correnti.map(c => <ContoRow key={c.id} c={c} />)}
        </View>
      )}

      {depositi.length > 0 && (
        <View style={st.section}>
          <Text style={st.sectionTitle}>DEPOSITI · {fmtShort(totDepositi)}</Text>
          {depositi.map(c => <ContoRow key={c.id} c={c} />)}
        </View>
      )}

      {carte.length > 0 && (
        <View style={st.section}>
          <Text style={st.sectionTitle}>CARTE DI CREDITO</Text>
          {carte.map(c => <ContoRow key={c.id} c={c} />)}
          {debitoCarta > 0 && (
            <Text style={st.cartaNote}>Debito carta mese corrente: <Text style={{ color: COLORS.danger, fontWeight: '800' }}>{fmt(debitoCarta)}</Text> (dedotto dalla liquidità)</Text>
          )}
        </View>
      )}

      {altri.length > 0 && (
        <View style={st.section}>
          <Text style={st.sectionTitle}>ALTRI CONTI</Text>
          {altri.map(c => <ContoRow key={c.id} c={c} />)}
        </View>
      )}

      {!isLoading && list.length === 0 && (
        <Text style={st.empty}>Nessun conto. Importa un estratto conto da “Importa”.</Text>
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  totalBox:   { backgroundColor: '#0C1F18', borderRadius: 10, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.success + '55' },
  totalLabel: { fontSize: 9, color: COLORS.success, fontWeight: '800', letterSpacing: 2 },
  totalVal:   { fontSize: 28, fontWeight: '900', color: COLORS.success, marginTop: 4 },
  totalSub:   { fontSize: 11, color: COLORS.subtext, marginTop: 4 },

  section:      { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  sectionTitle: { fontSize: 9, color: COLORS.subtext, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },

  row:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border + '44' },
  rowLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconWrap: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  rowName:  { fontSize: 13, color: COLORS.text, fontWeight: '700' },
  rowSub:   { fontSize: 10, color: COLORS.subtext, marginTop: 1 },
  rowValue: { fontSize: 14, fontWeight: '800', minWidth: 90, textAlign: 'right' },

  cartaNote: { fontSize: 10, color: COLORS.subtext, marginTop: 8 },
  empty:     { color: COLORS.subtext, textAlign: 'center', paddingVertical: 30 },
});
