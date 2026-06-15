import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  ActivityIndicator, Linking, RefreshControl, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { COLORS } from '../utils/format';
import { getNews, getDailyBriefing, translateNews } from '../services/api';

// ─── Tipi ────────────────────────────────────────────────────────────────────────
interface NewsItem {
  fonte: string; area: string; categoria: string;
  titolo: string; sommario: string; link: string; pubblicato?: string;
}
interface NewsResponse { items: NewsItem[]; aggiornato: string; n_fonti_ok: number; n_fonti_errore: number; }

interface BriefingAction { titolo: string; dettaglio: string; urgenza: string; tipo: string; }
interface Briefing {
  data: string; sentiment: string; sintesi: string;
  rischi_geopolitici: string[]; impatto_portafoglio: string;
  azioni: BriefingAction[]; fonti_usate: string[];
}

// ─── Helper UI ──────────────────────────────────────────────────────────────────
const SENTIMENT = {
  positivo: { color: COLORS.success, icon: 'trending-up',   label: 'POSITIVO' },
  neutro:   { color: COLORS.warning, icon: 'remove',        label: 'NEUTRO' },
  negativo: { color: COLORS.danger,  icon: 'trending-down', label: 'NEGATIVO' },
} as const;

const URGENZA_COLOR: Record<string, string> = {
  alta: COLORS.danger, media: COLORS.warning, bassa: COLORS.subtext,
};
const TIPO_ICON: Record<string, string> = {
  comprare: 'add-circle', vendere: 'remove-circle', monitorare: 'eye',
  ribilanciare: 'swap-horizontal', informarsi: 'information-circle',
};

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'ora';
  if (min < 60) return `${min}m fa`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h fa`;
  return `${Math.floor(h / 24)}g fa`;
}

const openLink = (url: string) => {
  if (!url) return;
  if (Platform.OS === 'web') window.open(url, '_blank');
  else Linking.openURL(url);
};

// ─── Briefing AI ────────────────────────────────────────────────────────────────
function BriefingCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await getDailyBriefing();
      setBriefing(data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Errore generazione briefing.');
    } finally {
      setLoading(false);
    }
  }, []);

  const sent = briefing ? (SENTIMENT[briefing.sentiment as keyof typeof SENTIMENT] || SENTIMENT.neutro) : null;

  return (
    <View style={styles.briefCard}>
      <View style={styles.briefHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={styles.briefIcon}>
            <Ionicons name="sparkles" size={16} color={COLORS.primary} />
          </View>
          <View>
            <Text style={styles.briefTitle}>BRIEFING GIORNALIERO</Text>
            <Text style={styles.briefSub}>Portafoglio · Notizie · Geopolitica</Text>
          </View>
        </View>
        {sent && (
          <View style={[styles.sentBadge, { borderColor: sent.color + '66', backgroundColor: sent.color + '20' }]}>
            <Ionicons name={sent.icon as any} size={12} color={sent.color} />
            <Text style={[styles.sentText, { color: sent.color }]}>{sent.label}</Text>
          </View>
        )}
      </View>

      {!briefing && !loading && (
        <TouchableOpacity style={styles.generateBtn} onPress={run}>
          <Ionicons name="flash" size={18} color="#fff" />
          <Text style={styles.generateText}>Genera briefing di oggi</Text>
        </TouchableOpacity>
      )}

      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={COLORS.primary} />
          <Text style={styles.loadingText}>Analisi notizie e portafoglio in corso…</Text>
        </View>
      )}

      {error && <Text style={styles.errorText}>⚠️ {error}</Text>}

      {briefing && !loading && (
        <View style={{ gap: 14 }}>
          <Text style={styles.briefDate}>📅 {briefing.data}</Text>
          <Text style={styles.sintesi}>{briefing.sintesi}</Text>

          {/* Impatto portafoglio */}
          {!!briefing.impatto_portafoglio && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="pie-chart-outline" size={13} color={COLORS.primary} />
                <Text style={[styles.sectionTitle, { color: COLORS.primary }]}>IMPATTO SUL PORTAFOGLIO</Text>
              </View>
              <Text style={styles.bodyText}>{briefing.impatto_portafoglio}</Text>
            </View>
          )}

          {/* Rischi geopolitici */}
          {briefing.rischi_geopolitici.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="earth-outline" size={13} color={COLORS.danger} />
                <Text style={[styles.sectionTitle, { color: COLORS.danger }]}>RISCHI GEOPOLITICI</Text>
              </View>
              {briefing.rischi_geopolitici.map((r, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Text style={[styles.bulletDot, { color: COLORS.danger }]}>▶</Text>
                  <Text style={styles.bulletText}>{r}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Azioni */}
          {briefing.azioni.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Ionicons name="list-outline" size={13} color={COLORS.success} />
                <Text style={[styles.sectionTitle, { color: COLORS.success }]}>AZIONI DA VALUTARE OGGI</Text>
              </View>
              {briefing.azioni.map((a, i) => {
                const uc = URGENZA_COLOR[a.urgenza] || COLORS.subtext;
                return (
                  <View key={i} style={styles.actionCard}>
                    <View style={styles.actionTop}>
                      <Ionicons name={(TIPO_ICON[a.tipo] || 'ellipse') as any} size={16} color={COLORS.primary} />
                      <Text style={styles.actionTitle}>{a.titolo}</Text>
                      <View style={[styles.urgBadge, { backgroundColor: uc + '22', borderColor: uc + '66' }]}>
                        <Text style={[styles.urgText, { color: uc }]}>{a.urgenza.toUpperCase()}</Text>
                      </View>
                    </View>
                    <Text style={styles.actionDetail}>{a.dettaglio}</Text>
                  </View>
                );
              })}
            </View>
          )}

          <Text style={styles.fonti}>Fonti: {briefing.fonti_usate.join(' · ')}</Text>
          <TouchableOpacity style={styles.rerunBtn} onPress={run}>
            <Ionicons name="refresh" size={14} color={COLORS.primary} />
            <Text style={styles.rerunText}>Rigenera</Text>
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            ⓘ Spunti informativi generati da AI sulle notizie del giorno. Non costituiscono consulenza finanziaria.
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Schermata ──────────────────────────────────────────────────────────────────
export default function NewsScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery<NewsResponse>({
    queryKey: ['news'],
    queryFn: getNews,
    staleTime: 5 * 60 * 1000,
  });

  const [filtro, setFiltro] = useState<'TUTTE' | 'IT' | 'INT'>('TUTTE');
  const items = (data?.items || []).filter(i => filtro === 'TUTTE' || i.area === filtro);

  // ── Traduzione automatica in italiano (solo notizie internazionali) ──
  const [tradotto, setTradotto] = useState(true);   // ON di default: traduzione automatica
  const [translating, setTranslating] = useState(false);
  const [trMap, setTrMap] = useState<Record<string, { titolo: string; sommario: string }>>({});

  // Traduce le notizie INT non ancora tradotte, a blocchi piccoli per evitare
  // risposte troncate (JSON non valido) → la UI si aggiorna progressivamente.
  const ensureTranslated = useCallback(async () => {
    const daTradurre = (data?.items || []).filter(i => i.area === 'INT' && i.link && !trMap[i.link]);
    if (daTradurre.length === 0) return;
    setTranslating(true);
    try {
      const CHUNK = 12;
      for (let off = 0; off < daTradurre.length; off += CHUNK) {
        const batch = daTradurre.slice(off, off + CHUNK);
        const res = await translateNews(batch.map(i => ({ titolo: i.titolo, sommario: i.sommario })));
        setTrMap(prev => {
          const map = { ...prev };
          batch.forEach((i, idx) => {
            const t = res.items?.[idx];
            if (t) map[i.link] = { titolo: t.titolo, sommario: t.sommario };
          });
          return map;
        });
      }
    } catch {
      // silenzioso: lascia l'originale
    } finally {
      setTranslating(false);
    }
  }, [data, trMap]);

  // Auto-traduzione all'arrivo delle notizie (se attiva)
  useEffect(() => {
    if (tradotto && !translating && data?.items?.length) ensureTranslated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tradotto]);

  const toggleTraduzione = useCallback(() => {
    setTradotto(v => !v);   // l'effetto sopra tradurrà se serve
  }, []);

  const display = (n: NewsItem) =>
    tradotto && trMap[n.link] ? trMap[n.link] : { titolo: n.titolo, sommario: n.sommario };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={COLORS.primary} />}
    >
      <BriefingCard />

      {/* Filtri + traduzione */}
      <View style={styles.filterRow}>
        {(['TUTTE', 'IT', 'INT'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, filtro === f && styles.filterChipActive]}
            onPress={() => setFiltro(f)}
          >
            <Text style={[styles.filterText, filtro === f && styles.filterTextActive]}>
              {f === 'TUTTE' ? 'Tutte' : f === 'IT' ? '🇮🇹 Italia' : '🌍 Internazionali'}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.trBtn, tradotto && styles.trBtnActive]}
          onPress={toggleTraduzione}
          disabled={translating}
        >
          {translating
            ? <ActivityIndicator size="small" color={COLORS.primary} />
            : <Ionicons name="language" size={15} color={tradotto ? COLORS.primary : COLORS.subtext} />}
          <Text style={[styles.trText, tradotto && styles.trTextActive]}>
            {translating ? 'Traduco…' : tradotto ? 'Originale' : 'Traduci'}
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingBox}><ActivityIndicator color={COLORS.primary} size="large" /></View>
      ) : items.length === 0 ? (
        <Text style={styles.empty}>Nessuna notizia disponibile.</Text>
      ) : (
        items.map((n, i) => {
          const d = display(n);
          const isTr = tradotto && !!trMap[n.link];
          return (
            <TouchableOpacity key={i} style={styles.newsCard} onPress={() => openLink(n.link)}>
              <View style={styles.newsMeta}>
                <View style={[styles.areaBadge, { backgroundColor: (n.area === 'IT' ? COLORS.success : COLORS.primary) + '22' }]}>
                  <Text style={[styles.areaText, { color: n.area === 'IT' ? COLORS.success : COLORS.primary }]}>
                    {n.area === 'IT' ? '🇮🇹' : '🌍'} {n.fonte}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {isTr && <Text style={styles.trTag}>tradotto</Text>}
                  {!!n.pubblicato && <Text style={styles.newsTime}>{timeAgo(n.pubblicato)}</Text>}
                </View>
              </View>
              <Text style={styles.newsTitle}>{d.titolo}</Text>
              {!!d.sommario && <Text style={styles.newsSummary} numberOfLines={2}>{d.sommario}</Text>}
              <View style={styles.readMore}>
                <Text style={styles.readMoreText}>Leggi</Text>
                <Ionicons name="open-outline" size={12} color={COLORS.primary} />
              </View>
            </TouchableOpacity>
          );
        })
      )}

      {data && (
        <Text style={styles.footer}>
          {data.n_fonti_ok} fonti attive{data.n_fonti_errore > 0 ? ` · ${data.n_fonti_errore} non raggiungibili` : ''}
        </Text>
      )}
    </ScrollView>
  );
}

// ─── Stili ──────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  // Briefing
  briefCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.primary + '44', borderRadius: 14, padding: 16, marginBottom: 16 },
  briefHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  briefIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: COLORS.primary + '20', alignItems: 'center', justifyContent: 'center' },
  briefTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: COLORS.text },
  briefSub: { fontSize: 10, color: COLORS.subtext, marginTop: 1 },
  sentBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  sentText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  generateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 13 },
  generateText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  loadingBox: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  loadingText: { color: COLORS.subtext, fontSize: 12 },
  errorText: { color: COLORS.danger, fontSize: 13, paddingVertical: 8 },

  briefDate: { color: COLORS.subtext, fontSize: 12, fontWeight: '600' },
  sintesi: { color: COLORS.text, fontSize: 14, lineHeight: 21 },

  section: { gap: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  sectionTitle: { fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  bodyText: { color: COLORS.text, fontSize: 13, lineHeight: 20 },

  bulletRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 4 },
  bulletDot: { fontSize: 9, marginTop: 4 },
  bulletText: { flex: 1, color: COLORS.text, fontSize: 13, lineHeight: 19 },

  actionCard: { backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, marginBottom: 8 },
  actionTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 },
  actionTitle: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: '700' },
  urgBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  urgText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  actionDetail: { color: COLORS.subtext, fontSize: 12, lineHeight: 18 },

  fonti: { color: COLORS.subtext, fontSize: 10, fontStyle: 'italic' },
  rerunBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.primary + '66', borderRadius: 8, paddingVertical: 9 },
  rerunText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  disclaimer: { color: COLORS.subtext, fontSize: 10, lineHeight: 15, fontStyle: 'italic' },

  // Filtri
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterChip: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  filterChipActive: { backgroundColor: COLORS.primary + '22', borderColor: COLORS.primary },
  filterText: { color: COLORS.subtext, fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: COLORS.primary },
  trBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, minWidth: 96, justifyContent: 'center' },
  trBtnActive: { backgroundColor: COLORS.primary + '22', borderColor: COLORS.primary },
  trText: { color: COLORS.subtext, fontSize: 12, fontWeight: '700' },
  trTextActive: { color: COLORS.primary },
  trTag: { color: COLORS.primary, fontSize: 9, fontWeight: '700', fontStyle: 'italic' },

  // News
  newsCard: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 14, marginBottom: 10 },
  newsMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  areaBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  areaText: { fontSize: 10, fontWeight: '700' },
  newsTime: { color: COLORS.subtext, fontSize: 10 },
  newsTitle: { color: COLORS.text, fontSize: 14, fontWeight: '700', lineHeight: 20, marginBottom: 4 },
  newsSummary: { color: COLORS.subtext, fontSize: 12, lineHeight: 18 },
  readMore: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  readMoreText: { color: COLORS.primary, fontSize: 11, fontWeight: '700' },

  empty: { color: COLORS.subtext, textAlign: 'center', paddingVertical: 30 },
  footer: { color: COLORS.subtext, fontSize: 10, textAlign: 'center', marginTop: 10 },
});
