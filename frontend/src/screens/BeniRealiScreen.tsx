import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, TextInput, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useImmobili, useOrologi } from '../hooks/useData';
import { KpiCard, Card, RowItem, LoadingView, ProgressBar } from '../components/common';
import { COLORS, fmt, fmtShort, colorPL } from '../utils/format';
import { createOrologio, deleteOrologio, updateOrologio } from '../services/api';

export default function BeniRealiScreen() {
  const qc = useQueryClient();
  const { data: immobili, isLoading: loadImm } = useImmobili();
  const { data: orologi,  isLoading: loadOr  } = useOrologi();
  const [showAdd, setShowAdd] = useState(false);
  const [editWatch, setEditWatch] = useState<any>(null);

  const rimuoviOrologio = async (id: string) => {
    await deleteOrologio(id);
    qc.invalidateQueries({ queryKey: ['orologi'] });
    qc.invalidateQueries({ queryKey: ['patrimonio-live'] });
  };

  if (loadImm || loadOr) return <LoadingView />;

  const n = (v: any): number => Number(v) || 0;
  const totImmobili = immobili?.reduce((s: number, i: any) => s + n(i.valore_corrente), 0) || 0;
  const totOrologi  = orologi?.reduce((s: number, o: any) => s + (n(o.stima_min) + n(o.stima_max)) / 2, 0) || 0;
  const totEquity   = immobili?.reduce((s: number, i: any) => s + (n(i.valore_corrente) - n(i.mutuo_residuo)), 0) || 0;

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
          const equity = n(im.valore_corrente) - n(im.mutuo_residuo);
          const ltv    = n(im.valore_corrente) ? (n(im.mutuo_residuo) / n(im.valore_corrente)) * 100 : 0;
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 10 }}>
          <Text style={[s.sectionTitle, { marginTop: 0, marginBottom: 0 }]}>OROLOGI DA COLLEZIONE</Text>
          <TouchableOpacity style={s.addBtn} onPress={() => setShowAdd(true)}>
            <Ionicons name="add" size={14} color={COLORS.warning} />
            <Text style={s.addBtnTxt}>Aggiungi</Text>
          </TouchableOpacity>
        </View>
        <View style={s.orologiRow}>
          {orologi?.map((or: any) => (
            <Card key={or.id}>
              <View style={s.cardHead}>
                <View>
                  <Text style={s.cardName}>{or.nome || `${or.marca} ${or.modello}`}</Text>
                  <Text style={s.cardSub}>Ref. {or.riferimento}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity onPress={() => setEditWatch(or)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="create-outline" size={16} color={COLORS.subtext} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => rimuoviOrologio(or.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
                  </TouchableOpacity>
                </View>
              </View>
              <RowItem label="Stima minima"  value={fmt(or.stima_min)} />
              <RowItem label="Stima massima" value={fmt(or.stima_max)} />
              <RowItem label="Prezzo acquisto" value={or.prezzo_acquisto != null ? fmt(or.prezzo_acquisto) : '—'} />
              <View style={s.totRow}>
                <Text style={s.totLabel}>Valore medio stimato</Text>
                <Text style={[s.totValue, { color: COLORS.warning }]}>{fmt(n(or.valore_medio))}</Text>
              </View>
              {or.pnl != null && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                  <Text style={s.totLabel}>P&L vs acquisto</Text>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: colorPL(or.pnl) }}>
                    {n(or.pnl) >= 0 ? '+' : ''}{fmt(or.pnl)}
                    {or.prezzo_acquisto ? ` (${n(or.pnl) >= 0 ? '+' : ''}${((n(or.pnl) / n(or.prezzo_acquisto)) * 100).toFixed(1)}%)` : ''}
                  </Text>
                </View>
              )}
            </Card>
          ))}
        </View>

      </View>

      <AddOrologioModal visible={showAdd} onClose={() => setShowAdd(false)} onSaved={() => {
        qc.invalidateQueries({ queryKey: ['orologi'] });
        qc.invalidateQueries({ queryKey: ['patrimonio-live'] });
        setShowAdd(false);
      }} />

      <EditOrologioModal watch={editWatch} onClose={() => setEditWatch(null)} onSaved={() => {
        qc.invalidateQueries({ queryKey: ['orologi'] });
        qc.invalidateQueries({ queryKey: ['patrimonio-live'] });
        setEditWatch(null);
      }} />
    </ScrollView>
  );
}

