import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, TextInput,
} from 'react-native';
import QRCode from 'react-qr-code';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { COLORS } from '../utils/format';
import {
  importaConti, importaMutui, importaPianoAmmortamento,
  importaImmobili, importaPortafoglio, importaOrologi, importaMovimenti,
  importaFinecoPortafoglio, importaFinecoConto,
  importaUnicreditConto, importaUnicreditCarta, importaUnicreditMutuo,
  importaCaMutuo,
  importaRevolutConto, importaRevolutDeposito,
  setup2fa, enable2fa, disable2fa, get2faStatus,
} from '../services/api';

interface Entity {
  key: string;
  label: string;
  fn: (f: File) => Promise<any>;
  colonne: string;
  esempio: string;
}

const ENTITIES: Entity[] = [
  {
    key: 'conti', label: 'Conti',
    fn: importaConti,
    colonne: 'nome, tipo, banca, iban, valuta, saldo, note',
    esempio: 'Conto Corrente,conto_corrente,UniCredit,IT60X...,EUR,5000.00,',
  },
  {
    key: 'mutui', label: 'Mutui',
    fn: importaMutui,
    colonne: 'nome, banca, numero_contratto, capitale_erogato, capitale_residuo, tasso_tipo, tasso_valore, rata_mensile, rate_totali, rate_pagate, data_erogazione, data_scadenza',
    esempio: 'Mutuo Casa,UniCredit,UC123,200000,180000,fisso,2.5,850,300,24,2022-01-01,2047-01-01',
  },
  {
    key: 'piano-ammortamento', label: 'Piano Ammortamento',
    fn: importaPianoAmmortamento,
    colonne: 'mutuo_nome, numero_rata, data_scadenza, quota_capitale, quota_interessi, rata_totale, pagata, data_pagamento',
    esempio: 'Mutuo Casa,1,2022-02-01,450.00,400.00,850.00,true,2022-02-01',
  },
  {
    key: 'immobili', label: 'Immobili',
    fn: importaImmobili,
    colonne: 'nome, descrizione, indirizzo, tipo, superficie_mq, valore_acquisto, data_acquisto, valore_mercato',
    esempio: 'Casa Milano,Appartamento,Via Roma 1,residenziale,80,300000,2020-03-15,350000',
  },
  {
    key: 'portafoglio', label: 'Investimenti',
    fn: importaPortafoglio,
    colonne: 'simbolo, isin, nome, tipo, piattaforma, quantita, prezzo_carico, valore_carico, data_primo_acquisto, note',
    esempio: 'VWCE,IE00BK5BQT80,Vanguard FTSE All-World,etf,Fineco,100,95.50,9550,2021-06-01,',
  },
  {
    key: 'orologi', label: 'Orologi',
    fn: importaOrologi,
    colonne: 'marca, modello, riferimento, anno_acquisto, prezzo_acquisto, stima_min, stima_max, note',
    esempio: 'Rolex,Submariner,116610LN,2019,12000,14000,18000,',
  },
  {
    key: 'movimenti', label: 'Movimenti',
    fn: importaMovimenti,
    colonne: 'tipo, importo, descrizione, data_operazione, conto_nome, note',
    esempio: 'uscita,150.00,Spesa supermercato,2024-01-15,Conto Corrente,',
  },
];

interface State {
  loading: boolean;
  result: { importati: number; saltati?: number; errori: string[] } | null;
  error: string | null;
}

