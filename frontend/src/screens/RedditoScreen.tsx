import React, { useRef, useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Platform, Dimensions, Modal, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COLORS, fmt, fmtShort } from '../utils/format';
import { getReddito, getRedditoSintesi, importaBustaPaga, deleteBusta, getBustaPdfBlob, updateBusta, getRedditoConfronto } from '../services/api';
import FinanceChart, { ChartPoint, fmtYValue } from '../components/FinanceChart';
import MultiLineChart, { ScenarioLine } from '../components/MultiLineChart';

const n = (v: any) => Number(v) || 0;
const CHART_W = Math.min(Dimensions.get('window').width - 28, 900);
const MESI_ABBR = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

const openPdf = async (id: string) => {
  try {
    const blob = await getBustaPdfBlob(id);
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  } catch { /* pdf non disponibile */ }
};

const TIPO_META: Record<string, { label: string; color: string }> = {
  ordinaria:       { label: 'Ordinaria',    color: COLORS.primary },
  tredicesima:     { label: '13ª',          color: COLORS.purple },
  quattordicesima: { label: '14ª',          color: COLORS.purple },
  premio:          { label: 'Premio',       color: COLORS.success },
  una_tantum:      { label: 'Una tantum',   color: COLORS.warning },
  altro:           { label: 'Altro',        color: COLORS.subtext },
};