// ── Modifica prezzo/stima orologio ─────────────────────
function EditOrologioModal({ watch, onClose, onSaved }: { watch: any; onClose: () => void; onSaved: () => void }) {
  const [prezzo, setPrezzo] = useState('');
  const [sMin, setSMin] = useState('');
  const [sMax, setSMax] = useState('');
  React.useEffect(() => {
    if (watch) {
      setPrezzo(watch.prezzo_acquisto != null ? String(Number(watch.prezzo_acquisto)) : '');
      setSMin(String(Number(watch.stima_min) || ''));
      setSMax(String(Number(watch.stima_max) || ''));
    }
  }, [watch]);

  const salva = useMutation({
    mutationFn: () => {
      const data: any = {};
      if (prezzo) data.prezzo_acquisto = parseFloat(prezzo.replace(',', '.'));
      if (sMin && sMax) { data.stima_min = parseFloat(sMin.replace(',', '.')); data.stima_max = parseFloat(sMax.replace(',', '.')); }
      return updateOrologio(String(watch.id), data);
    },
    onSuccess: onSaved,
  });

  return (
    <Modal visible={!!watch} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.modal} onPress={(e: any) => e.stopPropagation?.()}>
          <Text style={s.modalTitle}>{watch?.marca} {watch?.modello}</Text>
          <Text style={s.modalLabel}>PREZZO DI ACQUISTO (€)</Text>
          <TextInput style={s.modalInput} value={prezzo} onChangeText={setPrezzo} placeholder="es. 8000" placeholderTextColor={COLORS.subtext} keyboardType="decimal-pad" />
          <Text style={[s.modalLabel, { marginTop: 12 }]}>STIMA € (min / max)</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={[s.modalInput, { flex: 1 }]} value={sMin} onChangeText={setSMin} placeholder="min" placeholderTextColor={COLORS.subtext} keyboardType="decimal-pad" />
            <TextInput style={[s.modalInput, { flex: 1 }]} value={sMax} onChangeText={setSMax} placeholder="max" placeholderTextColor={COLORS.subtext} keyboardType="decimal-pad" />
          </View>
          <View style={s.modalBtns}>
            <TouchableOpacity style={[s.modalBtn, { borderColor: COLORS.border }]} onPress={onClose}>
              <Text style={{ color: COLORS.subtext, fontWeight: '700' }}>Annulla</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.modalBtn, { backgroundColor: COLORS.warning, borderColor: COLORS.warning }]} onPress={() => salva.mutate()} disabled={salva.isPending}>
              {salva.isPending ? <ActivityIndicator size="small" color="#000" /> : <Text style={{ color: '#000', fontWeight: '800' }}>Salva</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Form aggiunta orologio ─────────────────────────────
const CAMPI: Array<{ k: string; label: string; ph?: string }> = [
  { k: 'marca', label: 'Marca *', ph: 'Rolex' },
  { k: 'modello', label: 'Modello *', ph: 'Datejust 36' },
  { k: 'riferimento', label: 'Referenza', ph: '116234' },
  { k: 'materiale_cassa', label: 'Materiale cassa', ph: 'Acciaio' },
  { k: 'materiale_lunetta', label: 'Materiale lunetta', ph: 'Oro bianco' },
  { k: 'quadrante', label: 'Quadrante', ph: 'Blu' },
  { k: 'diametro', label: 'Diametro', ph: '36 mm' },
  { k: 'vetro', label: 'Vetro', ph: 'Zaffiro' },
  { k: 'carica', label: 'Carica', ph: 'Automatico' },
  { k: 'riserva_carica', label: 'Riserva di carica', ph: '48 h' },
  { k: 'funzioni', label: 'Funzioni', ph: 'Data' },
];

function AddOrologioModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [stimaMin, setStimaMin] = useState('');
  const [stimaMax, setStimaMax] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const salva = useMutation({
    mutationFn: () => {
      const payload: any = { ...form };
      if (stimaMin) payload.stima_min = parseFloat(stimaMin.replace(',', '.'));
      if (stimaMax) payload.stima_max = parseFloat(stimaMax.replace(',', '.'));
      return createOrologio(payload);
    },
    onSuccess: () => { setForm({}); setStimaMin(''); setStimaMax(''); onSaved(); },
    onError: (e: any) => setErr(e?.response?.data?.detail || 'Errore salvataggio'),
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.modal} onPress={(e: any) => e.stopPropagation?.()}>
          <Text style={s.modalTitle}>Aggiungi orologio</Text>
          <ScrollView style={{ maxHeight: 420 }}>
            {CAMPI.map(c => (
              <View key={c.k} style={{ marginBottom: 8 }}>
                <Text style={s.modalLabel}>{c.label}</Text>
                <TextInput style={s.modalInput} value={form[c.k] || ''} onChangeText={v => set(c.k, v)} placeholder={c.ph} placeholderTextColor={COLORS.subtext} />
              </View>
            ))}
            <Text style={s.modalLabel}>STIMA € (min / max) — lascia vuoto per valutazione AI</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput style={[s.modalInput, { flex: 1 }]} value={stimaMin} onChangeText={setStimaMin} placeholder="min" placeholderTextColor={COLORS.subtext} keyboardType="decimal-pad" />
              <TextInput style={[s.modalInput, { flex: 1 }]} value={stimaMax} onChangeText={setStimaMax} placeholder="max" placeholderTextColor={COLORS.subtext} keyboardType="decimal-pad" />
            </View>
          </ScrollView>
          {err && <Text style={{ color: COLORS.danger, fontSize: 11, marginTop: 8 }}>{err}</Text>}
          <View style={s.modalBtns}>
            <TouchableOpacity style={[s.modalBtn, { borderColor: COLORS.border }]} onPress={onClose}>
              <Text style={{ color: COLORS.subtext, fontWeight: '700' }}>Annulla</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modalBtn, { backgroundColor: COLORS.warning, borderColor: COLORS.warning }]}
              onPress={() => { setErr(null); if (form.marca && form.modello) salva.mutate(); else setErr('Marca e modello obbligatori'); }}
              disabled={salva.isPending}
            >
              {salva.isPending ? <ActivityIndicator size="small" color="#000" /> : <Text style={{ color: '#000', fontWeight: '800' }}>Salva</Text>}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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

  addBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: COLORS.warning + '66', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  addBtnTxt: { color: COLORS.warning, fontSize: 12, fontWeight: '700' },

  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modal:      { width: '100%', maxWidth: 440, backgroundColor: '#0B1322', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 18 },
  modalTitle: { color: COLORS.text, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  modalLabel: { color: COLORS.subtext, fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  modalInput: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: COLORS.text, fontSize: 14 },
  modalBtns:  { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalBtn:   { flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8, paddingVertical: 12 },
});
