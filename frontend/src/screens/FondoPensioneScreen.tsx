import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useFondiPensione, useRegoleAccessoFondo, useAddFondoPensioneSnapshot } from '../hooks/useData';
import { KpiCard, Card, RowItem, LoadingView, ProgressBar, Btn } from '../components/common';
import { COLORS, fmt, fmtShort } from '../utils/format';

// ── Helpers ──────────────────────────────────────────────────────────────────

function anzianitaLabel(anni: number, mesi: number, giorni: number): string {
  const parts = [];
  if (anni > 0)   parts.push(`${anni} anni`);
  if (mesi > 0)   parts.push(`${mesi} mesi`);
  if (giorni > 0) parts.push(`${giorni} giorni`);
  return parts.join(' ') || '—';
}

function mesiToLabel(mesi: number): string {
  if (mesi <= 0) return 'Già disponibile';
  const a = Math.floor(mesi / 12);
  const m = mesi % 12;
  if (a > 0 && m > 0) return `~${a} anni e ${m} mesi`;
  if (a > 0)           return `~${a} anni`;
  return `~${m} mesi`;
}

// Colore milestone: verde = raggiunta, arancio = <12 mesi, blu = futuro
function milestoneColor(mesiRimanenti: number): string {
  if (mesiRimanenti <= 0)  return COLORS.success;
  if (mesiRimanenti <= 12) return COLORS.warning;
  return COLORS.primary;
}

// ── Form aggiornamento dati ──────────────────────────────────────────────────

interface FormState {
  data_riferimento: string;
  saldo_individuale: string;
  tfr_maturato: string;
  totale_posizione: string;
  versamenti_ytd: string;
  risultato_esercizio: string;
  anzianita_anni: string;
  anzianita_mesi: string;
  anzianita_giorni: string;
  note: string;
}

function buildFormState(snap: any): FormState {
  const today = new Date().toISOString().split('T')[0];
  if (!snap) return {
    data_riferimento: today, saldo_individuale: '', tfr_maturato: '',
    totale_posizione: '', versamenti_ytd: '', risultato_esercizio: '',
    anzianita_anni: '0', anzianita_mesi: '0', anzianita_giorni: '0', note: '',
  };
  return {
    data_riferimento:    snap.data_riferimento ?? today,
    saldo_individuale:   String(snap.saldo_individuale ?? ''),
    tfr_maturato:        String(snap.tfr_maturato ?? ''),
    totale_posizione:    String(snap.totale_posizione ?? ''),
    versamenti_ytd:      snap.versamenti_ytd != null ? String(snap.versamenti_ytd) : '',
    risultato_esercizio: snap.risultato_esercizio != null ? String(snap.risultato_esercizio) : '',
    anzianita_anni:      String(snap.anzianita_anni ?? '0'),
    anzianita_mesi:      String(snap.anzianita_mesi ?? '0'),
    anzianita_giorni:    String(snap.anzianita_giorni ?? '0'),
    note:                snap.note ?? '',
  };
}

interface AggiornaDatiFormProps {
  fondoId: string;
  snap: any;
  onClose: () => void;
}

