import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

const TOKEN_KEY = 'access_token';
const AUTH_KEY  = 'auth_state';

const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') return localStorage.getItem(TOKEN_KEY);
  return SecureStore.getItemAsync(TOKEN_KEY);
};

const setToken = async (token: string): Promise<void> => {
  if (Platform.OS === 'web') { localStorage.setItem(TOKEN_KEY, token); return; }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
};

const deleteToken = async (): Promise<void> => {
  if (Platform.OS === 'web') { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(AUTH_KEY); return; }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
};

export const saveAuthState = (auth: { token: string; utente_id: string; nome: string }): void => {
  if (Platform.OS === 'web') localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
};

export const loadAuthState = (): { token: string; utente_id: string; nome: string } | null => {
  if (Platform.OS === 'web') {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  }
  return null;
};

const api = axios.create({ baseURL: API_BASE });

// Intercetta ogni request e aggiunge il token JWT
api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Intercetta 401: pulisce il token e forza il re-login
// Escludi le rotte /auth/ per evitare reload su errori di codice TOTP o credenziali errate
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const url: string = error.config?.url || '';
    const isAuthRoute = url.includes('/auth/');
    if (error.response?.status === 401 && !isAuthRoute) {
      await deleteToken();
      if (Platform.OS === 'web') {
        window.location.reload();
      }
    }
    return Promise.reject(error);
  }
);

// ── AUTH ─────────────────────────────────────────────
export const login = async (email: string, password: string) => {
  const form = new FormData();
  form.append('username', email);
  form.append('password', password);
  const { data } = await api.post('/auth/login', form);
  // Se NON richiede 2FA, salva subito il token
  if (!data.requires_2fa && data.access_token) {
    await setToken(data.access_token);
    saveAuthState({ token: data.access_token, utente_id: data.utente_id, nome: data.nome });
  }
  return data; // il chiamante decide cosa fare se requires_2fa
};

export const logout = async () => {
  await deleteToken();
};

export const loginTotp = async (tempToken: string, totpCode: string) => {
  const { data } = await api.post('/auth/login-totp', { temp_token: tempToken, totp_code: totpCode });
  await setToken(data.access_token);
  saveAuthState({ token: data.access_token, utente_id: data.utente_id, nome: data.nome });
  return data;
};

export const setup2fa = () =>
  api.post('/auth/setup-2fa').then(r => r.data);

export const enable2fa = (totp_code: string) =>
  api.post('/auth/enable-2fa', { totp_code }).then(r => r.data);

export const disable2fa = (password: string) =>
  api.post('/auth/disable-2fa', { password }).then(r => r.data);

export const get2faStatus = () =>
  api.get('/auth/2fa-status').then(r => r.data);

// ── PORTAFOGLIO ───────────────────────────────────────
export const getPortafoglio = () =>
  api.get('/portafoglio/').then(r => r.data);

export const getStoricoPostazione = (id: string) =>
  api.get(`/portafoglio/${id}/storico`).then(r => r.data);

export const aggiornaPrezzi = () =>
  api.post('/portafoglio/aggiorna-prezzi').then(r => r.data);

export const setPrezzoManuale = (id: string, prezzo: number) =>
  api.post(`/portafoglio/${id}/prezzo-manuale`, { prezzo }).then(r => r.data);

export const backfillPrezzi = (range: string = '1y') =>
  api.post(`/portafoglio/backfill-prezzi?range=${range}`).then(r => r.data);

export const getStoricoPosizioneById = (id: string) =>
  api.get(`/portafoglio/${id}/storico`).then(r => r.data);

// ── CONTI ─────────────────────────────────────────────
export const getConti = () =>
  api.get('/conti/').then(r => r.data);

export const aggiornaSaldo = (id: string, saldo: number) =>
  api.post(`/conti/${id}/saldo`, { saldo }).then(r => r.data);

// ── MUTUI ─────────────────────────────────────────────
export const getMutui = () =>
  api.get('/mutui/').then(r => r.data);

export const getPianoAmmortamento = (id: string) =>
  api.get(`/mutui/${id}/piano`).then(r => r.data);

export const completaPianoMutuo = (id: string) =>
  api.post(`/mutui/${id}/completa-piano`).then(r => r.data);

// ── PATRIMONIO ────────────────────────────────────────
export const getPatrimonioCorrente = () =>
  api.get('/patrimonio/corrente').then(r => r.data);

export const getStoricoPatrimonio = () =>
  api.get('/patrimonio/storico').then(r => r.data);

export const getStoricoPortafoglio = () =>
  api.get('/portafoglio/storico-portafoglio').then(r => r.data);

export const getUltimoAggiornamento = () =>
  api.get('/portafoglio/ultimo-aggiornamento').then(r => r.data);

