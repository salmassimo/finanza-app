import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COLORS, fmt, fmtShort } from '../utils/format';
import api from '../services/api';

// ── API ──────────────────────────────────────────────────────────────────────
const getPolizze      = () => api.get('/polizze/').then(r => r.data);
const getRiepilogo    = () => api.get('/polizze/riepilogo').then(r => r.data);
const getReportEredi  = () => api.get('/polizze/report-eredi').then(r => r.data);

const n = (v: any) => Number(v) || 0;

// ── Etichette leggibili ──────────────────────────────────────────────────────
const TIPO_LABEL: Record<string, string> = {
  vita_termine:       'Vita a Termine',
  vita_intera:        'Polizza Mista Rivalutabile',
  cpi_mutuo:          'CPI Mutuo',
  invalidita:         'Invalidità',
  malattia_grave:     'Malattia Grave',
  ltc:                'Long Term Care',
  tcm:                'Temporanea Caso Morte',
  altro:              'Altro',
};

const TIPO_ICON: Record<string, string> = {
  vita_termine:   'heart',
  vita_intera:    'trending-up',   // risparmio rivalutabile
  cpi_mutuo:      'home',
  invalidita:     'accessibility',
  malattia_grave: 'medical',
  ltc:            'medkit',
  tcm:            'shield-checkmark',
  altro:          'document-text',
};

// Polizze risparmio: capitale_assicurato = valore riscatto (non capitale morte)
const TIPI_RISPARMIO = new Set(['vita_intera']);

const STATO_COLOR: Record<string, string> = {
  attiva:     COLORS.success,
  sospesa:    '#F59E0B',
  scaduta:    COLORS.danger,
  estinta:    COLORS.subtext,
  in_attesa:  '#60A5FA',
};

const PERIODICITA_LABEL: Record<string, string> = {
  mensile:      'mese',
  trimestrale:  'trim.',
  semestrale:   'sem.',
  annuale:      'anno',
  unico:        'unico',
};

// ── Chip metrica ─────────────────────────────────────────────────────────────
function Chip({ label, value, color, small }: {
  label: string; value: string; color?: string; small?: boolean;
}) {
  return (
    <View style={s.chip}>
      <Text style={[s.chipLabel, small && { fontSize: 9 }]}>{label}</Text>
      <Text style={[s.chipValue, color ? { color } : {}, small && { fontSize: 13 }]}>{value}</Text>
    </View>
  );
}

// ── Badge stato ──────────────────────────────────────────────────────────────
function StatoBadge({ stato }: { stato: string }) {
  const color = STATO_COLOR[stato] || COLORS.subtext;
  return (
    <View style={[s.statoBadge, { borderColor: color }]}>
      <Text style={[s.statoText, { color }]}>{stato.toUpperCase()}</Text>
    </View>
  );
}

