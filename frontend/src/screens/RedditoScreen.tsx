import React, { useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COLORS, fmt, fmtShort } from '../utils/format';
import { getReddito, getRedditoSintesi, importaBustaPaga, deleteBusta } from '../services/api';

const n = (v: any) => Number(v) || 0;

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

  const annoCorrente = sintesi?.anni?.[0];

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

      {/* Lista buste */}
      <Text style={st.sectionTitle}>BUSTE PAGA</Text>
      {loadS ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />
      ) : (buste as any[]).length === 0 ? (
        <Text style={st.empty}>Nessuna busta paga. Carica un PDF per iniziare.</Text>
      ) : (
        (buste as any[]).map((b: any) => {
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
              <TouchableOpacity onPress={() => rimuovi(b.id)} style={{ paddingLeft: 10 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
              </TouchableOpacity>
            </View>
          );
        })
      )}
    </ScrollView>
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
});