function AggiornaDatiForm({ fondoId, snap, onClose }: AggiornaDatiFormProps) {
  const [form, setForm] = useState<FormState>(buildFormState(snap));
  const { mutate, isPending } = useAddFondoPensioneSnapshot();

  function set(field: keyof FormState, value: string) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function parseNum(v: string): number | undefined {
    const n = parseFloat(v.replace(',', '.'));
    return isNaN(n) ? undefined : n;
  }

  function handleSalva() {
    const saldo   = parseNum(form.saldo_individuale);
    const tfr     = parseNum(form.tfr_maturato);
    const totale  = parseNum(form.totale_posizione);
    const anni    = parseInt(form.anzianita_anni) || 0;
    const mesi    = parseInt(form.anzianita_mesi) || 0;

    if (!form.data_riferimento) { Alert.alert('Dati mancanti', 'Inserisci la data di riferimento'); return; }
    if (saldo  == null)         { Alert.alert('Dati mancanti', 'Inserisci il saldo individuale'); return; }
    if (tfr    == null)         { Alert.alert('Dati mancanti', 'Inserisci il TFR maturato'); return; }
    if (totale == null)         { Alert.alert('Dati mancanti', 'Inserisci il totale posizione'); return; }

    const versamenti = parseNum(form.versamenti_ytd);
    const risultato  = parseNum(form.risultato_esercizio);

    mutate(
      {
        fondoId,
        data: {
          data_riferimento:    form.data_riferimento,
          saldo_individuale:   saldo,
          tfr_maturato:        tfr,
          totale_posizione:    totale,
          versamenti_ytd:      versamenti,
          risultato_esercizio: risultato,
          anzianita_anni:      anni,
          anzianita_mesi:      mesi,
          anzianita_giorni:    parseInt(form.anzianita_giorni) || 0,
          fonte:               'manuale',
          note:                form.note || undefined,
        },
      },
      {
        onSuccess: () => { Alert.alert('Salvato', 'Dati aggiornati con successo'); onClose(); },
        onError:   (e: any) => Alert.alert('Errore', e?.response?.data?.detail ?? 'Salvataggio fallito'),
      }
    );
  }

  return (
    <Card>
      <View style={s.formHeader}>
        <Text style={s.formTitle}>AGGIORNA DATI</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={{ color: COLORS.subtext, fontSize: 18 }}>✕</Text>
        </TouchableOpacity>
      </View>

      <FormField label="Data riferimento (AAAA-MM-GG)" value={form.data_riferimento}
        onChangeText={v => set('data_riferimento', v)} placeholder="2026-03-31" />

      <Text style={s.formGroup}>IMPORTI</Text>
      <FormField label="Saldo conto individuale (€)" value={form.saldo_individuale}
        onChangeText={v => set('saldo_individuale', v)} placeholder="39187.83" keyboardType="decimal-pad" />
      <FormField label="TFR maturato (€)" value={form.tfr_maturato}
        onChangeText={v => set('tfr_maturato', v)} placeholder="90014.49" keyboardType="decimal-pad" />
      <FormField label="Totale posizione individuale (€)" value={form.totale_posizione}
        onChangeText={v => set('totale_posizione', v)} placeholder="129202.32" keyboardType="decimal-pad" />
      <FormField label="Versamenti anno in corso (€) — opzionale" value={form.versamenti_ytd}
        onChangeText={v => set('versamenti_ytd', v)} placeholder="2052.13" keyboardType="decimal-pad" />
      <FormField label="Risultato esercizio (€) — opzionale" value={form.risultato_esercizio}
        onChangeText={v => set('risultato_esercizio', v)} placeholder="1828.57" keyboardType="decimal-pad" />

      <Text style={s.formGroup}>ANZIANITÀ CONTRIBUTIVA</Text>
      <View style={s.anzianitaRow}>
        <View style={{ flex: 1 }}>
          <FormField label="Anni" value={form.anzianita_anni}
            onChangeText={v => set('anzianita_anni', v)} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Mesi" value={form.anzianita_mesi}
            onChangeText={v => set('anzianita_mesi', v)} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <FormField label="Giorni" value={form.anzianita_giorni}
            onChangeText={v => set('anzianita_giorni', v)} keyboardType="number-pad" />
        </View>
      </View>

      <FormField label="Note — opzionale" value={form.note}
        onChangeText={v => set('note', v)} placeholder="Es. estratto conto Q1 2026" />

      <View style={s.formActions}>
        <TouchableOpacity style={s.btnCancel} onPress={onClose}>
          <Text style={s.btnCancelText}>ANNULLA</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.btnSalva} onPress={handleSalva} disabled={isPending}>
          <Text style={s.btnSalvaText}>{isPending ? 'SALVATAGGIO…' : 'SALVA'}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

function FormField({ label, value, onChangeText, placeholder, keyboardType }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any;
}) {
  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        style={s.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.subtext}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize="none"
      />
    </View>
  );
}

