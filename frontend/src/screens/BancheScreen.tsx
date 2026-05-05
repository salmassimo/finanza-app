import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, FlatList, TextInput, ActivityIndicator, Alert, Linking, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOBConnessioni, getOBIstituzioni, connettiBanca, completaConnessione,
  syncConnessione, eliminaConnessione,
} from '../services/api';

// ─── Colori ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f172a', card: '#1e293b', border: '#334155',
  text: '#f1f5f9', muted: '#94a3b8', accent: '#3b82f6',
  success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
  pending: '#a78bfa',
};

// ─── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { color: string; label: string; icon: string }> = {
    active:  { color: C.success,  label: 'Attiva',        icon: 'checkmark-circle' },
    pending: { color: C.pending,  label: 'In attesa auth', icon: 'time' },
    expired: { color: C.danger,   label: 'Scaduta (90gg)', icon: 'alert-circle' },
    error:   { color: C.danger,   label: 'Errore',         icon: 'close-circle' },
  };
  const s = cfg[status] || { color: C.muted, label: status, icon: 'help-circle' };
  return (
    <View style={[styles.badge, { backgroundColor: s.color + '22', borderColor: s.color }]}>
      <Ionicons name={s.icon as any} size={12} color={s.color} />
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

// ─── Card connessione ──────────────────────────────────────────────────────────
function ConnessioneCard({
  conn, onSync, onCompleta, onElimina, syncing,
}: {
  conn: any; onSync: () => void; onCompleta: () => void;
  onElimina: () => void; syncing: boolean;
}) {
  const lastSync = conn.last_sync
    ? new Date(conn.last_sync).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'Mai';
  const expires = conn.expires_at
    ? new Date(conn.expires_at).toLocaleDateString('it-IT')
    : null;
  const daysLeft = conn.expires_at
    ? Math.max(0, Math.ceil((new Date(conn.expires_at).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.bankIcon}>
          <Ionicons name="business" size={22} color={C.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bankName}>{conn.institution_name}</Text>
          {conn.account_id && (
            <Text style={styles.accountId}>
              ID: {conn.account_id.slice(0, 8)}…
            </Text>
          )}
        </View>
        <StatusBadge status={conn.status} />
      </View>

      {/* Info */}
      <View style={styles.infoRow}>
        <View style={styles.infoItem}>
          <Text style={styles.infoLabel}>Ultimo sync</Text>
          <Text style={styles.infoValue}>{lastSync}</Text>
        </View>
        {expires && (
          <View style={styles.infoItem}>
            <Text style={styles.infoLabel}>Scadenza PSD2</Text>
            <Text style={[styles.infoValue, daysLeft && daysLeft < 10 ? { color: C.warning } : {}]}>
              {expires} {daysLeft !== null ? `(${daysLeft}gg)` : ''}
            </Text>
          </View>
        )}
      </View>

      {/* Azioni */}
      <View style={styles.cardActions}>
        {conn.status === 'pending' && (
          <>
            {conn.link_url && (
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: C.accent }]}
                onPress={() => Linking.openURL(conn.link_url)}
              >
                <Ionicons name="open-outline" size={14} color="#fff" />
                <Text style={styles.actionBtnText}>Apri Banca</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: C.pending }]}
              onPress={onCompleta}
            >
              <Ionicons name="checkmark" size={14} color="#fff" />
              <Text style={styles.actionBtnText}>Ho completato</Text>
            </TouchableOpacity>
          </>
        )}
        {conn.status === 'active' && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: C.success, opacity: syncing ? 0.6 : 1 }]}
            onPress={onSync}
            disabled={syncing}
          >
            {syncing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="sync" size={14} color="#fff" />
            }
            <Text style={styles.actionBtnText}>{syncing ? 'Sync…' : 'Sincronizza'}</Text>
          </TouchableOpacity>
        )}
        {conn.status === 'expired' && (
          <Text style={[styles.infoLabel, { color: C.warning, flex: 1 }]}>
            Ricollega la banca per rinnovare i 90gg PSD2
          </Text>
        )}
        <TouchableOpacity style={styles.deleteBtn} onPress={onElimina}>
          <Ionicons name="trash-outline" size={16} color={C.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Modal selezione istituto ──────────────────────────────────────────────────
function IstituzioneModal({
  visible, onClose, onSelect,
}: {
  visible: boolean; onClose: () => void; onSelect: (i: any) => void;
}) {
  const [search, setSearch] = useState('');
  const { data: istituti = [], isLoading, error } = useQuery({
    queryKey: ['ob-istituzioni'],
    queryFn: () => getOBIstituzioni('IT'),
    enabled: visible,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const filtered = search.trim()
    ? istituti.filter((i: any) => i.name.toLowerCase().includes(search.toLowerCase()))
    : istituti;

  const isNotConfigured = (error as any)?.response?.status === 503;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Seleziona la tua banca</Text>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={C.text} />
          </TouchableOpacity>
        </View>

        {isNotConfigured ? (
          <View style={styles.configWarning}>
            <Ionicons name="key-outline" size={40} color={C.warning} />
            <Text style={styles.configWarnTitle}>Configurazione richiesta</Text>
            <Text style={styles.configWarnText}>
              Per collegare la tua banca devi prima registrarti gratuitamente su{'\n\n'}
              <Text style={{ color: C.accent, fontWeight: '700' }}>bankaccountdata.gocardless.com</Text>
              {'\n\n'}
              Poi aggiungi le credenziali nel file{' '}
              <Text style={{ color: C.text, fontFamily: 'monospace' }}>.env</Text>:{'\n'}
              <Text style={{ color: C.success, fontFamily: 'monospace' }}>
                GOCARDLESS_SECRET_ID=..{'\n'}
                GOCARDLESS_SECRET_KEY=..
              </Text>
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={C.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Cerca banca..."
                placeholderTextColor={C.muted}
                value={search}
                onChangeText={setSearch}
                autoFocus
              />
            </View>

            {isLoading ? (
              <ActivityIndicator size="large" color={C.accent} style={{ marginTop: 40 }} />
            ) : error ? (
              <View style={styles.configWarning}>
                <Ionicons name="warning-outline" size={40} color={C.danger} />
                <Text style={[styles.configWarnTitle, { color: C.danger }]}>Errore connessione</Text>
                <Text style={styles.configWarnText}>
                  Impossibile caricare la lista delle banche.{'\n'}Verifica la connessione internet e riprova.
                </Text>
              </View>
            ) : (
          <FlatList
            data={filtered}
            keyExtractor={(i: any) => i.id}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.istituzioneItem} onPress={() => { onSelect(item); onClose(); }}>
                <View style={styles.istLogo}>
                  <Ionicons name="business-outline" size={20} color={C.accent} />
                </View>
                <View>
                  <Text style={styles.istName}>{item.name}</Text>
                  {item.bic && <Text style={styles.istBic}>{item.bic}</Text>}
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.muted} style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border }} />}
          />
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

// ─── Modal collegamento in corso ───────────────────────────────────────────────
function CollegamentoModal({
  visible, conn, onCompleta, onClose, completing,
}: {
  visible: boolean; conn: any | null; onCompleta: () => void;
  onClose: () => void; completing: boolean;
}) {
  if (!conn) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.overlayCard}>
          <Ionicons name="shield-checkmark" size={48} color={C.accent} style={{ alignSelf: 'center', marginBottom: 16 }} />
          <Text style={styles.overlayTitle}>Autenticazione {conn.institution_name}</Text>
          <Text style={styles.overlayText}>
            Stai per essere reindirizzato al sito della tua banca per autorizzare
            l'accesso ai tuoi movimenti (solo lettura, PSD2).{'\n\n'}
            Dopo aver completato l'autenticazione, torna qui e premi il pulsante qui sotto.
          </Text>

          {conn.link_url && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: C.accent, justifyContent: 'center', marginBottom: 12 }]}
              onPress={() => Linking.openURL(conn.link_url)}
            >
              <Ionicons name="open-outline" size={16} color="#fff" />
              <Text style={styles.actionBtnText}>Apri sito banca</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: C.success, justifyContent: 'center', opacity: completing ? 0.6 : 1 }]}
            onPress={onCompleta}
            disabled={completing}
          >
            {completing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="checkmark-circle" size={16} color="#fff" />
            }
            <Text style={styles.actionBtnText}>Ho completato l'autenticazione</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ marginTop: 12, alignItems: 'center' }}>
            <Text style={{ color: C.muted }}>Annulla</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Screen principale ─────────────────────────────────────────────────────────
