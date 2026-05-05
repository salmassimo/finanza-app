import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Modal, FlatList, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { COLORS, fmt, fmtShort } from '../utils/format';
import api from '../services/api';

// ── API calls ──────────────────────────────────────────
const getMovimenti = (mese: string, contoId: string | null, isCarta: boolean | null) =>
  api.get('/movimenti/', {
    params: {
      mese,
      conto_id: contoId ?? undefined,
      is_carta: isCarta === null ? undefined : isCarta,
      limit: 300,
    },
  }).then(r => r.data);

const getAggregati = (mese: string, contoId: string | null, isCarta: boolean | null, tipo: 'uscita' | 'entrata' = 'uscita') =>
  api.get('/movimenti/aggregati', {
    params: {
      mese,
      conto_id: contoId ?? undefined,
      is_carta: isCarta === null ? undefined : isCarta,
      tipo,
    },
  }).then(r => r.data);

const getMesiDisponibili = () =>
  api.get('/movimenti/mesi-disponibili').then(r => r.data);

const getSaldoEffettivo = () =>
  api.get('/movimenti/saldo-effettivo').then(r => r.data);

const getConti = () =>
  api.get('/conti/').then(r => r.data);

const getCategorie = () =>
  api.get('/movimenti/categorie').then(r => r.data);

const patchCategoria = ({ movimentoId, categoriaId }: { movimentoId: string; categoriaId: number | null }) =>
  api.patch(`/movimenti/${movimentoId}/categoria`, { categoria_id: categoriaId }).then(r => r.data);

// ── Helpers ────────────────────────────────────────────
const meseLabel = (mese: string) => {
  const [y, m] = mese.split('-');
  const nomi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  return `${nomi[parseInt(m) - 1]} ${y}`;
};

const colorPL = (v: number) => v >= 0 ? COLORS.success : COLORS.danger;

