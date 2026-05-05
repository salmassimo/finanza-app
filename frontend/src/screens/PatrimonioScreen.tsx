import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { COLORS, fmt, fmtShort } from '../utils/format';
import FinanceChart, { ChartPoint, fmtYValue } from '../components/FinanceChart';
import api from '../services/api';

const W      = Dimensions.get('window').width;
const CHART_W = W - 48;

const getPatrimonio    = () => api.get('/patrimonio/corrente').then(r => r.data);
const getConti         = () => api.get('/conti/').then(r => r.data);
const getMutui         = () => api.get('/mutui/').then(r => r.data);
const getImmobili      = () => api.get('/immobili/').then(r => r.data);
const getOrologi       = () => api.get('/orologi/').then(r => r.data);
const getPortafoglio   = () => api.get('/portafoglio/').then(r => r.data);
const getStoricoMensile = (mesi: number) =>
  api.get('/patrimonio/storico-mensile', { params: { mesi } }).then(r => r.data);

const n = (v: any) => Number(v) || 0;

// ── Range ──────────────────────────────────────────────
type RangeKey = '3M' | '6M' | '1A' | 'MAX';
const RANGES: { key: RangeKey; label: string; mesi: number }[] = [
  { key: '3M',  label: '3M',  mesi: 4 },
  { key: '6M',  label: '6M',  mesi: 7 },
  { key: '1A',  label: '1A',  mesi: 13 },
  { key: 'MAX', label: 'MAX', mesi: 24 },
];

