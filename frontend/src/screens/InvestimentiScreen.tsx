import React, { useState, useMemo, Component } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, RefreshControl, ActivityIndicator, TextInput,
} from 'react-native';
import { Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  usePortafoglio, useAggiornaPrezzi, useStoricoPortafoglio,
  useUltimoAggiornamento, useBackfillPrezzi, useStoricoPosizione,
} from '../hooks/useData';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import api, { setPrezzoManuale } from '../services/api';
import { COLORS, fmt, fmtShort } from '../utils/format';
import FinanceChart, { ChartPoint, fmtYValue } from '../components/FinanceChart';

const W = Dimensions.get('window').width;
const CHART_W = W - 48;

// ── ErrorBoundary con reset ──────────────────────────────
class ChartErrorBoundary extends Component<
  { children: React.ReactNode; posId: string },
  { error: string | null }
> {
  state = { error: null };
  static getDerivedStateFromError(e: any) { return { error: String(e?.message || e) }; }
  componentDidUpdate(prev: { posId: string }) {
    if (prev.posId !== this.props.posId && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ padding: 10, backgroundColor: '#1a0000', borderRadius: 6, margin: 4 }}>
          <Text style={{ color: '#F87171', fontSize: 11, fontWeight: '700' }}>Errore grafico</Text>
          <Text style={{ color: '#F87171', fontSize: 10, marginTop: 4 }}>{this.state.error}</Text>
          <TouchableOpacity
            style={{ marginTop: 8, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#2a0000', borderRadius: 4, alignSelf: 'flex-start' }}
            onPress={() => this.setState({ error: null })}
          >
            <Text style={{ color: '#F87171', fontSize: 11, fontWeight: '700' }}>Riprova</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ── Range ──────────────────────────────────────────────
type RangeKey = '1M' | '3M' | '6M' | '1A' | 'MAX';
const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1M',  label: '1M',  days: 30 },
  { key: '3M',  label: '3M',  days: 90 },
  { key: '6M',  label: '6M',  days: 180 },
  { key: '1A',  label: '1A',  days: 365 },
  { key: 'MAX', label: 'MAX', days: null },
];

function getDateField(d: any): Date {
  return new Date(d.data || d.rilevato_at || d.data_rilevazione || 0);
}

function filterByRange(points: any[], range: RangeKey): any[] {
  const r = RANGES.find(r => r.key === range);
  if (!r || r.days === null) return points;
  const cutoff = Date.now() - r.days * 86400000;
  return points.filter(d => getDateField(d).getTime() >= cutoff);
}

function RangePicker({ value, onChange }: { value: RangeKey; onChange: (r: RangeKey) => void }) {
  return (
    <View style={rp.row}>
      {RANGES.map(r => (
        <TouchableOpacity
          key={r.key}
          style={[rp.btn, value === r.key && rp.btnActive]}
          onPress={() => onChange(r.key)}
        >
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

// ── Helpers ────────────────────────────────────────────
const n = (v: any) => Number(v) || 0;
function colorPL(v: number) { return v >= 0 ? COLORS.success : COLORS.danger; }

function toChartPoints(raw: any[], mode: 'valore' | 'pl'): ChartPoint[] {
  if (!raw || raw.length < 2) return [];
  // Downsample a max 80 punti per performance
  const step = Math.max(1, Math.floor(raw.length / 80));
  return raw
    .filter((_, i) => i % step === 0 || i === raw.length - 1)
    .map(d => {
      const dt = getDateField(d);
      return {
        value: mode === 'valore' ? n(d.valore_mercato) : n(d.var_eur),
        label: dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
        dateFull: dt.toLocaleDateString('it-IT'),
      };
    });
}

// ── Mini-grafico posizione singola ─────────────────────
function PosizioneChart({ posId }: { posId: string }) {
  const [mode, setMode]   = useState<'valore' | 'pl'>('valore');
  const [range, setRange] = useState<RangeKey>('1A');
  const { data: storico, isLoading } = useStoricoPosizione(posId);

  const filtered  = useMemo(() => filterByRange(storico || [], range), [storico, range]);
  const chartPts  = useMemo(() => toChartPoints(filtered, mode), [filtered, mode]);
  const lastVal   = chartPts.length > 0 ? chartPts[chartPts.length - 1].value : 0;
  const lineColor = mode === 'pl' ? colorPL(lastVal) : COLORS.primary;

  if (isLoading) return (
    <View style={{ alignItems: 'center', paddingVertical: 20 }}>
      <ActivityIndicator size="small" color={COLORS.primary} />
    </View>
  );

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <RangePicker value={range} onChange={setRange} />
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {(['valore', 'pl'] as const).map(m => (
            <TouchableOpacity key={m} style={[rp.btn, mode === m && rp.btnActive]} onPress={() => setMode(m)}>
              <Text style={[rp.txt, mode === m && rp.txtActive]}>{m === 'valore' ? 'Val.' : 'P&L'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {chartPts.length < 2 ? (
        <View style={{ alignItems: 'center', paddingVertical: 14 }}>
          <Text style={{ color: COLORS.subtext, fontSize: 12, textAlign: 'center' }}>
            {(!storico || storico.length < 2)
              ? 'Nessun storico — usa "Carica storico" per importare i dati'
              : 'Nessun dato nel periodo selezionato'}
          </Text>
        </View>
      ) : (
        <FinanceChart
          points={chartPts}
          width={CHART_W - 28}
          height={160}
          color={lineColor}
          formatY={fmtYValue}
          tooltipFormat={fmt}
        />
      )}
    </View>
  );
}

// ── Grafico portafoglio complessivo ────────────────────
function OverallChart({ storico }: { storico: any[] }) {
  const [mode,  setMode]  = useState<'valore' | 'pl'>('valore');
  const [range, setRange] = useState<RangeKey>('1A');

  const filtered  = useMemo(() => filterByRange(storico, range), [storico, range]);
  const chartPts  = useMemo(() => toChartPoints(filtered, mode), [filtered, mode]);

  if (!storico || storico.length < 2) return (
    <View style={s.emptyChart}>
      <Ionicons name="analytics-outline" size={32} color={COLORS.subtext} />
      <Text style={s.emptyChartText}>
        Nessun storico portafoglio.{'\n'}Usa "Carica storico 1 anno" per importare i dati passati.
      </Text>
    </View>
  );

  const lastVal   = chartPts.length > 0 ? chartPts[chartPts.length - 1].value : 0;
  const firstVal  = chartPts.length > 0 ? chartPts[0].value : 0;
  const delta     = lastVal - firstVal;
  const deltaPct  = firstVal !== 0 ? (delta / Math.abs(firstVal)) * 100 : 0;
  const lineColor = mode === 'pl' ? colorPL(lastVal) : COLORS.primary;

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <View>
          <Text style={s.sectionTitle}>{mode === 'valore' ? 'Valore Portafoglio' : 'P&L nel Tempo'}</Text>
          {chartPts.length >= 2 && (
            <Text style={{ fontSize: 10, color: colorPL(delta), fontWeight: '700', marginTop: 2 }}>
              {delta >= 0 ? '+' : ''}{fmtShort(delta)} ({deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%) nel periodo
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {(['valore', 'pl'] as const).map(m => (
            <TouchableOpacity key={m} style={[rp.btn, mode === m && rp.btnActive]} onPress={() => setMode(m)}>
              <Text style={[rp.txt, mode === m && rp.txtActive]}>{m === 'valore' ? 'Val.' : 'P&L'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ marginBottom: 10 }}>
        <RangePicker value={range} onChange={setRange} />
      </View>

      {chartPts.length < 2 ? (
        <View style={s.emptyChart}>
          <Text style={s.emptyChartText}>Nessun dato nel periodo selezionato</Text>
        </View>
      ) : (
        <FinanceChart
          points={chartPts}
          width={CHART_W}
          height={200}
          color={lineColor}
          formatY={fmtYValue}
          tooltipFormat={fmt}
        />
      )}
    </View>
  );
}

// ── Riga posizione espandibile ─────────────────────────
function PosizioneRow({ pos }: { pos: any }) {
  const [expanded, setExpanded] = useState(false);
  const pl    = n(pos.var_eur);
  const plPct = n(pos.var_pct);

  const qc = useQueryClient();
  const [prezzoManuale, setPrezzoManualeInput] = useState('');
  const [manualeMsg, setManualeMsg] = useState<string | null>(null);
  const salvaPrezzo = useMutation({
    mutationFn: () => setPrezzoManuale(String(pos.id), parseFloat(prezzoManuale.replace(',', '.'))),
    onSuccess: () => {
      setManualeMsg('✓ Prezzo aggiornato');
      setPrezzoManualeInput('');
      qc.invalidateQueries({ queryKey: ['portafoglio'] });
      qc.invalidateQueries({ queryKey: ['patrimonio-live'] });
      qc.invalidateQueries({ queryKey: ['storico-portafoglio'] });
    },
    onError: () => setManualeMsg('✗ Errore salvataggio'),
  });

  const tipoBadgeColor = pos.tipo === 'crypto'          ? COLORS.orange
    : pos.tipo === 'azione'         ? COLORS.purple
    : pos.tipo === 'conto_deposito' ? COLORS.success
    : COLORS.primary;

  return (
    <View>
      <TouchableOpacity style={s.posRow} onPress={() => setExpanded(e => !e)} activeOpacity={0.7}>
        <View style={s.posLeft}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <Text style={s.posSimb}>{pos.simbolo}</Text>
            <View style={[s.badge, { backgroundColor: tipoBadgeColor + '22' }]}>
              <Text style={[s.badgeTxt, { color: tipoBadgeColor }]}>{pos.tipo.toUpperCase()}</Text>
            </View>
            <View style={[s.badge, { backgroundColor: pos.piattaforma === 'Revolut Investimenti' ? COLORS.purple + '22' : '#22D3EE22' }]}>
              <Text style={[s.badgeTxt, { color: pos.piattaforma === 'Revolut Investimenti' ? COLORS.purple : '#22D3EE' }]}>
                {pos.piattaforma === 'Revolut Investimenti' ? 'REVOLUT' : 'FINECO'}
              </Text>
            </View>
          </View>
          <Text style={s.posNome} numberOfLines={1}>{pos.nome}</Text>
          <Text style={s.posDetail}>
            Qtà {n(pos.quantita).toFixed(4)} · Carico {fmt(pos.prezzo_carico)} · Mkt {pos.prezzo_mercato ? fmt(pos.prezzo_mercato) : '—'}
          </Text>
        </View>
        <View style={s.posRight}>
          <Text style={s.posMkt}>{pos.valore_mercato ? fmt(pos.valore_mercato) : '—'}</Text>
          {pos.var_eur != null && (
            <Text style={[s.posPL, { color: colorPL(pl) }]}>
              {pl >= 0 ? '+' : ''}{fmtShort(pl)} ({pl >= 0 ? '+' : ''}{plPct.toFixed(1)}%)
            </Text>
          )}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={COLORS.subtext} style={{ marginTop: 4 }} />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={s.posChartWrap}>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <View style={s.miniStat}>
              <Text style={s.miniStatLabel}>VALORE CARICO</Text>
              <Text style={s.miniStatVal}>{fmt(pos.valore_carico)}</Text>
            </View>
            <View style={s.miniStat}>
              <Text style={s.miniStatLabel}>VALORE MKT</Text>
              <Text style={[s.miniStatVal, { color: COLORS.primary }]}>{pos.valore_mercato ? fmt(pos.valore_mercato) : '—'}</Text>
            </View>
            <View style={s.miniStat}>
              <Text style={s.miniStatLabel}>P&L TOTALE</Text>
              <Text style={[s.miniStatVal, { color: colorPL(pl) }]}>{pl >= 0 ? '+' : ''}{fmtShort(pl)}</Text>
            </View>
          </View>
          {/* Prezzo manuale (titoli non quotati, es. SpaceX) */}
          <View style={s.manualeBox}>
            <Text style={s.manualeLabel}>PREZZO MANUALE (titoli non quotati)</Text>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput
                style={s.manualeInput}
                value={prezzoManuale}
                onChangeText={setPrezzoManualeInput}
                placeholder={pos.prezzo_mercato ? `attuale ${fmt(pos.prezzo_mercato)}` : 'es. 185,00'}
                placeholderTextColor={COLORS.subtext}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity
                style={[s.manualeBtn, (!prezzoManuale || salvaPrezzo.isPending) && { opacity: 0.5 }]}
                onPress={() => { setManualeMsg(null); if (prezzoManuale) salvaPrezzo.mutate(); }}
                disabled={!prezzoManuale || salvaPrezzo.isPending}
              >
                {salvaPrezzo.isPending ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={s.manualeBtnTxt}>Salva</Text>}
              </TouchableOpacity>
            </View>
            {manualeMsg && <Text style={[s.manualeMsg, { color: manualeMsg.startsWith('✓') ? COLORS.success : COLORS.danger }]}>{manualeMsg}</Text>}
          </View>

          <ChartErrorBoundary posId={String(pos.id)}>
            <PosizioneChart posId={String(pos.id)} />
          </ChartErrorBoundary>
        </View>
      )}
    </View>
  );
}

// ── PAC Form ──────────────────────────────────────────
function PACForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { data: posizioni = [] } = useQuery({
    queryKey: ['portafoglio'],
    queryFn: () => api.get('/portafoglio/').then(r => r.data),
  });

  const [nome, setNome] = useState('');
  const [piattaforma, setPiattaforma] = useState('Fineco');
  const [giorno, setGiorno] = useState('15');
  const [costoStr, setCostoStr] = useState('2.95');
  const [prossimoStr, setProssimoStr] = useState('');
  const [strumenti, setStrumenti] = useState<Array<{
    posizione_id: string; nome_etf: string; simbolo: string;
    importo_target: string; quantita_target: string;
  }>>([]);

  const salva = useMutation({
    mutationFn: () => api.post('/pac/', {
      nome,
      piattaforma,
      giorno_esecuzione: parseInt(giorno) || 15,
      costo_per_strumento: parseFloat(costoStr) || 0,
      prossimo_investimento: prossimoStr || null,
      stato: 'attivo',
      periodicita: 'mensile',
      strumenti: strumenti.map(s => ({
        nome_etf: s.nome_etf,
        simbolo: s.simbolo,
        posizione_id: s.posizione_id || null,
        importo_target: parseFloat(s.importo_target) || 0,
        quantita_target: parseInt(s.quantita_target) || 1,
        attivo: true,
      })),
    }).then(r => r.data),
    onSuccess: onSaved,
  });

  const addStrumento = (pos: any) => {
    setStrumenti(prev => [...prev, {
      posizione_id: pos.id,
      nome_etf: pos.nome,
      simbolo: pos.simbolo,
      importo_target: '',
      quantita_target: '1',
    }]);
  };

  const removeStrumento = (idx: number) => {
    setStrumenti(prev => prev.filter((_, i) => i !== idx));
  };

  const inputStyle = {
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    color: COLORS.text,
    padding: 8,
    fontSize: 13,
    marginBottom: 8,
  };

  const labelStyle = { fontSize: 10, color: COLORS.subtext, fontWeight: '700' as const, letterSpacing: 0.5, marginBottom: 3, marginTop: 6 };

  // Posizioni non già aggiunte
  const posizioniDisponibili = (posizioni as any[]).filter(p =>
    !strumenti.find(s => s.posizione_id === p.id)
  );

  return (
    <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border }}>
      <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.text, marginBottom: 12 }}>Nuovo Piano di Accumulo</Text>

      <Text style={labelStyle}>NOME PIANO</Text>
      <TextInput style={inputStyle} value={nome} onChangeText={setNome} placeholder="es. PAC Fineco ETF" placeholderTextColor={COLORS.subtext} />

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={labelStyle}>PIATTAFORMA</Text>
          <TextInput style={inputStyle} value={piattaforma} onChangeText={setPiattaforma} placeholder="Fineco" placeholderTextColor={COLORS.subtext} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={labelStyle}>GIORNO ESECUZIONE</Text>
          <TextInput style={inputStyle} value={giorno} onChangeText={setGiorno} keyboardType="numeric" placeholder="15" placeholderTextColor={COLORS.subtext} />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={labelStyle}>COSTO/STRUMENTO €</Text>
          <TextInput style={inputStyle} value={costoStr} onChangeText={setCostoStr} keyboardType="decimal-pad" placeholder="2.95" placeholderTextColor={COLORS.subtext} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={labelStyle}>PROSSIMO (AAAA-MM-GG)</Text>
          <TextInput style={inputStyle} value={prossimoStr} onChangeText={setProssimoStr} placeholder="2026-05-15" placeholderTextColor={COLORS.subtext} />
        </View>
      </View>

      {/* Strumenti aggiunti */}
      {strumenti.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={labelStyle}>STRUMENTI SELEZIONATI</Text>
          {strumenti.map((st, idx) => (
            <View key={idx} style={{ backgroundColor: COLORS.bg, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: COLORS.border, marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.text, flex: 1 }} numberOfLines={1}>{st.nome_etf}</Text>
                <TouchableOpacity onPress={() => removeStrumento(idx)}>
                  <Ionicons name="close-circle" size={16} color={COLORS.danger} />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, color: COLORS.subtext, marginBottom: 2 }}>IMPORTO TARGET €</Text>
                  <TextInput
                    style={{ ...inputStyle, marginBottom: 0 }}
                    value={st.importo_target}
                    onChangeText={v => setStrumenti(prev => prev.map((s, i) => i === idx ? { ...s, importo_target: v } : s))}
                    keyboardType="decimal-pad"
                    placeholder="500"
                    placeholderTextColor={COLORS.subtext}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, color: COLORS.subtext, marginBottom: 2 }}>N. QUOTE</Text>
                  <TextInput
                    style={{ ...inputStyle, marginBottom: 0 }}
                    value={st.quantita_target}
                    onChangeText={v => setStrumenti(prev => prev.map((s, i) => i === idx ? { ...s, quantita_target: v } : s))}
                    keyboardType="numeric"
                    placeholder="3"
                    placeholderTextColor={COLORS.subtext}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Aggiungi strumento dal portafoglio */}
      {posizioniDisponibili.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={labelStyle}>AGGIUNGI STRUMENTO DAL PORTAFOGLIO</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(posizioniDisponibili as any[]).map((pos: any) => (
                <TouchableOpacity
                  key={pos.id}
                  style={{ backgroundColor: COLORS.primary + '22', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.primary + '44' }}
                  onPress={() => addStrumento(pos)}
                >
                  <Text style={{ color: COLORS.primary, fontSize: 10, fontWeight: '700' }}>{pos.simbolo}</Text>
                  <Text style={{ color: COLORS.subtext, fontSize: 9 }} numberOfLines={1}>{pos.nome?.substring(0, 20)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {salva.isError && (
        <Text style={{ color: COLORS.danger, fontSize: 11, marginBottom: 6 }}>Errore nel salvataggio. Controlla i dati.</Text>
      )}

      {/* Bottoni */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <TouchableOpacity
          style={{ flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' }}
          onPress={onClose}
        >
          <Text style={{ color: COLORS.subtext, fontWeight: '700', fontSize: 13 }}>Annulla</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 2, paddingVertical: 10, borderRadius: 8, backgroundColor: COLORS.primary, alignItems: 'center', opacity: salva.isPending || !nome ? 0.6 : 1 }}
          onPress={() => salva.mutate()}
          disabled={salva.isPending || !nome}
        >
          {salva.isPending
            ? <ActivityIndicator size="small" color="#000" />
            : <Text style={{ color: '#000', fontWeight: '800', fontSize: 13 }}>Salva Piano</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── PAC Card ──────────────────────────────────────────
function PACCard() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: piani = [], isLoading } = useQuery({
    queryKey: ['pac'],
    queryFn: () => api.get('/pac/').then(r => r.data),
  });

  const esegui = useMutation({
    mutationFn: (pianoId: string) => api.post(`/pac/${pianoId}/esegui`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pac'] });
      qc.invalidateQueries({ queryKey: ['portafoglio'] });
      qc.invalidateQueries({ queryKey: ['mesi-disponibili'] });
    },
  });

  if (isLoading) return <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 8 }} />;

  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="repeat" size={16} color={COLORS.primary} />
          <Text style={s.sectionTitle}>Piani di Accumulo (PAC)</Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowForm(true)}
          style={{ backgroundColor: COLORS.primary + '22', borderRadius: 6, padding: 6 }}
        >
          <Ionicons name="add" size={16} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {(piani as any[]).length === 0 && !showForm && (
        <Text style={{ color: COLORS.subtext, fontSize: 12, textAlign: 'center', paddingVertical: 8 }}>
          Nessun piano attivo. Tocca + per aggiungerne uno.
        </Text>
      )}

      {(piani as any[]).map((piano: any) => {
        const prossimo = piano.prossimo_investimento ? new Date(piano.prossimo_investimento + 'T00:00:00') : null;
        const oggi = new Date();
        const giorniMancanti = prossimo ? Math.ceil((prossimo.getTime() - oggi.setHours(0,0,0,0)) / 86400000) : null;
        const statoColor = piano.stato === 'attivo' ? COLORS.success : piano.stato === 'sospeso' ? COLORS.warning : COLORS.subtext;
        const importoStimato = (piano.strumenti as any[]).reduce((s: number, st: any) => s + (Number(st.importo_stimato) || 0), 0);

        return (
          <View key={piano.id} style={{ marginBottom: 8 }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.text }}>{piano.nome}</Text>
                <Text style={{ fontSize: 10, color: COLORS.subtext, marginTop: 1 }}>
                  {piano.piattaforma} · giorno {piano.giorno_esecuzione} di ogni mese
                </Text>
              </View>
              <View style={{ backgroundColor: statoColor + '22', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: statoColor, fontSize: 9, fontWeight: '800' }}>{piano.stato.toUpperCase()}</Text>
              </View>
            </View>

            {/* KPI */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <View style={{ flex: 1, backgroundColor: COLORS.bg, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: COLORS.border }}>
                <Text style={{ fontSize: 8, color: COLORS.subtext, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>INVESTIMENTO STIMATO</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: COLORS.primary }}>
                  {importoStimato > 0 ? fmt(importoStimato) : fmt(piano.importo_mensile_totale)}
                </Text>
                <Text style={{ fontSize: 9, color: COLORS.subtext }}>+ {fmt(piano.costo_mensile_totale)} comm.</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: piano.esecuzione_pendente ? COLORS.warning + '11' : COLORS.bg, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: piano.esecuzione_pendente ? COLORS.warning : COLORS.border }}>
                <Text style={{ fontSize: 8, color: COLORS.subtext, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 }}>PROSSIMO</Text>
                <Text style={{ fontSize: 14, fontWeight: '800', color: piano.esecuzione_pendente ? COLORS.warning : COLORS.text }}>
                  {prossimo ? prossimo.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) : '—'}
                </Text>
                <Text style={{ fontSize: 9, color: piano.esecuzione_pendente ? COLORS.warning : COLORS.subtext }}>
                  {giorniMancanti !== null
                    ? giorniMancanti <= 0 ? '⚡ Esecuzione oggi!'
                    : giorniMancanti === 1 ? 'domani'
                    : `tra ${giorniMancanti} giorni`
                    : '—'}
                </Text>
              </View>
            </View>

            {/* Strumenti */}
            {(piano.strumenti as any[]).filter((st: any) => st.attivo).map((st: any) => (
              <View key={st.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border + '33' }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontSize: 10, color: COLORS.text, fontWeight: '600' }} numberOfLines={1}>{st.nome_etf}</Text>
                  <Text style={{ fontSize: 9, color: COLORS.subtext }}>{st.simbolo} · {st.quantita_target} quote</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.primary }}>
                    {st.importo_stimato ? fmt(Number(st.importo_stimato)) : fmt(Number(st.importo_target))}
                  </Text>
                  {st.importo_stimato && Math.abs(Number(st.importo_stimato) - Number(st.importo_target)) > 1 && (
                    <Text style={{ fontSize: 9, color: COLORS.subtext }}>target {fmt(Number(st.importo_target))}</Text>
                  )}
                </View>
              </View>
            ))}

            {/* Pulsante esegui */}
            {piano.esecuzione_pendente && (
              <TouchableOpacity
                style={{ marginTop: 10, backgroundColor: COLORS.warning, borderRadius: 8, paddingVertical: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6, opacity: esegui.isPending ? 0.6 : 1 }}
                onPress={() => esegui.mutate(piano.id)}
                disabled={esegui.isPending}
              >
                {esegui.isPending
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Ionicons name="flash" size={14} color="#000" />
                }
                <Text style={{ color: '#000', fontWeight: '800', fontSize: 13 }}>
                  {esegui.isPending ? 'Esecuzione in corso...' : 'Esegui PAC ora'}
                </Text>
              </TouchableOpacity>
            )}

            {esegui.isSuccess && (
              <Text style={{ color: COLORS.success, fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 6 }}>
                ✓ PAC eseguito! Portafoglio aggiornato.
              </Text>
            )}
          </View>
        );
      })}

      {/* Form nuovo PAC */}
      {showForm && (
        <PACForm onClose={() => setShowForm(false)} onSaved={() => {
          setShowForm(false);
          qc.invalidateQueries({ queryKey: ['pac'] });
        }} />
      )}
    </View>
  );
}

// ── Screen principale ──────────────────────────────────
export default function InvestimentiScreen() {
  const qc = useQueryClient();
  const { data: posizioni, isLoading, error, refetch } = usePortafoglio();
  const { data: storico = [] }  = useStoricoPortafoglio();
  const { data: ultimoAgg }     = useUltimoAggiornamento();
  const aggiorna  = useAggiornaPrezzi();
  const backfill  = useBackfillPrezzi();
  const [filtro, setFiltro]       = useState<'tutti' | 'fineco' | 'revolut'>('tutti');
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);
  const [aggiornaMsg, setAggiornaMsg] = useState<string | null>(null);

  const handleAggiorna = () => {
    setAggiornaMsg(null);
    aggiorna.mutate(undefined, {
      onSuccess: (data: any) => {
        const n_ok = data?.aggiornati?.length || 0;
        const errs = data?.errori || [];
        setAggiornaMsg(
          `✓ ${n_ok} prezzi aggiornati` +
          (errs.length ? ` · ⚠️ non trovati: ${errs.join(', ')}` : '')
        );
      },
      onError: () => setAggiornaMsg('✗ Errore aggiornamento prezzi'),
    });
  };

  if (isLoading) return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  );
  if (error) return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
      <Text style={{ color: COLORS.danger }}>Errore caricamento portafoglio</Text>
    </View>
  );

  const pos      = (posizioni || []) as any[];
  const filtered = filtro === 'tutti'  ? pos
    : filtro === 'fineco'  ? pos.filter((p: any) => p.piattaforma === 'Fineco')
    : pos.filter((p: any) => p.piattaforma === 'Revolut Investimenti');

  const totVMkt    = pos.reduce((s: number, p: any) => s + n(p.valore_mercato), 0);
  const totVCar    = pos.reduce((s: number, p: any) => s + n(p.valore_carico), 0);
  const totPL      = totVMkt - totVCar;
  const totFineco  = pos.filter((p: any) => p.piattaforma === 'Fineco').reduce((s: number, p: any) => s + n(p.valore_mercato), 0);
  const totRevolut = pos.filter((p: any) => p.piattaforma === 'Revolut Investimenti').reduce((s: number, p: any) => s + n(p.valore_mercato), 0);
  const filtVMkt   = filtered.reduce((s: number, p: any) => s + n(p.valore_mercato), 0);
  const filtVCar   = filtered.reduce((s: number, p: any) => s + n(p.valore_carico), 0);
  const filtPL     = filtVMkt - filtVCar;
  const filtPct    = filtVCar > 0 ? (filtPL / filtVCar) * 100 : 0;
  const filtLabel  = filtro === 'fineco' ? 'TOTALE FINECO' : filtro === 'revolut' ? 'TOTALE REVOLUT' : 'TOTALE PORTAFOGLIO';

  const ultimoStr = ultimoAgg?.ultimo_aggiornamento
    ? new Date(ultimoAgg.ultimo_aggiornamento).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const handleBackfill = (range: string) => {
    setBackfillMsg(null);
    backfill.mutate(range, {
      onSuccess: (data: any) => setBackfillMsg(`✓ Caricati ${data.inseriti} snapshot${data.errori?.length ? ` (errori: ${data.errori.join(', ')})` : ''}`),
      onError:   () => setBackfillMsg('✗ Errore caricamento storico'),
    });
  };

  return (
    <ScrollView
      style={s.container}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.primary} />}
    >
      <View style={s.body}>

        {/* KPI */}
        <View style={s.kpiRow}>
          <View style={[s.kpi, s.kpiHighlight]}>
            <Text style={s.kpiLabel}>VALORE MERCATO</Text>
            <Text style={[s.kpiVal, { color: COLORS.primary }]}>{fmtShort(filtVMkt)}</Text>
            <Text style={s.kpiSub}>Carico {fmtShort(filtVCar)}</Text>
          </View>
          <View style={[s.kpi, { borderLeftWidth: 3, borderLeftColor: colorPL(filtPL) }]}>
            <Text style={s.kpiLabel}>P&L TOTALE</Text>
            <Text style={[s.kpiVal, { color: colorPL(filtPL) }]}>{filtPL >= 0 ? '+' : ''}{fmtShort(filtPL)}</Text>
            <Text style={[s.kpiSub, { color: colorPL(filtPL) }]}>{filtPct >= 0 ? '+' : ''}{filtPct.toFixed(2)}%</Text>
          </View>
        </View>

        {/* Pulsanti prezzi */}
        <View style={s.actionRow}>
          <TouchableOpacity
            style={[s.actionBtn, s.actionBtnPrimary, aggiorna.isPending && { opacity: 0.6 }]}
            onPress={handleAggiorna}
            disabled={aggiorna.isPending}
          >
            {aggiorna.isPending ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="refresh" size={13} color="#000" />}
            <Text style={s.actionBtnTxtDark}>Aggiorna prezzi</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.actionBtn, backfill.isPending && { opacity: 0.6 }]}
            onPress={() => handleBackfill('1y')}
            disabled={backfill.isPending}
          >
            {backfill.isPending ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Ionicons name="cloud-download-outline" size={13} color={COLORS.primary} />}
            <Text style={s.actionBtnTxt}>Carica storico 1 anno</Text>
          </TouchableOpacity>
        </View>

        {aggiornaMsg  && <Text style={[s.ultimoAgg, { color: aggiornaMsg.startsWith('✓') ? COLORS.success : COLORS.danger, marginBottom: 6 }]}>{aggiornaMsg}</Text>}
        {ultimoStr    && <Text style={s.ultimoAgg}>⏱ Ultimo aggiornamento: {ultimoStr}</Text>}
        {backfillMsg  && <Text style={[s.ultimoAgg, { color: backfillMsg.startsWith('✓') ? COLORS.success : COLORS.danger, marginBottom: 8 }]}>{backfillMsg}</Text>}

        {/* Grafico complessivo */}
        <View style={s.card}>
          <OverallChart storico={storico as any[]} />
        </View>

        {/* PAC */}
        <PACCard />

        {/* Filtri piattaforma */}
        <View style={s.filterRow}>
          {([
            { key: 'tutti',   label: `Tutti (${pos.length})` },
            { key: 'fineco',  label: `Fineco ${fmtShort(totFineco)}` },
            { key: 'revolut', label: `Revolut ${fmtShort(totRevolut)}` },
          ] as { key: 'tutti'|'fineco'|'revolut'; label: string }[]).map(f => (
            <TouchableOpacity key={f.key} style={[s.filterBtn, filtro === f.key && s.filterBtnActive]} onPress={() => setFiltro(f.key)}>
              <Text style={[s.filterText, filtro === f.key && s.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Lista posizioni */}
        <View style={s.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={s.sectionTitle}>Posizioni</Text>
            <Text style={{ color: COLORS.subtext, fontSize: 10 }}>Tocca per vedere il grafico</Text>
          </View>

          {filtered.map((p: any) => <PosizioneRow key={p.id} pos={p} />)}

          <View style={s.totaleRow}>
            <Text style={s.totaleLabel}>{filtLabel}</Text>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.totaleValore}>{fmt(filtVMkt)}</Text>
              <Text style={{ color: colorPL(filtPL), fontWeight: '700', fontSize: 12 }}>
                {filtPL >= 0 ? '+' : ''}{fmt(filtPL)} ({filtPct >= 0 ? '+' : ''}{filtPct.toFixed(1)}%)
              </Text>
            </View>
          </View>
        </View>

      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body:      { padding: 14, paddingBottom: 32 },

  kpiRow:       { flexDirection: 'row', gap: 8, marginBottom: 10 },
  kpi:          { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  kpiHighlight: { borderLeftWidth: 3, borderLeftColor: COLORS.primary },
  kpiLabel:     { fontSize: 9, color: COLORS.subtext, fontWeight: '700', letterSpacing: 1, marginBottom: 3 },
  kpiVal:       { fontSize: 18, fontWeight: '900', color: COLORS.text },
  kpiSub:       { fontSize: 10, color: COLORS.subtext, marginTop: 2 },

  actionRow:        { flexDirection: 'row', gap: 8, marginBottom: 6 },
  actionBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  actionBtnPrimary: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  actionBtnTxt:     { color: COLORS.primary, fontWeight: '700', fontSize: 12 },
  actionBtnTxtDark: { color: '#000', fontWeight: '700', fontSize: 12 },
  ultimoAgg:        { fontSize: 10, color: COLORS.subtext, marginBottom: 10 },

  card:        { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  sectionTitle:{ fontSize: 13, fontWeight: '800', color: COLORS.text },

  emptyChart:    { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyChartText:{ color: COLORS.subtext, fontSize: 12, textAlign: 'center', lineHeight: 18 },

  filterRow:       { flexDirection: 'row', gap: 6, marginBottom: 10 },
  filterBtn:       { flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  filterBtnActive: { backgroundColor: '#0C1F35', borderColor: COLORS.primary },
  filterText:      { fontSize: 10, color: COLORS.subtext, fontWeight: '700' },
  filterTextActive:{ color: COLORS.primary },

  posRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border + '44' },
  posLeft:   { flex: 1, marginRight: 8 },
  posRight:  { alignItems: 'flex-end', justifyContent: 'center' },
  posSimb:   { color: '#F1F5F9', fontWeight: '700', fontSize: 14 },
  posNome:   { color: COLORS.subtext, fontSize: 10, marginBottom: 2 },
  posDetail: { color: COLORS.subtext, fontSize: 9 },
  posMkt:    { color: '#F1F5F9', fontWeight: '700', fontSize: 13, marginBottom: 2 },
  posPL:     { fontSize: 11, fontWeight: '700' },

  badge:    { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  badgeTxt: { fontSize: 8, fontWeight: '800' },

  posChartWrap: { backgroundColor: COLORS.bg, borderRadius: 8, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: COLORS.border + '88' },
  miniStat:     { flex: 1, backgroundColor: COLORS.surface, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: COLORS.border },
  miniStatLabel:{ fontSize: 8, color: COLORS.subtext, fontWeight: '700', letterSpacing: 0.5, marginBottom: 3 },
  miniStatVal:  { fontSize: 12, fontWeight: '800', color: COLORS.text },

  manualeBox:    { backgroundColor: COLORS.bg, borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border + '88' },
  manualeLabel:  { fontSize: 8, color: COLORS.subtext, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 },
  manualeInput:  { flex: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7, color: COLORS.text, fontSize: 13 },
  manualeBtn:    { borderWidth: 1, borderColor: COLORS.primary + '66', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8 },
  manualeBtnTxt: { color: COLORS.primary, fontSize: 12, fontWeight: '800' },
  manualeMsg:    { fontSize: 10, fontWeight: '700', marginTop: 6 },

  totaleRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 4, borderTopWidth: 1, borderTopColor: COLORS.border },
  totaleLabel: { color: COLORS.subtext, fontWeight: '700', fontSize: 11, letterSpacing: 2 },
  totaleValore:{ color: COLORS.primary, fontWeight: '800', fontSize: 16 },
});
