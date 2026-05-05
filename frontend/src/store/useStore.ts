import { create } from 'zustand';

interface Posizione {
  id: string;
  simbolo: string;
  nome: string;
  tipo: string;
  piattaforma: string;
  quantita: number;
  prezzo_carico: number;
  valore_carico: number;
  prezzo_mercato?: number;
  valore_mercato?: number;
  var_eur?: number;
  var_pct?: number;
  aggiornato_al?: string;
}

interface Conto {
  id: string;
  nome: string;
  tipo: string;
  banca?: string;
  saldo?: number;
  aggiornato_al?: string;
}

interface Patrimonio {
  liquidita_totale: number;
  portafoglio_fineco: number;
  portafoglio_revolut: number;
  immobili_valore: number;
  orologi_valore: number;
  totale_asset: number;
  totale_passivo: number;
  patrimonio_netto: number;
  rilevato_at: string;
}

interface AuthState {
  token: string | null;
  utente_id: string | null;
  nome: string | null;
  isAuthenticated: boolean;
}

interface AppState {
  auth: AuthState;
  portafoglio: Posizione[];
  conti: Conto[];
  patrimonio: Patrimonio | null;
  isLoading: boolean;
  error: string | null;

  setAuth: (auth: AuthState) => void;
  clearAuth: () => void;
  setPortafoglio: (posizioni: Posizione[]) => void;
  setConti: (conti: Conto[]) => void;
  setPatrimonio: (p: Patrimonio) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  auth: { token: null, utente_id: null, nome: null, isAuthenticated: false },
  portafoglio: [],
  conti: [],
  patrimonio: null,
  isLoading: false,
  error: null,

  setAuth: (auth) => set({ auth }),
  clearAuth: () => set({ auth: { token: null, utente_id: null, nome: null, isAuthenticated: false } }),
  setPortafoglio: (portafoglio) => set({ portafoglio }),
  setConti: (conti) => set({ conti }),
  setPatrimonio: (patrimonio) => set({ patrimonio }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
}));