// ── Sezione Report Eredi ─────────────────────────────────────────────────────
function ReportSection({ sezione }: { sezione: any }) {
  const [open, setOpen] = useState(false);

  if (sezione.tipo === 'intestazione') {
    return (
      <View style={s.reportHeader}>
        <Ionicons name="document-text" size={20} color={COLORS.primary} />
        <Text style={s.reportHeaderTitle}>{sezione.titolo}</Text>
        <Text style={s.reportHeaderText}>{sezione.testo}</Text>
      </View>
    );
  }

  if (sezione.tipo === 'azioni_immediate') {
    return (
      <View style={s.reportBlock}>
        <TouchableOpacity style={s.reportBlockHeader} onPress={() => setOpen(!open)}>
          <Ionicons name="flash" size={16} color={COLORS.warning} />
          <Text style={[s.reportBlockTitle, { color: COLORS.warning }]}>{sezione.titolo}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.subtext} />
        </TouchableOpacity>
        {open && sezione.azioni?.map((a: string, i: number) => (
          <Text key={i} style={s.azioneText}>{a}</Text>
        ))}
      </View>
    );
  }

  if (sezione.tipo === 'polizze_risparmio') {
    return (
      <View style={s.reportBlock}>
        <TouchableOpacity style={s.reportBlockHeader} onPress={() => setOpen(!open)}>
          <Ionicons name="trending-up" size={16} color={COLORS.primary} />
          <Text style={s.reportBlockTitle}>{sezione.titolo}</Text>
          <Text style={s.reportBlockCount}>{sezione.polizze?.length || 0}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.subtext} />
        </TouchableOpacity>
        {open && sezione.polizze?.map((p: any, i: number) => (
          <View key={i} style={s.reportItem}>
            <Text style={s.reportItemNome}>{p.nome}</Text>
            {p.tipo_label && <Text style={[s.reportItemSub, { color: COLORS.primary, fontWeight: '700' }]}>{p.tipo_label}</Text>}
            {p.compagnia && <Text style={s.reportItemSub}>Compagnia: {p.compagnia}</Text>}
            {p.numero_polizza && <Text style={s.reportItemSub}>N° Posizione: {p.numero_polizza}</Text>}
            {p.intermediario && <Text style={s.reportItemSub}>Intermediario: {p.intermediario}</Text>}
            {p.valore_riscatto_attuale != null && (
              <Text style={s.reportItemSub}>
                Valore riscatto attuale: <Text style={{ color: COLORS.primary }}>{fmt(p.valore_riscatto_attuale)}</Text>
              </Text>
            )}
            {p.premio_rata && (
              <Text style={s.reportItemSub}>
                Premio: <Text style={{ color: COLORS.danger }}>{fmt(p.premio_rata)}/{p.premio_periodicita || 'trim.'}
                </Text>
              </Text>
            )}
            {p.scadenza && <Text style={s.reportItemSub}>Scadenza: {p.scadenza}</Text>}

            {/* Garanzie complementari */}
            {p.garanzie_complementari?.length > 0 && (
              <View style={{ marginTop: 6, marginBottom: 4 }}>
                <Text style={[s.reportItemSub, { fontWeight: '700', marginBottom: 2 }]}>Garanzie complementari incluse:</Text>
                {p.garanzie_complementari.map((g: string, j: number) => (
                  <Text key={j} style={s.reportItemSub}>{g}</Text>
                ))}
              </View>
            )}

            {/* Note importanti per eredi */}
            {p.note_importanti?.length > 0 && (
              <View style={[s.reportItemBenef, { backgroundColor: '#0A1F0A', borderRadius: 8, padding: 8, marginTop: 6 }]}>
                <Text style={[s.reportItemSub, { fontWeight: '800', color: COLORS.success, marginBottom: 4 }]}>
                  ℹ️ PER GLI EREDI:
                </Text>
                {p.note_importanti.map((n: string, j: number) => (
                  <Text key={j} style={[s.reportItemSub, { color: COLORS.success }]}>• {n}</Text>
                ))}
              </View>
            )}

            {p.beneficiari?.length > 0 && (
              <View style={s.reportItemBenef}>
                <Text style={[s.reportItemSub, { fontWeight: '700', marginBottom: 2 }]}>Beneficiari:</Text>
                {p.beneficiari.map((b: any, j: number) => (
                  <Text key={j} style={s.reportItemSub}>
                    • {b.nome} ({b.relazione || '—'}){b.quota ? ` — ${b.quota}%` : ''}
                  </Text>
                ))}
              </View>
            )}
            {p.documenti_dove && (
              <Text style={[s.reportItemSub, { color: '#F59E0B', marginTop: 4 }]}>📁 {p.documenti_dove}</Text>
            )}
            {p.contatto_liquidazione && (
              <Text style={[s.reportItemSub, { color: COLORS.primary }]}>📞 {p.contatto_liquidazione}</Text>
            )}
            {p.istruzioni && (
              <Text style={[s.reportItemSub, { fontStyle: 'italic', marginTop: 4 }]}>{p.istruzioni}</Text>
            )}
          </View>
        ))}
      </View>
    );
  }

  if (sezione.tipo === 'polizze_vita') {
    return (
      <View style={s.reportBlock}>
        <TouchableOpacity style={s.reportBlockHeader} onPress={() => setOpen(!open)}>
          <Ionicons name="heart" size={16} color={COLORS.primary} />
          <Text style={s.reportBlockTitle}>{sezione.titolo}</Text>
          <Text style={s.reportBlockCount}>{sezione.polizze?.length || 0}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.subtext} />
        </TouchableOpacity>
        {open && sezione.polizze?.map((p: any, i: number) => (
          <View key={i} style={s.reportItem}>
            <Text style={s.reportItemNome}>{p.nome}</Text>
            {p.compagnia && <Text style={s.reportItemSub}>Compagnia: {p.compagnia}</Text>}
            {p.numero_polizza && <Text style={s.reportItemSub}>N° Polizza: {p.numero_polizza}</Text>}
            {p.capitale_assicurato != null && (
              <Text style={s.reportItemSub}>
                Capitale: <Text style={{ color: COLORS.success }}>{fmt(p.capitale_assicurato)}</Text>
              </Text>
            )}
            {p.scadenza && <Text style={s.reportItemSub}>Scadenza: {p.scadenza}</Text>}
            {p.beneficiari?.length > 0 && (
              <View style={s.reportItemBenef}>
                <Text style={[s.reportItemSub, { fontWeight: '700', marginBottom: 2 }]}>Beneficiari:</Text>
                {p.beneficiari.map((b: any, j: number) => (
                  <Text key={j} style={s.reportItemSub}>
                    • {b.nome} ({b.relazione || '—'}){b.quota ? ` — ${b.quota}%` : ''}
                    {b.telefono ? `\n  Tel: ${b.telefono}` : ''}
                  </Text>
                ))}
              </View>
            )}
            {p.documenti_dove && (
              <Text style={[s.reportItemSub, { color: '#F59E0B' }]}>
                📁 Documenti: {p.documenti_dove}
              </Text>
            )}
            {p.contatto_liquidazione && (
              <Text style={[s.reportItemSub, { color: COLORS.primary }]}>
                📞 Liquidazione: {p.contatto_liquidazione}
              </Text>
            )}
            {p.istruzioni && (
              <Text style={[s.reportItemSub, { color: COLORS.text, fontStyle: 'italic', marginTop: 4 }]}>
                {p.istruzioni}
              </Text>
            )}
          </View>
        ))}
      </View>
    );
  }

  if (sezione.tipo === 'cpi_mutui') {
    return (
      <View style={s.reportBlock}>
        <TouchableOpacity style={s.reportBlockHeader} onPress={() => setOpen(!open)}>
          <Ionicons name="home" size={16} color='#60A5FA' />
          <Text style={s.reportBlockTitle}>{sezione.titolo}</Text>
          <Text style={s.reportBlockCount}>{sezione.polizze?.length || 0}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.subtext} />
        </TouchableOpacity>
        {open && sezione.polizze?.map((p: any, i: number) => (
          <View key={i} style={s.reportItem}>
            <Text style={s.reportItemNome}>{p.nome}</Text>
            {p.mutuo_nome && <Text style={s.reportItemSub}>Mutuo: {p.mutuo_nome}</Text>}
            {p.compagnia && <Text style={s.reportItemSub}>Compagnia: {p.compagnia}</Text>}
            {p.copertura_percentuale && (
              <Text style={s.reportItemSub}>Copertura: {p.copertura_percentuale}%</Text>
            )}
            {p.copertura_effettiva_oggi != null && (
              <Text style={s.reportItemSub}>
                Copertura oggi: <Text style={{ color: '#60A5FA' }}>{fmt(p.copertura_effettiva_oggi)}</Text>
              </Text>
            )}
            {p.beneficiari?.length > 0 && (
              <Text style={s.reportItemSub}>
                Beneficiario: {p.beneficiari.map((b: any) => b.nome).join(', ')}
              </Text>
            )}
            {p.documenti_dove && (
              <Text style={[s.reportItemSub, { color: '#F59E0B' }]}>📁 {p.documenti_dove}</Text>
            )}
            {p.istruzioni && (
              <Text style={[s.reportItemSub, { fontStyle: 'italic', marginTop: 4 }]}>{p.istruzioni}</Text>
            )}
          </View>
        ))}
      </View>
    );
  }

  if (sezione.tipo === 'mutui') {
    return (
      <View style={s.reportBlock}>
        <TouchableOpacity style={s.reportBlockHeader} onPress={() => setOpen(!open)}>
          <Ionicons name="business" size={16} color={COLORS.danger} />
          <Text style={s.reportBlockTitle}>{sezione.titolo}</Text>
          <Text style={s.reportBlockCount}>{sezione.mutui?.length || 0}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.subtext} />
        </TouchableOpacity>
        {open && sezione.mutui?.map((m: any, i: number) => (
          <View key={i} style={s.reportItem}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={s.reportItemNome}>{m.nome}</Text>
              {m.coperto_da_cpi
                ? <View style={[s.statoBadge, { borderColor: COLORS.success }]}>
                    <Text style={[s.statoText, { color: COLORS.success }]}>CPI ✓</Text>
                  </View>
                : <View style={[s.statoBadge, { borderColor: COLORS.danger }]}>
                    <Text style={[s.statoText, { color: COLORS.danger }]}>NO CPI</Text>
                  </View>
              }
            </View>
            <Text style={s.reportItemSub}>Banca: {m.banca}</Text>
            <Text style={s.reportItemSub}>
              Residuo: <Text style={{ color: COLORS.danger }}>{fmt(m.residuo_live)}</Text>
            </Text>
            <Text style={s.reportItemSub}>
              Rata: <Text style={{ color: COLORS.text }}>{fmt(m.rata_mensile)}/mese</Text>
            </Text>
            {m.scadenza && <Text style={s.reportItemSub}>Scadenza: {m.scadenza}</Text>}
            {m.cpi_note && (
              <Text style={[s.reportItemSub, { fontStyle: 'italic', color: COLORS.subtext }]}>
                {m.cpi_note}
              </Text>
            )}
          </View>
        ))}
      </View>
    );
  }

  return null;
}

