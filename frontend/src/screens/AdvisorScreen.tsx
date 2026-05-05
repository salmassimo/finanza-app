import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../utils/format';
import { getAnalisiAdvisor, sendAdvisorMessage } from '../services/api';

// ─── Palette ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f172a', surface: '#1e293b', border: '#334155',
  text: '#f1f5f9', muted: '#94a3b8',
  accent: '#3b82f6', accentDark: '#1d4ed8',
  success: '#22c55e', warning: '#f59e0b', danger: '#ef4444',
  userBubble: '#2563eb', aiBubble: '#1e293b',
};

// ─── Types ───────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  loading?: boolean;
}

interface AnalysisData {
  sommario: string;
  punteggio_salute: number;
  valutazione: string;
  rischi: string[];
  consigli: string[];
  aree_risparmio: string[];
}

// ─── Quick actions ───────────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { icon: 'analytics-outline',      label: 'Analisi completa',      prompt: 'Fai un\'analisi completa della mia situazione finanziaria con punteggio di salute, rischi e consigli prioritizzati.' },
  { icon: 'wallet-outline',         label: 'Dove risparmio?',       prompt: 'Analizza le mie spese degli ultimi 3 mesi e dimmi concretamente dove posso risparmiare, con stime di quanto.' },
  { icon: 'trending-up-outline',    label: 'Ottimizza investimenti', prompt: 'Valuta il mio portafoglio investimenti: sono ben diversificato? Cosa posso migliorare? C\'è qualcosa da vendere o comprare?' },
  { icon: 'home-outline',           label: 'Analisi mutui',         prompt: 'Analizza i miei mutui: conviene fare estinzione anticipata parziale? C\'è margine di rinegoziazione del tasso?' },
  { icon: 'shield-checkmark-outline', label: 'Rischi finanziari',   prompt: 'Quali sono i principali rischi nella mia situazione finanziaria attuale? Come posso mitigarli?' },
  { icon: 'cash-outline',           label: 'Liquidità ottimale',    prompt: 'Ho la giusta quantità di liquidità rispetto al mio patrimonio? Quanto dovrei tenere liquido e quanto investire?' },
];

// ─── Sub-components ──────────────────────────────────────────────────────────────

function TypingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ])
      );
    Animated.parallel([anim(dot1, 0), anim(dot2, 200), anim(dot3, 400)]).start();
  }, []);

  const dotStyle = (dot: Animated.Value) => ({
    width: 7, height: 7, borderRadius: 4, backgroundColor: C.muted, marginHorizontal: 2,
    opacity: dot,
    transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
  });

  return (
    <View style={styles.typingContainer}>
      <View style={styles.aiBubble}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
          <Animated.View style={dotStyle(dot1)} />
          <Animated.View style={dotStyle(dot2)} />
          <Animated.View style={dotStyle(dot3)} />
        </View>
      </View>
    </View>
  );
}

function HealthGauge({ score }: { score: number }) {
  const color = score >= 70 ? C.success : score >= 40 ? C.warning : C.danger;
  const label = score >= 70 ? 'OTTIMA' : score >= 40 ? 'DISCRETA' : 'CRITICA';
  return (
    <View style={styles.gaugeWrap}>
      <View style={[styles.gaugeCircle, { borderColor: color }]}>
        <Text style={[styles.gaugeScore, { color }]}>{score}</Text>
        <Text style={[styles.gaugeLabel, { color }]}>{label}</Text>
      </View>
    </View>
  );
}