// ── Sezione regole accesso ───────────────────────────────────────────────────

function RegolaCard({ item, tipo }: { item: any; tipo: 'anticipazione' | 'riscatto' | 'prestazione' }) {
  const [open, setOpen] = useState(false);
  const borderColor =
    tipo === 'anticipazione' ? '#818CF8' :
    tipo === 'riscatto'      ? COLORS.warning :
    COLORS.success;

  return (
    <TouchableOpacity onPress={() => setOpen(o => !o)} activeOpacity={0.8}>
      <View style={[s.regolaCard, { borderLeftColor: borderColor }]}>
        <View style={s.regolaHead}>
          <View style={{ flex: 1 }}>
            <Text style={s.regolaTitolo}>{item.titolo}</Text>
            {item.anzianita_minima_anni !== undefined && (
              <Text style={[s.regolaTag, { color: borderColor }]}>
                {item.percentuale_max ? `Fino al ${item.percentuale_max}%  ·  ` : ''}
                {item.anzianita_minima_anni === 0
                  ? 'In qualsiasi momento'
                  : `Dopo ${item.anzianita_minima_anni} anni di iscrizione`}
              </Text>
            )}
            {item.requisiti && !Array.isArray(item.requisiti) && (
              <Text style={s.regolaTag}>{item.requisiti}</Text>
            )}
          </View>
          <Text style={{ color: COLORS.subtext, fontSize: 16 }}>{open ? '▲' : '▼'}</Text>
        </View>
        {open && (
          <View style={s.regolaBody}>
            {item.descrizione && <Text style={s.regolaDesc}>{item.descrizione}</Text>}
            {item.modalita    && <Text style={[s.regolaDesc, { color: COLORS.subtext }]}>➜ {item.modalita}</Text>}
            {item.tassazione  && (
              <View style={s.taxBadge}>
                <Text style={s.taxText}>⚖ {item.tassazione}</Text>
              </View>
            )}
            {Array.isArray(item.cause) && item.cause.map((c: string, i: number) => (
              <Text key={i} style={s.causaItem}>• {c}</Text>
            ))}
            {Array.isArray(item.requisiti) && item.requisiti.map((r: string, i: number) => (
              <Text key={i} style={s.causaItem}>✓ {r}</Text>
            ))}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Screen principale ────────────────────────────────────────────────────────

export default function FondoPensioneScreen() {
  const { data: fondi, isLoading: loadFondi }   = useFondiPensione();
  const { data: regole, isLoading: loadRegole }  = useRegoleAccessoFondo();
  const [tabAttiva, setTabAttiva] = useState<'posizione' | 'accesso'>('posizione');
  const [formAperto, setFormAperto] = useState(false);

  if (loadFondi || loadRegole) return <LoadingView />;

  // Prende il primo fondo (Mario Negri) se esiste
  const fondo   = fondi?.[0];
  const snap    = fondo?.ultimo_snapshot;

  const totMesi8  = snap ? Math.max(0, 96 - (snap.anzianita_anni * 12 + snap.anzianita_mesi)) : 96;
  const pct8      = snap ? Math.min(100, ((snap.anzianita_anni * 12 + snap.anzianita_mesi) / 96) * 100) : 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={s.container} keyboardShouldPersistTaps="handled">
      <View style={s.body}>

        {/* Header fondo */}
        {fondo ? (
          <View style={s.fondoHeader}>
            <View>
              <Text style={s.fondoNome}>{fondo.nome}</Text>
              <Text style={s.fondoTipo}>Fondo pensione complementare {fondo.tipo}</Text>
            </View>
            <View style={[s.badge, { borderColor: COLORS.primary + '66', backgroundColor: COLORS.primary + '20' }]}>
              <Text style={[s.badgeText, { color: COLORS.primary }]}>PREVIDENZA</Text>
            </View>
          </View>
        ) : (
          <View style={s.emptyBox}>
            <Text style={s.emptyText}>Nessun fondo pensione registrato.</Text>
            <Text style={s.emptyHint}>Aggiungi il tuo fondo tramite l'endpoint POST /fondi-pensione/</Text>
          </View>
        )}

        {/* Pulsante aggiorna + form */}
        {fondo && (
          <>
            <TouchableOpacity
              style={[s.btnAggiorna, formAperto && s.btnAggiornaOpen]}
              onPress={() => setFormAperto(o => !o)}
            >
              <Text style={s.btnAggiornaText}>{formAperto ? '✕  CHIUDI' : '↑  AGGIORNA DATI'}</Text>
            </TouchableOpacity>

            {formAperto && (
              <AggiornaDatiForm
                fondoId={String(fondo.id)}
                snap={snap}
                onClose={() => setFormAperto(false)}
              />
            )}
          </>
        )}

        {/* KPI */}
        {snap && (
          <>
            <View style={s.kpiRow}>
              <KpiCard label="Saldo Individuale" value={fmtShort(Number(snap.saldo_individuale))} />
              <KpiCard label="TFR Maturato"       value={fmtShort(Number(snap.tfr_maturato))} />
            </View>
            <View style={s.kpiRow}>
              <KpiCard label="Totale Posizione"   value={fmtShort(Number(snap.totale_posizione))} highlight />
              <KpiCard label="Anzianità"           value={`${snap.anzianita_anni}a ${snap.anzianita_mesi}m`} />
            </View>
          </>
        )}

        {/* Tab selector */}
        <View style={s.tabRow}>
          <TouchableOpacity
            style={[s.tabBtn, tabAttiva === 'posizione' && s.tabBtnActive]}
            onPress={() => setTabAttiva('posizione')}
          >
            <Text style={[s.tabLabel, tabAttiva === 'posizione' && s.tabLabelActive]}>POSIZIONE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, tabAttiva === 'accesso' && s.tabBtnActive]}
            onPress={() => setTabAttiva('accesso')}
          >
            <Text style={[s.tabLabel, tabAttiva === 'accesso' && s.tabLabelActive]}>COME ACCEDERE</Text>
          </TouchableOpacity>
        </View>

        {/* ── TAB: POSIZIONE ──────────────────────────────── */}
        {tabAttiva === 'posizione' && snap && (
          <>
            <Text style={s.sectionTitle}>DETTAGLIO POSIZIONE AL {snap.data_riferimento}</Text>
            <Card>
              <RowItem label="Saldo conto individuale"   value={fmt(Number(snap.saldo_individuale))}  valueColor="#818CF8" />
              <RowItem label="TFR pervenuto"             value={fmt(Number(snap.tfr_maturato))}       valueColor={COLORS.primary} />
              <RowItem label="Totale posizione"          value={fmt(Number(snap.totale_posizione))}   valueColor={COLORS.success} />
              {snap.versamenti_ytd != null && (
                <RowItem label="Versamenti anno in corso" value={fmt(Number(snap.versamenti_ytd))} />
              )}
              {snap.risultato_esercizio != null && (
                <RowItem label="Risultato esercizio"     value={fmt(Number(snap.risultato_esercizio))} valueColor={COLORS.success} />
              )}
              <View style={s.divider} />
              <RowItem label="Anzianità contributiva"   value={anzianitaLabel(snap.anzianita_anni, snap.anzianita_mesi, snap.anzianita_giorni)} />
            </Card>

            {/* Milestone 8 anni */}
            <Text style={s.sectionTitle}>MILESTONE CONTRIBUTIVE</Text>
            <Card>
              <View style={s.milestoneRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.milestoneLabel}>Soglia 8 anni</Text>
                  <Text style={[s.milestoneDesc, { color: milestoneColor(totMesi8) }]}>
                    {totMesi8 <= 0
                      ? '✓ Raggiunta — anticipazione 30%/casa disponibile'
                      : `Mancano ${mesiToLabel(totMesi8)} — poi anticipazione 30% e acquisto casa`}
                  </Text>
                </View>
              </View>
              <ProgressBar pct={pct8} color={milestoneColor(totMesi8)} />
              <View style={s.milestoneTickRow}>
                <Text style={s.milestoneTick}>Oggi {snap.anzianita_anni}a {snap.anzianita_mesi}m</Text>
                <Text style={s.milestoneTick}>8 anni</Text>
              </View>

              <View style={[s.milestoneItem, { marginTop: 12 }]}>
                <Text style={[s.milestoneDot, { color: COLORS.success }]}>●</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.milestoneName}>Salute grave</Text>
                  <Text style={s.milestoneNote}>75% — già disponibile in qualsiasi momento</Text>
                </View>
                <Text style={[s.milestoneStatus, { color: COLORS.success }]}>✓</Text>
              </View>
              <View style={s.milestoneItem}>
                <Text style={[s.milestoneDot, { color: milestoneColor(totMesi8) }]}>●</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.milestoneName}>Acquisto/ristrutturazione prima casa</Text>
                  <Text style={s.milestoneNote}>75% dopo 8 anni — {mesiToLabel(totMesi8)}</Text>
                </View>
                <Text style={[s.milestoneStatus, { color: milestoneColor(totMesi8) }]}>
                  {totMesi8 <= 0 ? '✓' : '○'}
                </Text>
              </View>
              <View style={s.milestoneItem}>
                <Text style={[s.milestoneDot, { color: milestoneColor(totMesi8) }]}>●</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.milestoneName}>Anticipazione 30% (qualsiasi motivo)</Text>
                  <Text style={s.milestoneNote}>30% dopo 8 anni — {mesiToLabel(totMesi8)}</Text>
                </View>
                <Text style={[s.milestoneStatus, { color: milestoneColor(totMesi8) }]}>
                  {totMesi8 <= 0 ? '✓' : '○'}
                </Text>
              </View>
            </Card>

            {/* Nota fiscale */}
            {regole?.nota_fiscale && (
              <>
                <Text style={s.sectionTitle}>VANTAGGI FISCALI</Text>
                <Card>
                  <Text style={s.notaFiscale}>{regole.nota_fiscale}</Text>
                </Card>
              </>
            )}
          </>
        )}

        {/* ── TAB: COME ACCEDERE ──────────────────────────── */}
        {tabAttiva === 'accesso' && regole && (
          <>
            <Text style={s.sectionTitle}>ANTICIPAZIONI</Text>
            <Text style={s.sectionHint}>Somme prelevabili mantenendo l'iscrizione al fondo</Text>
            {regole.anticipazioni?.map((item: any, i: number) => (
              <RegolaCard key={i} item={item} tipo="anticipazione" />
            ))}

            <Text style={[s.sectionTitle, { marginTop: 16 }]}>RISCATTI</Text>
            <Text style={s.sectionHint}>Chiusura parziale o totale della posizione</Text>
            {regole.riscatti?.map((item: any, i: number) => (
              <RegolaCard key={i} item={item} tipo="riscatto" />
            ))}

            <Text style={[s.sectionTitle, { marginTop: 16 }]}>PRESTAZIONI PENSIONISTICHE</Text>
            <Text style={s.sectionHint}>Accesso alla pensione complementare e RITA</Text>
            {regole.prestazioni_pensionistiche?.map((item: any, i: number) => (
              <RegolaCard key={i} item={item} tipo="prestazione" />
            ))}

            {regole.nota_fiscale && (
              <View style={[s.regolaCard, { borderLeftColor: COLORS.success, marginTop: 16 }]}>
                <Text style={[s.regolaTitolo, { marginBottom: 6 }]}>⚖ Nota fiscale</Text>
                <Text style={s.regolaDesc}>{regole.nota_fiscale}</Text>
              </View>
            )}

            <View style={{ height: 32 }} />
          </>
        )}

      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Stili ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:      { flex: 1, backgroundColor: COLORS.bg },
  body:           { padding: 16 },
  fondoHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  fondoNome:      { color: COLORS.text, fontWeight: '800', fontSize: 20 },
  fondoTipo:      { color: COLORS.subtext, fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  badge:          { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  badgeText:      { fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  kpiRow:         { flexDirection: 'row', gap: 8, marginBottom: 8 },
  emptyBox:       { backgroundColor: COLORS.card, borderRadius: 12, padding: 20, marginBottom: 16, alignItems: 'center' },
  emptyText:      { color: COLORS.text, fontWeight: '700', marginBottom: 6 },
  emptyHint:      { color: COLORS.subtext, fontSize: 12, textAlign: 'center' },
  sectionTitle:   { fontSize: 9, letterSpacing: 3, color: COLORS.subtext, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  sectionHint:    { fontSize: 11, color: COLORS.subtext, marginBottom: 8, marginTop: -4 },
  divider:        { height: 1, backgroundColor: COLORS.border, marginVertical: 8 },
  tabRow:         { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 4 },
  tabBtn:         { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  tabBtnActive:   { backgroundColor: COLORS.primary + '20', borderColor: COLORS.primary },
  tabLabel:       { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: COLORS.subtext },
  tabLabelActive: { color: COLORS.primary },
  // Milestone
  milestoneRow:   { marginBottom: 10 },
  milestoneLabel: { color: COLORS.text, fontWeight: '700', fontSize: 13, marginBottom: 4 },
  milestoneDesc:  { fontSize: 12, fontWeight: '600' },
  milestoneTickRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  milestoneTick:  { fontSize: 10, color: COLORS.subtext },
  milestoneItem:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: COLORS.border },
  milestoneDot:   { fontSize: 14, marginTop: 1 },
  milestoneName:  { color: COLORS.text, fontWeight: '600', fontSize: 13 },
  milestoneNote:  { color: COLORS.subtext, fontSize: 11, marginTop: 2 },
  milestoneStatus:{ fontWeight: '700', fontSize: 16, marginTop: 1 },
  notaFiscale:    { color: COLORS.subtext, fontSize: 12, lineHeight: 18 },
  // Regole accesso
  regolaCard:     { backgroundColor: COLORS.card, borderRadius: 10, padding: 14, marginBottom: 8, borderLeftWidth: 3 },
  regolaHead:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  regolaTitolo:   { color: COLORS.text, fontWeight: '700', fontSize: 14, marginBottom: 4 },
  regolaTag:      { color: COLORS.subtext, fontSize: 11, fontWeight: '600' },
  regolaBody:     { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  regolaDesc:     { color: COLORS.text, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  taxBadge:       { backgroundColor: COLORS.warning + '20', borderRadius: 6, padding: 8, marginBottom: 6 },
  taxText:        { color: COLORS.warning, fontSize: 11, fontWeight: '600' },
  causaItem:      { color: COLORS.subtext, fontSize: 12, lineHeight: 18, paddingLeft: 4 },
  // Pulsante aggiorna
  btnAggiorna:     { borderWidth: 1, borderColor: COLORS.primary + '88', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginBottom: 12, backgroundColor: COLORS.primary + '15' },
  btnAggiornaOpen: { borderColor: COLORS.subtext + '55', backgroundColor: 'transparent' },
  btnAggiornaText: { color: COLORS.primary, fontWeight: '700', fontSize: 12, letterSpacing: 1.5 },
  // Form
  formHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  formTitle:   { fontSize: 11, letterSpacing: 2, color: COLORS.subtext, fontWeight: '700' },
  formGroup:   { fontSize: 9, letterSpacing: 2, color: COLORS.subtext, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  fieldWrap:   { marginBottom: 10 },
  fieldLabel:  { fontSize: 11, color: COLORS.subtext, marginBottom: 4, fontWeight: '600' },
  fieldInput:  { backgroundColor: '#0D1525', borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, color: COLORS.text, fontSize: 14 },
  anzianitaRow:{ flexDirection: 'row', gap: 8 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btnCancel:   { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
  btnCancelText: { color: COLORS.subtext, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  btnSalva:    { flex: 2, backgroundColor: COLORS.primary, borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
  btnSalvaText:{ color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
});