export default function BancheScreen() {
  const qc = useQueryClient();
  const [showIstituzioni, setShowIstituzioni]     = useState(false);
  const [pendingConn, setPendingConn]             = useState<any>(null);
  const [showCollegamento, setShowCollegamento]   = useState(false);
  const [syncingId, setSyncingId]                 = useState<string | null>(null);

  const { data: connessioni = [], isLoading, refetch } = useQuery({
    queryKey: ['ob-connessioni'],
    queryFn: getOBConnessioni,
    staleTime: 30 * 1000,
  });

  const connetti = useMutation({
    mutationFn: (istituto: any) =>
      connettiBanca({
        institution_id: istituto.id,
        institution_name: istituto.name,
      }),
    onSuccess: (conn) => {
      setPendingConn(conn);
      setShowCollegamento(true);
      qc.invalidateQueries({ queryKey: ['ob-connessioni'] });
    },
    onError: (e: any) => Alert.alert('Errore', e?.response?.data?.detail || 'Impossibile avviare il collegamento'),
  });

  const completa = useMutation({
    mutationFn: (reqId: string) => completaConnessione(reqId),
    onSuccess: () => {
      setShowCollegamento(false);
      setPendingConn(null);
      qc.invalidateQueries({ queryKey: ['ob-connessioni'] });
      Alert.alert('✅ Collegato!', 'La banca è stata collegata con successo. Ora puoi sincronizzare i movimenti.');
    },
    onError: (e: any) =>
      Alert.alert('Non ancora pronto', e?.response?.data?.detail || 'Completa prima l\'autenticazione sul sito della banca.'),
  });

  const sync = useCallback(async (connId: string) => {
    setSyncingId(connId);
    try {
      const result = await syncConnessione(connId);
      qc.invalidateQueries({ queryKey: ['movimenti'] });
      qc.invalidateQueries({ queryKey: ['conti'] });
      qc.invalidateQueries({ queryKey: ['ob-connessioni'] });
      qc.invalidateQueries({ queryKey: ['patrimonio'] });
      Alert.alert(
        '✅ Sincronizzazione completata',
        `${result.nuove} nuove transazioni importate\n${result.duplicate} già presenti${result.errori?.length ? `\n⚠️ ${result.errori.length} errori` : ''}`,
      );
    } catch (e: any) {
      Alert.alert('Errore sync', e?.response?.data?.detail || 'Errore durante la sincronizzazione');
    } finally {
      setSyncingId(null);
    }
  }, [qc]);

  const elimina = useMutation({
    mutationFn: (id: string) => eliminaConnessione(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ob-connessioni'] });
      Alert.alert('Connessione rimossa');
    },
  });

  const handleElimina = (conn: any) => {
    Alert.alert(
      'Rimuovi connessione',
      `Vuoi rimuovere il collegamento con ${conn.institution_name}?\nI movimenti già importati resteranno.`,
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Rimuovi', style: 'destructive', onPress: () => elimina.mutate(conn.id) },
      ],
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Open Banking</Text>
          <Text style={styles.headerSub}>Collega la tua banca (PSD2)</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowIstituzioni(true)}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addBtnText}>Collega banca</Text>
        </TouchableOpacity>
      </View>

      {/* Info PSD2 */}
      <View style={styles.infoCard}>
        <Ionicons name="shield-checkmark-outline" size={18} color={C.accent} />
        <Text style={styles.infoCardText}>
          Accesso sicuro in sola lettura tramite PSD2. Nessuna credenziale bancaria memorizzata.
          La connessione dura 90 giorni, poi è sufficiente riautenticarsi.
        </Text>
      </View>

      {/* Lista connessioni */}
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={C.accent} />}
      >
        {isLoading && connessioni.length === 0 && (
          <ActivityIndicator size="large" color={C.accent} style={{ marginTop: 40 }} />
        )}

        {!isLoading && connessioni.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="business-outline" size={48} color={C.muted} />
            <Text style={styles.emptyTitle}>Nessuna banca collegata</Text>
            <Text style={styles.emptyText}>
              Collega il tuo conto UniCredit (o altra banca) per importare automaticamente i movimenti.
            </Text>
            <TouchableOpacity style={[styles.addBtn, { marginTop: 16 }]} onPress={() => setShowIstituzioni(true)}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Collega banca</Text>
            </TouchableOpacity>
          </View>
        )}

        {connessioni.map((conn: any) => (
          <ConnessioneCard
            key={conn.id}
            conn={conn}
            syncing={syncingId === conn.id}
            onSync={() => sync(conn.id)}
            onCompleta={() => {
              setPendingConn(conn);
              setShowCollegamento(true);
            }}
            onElimina={() => handleElimina(conn)}
          />
        ))}
      </ScrollView>

      {/* Modals */}
      <IstituzioneModal
        visible={showIstituzioni}
        onClose={() => setShowIstituzioni(false)}
        onSelect={(istituto) => {
          setShowIstituzioni(false);
          connetti.mutate(istituto);
        }}
      />

      <CollegamentoModal
        visible={showCollegamento}
        conn={pendingConn}
        completing={completa.isPending}
        onCompleta={() => pendingConn && completa.mutate(pendingConn.requisition_id)}
        onClose={() => setShowCollegamento(false)}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16,
    backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: C.text },
  headerSub:   { fontSize: 12, color: C.muted, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.accent, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.accent + '15', borderLeftWidth: 3, borderLeftColor: C.accent,
    marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 8,
  },
  infoCardText: { color: C.muted, fontSize: 12, flex: 1, lineHeight: 18 },

  card: {
    backgroundColor: C.card, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, marginBottom: 12, padding: 16,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  bankIcon: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: C.accent + '20', alignItems: 'center', justifyContent: 'center',
  },
  bankName:  { fontSize: 16, fontWeight: '600', color: C.text },
  accountId: { fontSize: 11, color: C.muted, marginTop: 2 },

  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },

  infoRow: { flexDirection: 'row', gap: 24, marginBottom: 12 },
  infoItem: {},
  infoLabel: { fontSize: 11, color: C.muted },
  infoValue: { fontSize: 13, color: C.text, fontWeight: '500', marginTop: 2 },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
  },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  deleteBtn: { marginLeft: 'auto', padding: 8 },

  // Modal istituti
  modalContainer: { flex: 1, backgroundColor: C.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.card, margin: 16, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 15 },
  istituzioneItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  istLogo: {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.border,
  },
  istName: { fontSize: 15, color: C.text, fontWeight: '500' },
  istBic:  { fontSize: 11, color: C.muted },

  // Modal collegamento
  overlay: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'center', padding: 20 },
  overlayCard: { backgroundColor: C.card, borderRadius: 16, padding: 24 },
  overlayTitle: { fontSize: 18, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 12 },
  overlayText:  { fontSize: 14, color: C.muted, lineHeight: 22, marginBottom: 20 },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text, marginTop: 16 },
  emptyText:  { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginTop: 8 },

  // Config warning
  configWarning: { alignItems: 'center', padding: 32, gap: 12 },
  configWarnTitle: { fontSize: 17, fontWeight: '700', color: C.warning, textAlign: 'center' },
  configWarnText: { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 22 },
});