// ── Modale selettore categoria ──────────────────────────
function CategoriaModal({
  visible, categorie, onSelect, onClose,
}: {
  visible: boolean;
  categorie: any[];
  onSelect: (cat: any) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={cm.backdrop} onPress={onClose} />
      <View style={cm.sheet}>
        <View style={cm.handle} />
        <Text style={cm.title}>Cambia categoria</Text>
        <FlatList
          data={categorie}
          keyExtractor={c => String(c.id)}
          renderItem={({ item }) => (
            <TouchableOpacity style={cm.item} onPress={() => onSelect(item)}>
              <View style={[cm.dot, { backgroundColor: item.colore || '#9CA3AF' }]} />
              <Ionicons name={(item.icona || 'ellipsis-horizontal') as any} size={16} color={item.colore || '#9CA3AF'} />
              <Text style={cm.itemText}>{item.nome}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}

// ── Barra categoria ─────────────────────────────────────
function CatBar({ item, max, positivo = false }: { item: any; max: number; positivo?: boolean }) {
  const pct = max > 0 ? (Number(item.totale) / max) * 100 : 0;
  const colore = positivo ? (item.colore || COLORS.success) : (item.colore || '#9CA3AF');
  return (
    <View style={s.catRow}>
      <View style={s.catIcon}>
        <Ionicons name={(item.icona || 'ellipsis-horizontal') as any} size={14} color={colore} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.catLabelRow}>
          <Text style={s.catNome}>{item.categoria}</Text>
          <Text style={[s.catImporto, { color: colore }]}>
            {positivo ? '+' : ''}{fmt(item.totale)}
          </Text>
        </View>
        <View style={s.barBg}>
          <View style={[s.barFill, { width: `${pct}%` as any, backgroundColor: colore }]} />
        </View>
      </View>
      <Text style={s.catCount}>{item.count}</Text>
    </View>
  );
}

// ── Riga movimento ──────────────────────────────────────
function MovRow({
  item, onEditCategoria,
}: {
  item: any;
  onEditCategoria: (mov: any) => void;
}) {
  const isEntrata = item.tipo === 'entrata';
  const importo = Number(item.importo);
  const segno = isEntrata ? '+' : '';
  const colore = isEntrata ? COLORS.success : COLORS.text;
  const data = new Date(item.data_operazione).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
  const desc = item.descrizione?.substring(0, 55) || '—';
  const catColore = item.categoria?.colore || '#6B7280';

  return (
    <TouchableOpacity style={s.movRow} activeOpacity={0.7} onPress={() => onEditCategoria(item)}>
      <View style={[s.movIcon, { backgroundColor: catColore + '33' }]}>
        <Ionicons
          name={(item.categoria?.icona || (item.is_carta_credito ? 'card' : 'swap-horizontal')) as any}
          size={16}
          color={catColore}
        />
      </View>
      <View style={s.movCenter}>
        <Text style={s.movDesc} numberOfLines={1}>{desc}</Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text style={s.movData}>{data}</Text>
          {item.conto_nome && <Text style={s.movConto}>{item.conto_nome.replace('Conto Corrente ', '').replace('Deposito ', 'Dep ')}</Text>}
          <TouchableOpacity
            style={[s.catBadge, { borderColor: catColore + '88', backgroundColor: catColore + '22' }]}
            onPress={() => onEditCategoria(item)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[s.catBadgeText, { color: catColore }]}>
              {item.categoria?.nome || 'Altro'} ✎
            </Text>
          </TouchableOpacity>
          {item.is_carta_credito && <Text style={s.movCartaBadge}>CARTA</Text>}
        </View>
      </View>
      <Text style={[s.movImporto, { color: colore }]}>{segno}{fmt(Math.abs(importo))}</Text>
    </TouchableOpacity>
  );
}

// ── Screen ──────────────────────────────────────────────
export default function MovimentiScreen() {
  const qc = useQueryClient();

  // null = tutti, string = conto_id, 'carta' = solo carta credito
  const [filtro, setFiltro] = useState<string | null>(null);
  const [showMesi, setShowMesi] = useState(false);
  const [editMov, setEditMov] = useState<any | null>(null);   // movimento da modificare

  const meseAttuale = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const [mese, setMese] = useState<string>(meseAttuale);

  const { data: mesiDisp = [] } = useQuery({ queryKey: ['mesi-disponibili'], queryFn: getMesiDisponibili });
  const { data: saldo } = useQuery({ queryKey: ['saldo-effettivo'], queryFn: getSaldoEffettivo });
  const { data: contiRaw = [] } = useQuery({ queryKey: ['conti'], queryFn: getConti });
  const { data: categorie = [] } = useQuery({ queryKey: ['categorie'], queryFn: getCategorie, staleTime: 60_000 });

  // Separa conti CC/deposito da carta credito
  const conti = (contiRaw as any[]).filter((c: any) =>
    c.tipo === 'conto_corrente' || c.tipo === 'deposito'
  );
  const contiCarta = (contiRaw as any[]).filter((c: any) => c.tipo === 'carta_credito');

  // Risolvi conto_id e isCarta dalla selezione
  const contoId = filtro && filtro !== 'carta' ? filtro : null;
  const isCarta = filtro === 'carta' ? true : null;

  const {
    data: movimenti = [], isLoading, refetch: refetchMovimenti,
  } = useQuery({
    queryKey: ['movimenti', mese, contoId, isCarta],
    queryFn: () => getMovimenti(mese, contoId, isCarta),
  });
  const { data: aggregati = [], refetch: refetchAggregati } = useQuery({
    queryKey: ['aggregati', mese, contoId, isCarta, 'uscita'],
    queryFn: () => getAggregati(mese, contoId, isCarta, 'uscita'),
  });
  const { data: aggregatiEntrate = [], refetch: refetchAggregatiEntrate } = useQuery({
    queryKey: ['aggregati', mese, contoId, isCarta, 'entrata'],
    queryFn: () => getAggregati(mese, contoId, isCarta, 'entrata'),
  });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      refetchMovimenti(),
      refetchAggregati(),
      refetchAggregatiEntrate(),
      qc.invalidateQueries({ queryKey: ['saldo-effettivo'] }),
      qc.invalidateQueries({ queryKey: ['conti'] }),
    ]);
    setIsRefreshing(false);
  }, [refetchMovimenti, refetchAggregati, qc]);

  // Mutation aggiornamento categoria
  const mutation = useMutation({
    mutationFn: patchCategoria,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movimenti'] });
      qc.invalidateQueries({ queryKey: ['aggregati'] }); // prefix match → invalida sia uscite che entrate
      setEditMov(null);
    },
  });

  const handleSelectCategoria = useCallback((cat: any) => {
    if (!editMov) return;
    mutation.mutate({ movimentoId: editMov.id, categoriaId: cat.id });
  }, [editMov, mutation]);

  const totaleUscite = (movimenti as any[])
    .filter((m: any) => m.tipo === 'uscita')
    .reduce((acc: number, m: any) => acc + Math.abs(Number(m.importo)), 0);
  const totaleEntrate = (movimenti as any[])
    .filter((m: any) => m.tipo === 'entrata')
    .reduce((acc: number, m: any) => acc + Number(m.importo), 0);

  const maxCat = aggregati.length > 0 ? Math.max(...(aggregati as any[]).map((a: any) => Number(a.totale))) : 1;
  const maxCatEntrate = aggregatiEntrate.length > 0 ? Math.max(...(aggregatiEntrate as any[]).map((a: any) => Number(a.totale))) : 1;

  // Label breve per tab conto
  const contoLabel = (c: any) => {
    if (c.banca === 'Revolut' && c.tipo === 'deposito') return 'Dep. Revolut';
    if (c.banca === 'Revolut') return 'Revolut CC';
    if (c.banca === 'UniCredit') return 'UniCredit';
    return c.nome.substring(0, 10);
  };

  return (
    <>
      <ScrollView
        style={s.container}
        refreshControl={<RefreshControl refreshing={isRefreshing || isLoading} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
      >
        <View style={s.body}>

          {/* Saldo effettivo */}
          {saldo && (
            <View style={s.saldoCard}>
              <View style={s.saldoRow}>
                <View>
                  <Text style={s.saldoLabel}>SALDO C/C</Text>
                  <Text style={s.saldoVal}>{fmtShort(Number(saldo.saldo_conto))}</Text>
                </View>
                {Number(saldo.saldo_deposito) > 0 && (
                  <>
                    <Ionicons name="add" size={14} color={COLORS.subtext} />
                    <View style={{ alignItems: 'center' }}>
                      <Text style={s.saldoLabel}>DEPOSITO</Text>
                      <Text style={[s.saldoVal, { color: COLORS.primary }]}>{fmtShort(Number(saldo.saldo_deposito))}</Text>
                    </View>
                  </>
                )}
                <Ionicons name="remove" size={14} color={COLORS.subtext} />
                <View style={{ alignItems: 'center' }}>
                  <Text style={s.saldoLabel}>CARTA</Text>
                  <Text style={[s.saldoVal, { color: COLORS.danger }]}>{fmtShort(Number(saldo.debito_carta))}</Text>
                </View>
                <Ionicons name="remove" size={14} color={COLORS.subtext} />
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.saldoLabel}>LIQUIDITÀ</Text>
                  <Text style={[s.saldoVal, { color: COLORS.success, fontWeight: '800' }]}>
                    {fmtShort(Number(saldo.liquidita_effettiva))}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Selettore mese */}
          <TouchableOpacity style={s.meseSel} onPress={() => setShowMesi(!showMesi)}>
            <Ionicons name="calendar-outline" size={14} color={COLORS.primary} />
            <Text style={s.meseText}>{meseLabel(mese)}</Text>
            <Ionicons name={showMesi ? 'chevron-up' : 'chevron-down'} size={14} color={COLORS.subtext} />
          </TouchableOpacity>

          {showMesi && (
            <View style={s.mesiGrid}>
              {(mesiDisp.length > 0 ? mesiDisp : [meseAttuale]).map((m: string) => (
                <TouchableOpacity
                  key={m}
                  style={[s.mesiBtn, mese === m && s.mesiBtnActive]}
                  onPress={() => { setMese(m); setShowMesi(false); }}
                >
                  <Text style={[s.mesiBtnText, mese === m && s.mesiBtnTextActive]}>{meseLabel(m)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Tabs conto */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={s.tabs}>
              <TouchableOpacity
                style={[s.tab, filtro === null && s.tabActive]}
                onPress={() => setFiltro(null)}
              >
                <Text style={[s.tabText, filtro === null && s.tabTextActive]}>Tutti</Text>
              </TouchableOpacity>
              {conti.map((c: any) => (
                <TouchableOpacity
                  key={c.id}
                  style={[s.tab, filtro === c.id && s.tabActive]}
                  onPress={() => setFiltro(c.id)}
                >
                  <Text style={[s.tabText, filtro === c.id && s.tabTextActive]}>
                    {contoLabel(c)}
                  </Text>
                </TouchableOpacity>
              ))}
              {contiCarta.length > 0 && (
                <TouchableOpacity
                  style={[s.tab, filtro === 'carta' && s.tabActive]}
                  onPress={() => setFiltro('carta')}
                >
                  <Text style={[s.tabText, filtro === 'carta' && s.tabTextActive]}>Carta</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>

          {/* KPI mese */}
          <View style={s.kpiRow}>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>USCITE</Text>
              <Text style={[s.kpiVal, { color: COLORS.danger }]}>{fmtShort(totaleUscite)}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>ENTRATE</Text>
              <Text style={[s.kpiVal, { color: COLORS.success }]}>{fmtShort(totaleEntrate)}</Text>
            </View>
            <View style={s.kpi}>
              <Text style={s.kpiLabel}>SALDO MESE</Text>
              <Text style={[s.kpiVal, { color: colorPL(totaleEntrate - totaleUscite) }]}>
                {totaleEntrate - totaleUscite >= 0 ? '+' : ''}{fmtShort(totaleEntrate - totaleUscite)}
              </Text>
            </View>
          </View>

          {/* Entrate per categoria */}
          {(aggregatiEntrate as any[]).length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>ENTRATE PER CATEGORIA</Text>
              {(aggregatiEntrate as any[]).map((item: any, i: number) => (
                <CatBar key={i} item={item} max={maxCatEntrate} positivo />
              ))}
            </View>
          )}

          {/* Spese per categoria */}
          {aggregati.length > 0 && (
            <View style={s.card}>
              <Text style={s.cardTitle}>SPESE PER CATEGORIA</Text>
              {(aggregati as any[]).map((item: any, i: number) => (
                <CatBar key={i} item={item} max={maxCat} />
              ))}
            </View>
          )}

          {/* Lista movimenti */}
          <View style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={s.cardTitle}>MOVIMENTI ({(movimenti as any[]).length})</Text>
              <Text style={{ fontSize: 9, color: COLORS.subtext }}>Tocca per cambiare cat.</Text>
            </View>
            {isLoading
              ? <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 20 }} />
              : (movimenti as any[]).length === 0
                ? <Text style={s.empty}>Nessun movimento trovato</Text>
                : (movimenti as any[]).map((item: any) => (
                    <MovRow
                      key={item.id}
                      item={item}
                      onEditCategoria={setEditMov}
                    />
                  ))
            }
          </View>

        </View>
      </ScrollView>

      {/* Modale categoria */}
      <CategoriaModal
        visible={!!editMov}
        categorie={categorie as any[]}
        onSelect={handleSelectCategoria}
        onClose={() => setEditMov(null)}
      />
    </>
  );
}

// ── Stili modale ────────────────────────────────────────
const cm = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#0D1525',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingBottom: 40,
    maxHeight: '75%',
    borderTopWidth: 1,
    borderColor: '#1E3A5F',
  },
  handle: {
    width: 36, height: 4,
    backgroundColor: '#334155',
    borderRadius: 2,
    alignSelf: 'center',
    marginVertical: 10,
  },
  title:    { fontSize: 13, fontWeight: '800', color: '#E2E8F0', marginBottom: 12, letterSpacing: 1 },
  item:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#1E3A5F' },
  dot:      { width: 8, height: 8, borderRadius: 4 },
  itemText: { fontSize: 13, color: '#E2E8F0', fontWeight: '600', flex: 1 },
});

// ── Stili screen ─────────────────────────────────────────
const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: COLORS.bg },
  body:       { padding: 16 },

  saldoCard:  { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  saldoRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  saldoLabel: { fontSize: 9, color: COLORS.subtext, fontWeight: '700', letterSpacing: 1, marginBottom: 2 },
  saldoVal:   { fontSize: 13, fontWeight: '800', color: COLORS.text },

  meseSel:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.surface, borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border },
  meseText:   { flex: 1, color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  mesiGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  mesiBtn:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border },
  mesiBtnActive: { backgroundColor: '#0C1F35', borderColor: COLORS.primary },
  mesiBtnText:   { fontSize: 11, color: COLORS.subtext, fontWeight: '600' },
  mesiBtnTextActive: { color: COLORS.primary },

  tabs:       { flexDirection: 'row', gap: 8, paddingHorizontal: 0 },
  tab:        { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center' },
  tabActive:  { backgroundColor: '#0C1F35', borderColor: COLORS.primary },
  tabText:    { fontSize: 11, color: COLORS.subtext, fontWeight: '700' },
  tabTextActive: { color: COLORS.primary },

  kpiRow:     { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi:        { flex: 1, backgroundColor: COLORS.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: COLORS.border },
  kpiLabel:   { fontSize: 9, color: COLORS.subtext, fontWeight: '700', letterSpacing: 1, marginBottom: 3 },
  kpiVal:     { fontSize: 13, fontWeight: '800' },

  card:       { backgroundColor: COLORS.surface, borderRadius: 10, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border },
  cardTitle:  { fontSize: 9, color: COLORS.subtext, fontWeight: '800', letterSpacing: 2 },

  catRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  catIcon:    { width: 26, height: 26, borderRadius: 13, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
  catLabelRow:{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  catNome:    { fontSize: 11, color: COLORS.text, fontWeight: '600' },
  catImporto: { fontSize: 11, fontWeight: '700' },
  barBg:      { height: 4, backgroundColor: COLORS.border, borderRadius: 2, overflow: 'hidden' },
  barFill:    { height: 4, borderRadius: 2 },
  catCount:   { fontSize: 10, color: COLORS.subtext, width: 22, textAlign: 'right' },

  movRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border + '44' },
  movIcon:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  movCenter:  { flex: 1 },
  movDesc:    { fontSize: 12, color: COLORS.text, fontWeight: '600', marginBottom: 3 },
  movData:    { fontSize: 10, color: COLORS.subtext },
  movConto:   { fontSize: 9, color: COLORS.subtext + 'CC', fontStyle: 'italic' },
  catBadge:   { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  catBadgeText: { fontSize: 9, fontWeight: '700' },
  movCartaBadge: { fontSize: 8, color: '#22D3EE', fontWeight: '800', borderWidth: 1, borderColor: '#22D3EE', paddingHorizontal: 3, borderRadius: 2 },
  movImporto: { fontSize: 13, fontWeight: '700', minWidth: 80, textAlign: 'right' },

  empty:      { color: COLORS.subtext, fontSize: 12, textAlign: 'center', paddingVertical: 20 },
});
