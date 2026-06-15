import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { COLORS, fmt, fmtShort } from '../utils/format';
import api from '../services/api';
import { getAnalisiAnnuale, completaPianoMutuo } from '../services/api';

const getMutui = () => api.get('/mutui/').then(r => r.data);

const n = (v: any) => Number(v) || 0;

type TabType = 'dettaglio' | 'annuale' | 'simulatore';

// ── Barra progresso ────────────────────────────────────
function ProgressBar({ pct, color = COLORS.success }: { pct: number; color?: string }) {
  return (
    <View style={{ height: 6, backgroundColor: COLORS.border, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ height: 6, width: `${Math.min(pct, 100)}%` as any, backgroundColor: color, borderRadius: 3 }} />
    </View>
  );
}

// ── Chip metrica ───────────────────────────────────────
function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={st.chip}>
      <Text style={st.chipLabel}>{label}</Text>
      <Text style={[st.chipValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

// ── Riga tabella ───────────────────────────────────────
function TR({ anno, totCap, totInt, totRata, residuo, nRate, nPagate, highlight }: {
  anno: number; totCap: number; totInt: number; totRata: number;
  residuo: number | null; nRate: number; nPagate: number; highlight?: boolean;
}) {
  const today = new Date().getFullYear();
  const isCurrentYear = anno === today;
  return (
    <View style={[st.tr, highlight && st.trHighlight]}>
      <Text style={[st.td, st.tdAnno, isCurrentYear && { color: COLORS.primary, fontWeight: '800' }]}>
        {anno}
      </Text>
      <Text style={[st.td, { color: COLORS.success }]}>{fmtShort(totCap)}</Text>
      <Text style={[st.td, { color: COLORS.danger }]}>{fmtShort(totInt)}</Text>
      <Text style={[st.td, { color: COLORS.text }]}>{fmtShort(residuo ?? 0)}</Text>
      <Text style={[st.td, st.tdRate, { color: nPagate === nRate ? COLORS.success : COLORS.subtext }]}>
        {nPagate}/{nRate}
      </Text>
    </View>
  );
}

// ── Analisi annuale per singolo mutuo ──────────────────
function AnnualeTab({ mutuoId }: { mutuoId: string }) {
  const { data: anni = [], isLoading } = useQuery({
    queryKey: ['analisi-annuale', mutuoId],
    queryFn: () => getAnalisiAnnuale(mutuoId),
  });

  const today = new Date().getFullYear();

  if (isLoading) return <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />;

  // Totali
  const totInt = (anni as any[]).reduce((s: number, a: any) => s + n(a.quota_interessi), 0);
  const totCap = (anni as any[]).reduce((s: number, a: any) => s + n(a.quota_capitale), 0);
  const totRata = (anni as any[]).reduce((s: number, a: any) => s + n(a.rata_totale), 0);

  return (
    <View>
      {/* Totali */}
      <View style={st.totRow}>
        <Chip label="Tot. Interessi" value={fmtShort(totInt)} color={COLORS.danger} />
        <Chip label="Tot. Capitale" value={fmtShort(totCap)} color={COLORS.success} />
        <Chip label="Costo totale" value={fmtShort(totRata)} color={COLORS.text} />
      </View>

      {/* Header tabella */}
      <View style={[st.tr, st.trHeader]}>
        <Text style={[st.td, st.tdAnno, st.thText]}>Anno</Text>
        <Text style={[st.td, st.thText]}>Capitale</Text>
        <Text style={[st.td, st.thText]}>Interessi</Text>
        <Text style={[st.td, st.thText]}>Residuo</Text>
        <Text style={[st.td, st.tdRate, st.thText]}>Rate</Text>
      </View>

      {(anni as any[]).map((a: any) => (
        <TR
          key={a.anno}
          anno={a.anno}
          totCap={n(a.quota_capitale)}
          totInt={n(a.quota_interessi)}
          totRata={n(a.rata_totale)}
          residuo={a.capitale_residuo_fine_anno != null ? n(a.capitale_residuo_fine_anno) : null}
          nRate={a.n_rate}
          nPagate={a.n_pagate}
          highlight={a.anno === today}
        />
      ))}
    </View>
  );
}

// ── Helpers simulazione (French amortization) ──────────
function pmt(capital: number, rMensile: number, mesi: number): number {
  if (rMensile === 0) return capital / mesi;
  return (capital * rMensile) / (1 - Math.pow(1 + rMensile, -mesi));
}
function totalInt(capital: number, rMensile: number, mesi: number): number {
  return pmt(capital, rMensile, mesi) * mesi - capital;
}
function addMesi(mesi: number): string {
  const today = new Date();
  const d = new Date(today.getFullYear(), today.getMonth() + mesi, 1);
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

// ── Riga comparativa ────────────────────────────────────
function CmpRow({ label, before, after, isGood, isCurrency = true }:
  { label: string; before: number; after: number; isGood: boolean; isCurrency?: boolean }) {
  const delta = after - before;
  const sign = delta > 0 ? '+' : '';
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5,
      borderBottomWidth: 1, borderBottomColor: COLORS.border + '33' }}>
      <Text style={{ fontSize: 11, color: COLORS.subtext, flex: 1.2 }}>{label}</Text>
      <Text style={{ fontSize: 11, color: COLORS.text, fontWeight: '600', flex: 1, textAlign: 'right' }}>
        {isCurrency ? fmt(before) : before}
      </Text>
      <Text style={{ fontSize: 11, fontWeight: '800', flex: 1, textAlign: 'right',
        color: isGood ? COLORS.success : COLORS.danger }}>
        {isCurrency ? fmt(after) : after}
      </Text>
      <Text style={{ fontSize: 10, color: isGood ? COLORS.success : COLORS.danger,
        flex: 0.9, textAlign: 'right', fontWeight: '700' }}>
        {isCurrency ? `${sign}${fmtShort(delta)}` : `${sign}${delta}`}
      </Text>
    </View>
  );
}

