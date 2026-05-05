import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProiezione, useAlert, useObiettivi, useAddObiettivo, useDeleteObiettivo } from '../hooks/useData';
import { COLORS, fmt, fmtShort } from '../utils/format';
import MultiLineChart, { ScenarioLine } from '../components/MultiLineChart';

// ── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = 'scenari' | 'obiettivi' | 'alert';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'scenari',   label: 'Scenari',   icon: 'analytics' },
  { key: 'obiettivi', label: 'Obiettivi', icon: 'flag' },
  { key: 'alert',     label: 'Alert',     icon: 'notifications' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCENARIO_COLORS: Record<string, string> = {
  base:        '#38BDF8',
  ottimizzato: '#4ADE80',
  aggressivo:  '#A78BFA',
};

const ALERT_COLORS: Record<string, string> = {
  danger:  COLORS.danger,
  warning: COLORS.warning,
  info:    COLORS.primary,
};

const ALERT_ICONS: Record<string, string> = {
  danger:  'warning',
  warning: 'alert-circle',
  info:    'information-circle',
};

const TIPO_LABELS: Record<string, string> = {
  patrimonio_netto: 'Patrimonio netto',
  liquidita:        'Liquidità',
  portafoglio:      'Portafoglio',
  zero_mutui:       'Estingui mutui',
  libero:           'Obiettivo libero',
};

// ── Scenari tab ───────────────────────────────────────────────────────────────

function ScenariTab() {
  const { data, isLoading, error } = useProiezione();
  const { width } = useWindowDimensions();
  const [activeScenario, setActiveScenario] = useState<string | null>(null);

  if (isLoading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />;
  if (error || !data) return <Text style={styles.errorText}>Errore nel caricamento scenari</Text>;

  const scenari = data.scenari as Record<string, any>;
  const scenarioKeys = Object.keys(scenari);

  const lines: ScenarioLine[] = scenarioKeys.map(key => {
    const sc = scenari[key];
    // Mostra un punto ogni 6 mesi per leggibilità
    const punti: { label: string; value: number }[] = (sc.punti as any[])
      .filter((_: any, i: number) => i % 6 === 0 || i === sc.punti.length - 1)
      .map((p: any) => ({ label: p.label, value: p.patrimonio_netto }));
    return {
      key,
      label: sc.nome,
      color: SCENARIO_COLORS[key] || '#FFF',
      points: punti,
    };
  });

  // Milestones per scenario attivo (o base)
  const activeKey = activeScenario || 'base';
  const activeSc  = scenari[activeKey];
  const milestones = (activeSc.punti as any[]).filter(
    (p: any) => p.milestones?.some((m: string) => m !== 'Oggi')
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Legenda scenari */}
      <View style={styles.legendRow}>
        {scenarioKeys.map(key => (
          <TouchableOpacity
            key={key}
            style={[styles.legendChip, { borderColor: SCENARIO_COLORS[key] || '#FFF', opacity: activeScenario && activeScenario !== key ? 0.4 : 1 }]}
            onPress={() => setActiveScenario(activeScenario === key ? null : key)}
          >
            <View style={[styles.legendDot, { backgroundColor: SCENARIO_COLORS[key] || '#FFF' }]} />
            <Text style={styles.legendText}>{scenari[key].nome}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Grafico multi-linea */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Patrimonio netto — 5 anni</Text>
        <MultiLineChart lines={lines} width={width - 56} height={240} />
      </View>

      {/* Schede scenario */}
      {scenarioKeys.map(key => {
        const sc = scenari[key];
        const delta = sc.delta_vs_oggi;
        return (
          <View key={key} style={[styles.scenarioCard, { borderLeftColor: SCENARIO_COLORS[key] || '#FFF' }]}>
            <Text style={[styles.scenarioNome, { color: SCENARIO_COLORS[key] || '#FFF' }]}>{sc.nome}</Text>
            <Text style={styles.scenarioDesc}>{sc.descrizione}</Text>
            <View style={styles.scenarioRow}>
              <View style={styles.scenarioStat}>
                <Text style={styles.statLabel}>Patrimonio 5 anni</Text>
                <Text style={styles.statValue}>{fmtShort(sc.patrimonio_finale)}</Text>
              </View>
              <View style={styles.scenarioStat}>
                <Text style={styles.statLabel}>Delta vs oggi</Text>
                <Text style={[styles.statValue, { color: delta >= 0 ? COLORS.success : COLORS.danger }]}>
                  {delta >= 0 ? '+' : ''}{fmtShort(delta)}
                </Text>
              </View>
              <View style={styles.scenarioStat}>
                <Text style={styles.statLabel}>Rendimento</Text>
                <Text style={styles.statValue}>{(sc.tasso_annuo * 100).toFixed(1)}%/a</Text>
              </View>
            </View>
          </View>
        );
      })}

      {/* Milestones */}
      {milestones.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Milestone — scenario {activeSc.nome}</Text>
          {milestones.map((p: any, i: number) => (
            <View key={i} style={styles.milestoneRow}>
              <Ionicons name="flag" size={14} color={COLORS.success} />
              <Text style={styles.milestoneLabel}>{p.label}</Text>
              <Text style={styles.milestoneTags}>
                {p.milestones.filter((m: string) => m !== 'Oggi').join(' · ')}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Snapshot */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Snapshot patrimonio attuale</Text>
        {[
          ['Liquidità', data.snapshot.liquidita],
          ['Portafoglio', data.snapshot.portafoglio],
          ['Immobili', data.snapshot.immobili],
          ['Orologi', data.snapshot.orologi],
          ['Fondo pensione', data.snapshot.fondo_pensione],
          ['Mutui residui', -data.snapshot.mutui_residuo],
        ].map(([label, val]) => (
          <View key={label as string} style={styles.snapRow}>
            <Text style={styles.snapLabel}>{label}</Text>
            <Text style={[styles.snapVal, { color: (val as number) < 0 ? COLORS.danger : COLORS.text }]}>
              {fmtShort(val)}
            </Text>
          </View>
        ))}
        <View style={[styles.snapRow, styles.snapTotal]}>
          <Text style={[styles.snapLabel, { fontWeight: '700' }]}>Entrate mensili medie</Text>
          <Text style={styles.snapVal}>{fmtShort(data.flussi.entrate_mensili)}</Text>
        </View>
        <View style={styles.snapRow}>
          <Text style={styles.snapLabel}>Uscite mensili medie</Text>
          <Text style={styles.snapVal}>{fmtShort(data.flussi.uscite_mensili)}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

// ── Obiettivi tab ─────────────────────────────────────────────────────────────

function ObiettiviTab() {
  const { data: obiettivi, isLoading } = useObiettivi();
  const addMutation    = useAddObiettivo();
  const deleteMutation = useDeleteObiettivo();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    nome: '', descrizione: '', tipo: 'patrimonio_netto',
    target_importo: '', target_data: '',
  });

  const TIPI = Object.entries(TIPO_LABELS).map(([k, v]) => ({ key: k, label: v }));

  const handleSave = async () => {
    if (!form.nome.trim() || !form.target_data) {
      Alert.alert('Attenzione', 'Nome e data target sono obbligatori');
      return;
    }
    try {
      await addMutation.mutateAsync({
        nome: form.nome.trim(),
        descrizione: form.descrizione || undefined,
        tipo: form.tipo,
        target_importo: form.target_importo ? parseFloat(form.target_importo.replace(',', '.')) : undefined,
        target_data: form.target_data,
      });
      setShowForm(false);
      setForm({ nome: '', descrizione: '', tipo: 'patrimonio_netto', target_importo: '', target_data: '' });
    } catch {
      Alert.alert('Errore', 'Impossibile salvare l\'obiettivo');
    }
  };

  const handleDelete = (id: string, nome: string) => {
    Alert.alert('Elimina obiettivo', `Vuoi eliminare "${nome}"?`, [
      { text: 'Annulla', style: 'cancel' },
      { text: 'Elimina', style: 'destructive', onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  if (isLoading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />;

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <TouchableOpacity
        style={[styles.addBtn, showForm && { backgroundColor: COLORS.surface }]}
        onPress={() => setShowForm(!showForm)}
      >
        <Ionicons name={showForm ? 'close' : 'add-circle'} size={18} color={COLORS.primary} />
        <Text style={styles.addBtnText}>{showForm ? 'ANNULLA' : 'NUOVO OBIETTIVO'}</Text>
      </TouchableOpacity>

      {showForm && (
        <View style={styles.formCard}>
          <Text style={styles.fieldLabel}>Nome *</Text>
          <TextInput
            style={styles.input}
            placeholder="Es. Fondo emergenza"
            placeholderTextColor={COLORS.subtext}
            value={form.nome}
            onChangeText={v => setForm(f => ({ ...f, nome: v }))}
          />
          <Text style={styles.fieldLabel}>Tipo</Text>
          <View style={styles.tipiRow}>
            {TIPI.map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.tipoChip, form.tipo === t.key && styles.tipoChipActive]}
                onPress={() => setForm(f => ({ ...f, tipo: t.key }))}
              >
                <Text style={[styles.tipoChipText, form.tipo === t.key && { color: COLORS.bg }]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.fieldLabel}>
            {form.tipo === 'zero_mutui'
              ? 'Capitale originale mutuo (€) — serve per il progresso'
              : form.tipo === 'libero'
                ? 'Importo target (€) — opzionale'
                : 'Importo target (€) *'}
          </Text>
          <TextInput
            style={styles.input}
            placeholder={form.tipo === 'zero_mutui' ? 'Es. 600000 (importo iniziale)' : 'Es. 100000'}
            placeholderTextColor={COLORS.subtext}
            keyboardType="decimal-pad"
            value={form.target_importo}
            onChangeText={v => setForm(f => ({ ...f, target_importo: v }))}
          />
          <Text style={styles.fieldLabel}>Data target (AAAA-MM-GG) *</Text>
          <TextInput
            style={styles.input}
            placeholder="2029-12-31"
            placeholderTextColor={COLORS.subtext}
            value={form.target_data}
            onChangeText={v => setForm(f => ({ ...f, target_data: v }))}
          />
          <Text style={styles.fieldLabel}>Descrizione</Text>
          <TextInput
            style={styles.input}
            placeholder="Note opzionali"
            placeholderTextColor={COLORS.subtext}
            value={form.descrizione}
            onChangeText={v => setForm(f => ({ ...f, descrizione: v }))}
          />
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={handleSave}
            disabled={addMutation.isPending}
          >
            <Text style={styles.saveBtnText}>
              {addMutation.isPending ? 'Salvataggio...' : 'SALVA OBIETTIVO'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {(!obiettivi || obiettivi.length === 0) ? (
        <View style={styles.emptyState}>
          <Ionicons name="flag-outline" size={48} color={COLORS.subtext} />
          <Text style={styles.emptyText}>Nessun obiettivo finanziario</Text>
          <Text style={styles.emptySubtext}>Aggiungi il tuo primo obiettivo per tracciarne il progresso</Text>
        </View>
      ) : (
        obiettivi.map((ob: any) => (
          <ObiettivoCard key={ob.id} ob={ob} onDelete={() => handleDelete(ob.id, ob.nome)} />
        ))
      )}
    </ScrollView>
  );
}

function ObiettivoCard({ ob, onDelete }: { ob: any; onDelete: () => void }) {
  const isExpired   = ob.giorni_rimanenti < 0;
  const isUrgent    = ob.giorni_rimanenti <= 90 && ob.giorni_rimanenti >= 0;
  const hasProgress = ob.progresso_pct !== null && ob.progresso_pct !== undefined;

  const borderColor = isExpired ? COLORS.danger : isUrgent ? COLORS.warning : COLORS.border;

  return (
    <View style={[styles.obCard, { borderLeftColor: borderColor }]}>
      <View style={styles.obHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.obNome}>{ob.nome}</Text>
          <Text style={styles.obTipo}>{TIPO_LABELS[ob.tipo] || ob.tipo}</Text>
        </View>
        <TouchableOpacity onPress={onDelete} style={styles.deleteBtn}>
          <Ionicons name="trash-outline" size={16} color={COLORS.danger} />
        </TouchableOpacity>
      </View>

      {ob.descrizione ? <Text style={styles.obDesc}>{ob.descrizione}</Text> : null}

      <View style={styles.obStats}>
        {ob.target_importo && (
          <View style={styles.obStat}>
            <Text style={styles.obStatLabel}>Target</Text>
            <Text style={styles.obStatVal}>{fmtShort(ob.target_importo)}</Text>
          </View>
        )}
        {ob.valore_attuale !== null && ob.valore_attuale !== undefined && (
          <View style={styles.obStat}>
            <Text style={styles.obStatLabel}>Attuale</Text>
            <Text style={styles.obStatVal}>{fmtShort(ob.valore_attuale)}</Text>
          </View>
        )}
        <View style={styles.obStat}>
          <Text style={styles.obStatLabel}>{isExpired ? 'Scaduto' : 'Mancano'}</Text>
          <Text style={[styles.obStatVal, { color: isExpired ? COLORS.danger : isUrgent ? COLORS.warning : COLORS.text }]}>
            {isExpired ? `${Math.abs(ob.giorni_rimanenti)}gg fa` : `${ob.giorni_rimanenti}gg`}
          </Text>
        </View>
      </View>

      {hasProgress && (
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, {
              width: `${Math.min(100, ob.progresso_pct)}%` as any,
              backgroundColor: ob.progresso_pct >= 100 ? COLORS.success : COLORS.primary,
            }]} />
          </View>
          <Text style={styles.progressLabel}>{ob.progresso_pct.toFixed(1)}%</Text>
        </View>
      )}
    </View>
  );
}

// ── Alert tab ─────────────────────────────────────────────────────────────────

function AlertTab() {
  const { data: alerts, isLoading } = useAlert();

  if (isLoading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />;

  if (!alerts || alerts.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="checkmark-circle" size={56} color={COLORS.success} />
        <Text style={styles.emptyText}>Tutto sotto controllo</Text>
        <Text style={styles.emptySubtext}>Nessun alert attivo per la tua situazione finanziaria</Text>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {alerts.map((alert: any, i: number) => (
        <View key={i} style={[styles.alertCard, { borderLeftColor: ALERT_COLORS[alert.livello] || COLORS.border }]}>
          <View style={styles.alertHeader}>
            <Ionicons
              name={(alert.icona || ALERT_ICONS[alert.livello] || 'information-circle') as any}
              size={20}
              color={ALERT_COLORS[alert.livello] || COLORS.text}
            />
            <Text style={[styles.alertTitolo, { color: ALERT_COLORS[alert.livello] || COLORS.text }]}>
              {alert.titolo}
            </Text>
            <View style={[styles.alertBadge, { backgroundColor: ALERT_COLORS[alert.livello] + '30' }]}>
              <Text style={[styles.alertBadgeText, { color: ALERT_COLORS[alert.livello] }]}>
                {alert.livello.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.alertCorpo}>{alert.corpo}</Text>
          <Text style={styles.alertCategoria}>{alert.categoria}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function FuturoScreen() {
  const [activeTab, setActiveTab] = useState<Tab>('scenari');
  const { data: alerts } = useAlert();
  const alertCount = alerts?.filter((a: any) => a.livello === 'danger' || a.livello === 'warning').length || 0;

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <View>
                <Ionicons
                  name={isActive ? tab.icon as any : (tab.icon + '-outline') as any}
                  size={18}
                  color={isActive ? COLORS.primary : COLORS.subtext}
                />
                {tab.key === 'alert' && alertCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{alertCount}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.content}>
        {activeTab === 'scenari'   && <ScenariTab />}
        {activeTab === 'obiettivi' && <ObiettiviTab />}
        {activeTab === 'alert'     && <AlertTab />}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg },
  tabBar:       { flexDirection: 'row', backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tabItem:      { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  tabItemActive:{ borderBottomWidth: 2, borderBottomColor: COLORS.primary },
  tabLabel:     { fontSize: 11, color: COLORS.subtext },
  tabLabelActive:{ color: COLORS.primary, fontWeight: '600' },
  content:      { flex: 1, paddingHorizontal: 16, paddingTop: 12 },

  badge:        { position: 'absolute', top: -4, right: -8, backgroundColor: COLORS.danger, borderRadius: 8, minWidth: 16, paddingHorizontal: 3, alignItems: 'center' },
  badgeText:    { color: '#FFF', fontSize: 9, fontWeight: '700' },

  legendRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  legendChip:   { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  legendDot:    { width: 8, height: 8, borderRadius: 4 },
  legendText:   { color: COLORS.text, fontSize: 12 },

  chartCard:    { backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: COLORS.border },
  chartTitle:   { color: COLORS.subtext, fontSize: 12, marginBottom: 8 },

  scenarioCard: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 3, borderWidth: 1, borderColor: COLORS.border },
  scenarioNome: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  scenarioDesc: { color: COLORS.subtext, fontSize: 12, marginBottom: 10 },
  scenarioRow:  { flexDirection: 'row', gap: 8 },
  scenarioStat: { flex: 1 },
  statLabel:    { color: COLORS.subtext, fontSize: 10, marginBottom: 2 },
  statValue:    { color: COLORS.text, fontSize: 14, fontWeight: '600' },

  section:      { marginTop: 8, marginBottom: 16 },
  sectionTitle: { color: COLORS.subtext, fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  milestoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  milestoneLabel:{ color: COLORS.subtext, fontSize: 12, width: 60 },
  milestoneTags: { color: COLORS.success, fontSize: 12, flex: 1 },

  snapRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  snapTotal:    { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 4, paddingTop: 8 },
  snapLabel:    { color: COLORS.subtext, fontSize: 13 },
  snapVal:      { color: COLORS.text, fontSize: 13, fontWeight: '600' },

  addBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: COLORS.primary },
  addBtnText:   { color: COLORS.primary, fontSize: 13, fontWeight: '700' },

  formCard:     { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border },
  fieldLabel:   { color: COLORS.subtext, fontSize: 11, marginBottom: 4, marginTop: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  input:        { backgroundColor: COLORS.bg, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14, borderWidth: 1, borderColor: COLORS.border },
  tipiRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  tipoChip:     { borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  tipoChipActive:{ backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tipoChipText: { color: COLORS.subtext, fontSize: 11 },
  saveBtn:      { backgroundColor: COLORS.primary, borderRadius: 10, padding: 13, alignItems: 'center', marginTop: 14 },
  saveBtnText:  { color: COLORS.bg, fontSize: 14, fontWeight: '700' },

  emptyState:   { alignItems: 'center', marginTop: 60, gap: 12 },
  emptyText:    { color: COLORS.text, fontSize: 18, fontWeight: '600' },
  emptySubtext: { color: COLORS.subtext, fontSize: 13, textAlign: 'center', paddingHorizontal: 20 },

  obCard:       { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 3, borderWidth: 1, borderColor: COLORS.border },
  obHeader:     { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  obNome:       { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  obTipo:       { color: COLORS.subtext, fontSize: 11 },
  obDesc:       { color: COLORS.subtext, fontSize: 12, marginBottom: 8 },
  obStats:      { flexDirection: 'row', gap: 12, marginTop: 8 },
  obStat:       { flex: 1 },
  obStatLabel:  { color: COLORS.subtext, fontSize: 10, marginBottom: 2 },
  obStatVal:    { color: COLORS.text, fontSize: 14, fontWeight: '600' },
  deleteBtn:    { padding: 4 },
  progressContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  progressBar:  { flex: 1, height: 6, backgroundColor: COLORS.bg, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLabel:{ color: COLORS.subtext, fontSize: 11, width: 40, textAlign: 'right' },

  alertCard:    { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderLeftWidth: 3, borderWidth: 1, borderColor: COLORS.border },
  alertHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  alertTitolo:  { flex: 1, fontSize: 14, fontWeight: '700' },
  alertBadge:   { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  alertBadgeText:{ fontSize: 9, fontWeight: '700' },
  alertCorpo:   { color: COLORS.subtext, fontSize: 13, lineHeight: 19 },
  alertCategoria:{ color: COLORS.border, fontSize: 10, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 },

  errorText:    { color: COLORS.danger, textAlign: 'center', marginTop: 40 },
});