function AnalysisCard({ data, onClose }: { data: AnalysisData; onClose: () => void }) {
  return (
    <View style={styles.analysisCard}>
      <View style={styles.analysisHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="sparkles" size={16} color={C.accent} />
          <Text style={styles.analysisTitle}>ANALISI FINANZIARIA</Text>
        </View>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="close" size={20} color={C.muted} />
        </TouchableOpacity>
      </View>

      <View style={styles.analysisRow}>
        <HealthGauge score={data.punteggio_salute} />
        <Text style={styles.sommario}>{data.sommario}</Text>
      </View>

      {/* Aree risparmio */}
      {data.aree_risparmio.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="wallet-outline" size={13} color={C.warning} />
            <Text style={[styles.sectionTitle, { color: C.warning }]}>AREE DI RISPARMIO</Text>
          </View>
          {data.aree_risparmio.map((a, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={[styles.bulletDot, { color: C.warning }]}>▶</Text>
              <Text style={styles.bulletText}>{a}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Rischi */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="warning-outline" size={13} color={C.danger} />
          <Text style={[styles.sectionTitle, { color: C.danger }]}>RISCHI</Text>
        </View>
        {data.rischi.map((r, i) => (
          <View key={i} style={styles.bulletRow}>
            <View style={styles.riskNum}><Text style={styles.riskNumText}>{i+1}</Text></View>
            <Text style={styles.bulletText}>{r}</Text>
          </View>
        ))}
      </View>

      {/* Consigli */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="bulb-outline" size={13} color={C.success} />
          <Text style={[styles.sectionTitle, { color: C.success }]}>CONSIGLI PRIORITIZZATI</Text>
        </View>
        {data.consigli.map((c, i) => (
          <View key={i} style={styles.bulletRow}>
            <Ionicons name="checkmark-circle" size={14} color={C.success} style={{ marginTop: 2 }} />
            <Text style={styles.bulletText}>{c}</Text>
          </View>
        ))}
      </View>

      {/* Valutazione */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="document-text-outline" size={13} color={C.accent} />
          <Text style={[styles.sectionTitle, { color: C.accent }]}>ANALISI DETTAGLIATA</Text>
        </View>
        <Text style={styles.valutazione}>{data.valutazione}</Text>
      </View>
    </View>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  if (isSystem) {
    return (
      <View style={styles.systemMsg}>
        <Ionicons name="sparkles" size={14} color={C.accent} />
        <Text style={styles.systemText}>{msg.content}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAI]}>
      {!isUser && (
        <View style={styles.aiAvatar}>
          <Ionicons name="sparkles" size={14} color={C.accent} />
        </View>
      )}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble, { maxWidth: '80%' }]}>
        <Text style={[styles.bubbleText, isUser && { color: '#fff' }]}>{msg.content}</Text>
      </View>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────────
export default function AdvisorScreen() {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, []);

  // Messaggio di benvenuto
  useEffect(() => {
    setMessages([{
      id: 'welcome',
      role: 'system',
      content: 'Ciao! Sono il tuo AI Financial Advisor. Ho accesso alla tua situazione patrimoniale aggiornata e alle tue spese. Cosa vuoi sapere?',
    }]);
  }, []);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    scrollToBottom();

    // Costruisce history escludendo il messaggio di sistema iniziale
    const history = messages
      .filter(m => m.role !== 'system' && !m.loading)
      .map(m => ({ role: m.role as string, content: m.content }));

    try {
      const res = await sendAdvisorMessage(text.trim(), history);
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: res.response };
      setMessages(prev => [...prev, aiMsg]);
    } catch (e: any) {
      const errText = e?.response?.data?.detail || 'Errore di connessione. Riprova.';
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'assistant', content: `⚠️ ${errText}` }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [loading, messages, scrollToBottom]);

  const runFullAnalysis = useCallback(async () => {
    if (analysisLoading) return;
    setAnalysisLoading(true);
    setShowAnalysis(true);

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: 'Avvia analisi finanziaria completa' };
    setMessages(prev => [...prev, userMsg]);
    scrollToBottom();

    try {
      const data = await getAnalisiAdvisor();
      setAnalysisData(data);
      // Aggiunge un messaggio di riepilogo in chat
      const summary: Message = {
        id: (Date.now()+1).toString(),
        role: 'assistant',
        content: `📊 **Salute finanziaria: ${data.punteggio_salute}/100**\n\n${data.sommario}\n\nHo generato l'analisi completa con ${data.rischi.length} rischi identificati, ${data.consigli.length} consigli e ${data.aree_risparmio.length} aree di risparmio. Puoi vederla sopra o farmi domande specifiche.`,
      };
      setMessages(prev => [...prev, summary]);
    } catch (e: any) {
      const err = e?.response?.data?.detail || 'Errore durante l\'analisi.';
      setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'assistant', content: `⚠️ ${err}` }]);
    } finally {
      setAnalysisLoading(false);
      scrollToBottom();
    }
  }, [analysisLoading, scrollToBottom]);

  const isEmpty = messages.length <= 1; // solo il messaggio di benvenuto

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Ionicons name="sparkles" size={18} color={C.accent} />
          </View>
          <View>
            <Text style={styles.headerTitle}>AI Financial Advisor</Text>
            <Text style={styles.headerSub}>Analisi patrimoniale · Spese · Investimenti</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.analysisBtn, analysisLoading && { opacity: 0.6 }]}
          onPress={analysisData ? () => setShowAnalysis(v => !v) : runFullAnalysis}
          disabled={analysisLoading}
        >
          {analysisLoading
            ? <ActivityIndicator size="small" color={C.accent} />
            : <Ionicons name={showAnalysis && analysisData ? 'chevron-up' : 'analytics'} size={16} color={C.accent} />
          }
          <Text style={styles.analysisBtnText}>
            {analysisLoading ? 'Analisi…' : analysisData ? (showAnalysis ? 'Chiudi' : 'Report') : 'Analisi'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Analysis card (collapsible) */}
      {showAnalysis && analysisData && (
        <ScrollView style={styles.analysisScroll} contentContainerStyle={{ padding: 12 }}>
          <AnalysisCard data={analysisData} onClose={() => setShowAnalysis(false)} />
        </ScrollView>
      )}

      {/* Chat */}
      {!showAnalysis && (
        <ScrollView
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={scrollToBottom}
        >
          {/* Welcome + quick actions se chat vuota */}
          {isEmpty && (
            <View style={styles.quickActionsWrap}>
              <Text style={styles.quickActionsTitle}>Cosa vuoi sapere?</Text>
              <View style={styles.quickActionsGrid}>
                {QUICK_ACTIONS.map((qa, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.quickChip}
                    onPress={() => send(qa.prompt)}
                    disabled={loading}
                  >
                    <Ionicons name={qa.icon as any} size={16} color={C.accent} />
                    <Text style={styles.quickChipText}>{qa.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* CTA analisi completa */}
              <TouchableOpacity style={styles.analysisCtaBtn} onPress={runFullAnalysis} disabled={analysisLoading}>
                {analysisLoading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="analytics" size={18} color="#fff" />
                }
                <Text style={styles.analysisCtaText}>
                  {analysisLoading ? 'Analisi in corso…' : 'Genera Analisi Completa'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Messaggi */}
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}

          {/* Typing indicator */}
          {loading && <TypingDots />}
        </ScrollView>
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Fai una domanda sul tuo patrimonio…"
          placeholderTextColor={C.muted}
          multiline
          maxLength={500}
          onSubmitEditing={() => send(input)}
          blurOnSubmit={false}
          editable={!loading}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
        >
          <Ionicons name="send" size={18} color={(!input.trim() || loading) ? C.muted : '#fff'} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 14,
    backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon:  {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.accent + '20', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  headerSub:   { fontSize: 10, color: C.muted, marginTop: 1 },
  analysisBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: C.accent + '60',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  analysisBtnText: { fontSize: 12, fontWeight: '600', color: C.accent },

  analysisScroll: { flex: 1 },

  chatScroll:  { flex: 1 },
  chatContent: { padding: 16, paddingBottom: 12, gap: 12 },

  // Quick actions
  quickActionsWrap:  { marginBottom: 20 },
  quickActionsTitle: { fontSize: 14, fontWeight: '600', color: C.muted, marginBottom: 12, textAlign: 'center' },
  quickActionsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16 },
  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
  },
  quickChipText: { fontSize: 12, color: C.text, fontWeight: '500' },
  analysisCtaBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 10,
    paddingVertical: 14, paddingHorizontal: 20,
  },
  analysisCtaText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // Messages
  systemMsg: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.accent + '15', borderRadius: 10,
    padding: 12, borderLeftWidth: 3, borderLeftColor: C.accent,
  },
  systemText: { color: C.text, fontSize: 13, flex: 1, lineHeight: 19 },

  msgRow:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowUser: { justifyContent: 'flex-end' },
  msgRowAI:   { justifyContent: 'flex-start' },

  aiAvatar: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: C.accent + '20', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  bubble:     { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  userBubble: { backgroundColor: C.userBubble, borderBottomRightRadius: 4 },
  aiBubble:   { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 14, color: C.text, lineHeight: 20 },

  typingContainer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border,
  },
  input: {
    flex: 1, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10,
    color: C.text, fontSize: 14, maxHeight: 100,
  },
  sendBtn:         { width: 42, height: 42, borderRadius: 21, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },

  // Analysis card
  analysisCard: {
    backgroundColor: C.surface, borderRadius: 14,
    borderWidth: 1, borderColor: C.border, overflow: 'hidden',
  },
  analysisHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.accent + '10',
  },
  analysisTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 2, color: C.accent },
  analysisRow:   { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  sommario:      { flex: 1, fontSize: 13, color: C.text, lineHeight: 19 },

  gaugeWrap:    { alignItems: 'center' },
  gaugeCircle:  { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  gaugeScore:   { fontSize: 22, fontWeight: '900' },
  gaugeLabel:   { fontSize: 8, fontWeight: '800', letterSpacing: 1 },

  section: { paddingHorizontal: 16, paddingBottom: 14 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 8, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  sectionTitle: { fontSize: 9, fontWeight: '800', letterSpacing: 2, color: C.muted },

  bulletRow:     { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 7 },
  bulletDot:     { fontSize: 10, marginTop: 3, flexShrink: 0 },
  bulletText:    { fontSize: 13, color: C.text, flex: 1, lineHeight: 19 },
  riskNum:       { width: 20, height: 20, borderRadius: 10, backgroundColor: C.danger + '30', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  riskNumText:   { fontSize: 10, fontWeight: '800', color: C.danger },
  valutazione:   { fontSize: 13, color: C.text, lineHeight: 20 },
});