// ── Simulatore ────────────────────────────────────────
type SimMode = 'abbattimento' | 'durata';

function SimulatoreTab({ mutuo }: { mutuo: any }) {
  const isCA = (mutuo.banca as string).toLowerCase().includes('agricole');
  const [mode, setMode] = useState<SimMode>('abbattimento');

  // Scenario 1 – Abbattimento capitale, durata invariata
  const [importoAbb, setImportoAbb] = useState('');
  const [resAbb, setResAbb] = useState<any>(null);

  // Scenario 2 – Riduzione durata -5 anni (CA) + optional abbattimento
  const [importoDur, setImportoDur] = useState('');
  const [resDur, setResDur] = useState<any>(null);

  const residuo    = n(mutuo.capitale_residuo_live);
  const tanPct     = mutuo.tasso_valore != null ? n(mutuo.tasso_valore) : 2.0;
  const r          = tanPct / 100 / 12;
  const mesiRim    = mutuo.rate_totali - mutuo.rate_pagate_live;
  const rataAttuale = n(mutuo.rata_mensile);
  const intAttuali = n(mutuo.interessi_residui);

  // ── Calcolo scenario 1 ──────────────────────────────
  const simulaAbb = () => {
    const imp = parseFloat(importoAbb.replace(',', '.'));
    if (isNaN(imp) || imp <= 0 || imp >= residuo) return;
    const capNew   = residuo - imp;
    const rataNuova = pmt(capNew, r, mesiRim);
    const intNuovi  = totalInt(capNew, r, mesiRim);
    setResAbb({
      capNew, rataNuova, intNuovi,
      risparmioRate: (rataAttuale - rataNuova),
      risparmioInt:  (intAttuali - intNuovi),
      scadenza:      addMesi(mesiRim),
    });
  };

  // ── Calcolo scenario 2 ──────────────────────────────
  const simulaDur = () => {
    const mesiNuovi = mesiRim - 60; // -5 anni
    if (mesiNuovi <= 0) return;
    const imp    = parseFloat(importoDur.replace(',', '.')) || 0;
    const capNew = Math.max(0, residuo - imp);
    const rataNuova = pmt(capNew, r, mesiNuovi);
    const intNuovi  = totalInt(capNew, r, mesiNuovi);
    setResDur({
      mesiNuovi, capNew, rataNuova, intNuovi,
      risparmioInt:  (intAttuali - intNuovi),
      scadenza:      addMesi(mesiNuovi),
    });
  };

  // ── Contesto attuale ────────────────────────────────
  const infoBox = (
    <View style={[st.infoBox, { marginTop: 12 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={st.infoLabel}>Capitale residuo</Text>
        <Text style={[st.infoVal, { color: COLORS.danger }]}>{fmt(residuo)}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={st.infoLabel}>Rate rimanenti</Text>
        <Text style={st.infoVal}>{mesiRim} ({Math.floor(mesiRim/12)}a {mesiRim%12}m)</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
        <Text style={st.infoLabel}>Interessi residui</Text>
        <Text style={[st.infoVal, { color: COLORS.danger }]}>{fmtShort(intAttuali)}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={st.infoLabel}>Scadenza prevista</Text>
        <Text style={st.infoVal}>{new Date(mutuo.data_scadenza).toLocaleDateString('it-IT')}</Text>
      </View>
    </View>
  );

  return (
    <View>
      {/* Selettore scenario */}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        <TouchableOpacity
          style={[st.simModeBtn, mode === 'abbattimento' && st.simModeBtnActive]}
          onPress={() => { setMode('abbattimento'); setResAbb(null); }}
        >
          <Ionicons name="cash-outline" size={13} color={mode === 'abbattimento' ? COLORS.primary : COLORS.subtext} />
          <Text style={[st.simModeTxt, mode === 'abbattimento' && { color: COLORS.primary }]}>
            Abbatti capitale
          </Text>
        </TouchableOpacity>
        {isCA && (
          <TouchableOpacity
            style={[st.simModeBtn, mode === 'durata' && st.simModeBtnActive]}
            onPress={() => { setMode('durata'); setResDur(null); }}
          >
            <Ionicons name="timer-outline" size={13} color={mode === 'durata' ? COLORS.primary : COLORS.subtext} />
            <Text style={[st.simModeTxt, mode === 'durata' && { color: COLORS.primary }]}>
              Riduci durata −5a
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ─── Scenario 1: abbattimento capitale ─── */}
      {mode === 'abbattimento' && (
        <View>
          <Text style={st.simDesc}>
            Versa un importo una tantum per ridurre il capitale residuo, mantenendo la stessa scadenza.
            La rata mensile scende proporzionalmente.
          </Text>

          {/* Input */}
          <View style={st.simRow}>
            <View style={st.simInputWrap}>
              <Text style={st.simInputLabel}>Capitale residuo</Text>
              <Text style={st.simInputVal}>{fmt(residuo)}</Text>
            </View>
            <Ionicons name="remove-outline" size={16} color={COLORS.subtext} />
            <TextInput
              style={st.simInput}
              placeholder="Importo abbattimento €"
              placeholderTextColor={COLORS.subtext}
              keyboardType="numeric"
              value={importoAbb}
              onChangeText={v => { setImportoAbb(v); setResAbb(null); }}
            />
          </View>
          <TouchableOpacity style={[st.simBtn, { marginBottom: 12 }]} onPress={simulaAbb}>
            <Text style={st.simBtnText}>Calcola</Text>
          </TouchableOpacity>

          {resAbb && (
            <View>
              {/* Result card */}
              <View style={st.simResult}>
                <Text style={st.simResultTitle}>SCENARIO: durata invariata ({mesiRim} mesi)</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.simResultLabel}>NUOVA RATA</Text>
                    <Text style={[st.simResultVal, { color: COLORS.success }]}>{fmt(resAbb.rataNuova)}</Text>
                    <Text style={[st.simResultSub, { color: COLORS.success }]}>
                      −{fmt(resAbb.risparmioRate)}/mese
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.simResultLabel}>INTERESSI RESIDUI</Text>
                    <Text style={[st.simResultVal, { color: COLORS.danger }]}>{fmtShort(resAbb.intNuovi)}</Text>
                    <Text style={[st.simResultSub, { color: COLORS.success }]}>
                      risparmi {fmtShort(resAbb.risparmioInt)}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Tabella comparativa */}
              <View style={[st.infoBox, { marginTop: 0 }]}>
                <View style={{ flexDirection: 'row', marginBottom: 5 }}>
                  <Text style={{ flex: 1.2, fontSize: 9, color: COLORS.subtext, fontWeight: '800' }}> </Text>
                  <Text style={{ flex: 1, fontSize: 9, color: COLORS.subtext, fontWeight: '800', textAlign: 'right' }}>ATTUALE</Text>
                  <Text style={{ flex: 1, fontSize: 9, color: COLORS.primary, fontWeight: '800', textAlign: 'right' }}>NUOVO</Text>
                  <Text style={{ flex: 0.9, fontSize: 9, color: COLORS.subtext, fontWeight: '800', textAlign: 'right' }}>DELTA</Text>
                </View>
                <CmpRow label="Capitale" before={residuo} after={resAbb.capNew} isGood={true} />
                <CmpRow label="Rata mensile" before={rataAttuale} after={resAbb.rataNuova} isGood={true} />
                <CmpRow label="Tot. interessi" before={intAttuali} after={resAbb.intNuovi} isGood={true} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 }}>
                  <Text style={{ fontSize: 11, color: COLORS.subtext }}>Scadenza</Text>
                  <Text style={{ fontSize: 11, color: COLORS.text, fontWeight: '700' }}>{resAbb.scadenza}</Text>
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ─── Scenario 2: riduzione durata -5 anni (CA) ─── */}
      {mode === 'durata' && isCA && (
        <View>
          <Text style={st.simDesc}>
            Riduci la durata di 5 anni ({mesiRim - 60} rate rimanenti anziché {mesiRim}).
            Opzionalmente abbatti anche il capitale per ridurre ulteriormente la rata.
          </Text>

          {/* Riepilogo contesto */}
          <View style={[st.infoBox, { marginBottom: 12 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={st.infoLabel}>Durata attuale rimanente</Text>
              <Text style={st.infoVal}>{mesiRim} mesi ({Math.floor(mesiRim/12)}a {mesiRim%12}m)</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={st.infoLabel}>Nuova durata (−5 anni)</Text>
              <Text style={[st.infoVal, { color: COLORS.primary }]}>
                {mesiRim - 60} mesi ({Math.floor((mesiRim-60)/12)}a {(mesiRim-60)%12}m)
              </Text>
            </View>
          </View>

          {/* Input abbattimento opzionale */}
          <View style={st.simRow}>
            <View style={st.simInputWrap}>
              <Text style={st.simInputLabel}>Cap. residuo</Text>
              <Text style={st.simInputVal}>{fmtShort(residuo)}</Text>
            </View>
            <Ionicons name="remove-outline" size={16} color={COLORS.subtext} />
            <TextInput
              style={st.simInput}
              placeholder="Abbattimento € (opz.)"
              placeholderTextColor={COLORS.subtext}
              keyboardType="numeric"
              value={importoDur}
              onChangeText={v => { setImportoDur(v); setResDur(null); }}
            />
          </View>
          <TouchableOpacity style={[st.simBtn, { marginBottom: 12 }]} onPress={simulaDur}>
            <Text style={st.simBtnText}>Calcola</Text>
          </TouchableOpacity>

          {resDur && (
            <View>
              <View style={st.simResult}>
                <Text style={st.simResultTitle}>
                  SCENARIO: −5 anni{parseFloat(importoDur || '0') > 0 ? ` + abbattimento ${fmtShort(parseFloat(importoDur))}` : ''}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.simResultLabel}>NUOVA RATA</Text>
                    <Text style={[st.simResultVal, { color: COLORS.primary }]}>{fmt(resDur.rataNuova)}</Text>
                    <Text style={st.simResultSub}>vs {fmt(rataAttuale)} attuale</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.simResultLabel}>RISPARMIO INTERESSI</Text>
                    <Text style={[st.simResultVal, { color: COLORS.success }]}>{fmtShort(resDur.risparmioInt)}</Text>
                    <Text style={[st.simResultSub, { color: COLORS.danger }]}>
                      paghi {fmtShort(resDur.intNuovi)} tot.
                    </Text>
                  </View>
                </View>
              </View>

              {/* Tabella comparativa */}
              <View style={[st.infoBox, { marginTop: 0 }]}>
                <View style={{ flexDirection: 'row', marginBottom: 5 }}>
                  <Text style={{ flex: 1.2, fontSize: 9, color: COLORS.subtext, fontWeight: '800' }}> </Text>
                  <Text style={{ flex: 1, fontSize: 9, color: COLORS.subtext, fontWeight: '800', textAlign: 'right' }}>ATTUALE</Text>
                  <Text style={{ flex: 1, fontSize: 9, color: COLORS.primary, fontWeight: '800', textAlign: 'right' }}>NUOVO</Text>
                  <Text style={{ flex: 0.9, fontSize: 9, color: COLORS.subtext, fontWeight: '800', textAlign: 'right' }}>DELTA</Text>
                </View>
                <CmpRow label="Capitale" before={residuo} after={resDur.capNew} isGood={true} />
                <CmpRow label="Rata mensile" before={rataAttuale} after={resDur.rataNuova} isGood={resDur.rataNuova < rataAttuale} />
                <CmpRow label="Tot. interessi" before={intAttuali} after={resDur.intNuovi} isGood={true} />
                <CmpRow label="Mesi rimanenti" before={mesiRim} after={resDur.mesiNuovi} isGood={true} isCurrency={false} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6 }}>
                  <Text style={{ fontSize: 11, color: COLORS.subtext }}>Nuova scadenza</Text>
                  <Text style={{ fontSize: 11, color: COLORS.primary, fontWeight: '700' }}>{resDur.scadenza}</Text>
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      {infoBox}
    </View>
  );
}

// ── Dettaglio mutuo ────────────────────────────────────
function DettaglioTab({ mutuo }: { mutuo: any }) {
  const qc = useQueryClient();
  const [completaMsg, setCompletaMsg] = useState<string | null>(null);
  const completa = useMutation({
    mutationFn: () => completaPianoMutuo(String(mutuo.id)),
    onSuccess: (d: any) => {
      setCompletaMsg(
        d.ricostruite > 0
          ? `✓ ${d.ricostruite} rate ricostruite · residuo ${fmt(n(d.capitale_residuo_live))}`
          : '✓ Piano già completo, nessuna rata mancante'
      );
      qc.invalidateQueries({ queryKey: ['mutui'] });
      qc.invalidateQueries({ queryKey: ['patrimonio-live'] });
    },
    onError: () => setCompletaMsg('✗ Errore durante il completamento del piano'),
  });

  const erogato  = n(mutuo.capitale_erogato);
  const residuo  = n(mutuo.capitale_residuo_live);
  const rimborsato = erogato - residuo;
  const pctRimb  = erogato > 0 ? (rimborsato / erogato) * 100 : 0;
  const prossima = mutuo.prossima_scadenza
    ? new Date(mutuo.prossima_scadenza).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

  return (
    <View>
      {/* Avanzamento */}
      <View style={{ marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <Text style={st.metaLabel}>RIMBORSO CAPITALE</Text>
          <Text style={{ color: COLORS.success, fontWeight: '800', fontSize: 12 }}>
            {pctRimb.toFixed(1)}%
          </Text>
        </View>
        <ProgressBar pct={pctRimb} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={st.metaLabel}>Rimborsato {fmtShort(rimborsato)}</Text>
          <Text style={st.metaLabel}>Residuo {fmtShort(residuo)}</Text>
        </View>
      </View>

      {/* KPI grid */}
      <View style={st.chipGrid}>
        <Chip label="Erogato" value={fmtShort(erogato)} />
        <Chip label="Rata mensile" value={fmt(mutuo.rata_mensile)} />
        <Chip label="Rate pagate" value={`${mutuo.rate_pagate_live}/${mutuo.rate_totali}`} />
        <Chip label="Int. pagati" value={fmtShort(n(mutuo.interessi_pagati))} color={COLORS.subtext} />
        <Chip label="Int. residui" value={fmtShort(n(mutuo.interessi_residui))} color={COLORS.danger} />
        <Chip label="Rata prossima" value={mutuo.prossima_rata ? fmt(mutuo.prossima_rata) : '—'} />
      </View>

      {/* Dati contratto */}
      <View style={st.contractBox}>
        <View style={st.contractRow}>
          <Text style={st.contractLabel}>Banca</Text>
          <Text style={st.contractVal}>{mutuo.banca}</Text>
        </View>
        {mutuo.numero_contratto && (
          <View style={st.contractRow}>
            <Text style={st.contractLabel}>N. Contratto</Text>
            <Text style={st.contractVal}>{mutuo.numero_contratto}</Text>
          </View>
        )}
        <View style={st.contractRow}>
          <Text style={st.contractLabel}>Tipo tasso</Text>
          <Text style={st.contractVal}>{mutuo.tasso_tipo ? mutuo.tasso_tipo.charAt(0).toUpperCase() + mutuo.tasso_tipo.slice(1) : 'Fisso'}</Text>
        </View>
        {mutuo.tasso_valore != null && (
          <View style={st.contractRow}>
            <Text style={st.contractLabel}>TAN</Text>
            <Text style={[st.contractVal, { color: COLORS.primary, fontWeight: '800' }]}>
              {Number(mutuo.tasso_valore).toFixed(2)}%
            </Text>
          </View>
        )}
        <View style={st.contractRow}>
          <Text style={st.contractLabel}>Data erogazione</Text>
          <Text style={st.contractVal}>
            {new Date(mutuo.data_erogazione).toLocaleDateString('it-IT')}
          </Text>
        </View>
        <View style={st.contractRow}>
          <Text style={st.contractLabel}>Data scadenza</Text>
          <Text style={st.contractVal}>
            {new Date(mutuo.data_scadenza).toLocaleDateString('it-IT')}
          </Text>
        </View>
        <View style={st.contractRow}>
          <Text style={st.contractLabel}>Prossima scadenza</Text>
          <Text style={[st.contractVal, { color: COLORS.primary }]}>{prossima}</Text>
        </View>
      </View>

      {/* Completa piano: ricostruisce rate mancanti (salti pagina PDF) */}
      <TouchableOpacity
        style={st.completaBtn}
        onPress={() => { setCompletaMsg(null); completa.mutate(); }}
        disabled={completa.isPending}
      >
        {completa.isPending
          ? <ActivityIndicator size="small" color={COLORS.primary} />
          : <Ionicons name="construct-outline" size={14} color={COLORS.primary} />}
        <Text style={st.completaBtnTxt}>Completa piano ammortamento</Text>
      </TouchableOpacity>
      {completaMsg && (
        <Text style={[st.completaMsg, { color: completaMsg.startsWith('✓') ? COLORS.success : COLORS.danger }]}>
          {completaMsg}
        </Text>
      )}
      <Text style={st.completaHint}>
        Ricostruisce eventuali rate mancanti nel piano (perse sui cambi pagina del PDF) e ricalcola il debito residuo.
      </Text>
    </View>
  );
}

// ── Screen principale ──────────────────────────────────
export default function MutuiScreen() {
  const { data: mutui = [], isLoading } = useQuery({ queryKey: ['mutui'], queryFn: getMutui });
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [tab, setTab] = useState<TabType>('dettaglio');

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
      </View>
    );
  }

  const lista = mutui as any[];

  if (lista.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
        <Ionicons name="business-outline" size={56} color={COLORS.subtext} />
        <Text style={{ color: COLORS.subtext, marginTop: 16, fontSize: 15, fontWeight: '700' }}>Nessun mutuo</Text>
        <Text style={{ color: COLORS.subtext, marginTop: 6, fontSize: 12, textAlign: 'center' }}>
          Importa il piano di ammortamento dalla schermata Importa
        </Text>
      </View>
    );
  }

  const selected = lista[selectedIdx] || lista[0];

  const totResiduo = lista.reduce((s: number, m: any) => s + n(m.capitale_residuo_live), 0);
  const totRate    = lista.reduce((s: number, m: any) => s + n(m.rata_mensile), 0);
  const totIntRes  = lista.reduce((s: number, m: any) => s + n(m.interessi_residui), 0);

  return (
    <ScrollView style={st.container}>
      <View style={st.body}>

        {/* KPI totali (tutti i mutui) */}
        <View style={st.kpiRow}>
          <View style={st.kpi}>
            <Text style={st.kpiLabel}>DEBITO TOTALE</Text>
            <Text style={[st.kpiVal, { color: COLORS.danger }]}>{fmtShort(totResiduo)}</Text>
            <Text style={st.kpiSub}>{lista.length} mutui attivi</Text>
          </View>
          <View style={st.kpi}>
            <Text style={st.kpiLabel}>RATE MENSILI</Text>
            <Text style={[st.kpiVal, { color: COLORS.text }]}>{fmt(totRate)}</Text>
            <Text style={st.kpiSub}>Int. residui {fmtShort(totIntRes)}</Text>
          </View>
        </View>

        {/* Selezione mutuo */}
        {lista.length > 1 && (
          <View style={st.mutuoTabRow}>
            {lista.map((m: any, i: number) => (
              <TouchableOpacity
                key={m.id}
                style={[st.mutuoTab, selectedIdx === i && st.mutuoTabActive]}
                onPress={() => { setSelectedIdx(i); setTab('dettaglio'); }}
              >
                <View style={[st.mutuoTabDot, { backgroundColor: i === 0 ? COLORS.primary : COLORS.success }]} />
                <View>
                  <Text style={[st.mutuoTabBanca, selectedIdx === i && { color: COLORS.primary }]}>
                    {m.banca}
                  </Text>
                  <Text style={st.mutuoTabResiduo}>{fmtShort(n(m.capitale_residuo_live))}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Card mutuo selezionato */}
        <View style={st.card}>
          <View style={st.cardTitleRow}>
            <Text style={st.cardNome}>{selected.nome}</Text>
            <View style={st.bancaBadge}>
              <Text style={st.bancaBadgeText}>{selected.banca}</Text>
            </View>
          </View>

          {/* Tab dettaglio / annuale / simulatore */}
          <View style={st.tabRow}>
            {([
              { key: 'dettaglio',   icon: 'information-circle-outline', label: 'Dettaglio' },
              { key: 'annuale',     icon: 'bar-chart-outline',           label: 'Per anno' },
              { key: 'simulatore',  icon: 'calculator-outline',          label: 'Simula' },
            ] as { key: TabType; icon: string; label: string }[]).map(t => (
              <TouchableOpacity
                key={t.key}
                style={[st.tabBtn, tab === t.key && st.tabBtnActive]}
                onPress={() => setTab(t.key)}
              >
                <Ionicons
                  name={t.icon as any}
                  size={13}
                  color={tab === t.key ? COLORS.primary : COLORS.subtext}
                />
                <Text style={[st.tabBtnText, tab === t.key && { color: COLORS.primary }]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Contenuto tab */}
          {tab === 'dettaglio'  && <DettaglioTab mutuo={selected} />}
          {tab === 'annuale'    && <AnnualeTab mutuoId={selected.id} />}
          {tab === 'simulatore' && <SimulatoreTab mutuo={selected} />}
        </View>

      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  body:      { padding: 14, paddingBottom: 32 },

  kpiRow:  { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi:     { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  kpiLabel:{ fontSize: 9, color: COLORS.subtext, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  kpiVal:  { fontSize: 16, fontWeight: '800' },
  kpiSub:  { fontSize: 9, color: COLORS.subtext, marginTop: 3 },

  mutuoTabRow:    { flexDirection: 'row', gap: 8, marginBottom: 12 },
  mutuoTab:       { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: COLORS.border },
  mutuoTabActive: { borderColor: COLORS.primary, backgroundColor: '#0C1F35' },
  mutuoTabDot:    { width: 8, height: 8, borderRadius: 4 },
  mutuoTabBanca:  { fontSize: 11, fontWeight: '700', color: COLORS.subtext },
  mutuoTabResiduo:{ fontSize: 10, color: COLORS.danger, fontWeight: '700', marginTop: 1 },

  card:        { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: COLORS.border },
  cardTitleRow:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardNome:    { fontSize: 13, color: COLORS.text, fontWeight: '800', flex: 1 },
  bancaBadge:  { backgroundColor: COLORS.primary + '22', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  bancaBadgeText: { color: COLORS.primary, fontSize: 9, fontWeight: '800' },

  tabRow:      { flexDirection: 'row', gap: 6, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border + '44', paddingBottom: 10 },
  tabBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border },
  tabBtnActive:{ backgroundColor: '#0C1F35', borderColor: COLORS.primary },
  tabBtnText:  { fontSize: 10, fontWeight: '700', color: COLORS.subtext },

  metaLabel: { fontSize: 10, color: COLORS.subtext },
  chipGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip:      { flex: 1, minWidth: '30%', backgroundColor: COLORS.bg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: COLORS.border },
  chipLabel: { fontSize: 9, color: COLORS.subtext, fontWeight: '700', letterSpacing: 0.5, marginBottom: 3 },
  chipValue: { fontSize: 13, fontWeight: '800', color: COLORS.text },

  contractBox: { backgroundColor: COLORS.bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: COLORS.border },
  contractRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border + '33' },
  contractLabel:{ fontSize: 11, color: COLORS.subtext },
  contractVal:  { fontSize: 11, color: COLORS.text, fontWeight: '700' },

  completaBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderWidth: 1, borderColor: COLORS.primary + '66', borderRadius: 8, paddingVertical: 11 },
  completaBtnTxt: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  completaMsg:    { fontSize: 11, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  completaHint:   { fontSize: 9, color: COLORS.subtext, marginTop: 6, textAlign: 'center', lineHeight: 13 },

  // Tabella annuale
  totRow:    { flexDirection: 'row', gap: 8, marginBottom: 12 },
  trHeader:  { borderBottomWidth: 1.5, borderBottomColor: COLORS.border, paddingBottom: 6, marginBottom: 2 },
  tr:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: COLORS.border + '33' },
  trHighlight:{ backgroundColor: COLORS.primary + '11', borderRadius: 4 },
  td:        { flex: 1, fontSize: 10, color: COLORS.text, fontWeight: '500', textAlign: 'right' },
  tdAnno:    { flex: 0.7, textAlign: 'left', fontWeight: '700' },
  tdRate:    { flex: 0.7, textAlign: 'right' },
  thText:    { fontSize: 9, color: COLORS.subtext, fontWeight: '800', letterSpacing: 0.5 },

  // Simulatore
  simDesc:         { color: COLORS.subtext, fontSize: 12, marginBottom: 14, lineHeight: 18 },
  simModeBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
                     paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: COLORS.border,
                     backgroundColor: COLORS.bg },
  simModeBtnActive:{ borderColor: COLORS.primary, backgroundColor: '#0C1F35' },
  simModeTxt:      { fontSize: 11, fontWeight: '700', color: COLORS.subtext },
  simRow:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  simInputWrap:    { flex: 1, backgroundColor: COLORS.bg, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: COLORS.border },
  simInputLabel:   { fontSize: 8, color: COLORS.subtext, marginBottom: 2 },
  simInputVal:     { fontSize: 12, fontWeight: '700', color: COLORS.text },
  simInput:        { flex: 1.5, backgroundColor: COLORS.bg, borderColor: COLORS.border, borderWidth: 1, borderRadius: 6, color: COLORS.text, padding: 10, fontSize: 12 },
  simBtn:          { backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'stretch', justifyContent: 'center' },
  simBtnText:      { color: '#000', fontWeight: '800', fontSize: 13 },
  simResult:       { backgroundColor: '#091A10', borderRadius: 8, padding: 14, marginBottom: 8 },
  simResultTitle:  { fontSize: 9, color: COLORS.subtext, fontWeight: '800', letterSpacing: 0.8, marginBottom: 2 },
  simResultLabel:  { fontSize: 9, color: COLORS.subtext, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  simResultVal:    { fontSize: 18, fontWeight: '900' },
  simResultSub:    { fontSize: 10, color: COLORS.subtext, marginTop: 2 },
  infoBox:         { backgroundColor: COLORS.bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginTop: 12 },
  infoLabel:       { fontSize: 11, color: COLORS.subtext },
  infoVal:         { fontSize: 11, color: COLORS.text, fontWeight: '700' },
});
