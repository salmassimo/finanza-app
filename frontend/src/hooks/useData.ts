import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getPortafoglio, getStoricoPatrimonio, getPatrimonioCorrente,
  getConti, getMutui, getImmobili, getOrologi, getMovimenti,
  aggiornaPrezzi, aggiornaSaldo, getStoricoPortafoglio, getUltimoAggiornamento,
  backfillPrezzi, getStoricoPosizioneById,
  getFondiPensione, getRegoleAccessoFondo, addFondoPensioneSnapshot,
  getScenariProiezione, getAlert, getObiettivi, createObiettivo, deleteObiettivo,
} from '../services/api';

export const usePortafoglio = () =>
  useQuery({ queryKey: ['portafoglio'], queryFn: getPortafoglio, staleTime: 5 * 60 * 1000 });

export const useStoricoPortafoglio = () =>
  useQuery({ queryKey: ['storico-portafoglio'], queryFn: getStoricoPortafoglio });

export const useUltimoAggiornamento = () =>
  useQuery({ queryKey: ['ultimo-aggiornamento'], queryFn: getUltimoAggiornamento, staleTime: 0 });

export const useStoricoPosizione = (id: string | null) =>
  useQuery({
    queryKey: ['storico-posizione', id],
    queryFn: () => getStoricoPosizioneById(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

export const usePatrimonioCorrente = () =>
  useQuery({ queryKey: ['patrimonio'], queryFn: getPatrimonioCorrente });

export const useStoricoPatrimonio = () =>
  useQuery({ queryKey: ['patrimonio-storico'], queryFn: getStoricoPatrimonio });

export const useConti = () =>
  useQuery({ queryKey: ['conti'], queryFn: getConti });

export const useMutui = () =>
  useQuery({ queryKey: ['mutui'], queryFn: getMutui });

export const useImmobili = () =>
  useQuery({ queryKey: ['immobili'], queryFn: getImmobili });

export const useOrologi = () =>
  useQuery({ queryKey: ['orologi'], queryFn: getOrologi });

export const useMovimenti = (mese?: string) =>
  useQuery({ queryKey: ['movimenti', mese], queryFn: () => getMovimenti({ mese }) });

export const useAggiornaPrezzi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: aggiornaPrezzi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portafoglio'] });
      qc.invalidateQueries({ queryKey: ['storico-portafoglio'] });
      qc.invalidateQueries({ queryKey: ['ultimo-aggiornamento'] });
      qc.invalidateQueries({ queryKey: ['patrimonio'] });
      qc.invalidateQueries({ queryKey: ['patrimonio-live'] }); // OverviewScreen + PatrimonioScreen
    },
  });
};

export const useBackfillPrezzi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (range: string) => backfillPrezzi(range),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portafoglio'] });
      qc.invalidateQueries({ queryKey: ['storico-portafoglio'] });
      qc.invalidateQueries({ queryKey: ['storico-posizione'] });
      qc.invalidateQueries({ queryKey: ['ultimo-aggiornamento'] });
      qc.invalidateQueries({ queryKey: ['patrimonio'] });
      qc.invalidateQueries({ queryKey: ['patrimonio-live'] }); // OverviewScreen + PatrimonioScreen
    },
  });
};

export const useFondiPensione = () =>
  useQuery({ queryKey: ['fondi-pensione'], queryFn: getFondiPensione, staleTime: 5 * 60 * 1000 });

export const useRegoleAccessoFondo = () =>
  useQuery({ queryKey: ['regole-accesso-fondo'], queryFn: getRegoleAccessoFondo, staleTime: 60 * 60 * 1000 });

export const useAddFondoPensioneSnapshot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fondoId, data }: { fondoId: string; data: Parameters<typeof addFondoPensioneSnapshot>[1] }) =>
      addFondoPensioneSnapshot(fondoId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fondi-pensione'] }),
  });
};

export const useProiezione = () =>
  useQuery({ queryKey: ['proiezione'], queryFn: getScenariProiezione, staleTime: 10 * 60 * 1000 });

export const useAlert = () =>
  useQuery({ queryKey: ['alert'], queryFn: getAlert, staleTime: 5 * 60 * 1000 });

export const useObiettivi = () =>
  useQuery({ queryKey: ['obiettivi'], queryFn: getObiettivi, staleTime: 5 * 60 * 1000 });

export const useAddObiettivo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof createObiettivo>[0]) => createObiettivo(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['obiettivi'] }),
  });
};

export const useDeleteObiettivo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteObiettivo(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['obiettivi'] }),
  });
};

export const useAggiornaSaldo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, saldo }: { id: string; saldo: number }) => aggiornaSaldo(id, saldo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conti'] });
      qc.invalidateQueries({ queryKey: ['patrimonio'] });
    },
  });
};
