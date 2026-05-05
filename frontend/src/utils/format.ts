const toNum = (n: any): number | null => {
  if (n === undefined || n === null) return null;
  const v = Number(n);
  return isNaN(v) ? null : v;
};

export const fmt = (n: any, decimals = 2): string => {
  const v = toNum(n);
  if (v === null) return '—';
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
};

export const fmtShort = (n: any): string => {
  const v = toNum(n);
  if (v === null) return '—';
  if (Math.abs(v) >= 1_000_000)
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 1 }).format(v / 1_000_000) + 'M';
  if (Math.abs(v) >= 1_000)
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  return fmt(v);
};

export const fmtPct = (n: any): string => {
  const v = toNum(n);
  if (v === null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
};

export const fmtDate = (d: string | undefined | null): string => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('it-IT');
};

export const colorPL = (n: any): string => {
  const v = toNum(n);
  if (v === null) return '#A8C4DC';
  return v >= 0 ? '#4ADE80' : '#F87171';
};

export const COLORS = {
  bg:       '#070B14',
  card:     '#0F1C2E',   // sfondo card (alias di surface)
  surface:  '#0F1C2E',
  border:   '#2A3F5A',
  primary:  '#38BDF8',
  success:  '#4ADE80',
  danger:   '#F87171',
  warning:  '#FCD34D',
  purple:   '#A78BFA',
  orange:   '#FB923C',
  text:     '#F1F5F9',
  subtext:  '#A8C4DC',
};
