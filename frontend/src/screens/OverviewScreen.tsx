import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { COLORS, fmt, fmtShort } from '../utils/format';
import api from '../services/api';

const getPatrimonio = () => api.get('/patrimonio/corrente').then(r => r.data);
const getConti     = () => api.get('/conti/').then(r => r.data);
const getMutui     = () => api.get('/mutui/').then(r => r.data);
const getPortafoglio = () => api.get('/portafoglio/').then(r => r.data);
const getSaldo     = () => api.get('/movimenti/saldo-effettivo').then(r => r.data);
const getMesiDisp  = () => api.get('/movimenti/mesi-disponibili').then(r => r.data);

const n = (v: any) => Number(v) || 0;

function KpiCard({ label, value, color, icon, sub }: {
  label: string; value: string; color?: string; icon?: string; sub?: string;
}) {
  return (
    <View style={st.kpi}>
      <Text style={st.kpiLabel}>{label}</Text>
      <Text style={[st.kpiVal, { color: color || COLORS.text }]}>{value}</Text>
      {sub ? <Text style={st.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={st.section}>
      <View style={st.sectionHeader}>
        <Ionicons name={icon as any} size={13} color={COLORS.primary} />
        <Text style={st.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function BarRow({ label, value, total, color, sub }: {
  label: string; value: number; total: number; color: string; sub?: string;
}) {
  const pct = total > 0 ? Math.min((value / total) * 100, 100) : 0;
  return (
    <View style={st.barRow}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
          <View>
            <Text style={st.barLabel}>{label}</Text>
            {sub ? <Text style={st.barSub}>{sub}</Text> : null}
          </View>
          <Text style={[st.barValue, { color }]}>{fmtShort(value)}</Text>
        </View>
        <View style={st.barBg}>
          <View style={[st.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
        </View>
      </View>
    </View>
  );
}

export default function OverviewScreen() {
  const navigation = useNavigation<any>();
  const { data: pat, isLoading: loadPat, refetch: refetchPat } = useQuery({
    queryKey: ['patrimonio-live'], queryFn: getPatrimonio, retry: 1,
  });
  const { data: conti = [] }   = useQuery({ queryKey: ['conti'], queryFn: getConti });
  const { data: mutui = [] }   = useQuery({ queryKey: ['mutui'], queryFn: getMutui });
  const { data: port = [] }    = useQuery({ queryKey: ['portafoglio'], queryFn: getPortafoglio });
  const { data: saldo }        = useQuery({ queryKey: ['saldo-effettivo'], queryFn: getSaldo });
  const { data: mesi = [] }    = useQuery({ queryKey: ['mesi-disponibili'], queryFn: getMesiDisp });

  const isLoading = loadPat;
  const refetch   = refetchPat;

  // valori sicuri
  const patrimNetto  = n(pat?.patrimonio_netto);
  const totAsset     = n(pat?.totale_asset);
  const totPassivo   = n(pat?.totale_passivo);
  const saldoCC      = n(pat?.saldo_conto_corrente || saldo?.saldo_conto);
  const saldoDeposito = n(pat?.saldo_deposito || saldo?.saldo_deposito);
  const debitoCarta  = n(pat?.debito_carta || saldo?.debito_carta);
  const liquidita    = n(pat?.liquidita_effettiva || saldo?.liquidita_effettiva);
  const portFineco   = n(pat?.portafoglio_fineco);
  const portRevolut  = n(pat?.portafoglio_revolut);
  const portTotale   = portFineco + portRevolut;
  const immobiliVal  = n(pat?.immobili_valore);
  const orologiVal   = n(pat?.orologi_valore);
  const mutuiTot     = n(pat?.totale_mutui);

  // Calcola totale portafoglio da lista posizioni se patrimonio non disponibile
  const portFallback = (port as any[]).reduce((s: number, p: any) => s + n(p.valore_mercato), 0);

  // ── Equity disponibile = liquidità + portafoglio al netto della tassazione
  //    sulle plusvalenze (26% sul guadagno netto del portafoglio) ──
  const ALIQUOTA_CG  = 0.26;
  const portMktList  = (port as any[]).reduce((s: number, p: any) => s + n(p.valore_mercato), 0);
  const portCarList  = (port as any[]).reduce((s: number, p: any) => s + n(p.valore_carico), 0);
  const portMktEq    = portMktList > 0 ? portMktList : portTotale;
  const plusvalenza  = Math.max(0, portMktList - portCarList);
  const tasseCG      = plusvalenza * ALIQUOTA_CG;
  const portNetto    = portMktEq - tasseCG;
  const equity       = liquidita + portNetto;

  const today = new Date();
  const meseCorrente = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const mesiCount = (mesi as string[]).length;

  return (
    <ScrollView
      style={st.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.primary} />}
    >
      {/* Hero */}
      <View style={st.hero}>
        <Text style={st.heroLabel}>PATRIMONIO NETTO</Text>
        <Text style={[st.heroValue, { color: patrimNetto >= 0 ? COLORS.success : COLORS.danger }]}>
          {fmtShort(patrimNetto)}
        </Text>
        <View style={st.heroSub}>
          <Text style={st.heroSubText}>Asset {fmtShort(totAsset)}</Text>
          <Ionicons name="remove" size={10} color={COLORS.subtext} />
          <Text style={st.heroSubText}>Debiti {fmtShort(totPassivo)}</Text>
        </View>
        {pat?.calcolato_at && (
          <Text style={st.heroDate}>
            Calcolato {new Date(pat.calcolato_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
      </View>

      <View style={st.body}>

        {/* KPI row */}
        <View style={st.kpiRow}>
          <KpiCard label="LIQUIDITÀ EFFETTIVA" value={fmtShort(liquidita)}
            color={liquidita >= 0 ? COLORS.success : COLORS.danger}
            sub={`CC ${fmtShort(saldoCC)}${saldoDeposito > 0 ? ` + Dep ${fmtShort(saldoDeposito)}` : ''} − Carta ${fmtShort(debitoCarta)}`} />
          <KpiCard label="PORTAFOGLIO" value={fmtShort(portTotale || portFallback)}
            color={COLORS.primary}
            sub={`Fineco ${fmtShort(portFineco)}`} />
        </View>

        {/* Equity disponibile (netto tasse) */}
        <View style={st.equityBox}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={st.equityLabel}>EQUITY DISPONIBILE</Text>
            <Ionicons name="cash-outline" size={16} color={COLORS.success} />
          </View>
          <Text style={st.equityVal}>{fmt(equity)}</Text>
          <Text style={st.equitySub}>
            Liquidità {fmtShort(liquidita)} + Portafoglio netto {fmtShort(portNetto)}
          </Text>
          {tasseCG > 0 && (
            <Text style={st.equityTax}>
              − Tasse plusvalenze (26%): {fmt(tasseCG)}  ·  Portafoglio lordo {fmtShort(portMktEq)}
            </Text>
          )}
        </View>

        {/* Composizione Asset */}
        <Section title="COMPOSIZIONE ASSET" icon="pie-chart-outline">
          {liquidita > 0 && (
            <BarRow label="Liquidità effettiva" value={liquidita} total={totAsset}
              color={COLORS.success} sub={`Saldo CC − debito carta`} />
          )}
          {(portTotale > 0 || portFallback > 0) && (
            <BarRow label="Portafoglio investimenti" value={portTotale || portFallback}
              total={totAsset} color={COLORS.primary} />
          )}
          {immobiliVal > 0 && (
            <BarRow label="Immobili" value={immobiliVal} total={totAsset} color="#818CF8" />
          )}
          {orologiVal > 0 && (
            <BarRow label="Beni (orologi ecc.)" value={orologiVal} total={totAsset} color={COLORS.warning} />
          )}
        </Section>

        {/* Conti */}
        {(conti as any[]).length > 0 && (
          <Section title="CONTI & SALDI" icon="wallet-outline">
            {(conti as any[]).map((c: any) => (
              <View key={c.id} style={st.row}>
                <View style={st.rowLeft}>
                  <Ionicons
                    name={(c.tipo === 'carta_credito' ? 'card' : 'business') as any}
                    size={14} color={c.tipo === 'carta_credito' ? COLORS.danger : COLORS.primary}
                  />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={st.rowLabel}>{c.nome}</Text>
                    {c.banca ? <Text style={st.rowSub}>{c.banca}</Text> : null}
                  </View>
                </View>
                <Text style={[st.rowValue, {
                  color: c.tipo === 'carta_credito' ? COLORS.danger : COLORS.text,
                }]}>
                  {c.saldo_corrente != null
                    ? fmt(n(c.saldo_corrente))
                    : c.tipo === 'carta_credito' && debitoCarta > 0
                      ? `−${fmt(debitoCarta)}`
                      : '—'}
                </Text>
              </View>
            ))}
            {debitoCarta > 0 && (
              <View style={st.debitoRow}>
                <Ionicons name="warning-outline" size={12} color={COLORS.warning} />
                <Text style={st.debitoText}>
                  Debito carta mese corrente: <Text style={{ color: COLORS.danger, fontWeight: '800' }}>{fmt(debitoCarta)}</Text>
                </Text>
              </View>
            )}
          </Section>
        )}

        {/* Mutui */}
        {(mutui as any[]).length > 0 && (
          <Section title="MUTUI IN CORSO" icon="business-outline">
            {(mutui as any[]).map((m: any) => {
              const residuo  = n(m.capitale_residuo_live);
              const erogato  = n(m.capitale_erogato);
              const pct      = erogato > 0 ? ((erogato - residuo) / erogato) * 100 : 0;
              const nextDate = m.prossima_scadenza
                ? new Date(m.prossima_scadenza).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
                : null;
              return (
                <View key={m.id} style={st.mutuoCard}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <View>
                      <Text style={st.mutuoNome}>{m.nome}</Text>
                      <Text style={st.rowSub}>{m.banca} · {m.rate_pagate_live}/{m.rate_totali} rate</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[st.rowValue, { color: COLORS.danger }]}>{fmtShort(residuo)}</Text>
                      <Text style={st.rowSub}>residuo</Text>
                    </View>
                  </View>
                  <View style={st.barBg}>
                    <View style={[st.barFill, { width: `${pct}%` as any, backgroundColor: COLORS.success }]} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={st.rowSub}>Rimborsato {pct.toFixed(1)}%</Text>
                    {nextDate && <Text style={st.rowSub}>Prossima: {nextDate} · {fmt(m.prossima_rata)}</Text>}
                  </View>
                </View>
              );
            })}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border + '44' }}>
              <Text style={{ color: COLORS.subtext, fontWeight: '700', fontSize: 11 }}>Totale debito</Text>
              <Text style={{ color: COLORS.danger, fontWeight: '800', fontSize: 13 }}>{fmtShort(mutuiTot)}</Text>
            </View>
          </Section>
        )}

        {/* Movimenti rapidi */}
        {mesiCount > 0 && (
          <Section title="MOVIMENTI" icon="swap-horizontal-outline">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={st.rowSub}>Dati disponibili per {mesiCount} {mesiCount === 1 ? 'mese' : 'mesi'}</Text>
              <TouchableOpacity style={st.badge} onPress={() => navigation.navigate('Movimenti')}>
                <Text style={st.badgeText}>Vai a Movimenti →</Text>
              </TouchableOpacity>
            </View>
          </Section>
        )}

      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body:      { padding: 14 },

  hero:       { backgroundColor: '#0D1525', paddingHorizontal: 20, paddingTop: 48, paddingBottom: 24, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  heroLabel:  { fontSize: 9, letterSpacing: 4, color: COLORS.primary, fontWeight: '800', marginBottom: 6 },
  heroValue:  { fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  heroSub:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  heroSubText:{ fontSize: 11, color: COLORS.subtext },
  heroDate:   { fontSize: 9, color: COLORS.subtext + '88', marginTop: 8 },

  kpiRow:    { flexDirection: 'row', gap: 8, marginBottom: 10, marginTop: 8 },
  kpi:       { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  kpiLabel:  { fontSize: 9, color: COLORS.subtext, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  kpiVal:    { fontSize: 16, fontWeight: '800' },
  kpiSub:    { fontSize: 9, color: COLORS.subtext, marginTop: 3 },

  equityBox:   { backgroundColor: '#0C1F18', borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.success + '55' },
  equityLabel: { fontSize: 9, color: COLORS.success, fontWeight: '800', letterSpacing: 2 },
  equityVal:   { fontSize: 26, fontWeight: '900', color: COLORS.success, marginTop: 4 },
  equitySub:   { fontSize: 11, color: COLORS.text, marginTop: 4 },
  equityTax:   { fontSize: 10, color: COLORS.subtext, marginTop: 3 },

  section:       { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  sectionTitle:  { fontSize: 9, color: COLORS.subtext, fontWeight: '800', letterSpacing: 2 },

  barRow:   { marginBottom: 12 },
  barLabel: { fontSize: 12, color: COLORS.text, fontWeight: '600' },
  barSub:   { fontSize: 9, color: COLORS.subtext },
  barValue: { fontSize: 13, fontWeight: '800' },
  barBg:    { height: 5, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  barFill:  { height: 5, borderRadius: 3 },

  row:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border + '44' },
  rowLeft:   { flexDirection: 'row', alignItems: 'center', flex: 1 },
  rowLabel:  { fontSize: 12, color: COLORS.text, fontWeight: '600' },
  rowSub:    { fontSize: 10, color: COLORS.subtext, marginTop: 1 },
  rowValue:  { fontSize: 13, fontWeight: '700', minWidth: 70, textAlign: 'right' },

  debitoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2b1e0d', borderRadius: 6, padding: 8, marginTop: 8 },
  debitoText:{ fontSize: 11, color: COLORS.text, flex: 1 },

  mutuoCard: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border + '44' },
  mutuoNome: { fontSize: 12, color: COLORS.text, fontWeight: '700' },

  badge:     { backgroundColor: COLORS.primary + '22', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, color: COLORS.primary, fontWeight: '700' },
});