function RangePicker({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <View style={rp.row}>
      {RANGES.map(r => (
        <TouchableOpacity key={r.key} style={[rp.btn, value === r.key && rp.btnActive]} onPress={() => onChange(r.key)}>
          <Text style={[rp.txt, value === r.key && rp.txtActive]}>{r.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const rp = StyleSheet.create({
  row:       { flexDirection: 'row', gap: 4 },
  btn:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border },
  btnActive: { backgroundColor: '#0C1F35', borderColor: COLORS.primary },
  txt:       { fontSize: 11, fontWeight: '700', color: COLORS.subtext },
  txtActive: { color: COLORS.primary },
});

// ── Grafico patrimonio storico ─────────────────────────
function PatrimonioChart() {
  const [range, setRange] = useState<RangeKey>('1A');
  const mesiRichiesti = RANGES.find(r => r.key === range)!.mesi;

  const { data: storico = [], isLoading } = useQuery({
    queryKey: ['storico-mensile', mesiRichiesti],
    queryFn: () => getStoricoMensile(mesiRichiesti),
    staleTime: 5 * 60 * 1000,
  });

  const chartPts: ChartPoint[] = useMemo(() =>
    (storico as any[]).map((d: any) => ({
      value: n(d.patrimonio_netto),
      label: d.label,
    })),
    [storico]
  );

  if (isLoading) return <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 24 }} />;

  if (chartPts.length < 2) return (
    <View style={st.emptyChart}>
      <Ionicons name="analytics-outline" size={28} color={COLORS.subtext} />
      <Text style={st.emptyChartText}>
        Nessun dato disponibile per il periodo.
      </Text>
    </View>
  );

  const lastVal  = chartPts[chartPts.length - 1].value;
  const firstVal = chartPts[0].value;
  const delta    = lastVal - firstVal;
  const deltaPct = firstVal !== 0 ? (delta / Math.abs(firstVal)) * 100 : 0;
  const lineColor = delta >= 0 ? COLORS.success : COLORS.danger;

  return (
    <View>
      {/* Header */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <View>
          <Text style={st.chartTitle}>Patrimonio Netto</Text>
          <Text style={{ fontSize: 10, color: delta >= 0 ? COLORS.success : COLORS.danger, fontWeight: '700', marginTop: 2 }}>
            {delta >= 0 ? '+' : ''}{fmtShort(delta)} ({deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%) nel periodo
          </Text>
        </View>
        <RangePicker value={range} onChange={setRange} />
      </View>

      <FinanceChart
        points={chartPts}
        width={CHART_W}
        height={190}
        color={lineColor}
        formatY={fmtYValue}
      />
    </View>
  );
}

// ── Componenti UI ──────────────────────────────────────
function Row({ label, value, color, sub, bold }: {
  label: string; value: string; color?: string; sub?: string; bold?: boolean;
}) {
  return (
    <View style={st.row}>
      <View style={{ flex: 1 }}>
        <Text style={[st.rowLabel, bold && { fontWeight: '800', color: COLORS.text }]}>{label}</Text>
        {sub ? <Text style={st.rowSub}>{sub}</Text> : null}
      </View>
      <Text style={[st.rowValue, { color: color || COLORS.text }, bold && { fontSize: 15 }]}>{value}</Text>
    </View>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={st.card}>
      <View style={st.cardHeader}>
        <Ionicons name={icon as any} size={14} color={COLORS.primary} />
        <Text style={st.cardTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={{ height: 5, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden', marginVertical: 4 }}>
      <View style={{ height: 5, width: `${Math.min(pct, 100)}%` as any, backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────
export default function PatrimonioScreen() {
  const { data: pat, isLoading } = useQuery({ queryKey: ['patrimonio-live'], queryFn: getPatrimonio, retry: 1 });
  const { data: conti = [] }    = useQuery({ queryKey: ['conti'],       queryFn: getConti });
  const { data: mutui = [] }    = useQuery({ queryKey: ['mutui'],       queryFn: getMutui });
  const { data: immobili = [] } = useQuery({ queryKey: ['immobili'],    queryFn: getImmobili });
  const { data: orologi = [] }  = useQuery({ queryKey: ['orologi'],     queryFn: getOrologi });
  const { data: port = [] }     = useQuery({ queryKey: ['portafoglio'], queryFn: getPortafoglio });

  if (isLoading) return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator color={COLORS.primary} size="large" />
    </View>
  );

  const saldoCC      = n(pat?.saldo_conto_corrente);
  const saldoDeposito = n(pat?.saldo_deposito);
  const debitoCarta  = n(pat?.debito_carta);
  const liquidita    = n(pat?.liquidita_effettiva);
  const portFineco  = n(pat?.portafoglio_fineco);
  const portRevol   = n(pat?.portafoglio_revolut);
  const portTotale  = portFineco + portRevol;
  const immVal      = n(pat?.immobili_valore);
  const orVal       = n(pat?.orologi_valore);
  const totAsset    = n(pat?.totale_asset);
  const totPassivo  = n(pat?.totale_passivo);
  const patriNetto  = n(pat?.patrimonio_netto);

  const portFallback          = (port as any[]).reduce((s: number, p: any) => s + n(p.valore_mercato), 0);
  const effectivePortTotale   = portTotale || portFallback;
  const effectiveTotAsset     = totAsset || (liquidita + effectivePortTotale + immVal + orVal);
  const effectiveTotPassivo   = totPassivo || (mutui as any[]).reduce((s: number, m: any) => s + n(m.capitale_residuo_live), 0);
  const effectivePatriNetto   = patriNetto || (effectiveTotAsset - effectiveTotPassivo);

  const pct = (v: number) => effectiveTotAsset > 0 ? (v / effectiveTotAsset) * 100 : 0;

  return (
    <ScrollView style={st.container}>
      <View style={st.body}>

        {/* Hero */}
        <View style={st.hero}>
          <Text style={st.heroLabel}>PATRIMONIO NETTO</Text>
          <Text style={[st.heroValue, { color: effectivePatriNetto >= 0 ? COLORS.success : COLORS.danger }]}>
            {fmtShort(effectivePatriNetto)}
          </Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={st.heroMeta}>{fmtShort(effectiveTotAsset)}</Text>
              <Text style={st.heroMetaLabel}>Asset totali</Text>
            </View>
            <Text style={{ color: COLORS.subtext, fontSize: 18, alignSelf: 'center' }}>−</Text>
            <View style={{ alignItems: 'center' }}>
              <Text style={[st.heroMeta, { color: COLORS.danger }]}>{fmtShort(effectiveTotPassivo)}</Text>
              <Text style={st.heroMetaLabel}>Passività</Text>
            </View>
          </View>
        </View>

        {/* Grafico storico patrimonio */}
        <View style={st.card}>
          <View style={st.cardHeader}>
            <Ionicons name="trending-up-outline" size={14} color={COLORS.primary} />
            <Text style={st.cardTitle}>EVOLUZIONE PATRIMONIO</Text>
          </View>
          <PatrimonioChart />
        </View>

        {/* 1 — LIQUIDITÀ */}
        <SectionCard title="LIQUIDITÀ" icon="wallet-outline">
          <Row label="Saldo conti correnti" value={fmt(saldoCC)} sub="UniCredit + Revolut CC" />
          {saldoDeposito > 0 && (
            <Row label="Deposito" value={fmt(saldoDeposito)} color={COLORS.primary} sub="Revolut Deposito" />
          )}
          {debitoCarta > 0 && (
            <Row label="Debito carta (mese corrente)" value={`− ${fmt(debitoCarta)}`} color={COLORS.danger} sub="Carta di credito" />
          )}
          <View style={st.divider} />
          <Row label="Liquidità effettiva" value={fmt(liquidita)} color={liquidita >= 0 ? COLORS.success : COLORS.danger} bold />
          <ProgressBar pct={pct(liquidita)} color={COLORS.success} />
          <Text style={st.pctLabel}>{pct(liquidita).toFixed(1)}% del totale asset</Text>
        </SectionCard>

        {/* 2 — INVESTIMENTI */}
        <SectionCard title="INVESTIMENTI" icon="trending-up-outline">
          {portFineco > 0 && (
            <Row label="Portafoglio Fineco" value={fmt(portFineco)} color={COLORS.primary}
              sub={`${(port as any[]).filter((p: any) => p.piattaforma === 'Fineco' && p.attivo).length} posizioni`} />
          )}
          {portRevol > 0 && <Row label="Revolut Investimenti" value={fmt(portRevol)} color="#9B59B6" />}
          {effectivePortTotale === 0 && portFallback > 0 && (
            <Row label="Portafoglio (calcolato)" value={fmt(portFallback)} color={COLORS.primary} />
          )}
          {effectivePortTotale === 0 && portFallback === 0 && <Text style={st.empty}>Nessun investimento registrato</Text>}
          {effectivePortTotale > 0 && (
            <>
              <View style={st.divider} />
              <Row label="Totale investimenti" value={fmt(effectivePortTotale)} color={COLORS.primary} bold />
              <ProgressBar pct={pct(effectivePortTotale)} color={COLORS.primary} />
              <Text style={st.pctLabel}>{pct(effectivePortTotale).toFixed(1)}% del totale asset</Text>
            </>
          )}
        </SectionCard>

        {/* 3 — IMMOBILI */}
        {(immobili as any[]).length > 0 && (
          <SectionCard title="IMMOBILI" icon="home-outline">
            {(immobili as any[]).map((im: any) => {
              const valore = n(im.valore_corrente) || n(im.valore_acquisto);
              return (
                <View key={im.id}>
                  <Row label={im.nome} value={fmt(valore)} color="#818CF8"
                    sub={`${im.tipo} · ${im.superficie_mq ? im.superficie_mq + ' mq' : ''} · ${im.indirizzo || ''}`} />
                </View>
              );
            })}
            {immVal > 0 && (
              <>
                <View style={st.divider} />
                <Row label="Totale immobili" value={fmt(immVal)} color="#818CF8" bold />
                <ProgressBar pct={pct(immVal)} color="#818CF8" />
                <Text style={st.pctLabel}>{pct(immVal).toFixed(1)}% del totale asset</Text>
              </>
            )}
          </SectionCard>
        )}

        {/* 4 — BENI OROLOGI */}
        {(orologi as any[]).length > 0 && (
          <SectionCard title="BENI (OROLOGI)" icon="time-outline">
            {(orologi as any[]).map((or: any) => {
              const media = (n(or.stima_min) + n(or.stima_max)) / 2;
              return <Row key={or.id} label={`${or.marca} ${or.modello}`} sub={`Rif. ${or.riferimento || '—'}`} value={fmt(media)} color={COLORS.warning} />;
            })}
            {orVal > 0 && (
              <>
                <View style={st.divider} />
                <Row label="Totale beni" value={fmt(orVal)} color={COLORS.warning} bold />
              </>
            )}
          </SectionCard>
        )}

        {/* 5 — PASSIVITÀ */}
        <SectionCard title="PASSIVITÀ — MUTUI" icon="business-outline">
          {(mutui as any[]).length === 0 ? (
            <Text style={st.empty}>Nessun mutuo registrato</Text>
          ) : (mutui as any[]).map((m: any) => {
            const residuo = n(m.capitale_residuo_live);
            const erogato = n(m.capitale_erogato);
            const pctRimb = erogato > 0 ? ((erogato - residuo) / erogato) * 100 : 0;
            const nextDate = m.prossima_scadenza ? new Date(m.prossima_scadenza).toLocaleDateString('it-IT') : null;
            return (
              <View key={m.id} style={{ marginBottom: 14 }}>
                <Row label={m.nome} value={fmt(residuo)} color={COLORS.danger}
                  sub={`${m.banca} · ${m.rate_pagate_live}/${m.rate_totali} rate pagate`} />
                <ProgressBar pct={pctRimb} color={COLORS.success} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}>
                  <Text style={st.pctLabel}>Rimborsato {pctRimb.toFixed(1)}%</Text>
                  {nextDate && <Text style={st.pctLabel}>Prossima: {nextDate} · {fmt(m.prossima_rata)}</Text>}
                </View>
                <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
                  <View style={st.chipRow}>
                    <Text style={st.chipLabel}>Int. pagati</Text>
                    <Text style={st.chipValue}>{fmt(n(m.interessi_pagati))}</Text>
                  </View>
                  <View style={st.chipRow}>
                    <Text style={st.chipLabel}>Int. residui</Text>
                    <Text style={[st.chipValue, { color: COLORS.danger }]}>{fmt(n(m.interessi_residui))}</Text>
                  </View>
                </View>
              </View>
            );
          })}
          {(mutui as any[]).length > 0 && (
            <>
              <View style={st.divider} />
              <Row label="Totale debito" value={fmt(effectiveTotPassivo)} color={COLORS.danger} bold />
            </>
          )}
        </SectionCard>

        {/* 6 — EQUITY IMMOBILIARE */}
        {(immobili as any[]).length > 0 && (mutui as any[]).length > 0 && (() => {
          const immMap: Record<string, any> = {};
          (mutui as any[]).forEach((m: any) => { if (m.immobile_id) immMap[m.immobile_id] = m; });
          return (
            <SectionCard title="EQUITY IMMOBILIARE" icon="trending-up-outline">
              {(immobili as any[]).map((im: any) => {
                const valore  = n(im.valore_corrente) || n(im.valore_acquisto);
                const mutuo   = immMap[im.id];
                const residuo = mutuo ? n(mutuo.capitale_residuo_live) : 0;
                const equity  = valore - residuo;
                const ltv     = valore > 0 ? (residuo / valore) * 100 : 0;
                return (
                  <View key={im.id} style={{ marginBottom: 10 }}>
                    <Row label={im.nome} value={fmt(equity)} color={COLORS.success}
                      sub={`LTV ${ltv.toFixed(1)}% · Valore ${fmtShort(valore)} · Mutuo ${fmtShort(residuo)}`} />
                  </View>
                );
              })}
            </SectionCard>
          );
        })()}

      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body:      { padding: 14, paddingBottom: 32 },

  hero:          { backgroundColor: COLORS.surface, borderRadius: 12, padding: 20, marginBottom: 12, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  heroLabel:     { fontSize: 9, letterSpacing: 3, color: COLORS.subtext, fontWeight: '800', marginBottom: 6 },
  heroValue:     { fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  heroMeta:      { fontSize: 16, fontWeight: '800', color: COLORS.text },
  heroMetaLabel: { fontSize: 9, color: COLORS.subtext, fontWeight: '600', marginTop: 2 },

  card:       { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  cardTitle:  { fontSize: 9, color: COLORS.subtext, fontWeight: '800', letterSpacing: 2 },
  chartTitle: { fontSize: 13, fontWeight: '800', color: COLORS.text },

  emptyChart:    { alignItems: 'center', paddingVertical: 24, gap: 8 },
  emptyChartText:{ color: COLORS.subtext, fontSize: 12, textAlign: 'center', lineHeight: 18 },

  row:      { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border + '33' },
  rowLabel: { fontSize: 12, color: COLORS.subtext, fontWeight: '600' },
  rowSub:   { fontSize: 9, color: COLORS.subtext + 'AA', marginTop: 1 },
  rowValue: { fontSize: 13, fontWeight: '700', minWidth: 80, textAlign: 'right' },

  divider:  { height: 1, backgroundColor: COLORS.border, marginVertical: 8 },
  pctLabel: { fontSize: 9, color: COLORS.subtext, marginTop: 2 },
  empty:    { color: COLORS.subtext, fontSize: 12, paddingVertical: 8, textAlign: 'center' },

  chipRow:   { flex: 1, backgroundColor: COLORS.bg, borderRadius: 6, padding: 6 },
  chipLabel: { fontSize: 9, color: COLORS.subtext, fontWeight: '700', marginBottom: 2 },
  chipValue: { fontSize: 12, fontWeight: '700', color: COLORS.text },
});
