import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useImmobili, useOrologi } from '../hooks/useData';
import { KpiCard, Card, RowItem, LoadingView, ProgressBar } from '../components/common';
import { COLORS, fmt, fmtShort } from '../utils/format';

export default function BeniRealiScreen() {
  const { data: immobili, isLoading: loadImm } = useImmobili();
  const { data: orologi,  isLoading: loadOr  } = useOrologi();

  if (loadImm || loadOr) return <LoadingView />;

  const totImmobili = immobili?.reduce((s: number, i: any) => s + i.valore_corrente, 0) || 0;
  const totOrologi  = orologi?.reduce((s: number, o: any) => s + (o.stima_min + o.stima_max) / 2, 0) || 0;
  const totEquity   = immobili?.reduce((s: number, i: any) => s + (i.valore_corrente - i.mutuo_residuo), 0) || 0;

  return (
    <ScrollView style={s.container}>
      <View style={s.body}>

        {/* KPI */}
        <View style={s.kpiRow}>
          <KpiCard label="Valore Immobili"   value={fmtShort(totImmobili)} />
          <KpiCard label="Equity Immobiliare" value={fmtShort(totEquity)} highlight />
        </View>
        <View style={s.kpiRow}>
          <KpiCard label="Orologi (stima)"   value={fmtShort(totOrologi)} />
          <KpiCard label="Totale Beni Reali" value={fmtShort(totImmobili + totOrologi)} />
        </View>

        {/* Immobili */}
        <Text style={s.sectionTitle}>IMMOBILI</Text>
        {immobili?.map((im: any) => {
          const equity = im.valore_corrente - im.mutuo_residuo;
          const ltv    = (im.mutuo_residuo / im.valore_corrente) * 100;
          const ltvCol = ltv > 80 ? COLORS.danger : ltv > 50 ? COLORS.warning : COLORS.success;
          return (
            <Card key={im.id}>
              <View style={s.cardHead}>
                <View>
                  <Text style={s.cardName}>{im.nome}</Text>
                  <Text style={s.cardSub}>{im.descrizione}</Text>
                </View>
                <View style={[s.badge, { borderColor: '#818CF866', backgroundColor: '#818CF828' }]}>
                  <Text style={[s.badgeText, { color: '#818CF8' }]}>{im.banca_mutuo || 'IMMOBILE'}</Text>
                </View>
              </View>
              <RowItem label="Valore di mercato"  value={fmt(im.valore_corrente)}  valueColor="#818CF8" />
              <RowItem label="Mutuo residuo"       value={fmt(im.mutuo_residuo)}    valueColor={COLORS.danger} />
              <RowItem label="Equity"              value={fmt(equity)}              valueColor={COLORS.success} />
              <RowItem label="Rata mensile"        value={fmt(im.rata_mensile)} />
              <RowItem label="Scadenza mutuo"      value={im.data_scadenza_mutuo} />
              <View style={{ marginTop: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={s.ltvLabel}>LTV (debito/valore)</Text>
                  <Text style={[s.ltvVal, { color: ltvCol }]}>{ltv.toFixed(1)}%</Text>
                </View>
                <ProgressBar pct={ltv} color={ltvCol} />
                <Text style={s.ltvNote}>LTV ottimale &lt; 80%</Text>
              </View>
            </Card>
          );
        })}

        {/* Orologi */}
        <Text style={s.sectionTitle}>OROLOGI DA COLLEZIONE</Text>
        <View style={s.orologiRow}>
          {orologi?.map((or: any) => (
            <Card key={or.id}>
              <View style={s.cardHead}>
                <View>
                  <Text style={s.cardName}>{or.nome || `${or.marca} ${or.modello}`}</Text>
                  <Text style={s.cardSub}>Ref. {or.riferimento}</Text>
                </View>
                <View style={[s.badge, { borderColor: COLORS.warning + '66', backgroundColor: COLORS.warning + '28' }]}>
                  <Text style={[s.badgeText, { color: COLORS.warning }]}>OROLOGIO</Text>
                </View>
              </View>
              <RowItem label="Stima minima"  value={fmt(or.stima_min)} />
              <RowItem label="Stima massima" value={fmt(or.stima_max)} />
              <View style={s.totRow}>
                <Text style={s.totLabel}>Valore medio stimato</Text>
                <Text style={[s.totValue, { color: COLORS.warning }]}>{fmt((or.stima_min + or.stima_max) / 2)}</Text>
              </View>
            </Card>
          ))}
        </View>

      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg },
  body:         { padding: 16 },
  kpiRow:       { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 9, letterSpacing: 3, color: COLORS.subtext, fontWeight: '700', marginTop: 8, marginBottom: 10 },
  orologiRow:   { gap: 0 },
  cardHead:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  cardName:     { color: COLORS.text, fontWeight: '700', fontSize: 15 },
  cardSub:      { color: COLORS.subtext, fontSize: 11, marginTop: 2 },
  badge:        { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  badgeText:    { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  ltvLabel:     { color: COLORS.subtext, fontSize: 11 },
  ltvVal:       { fontWeight: '700', fontSize: 11 },
  ltvNote:      { fontSize: 9, color: COLORS.subtext, marginTop: 3 },
  totRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4 },
  totLabel:     { color: COLORS.subtext, fontWeight: '700' },
  totValue:     { fontWeight: '800', fontSize: 16 },
});