// ── Card singola polizza ─────────────────────────────────────────────────────
function PolizzaCard({ polizza, expanded, onToggle }: {
  polizza: any; expanded: boolean; onToggle: () => void;
}) {
  const iconName = (TIPO_ICON[polizza.tipo] || 'document-text') as any;
  const tipoLabel = TIPO_LABEL[polizza.tipo] || polizza.tipo;

  const premioMensile = (() => {
    if (!polizza.premio_importo) return null;
    const factors: Record<string, number> = {
      mensile: 1, trimestrale: 1/3, semestrale: 1/6, annuale: 1/12, unico: 0,
    };
    const f = factors[polizza.premio_periodicita] ?? 1;
    return n(polizza.premio_importo) * f;
  })();

  return (
    <View style={s.card}>
      <TouchableOpacity style={s.cardHeader} onPress={onToggle} activeOpacity={0.8}>
        {/* Icona tipo */}
        <View style={[s.tipoIcon, { backgroundColor: polizza.tipo === 'cpi_mutuo' ? '#1E3A5F' : '#1A2E1A' }]}>
          <Ionicons name={iconName} size={20} color={polizza.tipo === 'cpi_mutuo' ? '#60A5FA' : COLORS.success} />
        </View>

        {/* Titolo */}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.cardNome} numberOfLines={2}>{polizza.nome}</Text>
          <Text style={s.cardSub}>{tipoLabel}{polizza.compagnia ? ` · ${polizza.compagnia}` : ''}</Text>
        </View>

        {/* Stato + freccia */}
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <StatoBadge stato={polizza.stato} />
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16} color={COLORS.subtext}
          />
        </View>
      </TouchableOpacity>

      {/* Chips riassuntive */}
      <View style={s.chipsRow}>
        {polizza.premio_importo && (
          <Chip
            label={`Premio/${PERIODICITA_LABEL[polizza.premio_periodicita] || 'mese'}`}
            value={fmt(polizza.premio_importo)}
            color={COLORS.danger}
            small
          />
        )}
        {premioMensile != null && polizza.premio_periodicita !== 'mensile' && polizza.premio_periodicita !== 'unico' && (
          <Chip label="≈ mensile" value={fmt(premioMensile)} color={COLORS.danger} small />
        )}
        {polizza.capitale_assicurato && (
          <Chip
            label={TIPI_RISPARMIO.has(polizza.tipo) ? 'Val. Riscatto' : 'Capitale'}
            value={fmtShort(polizza.capitale_assicurato)}
            color={TIPI_RISPARMIO.has(polizza.tipo) ? COLORS.primary : COLORS.success}
            small
          />
        )}
        {polizza.copertura_effettiva_live && (
          <Chip label="CPI oggi" value={fmtShort(polizza.copertura_effettiva_live)} color='#60A5FA' small />
        )}
        {polizza.data_scadenza && (
          <Chip label="Scadenza" value={polizza.data_scadenza} small />
        )}
        {TIPI_RISPARMIO.has(polizza.tipo) && (
          <Chip label="Garanzie" value={`${polizza.garanzie?.length || 0} compl.`} small />
        )}
      </View>

      {/* Dettagli espansi */}
      {expanded && (
        <View style={s.expandedSection}>
          {/* Banner informativo per polizze miste */}
          {TIPI_RISPARMIO.has(polizza.tipo) && (
            <View style={[s.subSection, { borderTopWidth: 0, marginTop: 0, backgroundColor: '#0A1422', borderRadius: 8, padding: 10, marginBottom: 8 }]}>
              <Text style={[s.subSectionTitle, { color: COLORS.primary }]}>POLIZZA MISTA RIVALUTABILE</Text>
              <Text style={[s.noteText, { borderTopWidth: 0, paddingTop: 0, marginTop: 0 }]}>
                Gestioni Separate Previr/Gesav · Rendimento 2025: 2,58% (conv. 3049-3140) / 2,40% (conv. 3175-3182){'\n'}
                Premio annuo totale incl. garanzie compl.: ~€5.258 (≈ €438/mese)
              </Text>
            </View>
          )}

          {/* Dati principali */}
          <View style={s.detailGrid}>
            {polizza.numero_polizza && (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>{TIPI_RISPARMIO.has(polizza.tipo) ? 'N° Posizione' : 'N° Polizza'}</Text>
                <Text style={s.detailValue}>{polizza.numero_polizza}</Text>
              </View>
            )}
            {polizza.intermediario && (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Intermediario</Text>
                <Text style={s.detailValue}>{polizza.intermediario}</Text>
              </View>
            )}
            {polizza.data_stipula && (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Stipula</Text>
                <Text style={s.detailValue}>{polizza.data_stipula}</Text>
              </View>
            )}
            {polizza.data_revisione && (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Revisione</Text>
                <Text style={s.detailValue}>{polizza.data_revisione}</Text>
              </View>
            )}
            {polizza.mutuo_nome && (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Mutuo collegato</Text>
                <Text style={[s.detailValue, { color: '#60A5FA' }]}>{polizza.mutuo_nome}</Text>
              </View>
            )}
            {polizza.copertura_percentuale && (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>Copertura %</Text>
                <Text style={s.detailValue}>{polizza.copertura_percentuale}% del debito</Text>
              </View>
            )}
            {polizza.copertura_effettiva_live && (
              <View style={s.detailRow}>
                <Text style={s.detailLabel}>CPI valore oggi</Text>
                <Text style={[s.detailValue, { color: '#60A5FA' }]}>{fmt(polizza.copertura_effettiva_live)}</Text>
              </View>
            )}
          </View>

          {/* Garanzie */}
          {polizza.garanzie?.length > 0 && (
            <View style={s.subSection}>
              <Text style={s.subSectionTitle}>GARANZIE</Text>
              {polizza.garanzie.map((g: any, i: number) => (
                <View key={i} style={s.garanziaRow}>
                  <Ionicons name="shield-checkmark" size={13} color={COLORS.success} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={s.garanziaType}>
                      {g.tipo_garanzia.replace(/_/g, ' ').toUpperCase()}
                      {!g.attiva && <Text style={{ color: COLORS.subtext }}> (inattiva)</Text>}
                    </Text>
                    {g.descrizione && <Text style={s.garanziaDesc}>{g.descrizione}</Text>}
                    {g.percentuale_debito && (
                      <Text style={s.garanziaDesc}>Copertura: {g.percentuale_debito}% del debito</Text>
                    )}
                    {g.capitale_garantito && (
                      <Text style={s.garanziaDesc}>Capitale: {fmt(g.capitale_garantito)}</Text>
                    )}
                    {g.franchigia_giorni && (
                      <Text style={s.garanziaDesc}>Franchigia: {g.franchigia_giorni} giorni</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Beneficiari */}
          {polizza.beneficiari?.length > 0 && (
            <View style={s.subSection}>
              <Text style={s.subSectionTitle}>BENEFICIARI</Text>
              {polizza.beneficiari.map((b: any, i: number) => (
                <View key={i} style={s.beneficiarioRow}>
                  <Ionicons name="person" size={13} color={COLORS.primary} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={s.beneficiarioNome}>{b.nome_cognome}</Text>
                    <Text style={s.beneficiarioSub}>
                      {b.relazione || '—'}
                      {b.percentuale_quota ? ` · ${b.percentuale_quota}%` : ''}
                    </Text>
                    {b.recapito_telefono && (
                      <Text style={[s.beneficiarioSub, { color: COLORS.primary }]}>
                        📞 {b.recapito_telefono}
                      </Text>
                    )}
                    {b.recapito_email && (
                      <Text style={[s.beneficiarioSub, { color: COLORS.primary }]}>
                        ✉️ {b.recapito_email}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Istruzioni eredi */}
          {(polizza.istruzioni_eredi || polizza.documenti_dove || polizza.contatto_liquidazione) && (
            <View style={s.subSection}>
              <Text style={s.subSectionTitle}>INFO EREDI</Text>
              {polizza.documenti_dove && (
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>📁 Documenti</Text>
                  <Text style={[s.detailValue, { color: '#F59E0B', flex: 1 }]}>{polizza.documenti_dove}</Text>
                </View>
              )}
              {polizza.contatto_liquidazione && (
                <View style={s.detailRow}>
                  <Text style={s.detailLabel}>📞 Liquidazione</Text>
                  <Text style={[s.detailValue, { color: COLORS.primary, flex: 1 }]}>{polizza.contatto_liquidazione}</Text>
                </View>
              )}
              {polizza.istruzioni_eredi && (
                <Text style={s.istruzioniText}>{polizza.istruzioni_eredi}</Text>
              )}
            </View>
          )}

          {/* Note */}
          {polizza.note && (
            <Text style={s.noteText}>{polizza.note}</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ── MAIN SCREEN ──────────────────────────────────────────────────────────────
export default function PolizzeScreen() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'polizze' | 'report'>('polizze');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: riepilogo, isLoading: loadingRiep } = useQuery({
    queryKey: ['polizze-riepilogo'],
    queryFn: getRiepilogo,
  });

  const { data: polizze = [], isLoading: loadingPol } = useQuery({
    queryKey: ['polizze'],
    queryFn: getPolizze,
  });

  const { data: report, isLoading: loadingReport } = useQuery({
    queryKey: ['polizze-report-eredi'],
    queryFn: getReportEredi,
    enabled: activeTab === 'report',
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['polizze-riepilogo'] }),
      qc.invalidateQueries({ queryKey: ['polizze'] }),
      qc.invalidateQueries({ queryKey: ['polizze-report-eredi'] }),
    ]);
    setRefreshing(false);
  }, [qc]);

  const isLoading = loadingRiep || loadingPol;

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
    >
      {/* ── RIEPILOGO HEADER ── */}
      {riepilogo && (
        <View style={s.riepilogoCard}>
          <Text style={s.riepilogoTitle}>COPERTURE ATTIVE</Text>
          <View style={s.riepilogoGrid}>
            <View style={s.riepilogoItem}>
              <Text style={s.riepilogoLabel}>Polizze attive</Text>
              <Text style={[s.riepilogoValue, { color: COLORS.primary }]}>
                {riepilogo.n_polizze_attive}
              </Text>
            </View>
            <View style={s.riepilogoItem}>
              <Text style={s.riepilogoLabel}>Premio rivalut./trim.</Text>
              <Text style={[s.riepilogoValue, { color: COLORS.danger }]}>
                {fmt(riepilogo.totale_premio_mensile)}
              </Text>
            </View>
            <View style={s.riepilogoItem}>
              <Text style={s.riepilogoLabel}>Valore riscatto maturato</Text>
              <Text style={[s.riepilogoValue, { color: COLORS.primary }]}>
                {fmtShort(riepilogo.valore_maturato_totale)}
              </Text>
            </View>
            <View style={s.riepilogoItem}>
              <Text style={s.riepilogoLabel}>CPI debito coperto</Text>
              <Text style={[s.riepilogoValue, { color: '#60A5FA' }]}>
                {fmtShort(riepilogo.copertura_cpi_effettiva)}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* ── TABS ── */}
      <View style={s.tabRow}>
        {([
          { key: 'polizze', label: 'POLIZZE', icon: 'shield' },
          { key: 'report',  label: 'REPORT EREDI', icon: 'document-text' },
        ] as const).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[s.tabBtn, activeTab === tab.key && s.tabBtnActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon as any}
              size={14}
              color={activeTab === tab.key ? COLORS.primary : COLORS.subtext}
            />
            <Text style={[s.tabLabel, activeTab === tab.key && s.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── TAB: POLIZZE ── */}
      {activeTab === 'polizze' && (
        <>
          {isLoading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
          ) : (polizze as any[]).length === 0 ? (
            <View style={s.emptyState}>
              <Ionicons name="shield-outline" size={48} color={COLORS.subtext} />
              <Text style={s.emptyText}>Nessuna polizza registrata</Text>
            </View>
          ) : (
            (polizze as any[]).map((p: any) => (
              <PolizzaCard
                key={p.id}
                polizza={p}
                expanded={expandedId === p.id}
                onToggle={() => setExpandedId(expandedId === p.id ? null : p.id)}
              />
            ))
          )}
        </>
      )}

      {/* ── TAB: REPORT EREDI ── */}
      {activeTab === 'report' && (
        <>
          {loadingReport ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
          ) : !report ? (
            <View style={s.emptyState}>
              <Ionicons name="document-text-outline" size={48} color={COLORS.subtext} />
              <Text style={s.emptyText}>Report non disponibile</Text>
            </View>
          ) : (
            <>
              <View style={s.reportWarning}>
                <Ionicons name="warning" size={16} color='#F59E0B' />
                <Text style={s.reportWarningText}>
                  Documento riservato — da conservare in luogo sicuro e condividere con un legale di fiducia
                </Text>
              </View>
              {report.sezioni?.map((sez: any, i: number) => (
                <ReportSection key={i} sezione={sez} />
              ))}
              <Text style={s.reportGenerato}>
                Generato: {new Date(report.generato_at).toLocaleString('it-IT')}
              </Text>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ── STYLES ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  // Riepilogo
  riepilogoCard: {
    margin: 12, padding: 16,
    backgroundColor: COLORS.card, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
  },
  riepilogoTitle: {
    fontSize: 10, fontWeight: '800', letterSpacing: 1.5,
    color: COLORS.subtext, marginBottom: 14,
  },
  riepilogoGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12,
  },
  riepilogoItem: { minWidth: '45%', flex: 1 },
  riepilogoLabel: { fontSize: 10, color: COLORS.subtext, marginBottom: 2, letterSpacing: 0.5 },
  riepilogoValue: { fontSize: 20, fontWeight: '800' },

  // Tabs
  tabRow: {
    flexDirection: 'row', marginHorizontal: 12, marginBottom: 8,
    backgroundColor: COLORS.card, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden',
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, gap: 6,
  },
  tabBtnActive: { backgroundColor: '#0D2340' },
  tabLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: COLORS.subtext },
  tabLabelActive: { color: COLORS.primary },

  // Card polizza
  card: {
    marginHorizontal: 12, marginBottom: 10,
    backgroundColor: COLORS.card, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: 14,
  },
  tipoIcon: {
    width: 42, height: 42, borderRadius: 21,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  cardNome: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  cardSub: { fontSize: 11, color: COLORS.subtext },

  // Badge stato
  statoBadge: {
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
  },
  statoText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  // Chips
  chipsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 14, paddingBottom: 14,
  },
  chip: {
    backgroundColor: '#0D1B2E', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    alignItems: 'center', minWidth: 70,
  },
  chipLabel: { fontSize: 9, color: COLORS.subtext, letterSpacing: 0.5, marginBottom: 2 },
  chipValue: { fontSize: 14, fontWeight: '700', color: COLORS.text },

  // Sezione espansa
  expandedSection: {
    borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  detailGrid: { gap: 6, marginBottom: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  detailLabel: { fontSize: 11, color: COLORS.subtext, flex: 1 },
  detailValue: { fontSize: 11, color: COLORS.text, fontWeight: '600', textAlign: 'right' },

  subSection: {
    borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingTop: 10, marginTop: 6, marginBottom: 4,
  },
  subSectionTitle: {
    fontSize: 9, fontWeight: '800', letterSpacing: 1.5,
    color: COLORS.subtext, marginBottom: 8,
  },

  garanziaRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  garanziaType: { fontSize: 11, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  garanziaDesc: { fontSize: 10, color: COLORS.subtext },

  beneficiarioRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  beneficiarioNome: { fontSize: 12, fontWeight: '700', color: COLORS.text },
  beneficiarioSub: { fontSize: 10, color: COLORS.subtext },

  istruzioniText: {
    fontSize: 11, color: COLORS.subtext, fontStyle: 'italic',
    marginTop: 6, lineHeight: 17,
  },
  noteText: {
    fontSize: 10, color: COLORS.subtext, marginTop: 8,
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 8,
    fontStyle: 'italic',
  },

  // Report eredi
  reportWarning: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginHorizontal: 12, marginBottom: 10,
    backgroundColor: '#2D1B00', borderRadius: 10, padding: 12, gap: 8,
    borderWidth: 1, borderColor: '#F59E0B',
  },
  reportWarningText: { flex: 1, fontSize: 11, color: '#F59E0B', lineHeight: 16 },

  reportHeader: {
    marginHorizontal: 12, marginBottom: 10,
    backgroundColor: COLORS.card, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
    gap: 6,
  },
  reportHeaderTitle: {
    fontSize: 14, fontWeight: '800', letterSpacing: 0.5, color: COLORS.text,
  },
  reportHeaderText: { fontSize: 12, color: COLORS.subtext, lineHeight: 18 },

  reportBlock: {
    marginHorizontal: 12, marginBottom: 8,
    backgroundColor: COLORS.card, borderRadius: 14,
    borderWidth: 1, borderColor: COLORS.border,
    overflow: 'hidden',
  },
  reportBlockHeader: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, gap: 8,
  },
  reportBlockTitle: {
    flex: 1, fontSize: 12, fontWeight: '700', color: COLORS.text,
  },
  reportBlockCount: {
    fontSize: 11, color: COLORS.subtext,
    backgroundColor: '#1A2535', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },

  reportItem: {
    marginHorizontal: 12, marginBottom: 12,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  reportItemNome: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 4 },
  reportItemSub: { fontSize: 11, color: COLORS.subtext, marginBottom: 2, lineHeight: 16 },
  reportItemBenef: { marginTop: 4 },

  azioneText: {
    fontSize: 12, color: COLORS.text, lineHeight: 20,
    paddingHorizontal: 14, paddingBottom: 8,
  },

  reportGenerato: {
    textAlign: 'center', fontSize: 10,
    color: COLORS.subtext, marginTop: 20, marginBottom: 8,
  },

  // Empty state
  emptyState: {
    alignItems: 'center', paddingVertical: 60, gap: 12,
  },
  emptyText: { fontSize: 14, color: COLORS.subtext },

  // Warning color
  warning: { color: '#F59E0B' },
});