// ── IMMOBILI ──────────────────────────────────────────
export const getImmobili = () =>
  api.get('/immobili/').then(r => r.data);

// ── OROLOGI ───────────────────────────────────────────
export const getOrologi = () =>
  api.get('/orologi/').then(r => r.data);

// ── MOVIMENTI ─────────────────────────────────────────
export const getMovimenti = (params?: { mese?: string }) =>
  api.get('/movimenti/', { params }).then(r => r.data);

export const addMovimento = (data: any) =>
  api.post('/movimenti/', data).then(r => r.data);

// ── IMPORT CSV ────────────────────────────────────────
const importCSV = async (entity: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post(`/importa/${entity}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
};

export const importaFinecoPortafoglio = (f: File) => importCSV('fineco-portafoglio', f);
export const importaFinecoConto      = (f: File) => importCSV('fineco-conto', f);
export const importaConti           = (f: File) => importCSV('conti', f);
export const importaMutui           = (f: File) => importCSV('mutui', f);
export const importaPianoAmmortamento = (f: File) => importCSV('piano-ammortamento', f);
export const importaImmobili        = (f: File) => importCSV('immobili', f);
export const importaPortafoglio     = (f: File) => importCSV('portafoglio', f);
export const importaOrologi         = (f: File) => importCSV('orologi', f);
export const importaMovimenti       = (f: File) => importCSV('movimenti', f);

// ── ANALISI MUTUO ─────────────────────────────────────
export const getAnalisiAnnuale = (id: string) =>
  api.get(`/mutui/${id}/analisi-annuale`).then(r => r.data);

// ── IMPORT UNICREDIT ──────────────────────────────────
export const importaUnicreditConto  = (f: File) => importCSV('unicredit-conto', f);
export const importaUnicreditCarta  = (f: File) => importCSV('unicredit-carta', f);
// ── IMPORT CRÉDIT AGRICOLE ────────────────────────────
export const importaCaMutuo = (f: File) => {
  const form = new FormData();
  form.append('file', f);
  return api.post('/importa/ca-mutuo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

// ── IMPORT REVOLUT ────────────────────────────────────────────────────────────
export const importaRevolutConto    = (f: File) => importCSV('revolut-conto', f);
export const importaRevolutDeposito = (f: File) => importCSV('revolut-deposito', f);

export const importaUnicreditMutuo  = (f: File) => {
  const form = new FormData();
  form.append('file', f);
  return api.post('/importa/unicredit-mutuo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
};

// ── FONDI PENSIONE ────────────────────────────────────
export const getFondiPensione = () =>
  api.get('/fondi-pensione/').then(r => r.data);

export const createFondoPensione = (data: { nome: string; tipo?: string; note?: string }) =>
  api.post('/fondi-pensione/', data).then(r => r.data);

export const addFondoPensioneSnapshot = (fondoId: string, data: {
  data_riferimento: string;
  saldo_individuale: number;
  tfr_maturato: number;
  totale_posizione: number;
  versamenti_ytd?: number;
  risultato_esercizio?: number;
  anzianita_anni: number;
  anzianita_mesi: number;
  anzianita_giorni?: number;
  fonte?: string;
  note?: string;
}) => api.post(`/fondi-pensione/${fondoId}/snapshot`, data).then(r => r.data);

export const getRegoleAccessoFondo = () =>
  api.get('/fondi-pensione/regole-accesso').then(r => r.data);

// ── PROIEZIONE ────────────────────────────────────────
export const getScenariProiezione = () =>
  api.get('/proiezione/scenari').then(r => r.data);

// ── ALERT ─────────────────────────────────────────────
export const getAlert = () =>
  api.get('/alert/').then(r => r.data);

// ── OBIETTIVI ─────────────────────────────────────────
export const getObiettivi = () =>
  api.get('/obiettivi/').then(r => r.data);

export const createObiettivo = (data: {
  nome: string;
  descrizione?: string;
  tipo?: string;
  target_importo?: number;
  target_data: string;
}) => api.post('/obiettivi/', data).then(r => r.data);

export const deleteObiettivo = (id: string) =>
  api.delete(`/obiettivi/${id}`).then(r => r.data);

// ── NEWS & MERCATI ────────────────────────────────────
export const getNews = () =>
  api.get('/news/').then(r => r.data);

export const getDailyBriefing = () =>
  api.post('/news/daily-briefing').then(r => r.data);

export const translateNews = (items: Array<{ titolo: string; sommario: string }>) =>
  api.post('/news/translate', { items }).then(r => r.data);

// ── AI ADVISOR ────────────────────────────────────────
export const getAnalisiAdvisor = () =>
  api.post('/advisor/analisi').then(r => r.data);

export const sendAdvisorMessage = (
  message: string,
  history: Array<{ role: string; content: string }>,
) => api.post('/advisor/chat', { message, history }).then(r => r.data);

export default api;