function EntityCard({ entity }: { entity: Entity }) {
  const inputRef = useRef<any>(null);
  const [state, setState] = useState<State>({ loading: false, result: null, error: null });

  const handleUpload = async (e: any) => {
    const file: File = e.target.files[0];
    if (!file) return;
    setState({ loading: true, result: null, error: null });
    try {
      const result = await entity.fn(file);
      setState({ loading: false, result, error: null });
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Errore sconosciuto';
      setState({ loading: false, result: null, error: msg });
    }
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const header = entity.colonne;
    const content = `${header}\n${entity.esempio}\n`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${entity.key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{entity.label}</Text>
      <Text style={s.colonne}>{entity.colonne}</Text>

      <View style={s.row}>
        <TouchableOpacity style={[s.btn, s.btnSecondary]} onPress={downloadTemplate}>
          <Text style={s.btnSecondaryText}>Template CSV</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.btn} onPress={() => inputRef.current?.click()} disabled={state.loading}>
          {state.loading
            ? <ActivityIndicator color="#000" size="small" />
            : <Text style={s.btnText}>Importa CSV</Text>
          }
        </TouchableOpacity>
      </View>

      {/* input file nativo web, invisibile */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      {state.result && (
        <View style={[s.feedback, state.result.errori.length > 0 ? s.feedbackWarn : s.feedbackOk]}>
          <Text style={s.feedbackText}>
            ✓ {state.result.importati} righe importate
            {state.result.errori.length > 0 && ` · ${state.result.errori.length} errori`}
          </Text>
          {state.result.errori.slice(0, 5).map((e, i) => (
            <Text key={i} style={s.errorLine}>{e}</Text>
          ))}
        </View>
      )}

      {state.error && (
        <View style={[s.feedback, s.feedbackError]}>
          <Text style={s.feedbackText}>{state.error}</Text>
        </View>
      )}
    </View>
  );
}

function FinecoCard() {
  const inputRef = useRef<any>(null);
  const [state, setState] = useState<State>({ loading: false, result: null, error: null });

  const handleUpload = async (e: any) => {
    const file: File = e.target.files[0];
    if (!file) return;
    setState({ loading: true, result: null, error: null });
    try {
      const res = await importaFinecoPortafoglio(file);
      // Adatta il risultato al formato atteso da result
      setState({
        loading: false,
        result: {
          importati: (res.creati || 0) + (res.aggiornati || 0),
          errori: res.errori || [],
        },
        error: null,
      });
    } catch (err: any) {
      setState({ loading: false, result: null, error: err?.response?.data?.detail || err?.message || 'Errore' });
    }
    e.target.value = '';
  };

  return (
    <View style={[s.card, s.finecoCard]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Text style={s.cardTitle}>Fineco — Portafoglio di Sintesi</Text>
        <View style={s.badge}><Text style={s.badgeText}>XLS / XLSX</Text></View>
      </View>
      <Text style={s.colonne}>
        Esporta da Fineco → Dossier titoli → Portafoglio di sintesi → Esporta Excel.{'\n'}
        Logica: crea nuove posizioni, aggiorna quantità/prezzi esistenti, disattiva quelle rimosse.
      </Text>

      <TouchableOpacity style={s.btn} onPress={() => inputRef.current?.click()} disabled={state.loading}>
        {state.loading
          ? <ActivityIndicator color="#000" size="small" />
          : <Text style={s.btnText}>Carica file Fineco</Text>
        }
      </TouchableOpacity>

      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      {state.result && (
        <View style={[s.feedback, state.result.errori.length > 0 ? s.feedbackWarn : s.feedbackOk]}>
          <Text style={s.feedbackText}>✓ {state.result.importati} posizioni elaborate{state.result.errori.length > 0 ? ` · ${state.result.errori.length} errori` : ''}</Text>
          {state.result.errori.slice(0, 5).map((e: string, i: number) => <Text key={i} style={s.errorLine}>{e}</Text>)}
        </View>
      )}
      {state.error && <View style={[s.feedback, s.feedbackError]}><Text style={s.feedbackText}>{state.error}</Text></View>}
    </View>
  );
}

// ── UniCredit XLS/PDF card ─────────────────────────────
interface UniCreditCardConfig {
  label: string;
  badge: string;
  accept: string;
  description: string;
  fn: (f: File) => Promise<any>;
  borderColor: string;
}

function UniCreditCard({ cfg }: { cfg: UniCreditCardConfig }) {
  const inputRef = useRef<any>(null);
  const [state, setState] = useState<State>({ loading: false, result: null, error: null });

  const handleUpload = async (e: any) => {
    const file: File = e.target.files[0];
    if (!file) return;
    setState({ loading: false, result: null, error: null });
    setState(prev => ({ ...prev, loading: true }));
    try {
      const res = await cfg.fn(file);
      // Gestisce i diversi formati di risposta:
      // unicredit-conto/carta: { importati, saltati, errori }
      // unicredit-mutuo/ca-mutuo: { rate_importate, errori }
      // fineco: { creati, aggiornati, errori }
      const importati =
        res.importati ??
        res.rate_importate ??
        (res.creati || 0) + (res.aggiornati || 0);
      setState({
        loading: false,
        result: {
          importati,
          saltati: res.saltati,
          errori: res.errori || [],
        },
        error: null,
      });
    } catch (err: any) {
      setState({ loading: false, result: null, error: err?.response?.data?.detail || err?.message || 'Errore' });
    }
    e.target.value = '';
  };

  return (
    <View style={[s.card, { borderColor: cfg.borderColor, borderWidth: 1.5 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Text style={s.cardTitle}>{cfg.label}</Text>
        <View style={[s.badge, { backgroundColor: cfg.borderColor + '22' }]}>
          <Text style={[s.badgeText, { color: cfg.borderColor }]}>{cfg.badge}</Text>
        </View>
      </View>
      <Text style={s.colonne}>{cfg.description}</Text>

      <TouchableOpacity style={s.btn} onPress={() => inputRef.current?.click()} disabled={state.loading}>
        {state.loading
          ? <ActivityIndicator color="#000" size="small" />
          : <Text style={s.btnText}>Carica file</Text>
        }
      </TouchableOpacity>

      <input
        ref={inputRef}
        type="file"
        accept={cfg.accept}
        style={{ display: 'none' }}
        onChange={handleUpload}
      />

      {state.result && (
        <View style={[s.feedback, state.result.errori.length > 0 ? s.feedbackWarn : (state.result.importati === 0 ? s.feedbackDup : s.feedbackOk)]}>
          <Text style={s.feedbackText}>
            {state.result.importati > 0
              ? `✓ ${state.result.importati} nuovi movimenti importati`
              : '⟳ Nessun movimento nuovo'}
            {state.result.saltati != null && state.result.saltati > 0
              && ` · ${state.result.saltati} già presenti (saltati)`}
            {state.result.errori.length > 0
              && ` · ${state.result.errori.length} errori`}
          </Text>
          {state.result.saltati != null && state.result.saltati > 0 && state.result.importati === 0 && (
            <Text style={s.dupLine}>
              Tutti i movimenti del file sono già in archivio. Scarica un estratto con date più recenti.
            </Text>
          )}
          {state.result.errori.slice(0, 5).map((e: string, i: number) => (
            <Text key={i} style={s.errorLine}>{e}</Text>
          ))}
        </View>
      )}
      {state.error && (
        <View style={[s.feedback, s.feedbackError]}>
          <Text style={s.feedbackText}>{state.error}</Text>
        </View>
      )}
    </View>
  );
}

const FINECO_CARDS: UniCreditCardConfig[] = [
  {
    label: 'Fineco — Conto Corrente',
    badge: 'XLSX',
    accept: '.xls,.xlsx',
    description:
      'Esporta da Fineco → Conto Corrente → Movimenti → Esporta Excel (movements_*.xlsx).\n' +
      'Importa i movimenti, crea il conto C/C Fineco e aggiorna il saldo (Saldo Finale). Dedup automatico, ri-importabile in futuro.',
    fn: importaFinecoConto,
    borderColor: '#00B0B9',
  },
];

const REVOLUT_CARDS: UniCreditCardConfig[] = [
  {
    label: 'Revolut — Conto Corrente',
    badge: 'CSV',
    accept: '.csv',
    description:
      'Scarica da Revolut → Conto → Estratto conto (account-statement_*.csv).\n' +
      'Importa tutti i movimenti completati, crea il conto corrente Revolut e aggiorna il saldo.',
    fn: importaRevolutConto,
    borderColor: '#7B16FF',
  },
  {
    label: 'Revolut — Conto Deposito',
    badge: 'CSV',
    accept: '.csv',
    description:
      'Scarica da Revolut → Risparmio → Estratto conto (savings-statement_*.csv).\n' +
      'Calcola il capitale netto versato e gli interessi maturati al 2,25% lordo. Appare nella sezione Investimenti.',
    fn: importaRevolutDeposito,
    borderColor: '#7B16FF',
  },
];

const UNICREDIT_CARDS: UniCreditCardConfig[] = [
  {
    label: 'UniCredit — Conto Corrente',
    badge: 'XLS',
    accept: '.xls,.xlsx',
    description:
      'Esporta da UniCredit → Movimenti conto → Esporta XLS.\n' +
      'Importa movimenti, crea automaticamente il conto C/C e aggiorna il saldo.',
    fn: importaUnicreditConto,
    borderColor: '#E63232',
  },
  {
    label: 'UniCredit — Carta di Credito',
    badge: 'XLS',
    accept: '.xls,.xlsx',
    description:
      'Esporta da UniCredit → Carta Flexia Gold → Movimenti → Esporta XLS.\n' +
      'I movimenti vengono marcati come carta di credito. Il debito carta è dedotto dalla liquidità effettiva.',
    fn: importaUnicreditCarta,
    borderColor: '#E63232',
  },
  {
    label: 'UniCredit — Mutuo (Piano Ammortamento)',
    badge: 'PDF',
    accept: '.pdf',
    description:
      'Carica il PDF "Elenco Rate" del mutuo UniCredit.\n' +
      'Il capitale residuo viene calcolato automaticamente dalle date di scadenza delle rate, senza ulteriori importazioni.',
    fn: importaUnicreditMutuo,
    borderColor: '#E63232',
  },
  {
    label: 'Crédit Agricole — Mutuo (Piano Rimborso)',
    badge: 'XLSX',
    accept: '.xlsx',
    description:
      'Carica il file Excel "Piano Rimborso Mutuo_CAI_..." scaricato da Crédit Agricole.\n' +
      'Importa automaticamente 361 rate con quota capitale, interessi e debito residuo.',
    fn: importaCaMutuo,
    borderColor: '#009A44',
  },
];

function TwoFAPanel() {
  const qc = useQueryClient();
  const [showSetup, setShowSetup]   = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [totpCode, setTotpCode]     = useState('');
  const [disablePass, setDisablePass] = useState('');
  const [setupData, setSetupData]   = useState<{ secret: string; totp_uri: string } | null>(null);
  const [msg, setMsg]               = useState<{ text: string; ok: boolean } | null>(null);

  const { data: status } = useQuery({
    queryKey: ['2fa-status'],
    queryFn: get2faStatus,
  });

  const setupMut = useMutation({
    mutationFn: setup2fa,
    onSuccess: (data) => { setSetupData(data); setShowSetup(true); setMsg(null); },
  });

  const enableMut = useMutation({
    mutationFn: () => enable2fa(totpCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
      setShowSetup(false); setSetupData(null); setTotpCode('');
      setMsg({ text: '✓ 2FA abilitato con successo!', ok: true });
    },
    onError: () => setMsg({ text: '✗ Codice non valido. Riprova.', ok: false }),
  });

  const disableMut = useMutation({
    mutationFn: () => disable2fa(disablePass),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['2fa-status'] });
      setShowDisable(false); setDisablePass('');
      setMsg({ text: '2FA disabilitato.', ok: true });
    },
    onError: () => setMsg({ text: '✗ Password non corretta.', ok: false }),
  });

  const enabled = status?.totp_enabled;

  return (
    <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 18 }}>🔐</Text>
          <Text style={{ fontSize: 14, fontWeight: '800', color: COLORS.text }}>Autenticazione 2FA</Text>
        </View>
        <View style={{ backgroundColor: enabled ? COLORS.success + '22' : COLORS.border, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ color: enabled ? COLORS.success : COLORS.subtext, fontSize: 9, fontWeight: '800' }}>
            {enabled ? 'ATTIVO' : 'NON ATTIVO'}
          </Text>
        </View>
      </View>

      <Text style={{ fontSize: 12, color: COLORS.subtext, marginBottom: 12, lineHeight: 18 }}>
        {enabled
          ? 'Il 2FA è attivo. Ad ogni login ti verrà richiesto il codice dall\'app Google Authenticator.'
          : 'Aggiungi un secondo livello di sicurezza. Dopo l\'attivazione dovrai inserire un codice dall\'app Google Authenticator ad ogni accesso.'}
      </Text>

      {msg && (
        <Text style={{ color: msg.ok ? COLORS.success : COLORS.danger, fontSize: 12, fontWeight: '700', marginBottom: 8 }}>{msg.text}</Text>
      )}

      {!enabled && !showSetup && (
        <TouchableOpacity
          style={{ backgroundColor: COLORS.primary, borderRadius: 8, padding: 12, alignItems: 'center', opacity: setupMut.isPending ? 0.6 : 1 }}
          onPress={() => setupMut.mutate()}
          disabled={setupMut.isPending}
        >
          <Text style={{ color: '#000', fontWeight: '800', fontSize: 13 }}>
            {setupMut.isPending ? 'Generazione...' : 'Attiva 2FA'}
          </Text>
        </TouchableOpacity>
      )}

      {showSetup && setupData && (
        <View style={{ backgroundColor: COLORS.bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: COLORS.border }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.text, marginBottom: 12 }}>
            1. Scansiona il QR con Google Authenticator:
          </Text>

          {/* QR Code */}
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <View style={{ backgroundColor: '#fff', padding: 12, borderRadius: 8 }}>
              <QRCode value={setupData.totp_uri} size={180} />
            </View>
          </View>

          {/* Chiave manuale (fallback) */}
          <Text style={{ fontSize: 11, color: COLORS.subtext, textAlign: 'center', marginBottom: 6 }}>
            Oppure inserisci manualmente la chiave nell'app:
          </Text>
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 6, padding: 10, marginBottom: 12 }}>
            <Text style={{ fontSize: 11, color: COLORS.subtext, marginBottom: 2 }}>CHIAVE SEGRETA</Text>
            <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.primary, letterSpacing: 3, textAlign: 'center' }}>{setupData.secret}</Text>
          </View>

          <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.text, marginBottom: 6 }}>
            2. Inserisci il codice a 6 cifre generato dall'app:
          </Text>
          <TextInput
            style={{ backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, color: COLORS.text, padding: 10, fontSize: 22, fontWeight: '800', textAlign: 'center', letterSpacing: 8, marginBottom: 8 }}
            placeholder="000000"
            placeholderTextColor={COLORS.subtext}
            value={totpCode}
            onChangeText={v => setTotpCode(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
          />
          <TouchableOpacity
            style={{ backgroundColor: COLORS.success, borderRadius: 8, padding: 12, alignItems: 'center', opacity: enableMut.isPending ? 0.6 : 1 }}
            onPress={() => enableMut.mutate()}
            disabled={enableMut.isPending || totpCode.length !== 6}
          >
            <Text style={{ color: '#000', fontWeight: '800', fontSize: 13 }}>
              {enableMut.isPending ? 'Verifica...' : 'Conferma e attiva'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowSetup(false)} style={{ marginTop: 8, alignItems: 'center' }}>
            <Text style={{ color: COLORS.subtext, fontSize: 12 }}>Annulla</Text>
          </TouchableOpacity>
        </View>
      )}

      {enabled && !showDisable && (
        <TouchableOpacity
          style={{ borderWidth: 1, borderColor: COLORS.danger, borderRadius: 8, padding: 12, alignItems: 'center' }}
          onPress={() => setShowDisable(true)}
        >
          <Text style={{ color: COLORS.danger, fontWeight: '700', fontSize: 13 }}>Disabilita 2FA</Text>
        </TouchableOpacity>
      )}

      {showDisable && (
        <View style={{ backgroundColor: COLORS.bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: COLORS.danger + '44' }}>
          <Text style={{ fontSize: 12, color: COLORS.text, marginBottom: 8 }}>Conferma la tua password per disabilitare il 2FA:</Text>
          <TextInput
            style={{ backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, color: COLORS.text, padding: 10, fontSize: 14, marginBottom: 8 }}
            placeholder="Password"
            placeholderTextColor={COLORS.subtext}
            value={disablePass}
            onChangeText={setDisablePass}
            secureTextEntry
          />
          <TouchableOpacity
            style={{ backgroundColor: COLORS.danger, borderRadius: 8, padding: 12, alignItems: 'center', opacity: disableMut.isPending ? 0.6 : 1 }}
            onPress={() => disableMut.mutate()}
            disabled={disableMut.isPending || !disablePass}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
              {disableMut.isPending ? 'Disabilitazione...' : 'Conferma disabilitazione'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowDisable(false)} style={{ marginTop: 8, alignItems: 'center' }}>
            <Text style={{ color: COLORS.subtext, fontSize: 12 }}>Annulla</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function ImportScreen() {
  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <Text style={s.title}>Importa Dati</Text>
      <Text style={s.subtitle}>
        Importa direttamente i file esportati da Fineco e UniCredit, oppure usa i template CSV.{'\n'}
        Ordine consigliato: Conti → Mutui → Piano Ammortamento → Immobili → Investimenti → Orologi → Movimenti.
      </Text>

      <Text style={s.sectionHeader}>FINECO — IMPORT DIRETTO</Text>
      <FinecoCard />
      {FINECO_CARDS.map(c => <UniCreditCard key={c.label} cfg={c} />)}

      <Text style={s.sectionHeader}>REVOLUT — IMPORT DIRETTO</Text>
      {REVOLUT_CARDS.map(c => <UniCreditCard key={c.label} cfg={c} />)}

      <Text style={s.sectionHeader}>UNICREDIT — IMPORT DIRETTO</Text>
      {UNICREDIT_CARDS.map(c => <UniCreditCard key={c.label} cfg={c} />)}

      <Text style={s.sectionHeader}>IMPORT CSV GENERICO</Text>
      {ENTITIES.map(e => <EntityCard key={e.key} entity={e} />)}

      {/* ── Sicurezza 2FA ─────────────────────────────── */}
      <TwoFAPanel />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: COLORS.bg },
  content:     { padding: 16, paddingBottom: 40 },
  title:       { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  subtitle:    { fontSize: 12, color: COLORS.subtext, marginBottom: 20, lineHeight: 18 },
  card:        { backgroundColor: COLORS.surface, borderRadius: 10, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border },
  cardTitle:   { fontSize: 15, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  colonne:     { fontSize: 10, color: COLORS.subtext, marginBottom: 12, fontFamily: 'monospace' },
  row:         { flexDirection: 'row', gap: 10 },
  btn:         { flex: 1, backgroundColor: COLORS.primary, borderRadius: 8, padding: 12, alignItems: 'center' },
  btnText:     { color: '#000', fontWeight: '800', fontSize: 13 },
  btnSecondary:{ backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.primary },
  btnSecondaryText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  feedback:    { marginTop: 10, borderRadius: 6, padding: 10 },
  feedbackOk:  { backgroundColor: '#0d2b1a' },
  feedbackWarn:{ backgroundColor: '#2b1e0d' },
  feedbackError:{ backgroundColor: '#2b0d0d' },
  feedbackDup: { backgroundColor: '#1a1a2e' },
  feedbackText:{ color: COLORS.text, fontSize: 12, fontWeight: '700' },
  errorLine:   { color: '#ff9966', fontSize: 11, marginTop: 3 },
  dupLine:     { color: '#94a3b8', fontSize: 11, marginTop: 4, fontStyle: 'italic' },

  finecoCard:    { borderColor: '#22D3EE', borderWidth: 1.5 },
  badge:         { backgroundColor: '#22D3EE22', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText:     { color: '#22D3EE', fontSize: 9, fontWeight: '800' },
  sectionHeader: { color: COLORS.subtext, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 10, marginTop: 6 },
});