export default function RedditoScreen() {
  const qc = useQueryClient();
  const inputRef = useRef<any>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [chartMode, setChartMode] = useState<'netto' | 'lordo'>('netto');
  const [editBusta, setEditBusta] = useState<any>(null);
  const [editTipo, setEditTipo] = useState('ordinaria');
  const [editNetto, setEditNetto] = useState('');
  const [editLordo, setEditLordo] = useState('');
  const [saving, setSaving] = useState(false);

  const openEdit = (b: any) => {
    setEditBusta(b);
    setEditTipo(b.tipo_mensilita);
    setEditNetto(String(n(b.netto)));
    setEditLordo(String(n(b.totale_competenze)));
  };

  const salvaEdit = async () => {
    if (!editBusta) return;
    setSaving(true);
    try {
      await updateBusta(String(editBusta.id), {
        tipo_mensilita: editTipo,
        netto: parseFloat(editNetto.replace(',', '.')) || 0,
        totale_competenze: parseFloat(editLordo.replace(',', '.')) || 0,
      });
      qc.invalidateQueries({ queryKey: ['reddito'] });
      qc.invalidateQueries({ queryKey: ['reddito-sintesi'] });
      setEditBusta(null);
    } finally {
      setSaving(false);
    }
  };

  const { data: sintesi, isLoading: loadS, refetch: refS, isRefetching } = useQuery({ queryKey: ['reddito-sintesi'], queryFn: getRedditoSintesi });
  const { data: buste = [], refetch: refB } = useQuery({ queryKey: ['reddito'], queryFn: getReddito });

  const refetchAll = () => { refS(); refB(); };

  const handleUpload = async (e: any) => {
    const file: File = e.target.files[0];
    if (!file) return;
    setMsg(null); setUploading(true);
    try {
      const r = await importaBustaPaga(file);
      if (r.stato === 'gia_presente') setMsg({ text: `Busta ${r.mese}/${r.anno} già presente`, ok: true });
      else setMsg({ text: `✓ Importata: ${r.mese}/${r.anno} (${r.tipo}) · netto ${fmt(n(r.netto))}`, ok: true });
      qc.invalidateQueries({ queryKey: ['reddito'] });
      qc.invalidateQueries({ queryKey: ['reddito-sintesi'] });
    } catch (err: any) {
      setMsg({ text: err?.response?.data?.detail || 'Errore analisi busta', ok: false });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const rimuovi = async (id: string) => {
    await deleteBusta(id);
    qc.invalidateQueries({ queryKey: ['reddito'] });
    qc.invalidateQueries({ queryKey: ['reddito-sintesi'] });
  };

  const listaBuste = buste as any[];
  const years = useMemo(
    () => Array.from(new Set(listaBuste.map((b: any) => b.anno))).sort((a: number, b: number) => b - a),
    [listaBuste],
  );
  const anno = selectedYear ?? years[0] ?? new Date().getFullYear();
  const yearBuste = useMemo(
    () => listaBuste.filter((b: any) => b.anno === anno).sort((a: any, b: any) => a.mese - b.mese),
    [listaBuste, anno],
  );
  const annoCorrente = sintesi?.anni?.find((a: any) => a.anno === anno);
  const chartPts: ChartPoint[] = yearBuste.map((b: any) => ({
    value: chartMode === 'netto' ? n(b.netto) : n(b.totale_competenze),
    label: MESI_ABBR[b.mese - 1],
    dateFull: `${b.mese_label} ${b.anno}`,
  }));

  const { data: confronto } = useQuery({ queryKey: ['reddito-confronto', anno], queryFn: () => getRedditoConfronto(anno) });
  const confPunti = (confronto?.punti || []) as any[];
  const confLines: ScenarioLine[] = confPunti.length >= 2 ? [
    { key: 'reddito', label: 'Reddito', color: COLORS.success, points: confPunti.map((p: any) => ({ label: p.label, value: n(p.reddito) })) },
    { key: 'spese',   label: 'Spese',   color: COLORS.danger,  points: confPunti.map((p: any) => ({ label: p.label, value: n(p.spese) })) },
  ] : [];

  return (
    <ScrollView
      style={st.container}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetchAll} tintColor={COLORS.primary} />}
    >
      {/* Sintesi reddito */}
      <View style={st.heroBox}>
        <Text style={st.heroLabel}>REDDITO NETTO ANNUO STIMATO</Text>
        <Text style={st.heroVal}>{fmt(n(sintesi?.reddito_netto_annuo_stimato))}</Text>
        <Text style={st.heroSub}>
          RAL ~{fmtShort(n(sintesi?.reddito_lordo_annuo_stimato))} · Netto mensile medio {fmt(n(sintesi?.netto_mensile_medio))}
        </Text>
        {!!sintesi?.azienda && <Text style={st.heroAzienda}>{sintesi.azienda}</Text>}
      </View>

      {/* Import */}
      <TouchableOpacity style={st.uploadBtn} onPress={() => inputRef.current?.click()} disabled={uploading}>
        {uploading
          ? <ActivityIndicator color="#000" size="small" />
          : <><Ionicons name="cloud-upload" size={16} color="#000" /><Text style={st.uploadTxt}>Carica busta paga (PDF)</Text></>}
      </TouchableOpacity>
      <input ref={inputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleUpload} />
      <Text style={st.hint}>Il sistema analizza la busta (stipendio, 13ª/14ª, premi) e aggiorna il reddito usato dall'AI.</Text>
      {msg && <Text style={[st.msg, { color: msg.ok ? COLORS.success : COLORS.danger }]}>{msg.text}</Text>}

      {/* Selettore anno di osservazione */}
      {years.length > 0 && (
        <View style={st.yearRow}>
          {years.map((y: number) => (
            <TouchableOpacity key={y} style={[st.yearChip, y === anno && st.yearChipActive]} onPress={() => setSelectedYear(y)}>
              <Text style={[st.yearTxt, y === anno && st.yearTxtActive]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Grafico retribuzioni mensili */}
      {chartPts.length >= 2 && (
        <View style={st.chartCard}>
          <View style={st.chartHead}>
            <Text style={st.cardTitle}>RETRIBUZIONI MENSILI {anno}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['netto', 'lordo'] as const).map(m => (
                <TouchableOpacity key={m} style={[st.modeBtn, chartMode === m && st.modeBtnActive]} onPress={() => setChartMode(m)}>
                  <Text style={[st.modeTxt, chartMode === m && st.modeTxtActive]}>{m === 'netto' ? 'Netto' : 'Lordo'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <FinanceChart points={chartPts} width={CHART_W} height={190} color={COLORS.success} formatY={fmtYValue} tooltipFormat={fmt} />
        </View>
      )}

      {/* Dettaglio anno corrente */}
      {annoCorrente && (
        <View style={st.card}>
          <Text style={st.cardTitle}>ANNO {annoCorrente.anno}</Text>
          <Row label="Netto incassato" value={fmt(annoCorrente.netto_totale)} color={COLORS.success} />
          <Row label="Lordo totale" value={fmt(annoCorrente.lordo_totale)} />
          <Row label="Buste analizzate" value={String(annoCorrente.n_buste)} />
          <Row label="13ª / 14ª" value={`${annoCorrente.ha_tredicesima ? 'Sì' : '—'} / ${annoCorrente.ha_quattordicesima ? 'Sì' : '—'}`} />
          {annoCorrente.premi_netto > 0 && <Row label="Premi / una tantum (netto)" value={fmt(annoCorrente.premi_netto)} color={COLORS.warning} />}
        </View>
      )}

      {/* Confronto reddito vs spese */}
      {confLines.length > 0 && (
        <View style={st.chartCard}>
          <View style={st.chartHead}>
            <Text style={st.cardTitle}>REDDITO vs SPESE {anno}</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Legend color={COLORS.success} label="Reddito" />
              <Legend color={COLORS.danger} label="Spese" />
            </View>
          </View>
          <MultiLineChart lines={confLines} width={CHART_W} height={190} />
          <View style={st.savRow}>
            <View>
              <Text style={st.modalLabel}>RISPARMIO {anno}</Text>
              <Text style={[st.savVal, { color: n(confronto?.risparmio) >= 0 ? COLORS.success : COLORS.danger }]}>{fmt(n(confronto?.risparmio))}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={st.modalLabel}>TASSO RISPARMIO</Text>
              <Text style={[st.savVal, { color: COLORS.primary }]}>{n(confronto?.tasso_risparmio).toFixed(1)}%</Text>
            </View>
          </View>
          <Text style={st.hint}>Spese = uscite del conto (escluse voci carta itemizzate e giroconti verso investimenti/PAC). Include mutuo e spese carta a saldo.</Text>
        </View>
      )}

      {/* Lista buste dell'anno selezionato */}
      <Text style={st.sectionTitle}>BUSTE PAGA {anno}</Text>
      {loadS ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />
      ) : yearBuste.length === 0 ? (
        <Text style={st.empty}>Nessuna busta paga per il {anno}. Carica un PDF per iniziare.</Text>
      ) : (
        yearBuste.map((b: any) => {
          const meta = TIPO_META[b.tipo_mensilita] || TIPO_META.altro;
          return (
            <View key={b.id} style={st.bustaRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={st.bustaMese}>{b.mese_label} {b.anno}</Text>
                  <View style={[st.badge, { backgroundColor: meta.color + '22' }]}>
                    <Text style={[st.badgeTxt, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={st.bustaSub}>Lordo {fmtShort(n(b.totale_competenze))} · Trattenute {fmtShort(n(b.totale_trattenute))}</Text>
              </View>
              <Text style={st.bustaNetto}>{fmt(n(b.netto))}</Text>
              <TouchableOpacity onPress={() => openEdit(b)} style={{ paddingLeft: 10 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="create-outline" size={16} color={COLORS.subtext} />
              </TouchableOpacity>
              {b.has_pdf && (
                <TouchableOpacity onPress={() => openPdf(b.id)} style={{ paddingLeft: 10 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="document-text-outline" size={16} color={COLORS.primary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => rimuovi(b.id)} style={{ paddingLeft: 10 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
          );
        })
      )}

      {/* Modale correzione manuale */}
      <Modal visible={!!editBusta} transparent animationType="fade" onRequestClose={() => setEditBusta(null)}>
        <Pressable style={st.backdrop} onPress={() => setEditBusta(null)}>
          <Pressable style={st.modal} onPress={(e: any) => e.stopPropagation?.()}>
            <Text style={st.modalTitle}>
              Correggi {editBusta?.mese_label} {editBusta?.anno}
            </Text>

            <Text style={st.modalLabel}>TIPO MENSILITÀ</Text>
            <View style={st.tipoWrap}>
              {Object.keys(TIPO_META).map(k => (
                <TouchableOpacity key={k} style={[st.tipoChip, editTipo === k && st.tipoChipActive]} onPress={() => setEditTipo(k)}>
                  <Text style={[st.tipoTxt, editTipo === k && st.tipoTxtActive]}>{TIPO_META[k].label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={st.modalLabel}>NETTO (€)</Text>
            <TextInput style={st.modalInput} value={editNetto} onChangeText={setEditNetto} keyboardType="decimal-pad" placeholderTextColor={COLORS.subtext} />

            <Text style={st.modalLabel}>LORDO / TOTALE COMPETENZE (€)</Text>
            <TextInput style={st.modalInput} value={editLordo} onChangeText={setEditLordo} keyboardType="decimal-pad" placeholderTextColor={COLORS.subtext} />

            <View style={st.modalBtns}>
              <TouchableOpacity style={[st.modalBtn, { borderColor: COLORS.border }]} onPress={() => setEditBusta(null)}>
                <Text style={{ color: COLORS.subtext, fontWeight: '700' }}>Annulla</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.modalBtn, { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]} onPress={salvaEdit} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={{ color: '#000', fontWeight: '800' }}>Salva</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ color: COLORS.subtext, fontSize: 10, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={st.row}>
      <Text style={st.rowLabel}>{label}</Text>
      <Text style={[st.rowValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  heroBox:    { backgroundColor: '#0C1F18', borderRadius: 12, padding: 18, borderWidth: 1, borderColor: COLORS.success + '55', marginBottom: 12 },
  heroLabel:  { fontSize: 9, color: COLORS.success, fontWeight: '800', letterSpacing: 2 },
  heroVal:    { fontSize: 30, fontWeight: '900', color: COLORS.success, marginTop: 4 },
  heroSub:    { fontSize: 11, color: COLORS.subtext, marginTop: 4 },
  heroAzienda:{ fontSize: 11, color: COLORS.text, marginTop: 6, fontWeight: '700' },

  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 13 },
  uploadTxt: { color: '#000', fontWeight: '800', fontSize: 14 },
  hint:      { fontSize: 10, color: COLORS.subtext, marginTop: 8, lineHeight: 15 },
  msg:       { fontSize: 12, fontWeight: '700', marginTop: 8 },

  card:        { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginTop: 14, borderWidth: 1, borderColor: COLORS.border },
  cardTitle:   { fontSize: 9, color: COLORS.subtext, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },

  yearRow:      { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 4, flexWrap: 'wrap' },
  yearChip:     { borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  yearChipActive:{ backgroundColor: COLORS.primary + '22', borderColor: COLORS.primary },
  yearTxt:      { color: COLORS.subtext, fontSize: 13, fontWeight: '700' },
  yearTxtActive:{ color: COLORS.primary },

  chartCard:    { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginTop: 10, borderWidth: 1, borderColor: COLORS.border },
  chartHead:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modeBtn:      { borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  modeBtnActive:{ backgroundColor: COLORS.primary + '22', borderColor: COLORS.primary },
  modeTxt:      { color: COLORS.subtext, fontSize: 11, fontWeight: '700' },
  modeTxtActive:{ color: COLORS.primary },
  row:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border + '44' },
  rowLabel:    { color: COLORS.subtext, fontSize: 12 },
  rowValue:    { color: COLORS.text, fontWeight: '700', fontSize: 13 },

  sectionTitle:{ fontSize: 9, color: COLORS.subtext, fontWeight: '800', letterSpacing: 2, marginTop: 18, marginBottom: 8 },
  empty:       { color: COLORS.subtext, textAlign: 'center', paddingVertical: 20 },

  bustaRow:  { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 8, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  bustaMese: { color: COLORS.text, fontSize: 14, fontWeight: '700' },
  bustaSub:  { color: COLORS.subtext, fontSize: 10, marginTop: 3 },
  bustaNetto:{ color: COLORS.success, fontSize: 14, fontWeight: '800' },
  badge:     { borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTxt:  { fontSize: 9, fontWeight: '800' },

  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modal:      { width: '100%', maxWidth: 420, backgroundColor: '#0B1322', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 18 },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginBottom: 14 },
  modalLabel: { color: COLORS.subtext, fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginTop: 12, marginBottom: 6 },
  tipoWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tipoChip:   { borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  tipoChipActive: { backgroundColor: COLORS.primary + '22', borderColor: COLORS.primary },
  tipoTxt:    { color: COLORS.subtext, fontSize: 12, fontWeight: '700' },
  tipoTxtActive: { color: COLORS.primary },
  modalInput: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: COLORS.text, fontSize: 15 },
  modalBtns:  { flexDirection: 'row', gap: 10, marginTop: 20 },
  modalBtn:   { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8, paddingVertical: 12 },

  savRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border + '55' },
  savVal:  { fontSize: 18, fontWeight: '900', marginTop: 2 },
});
