/**
 * FinanceChart — grafico lineare SVG custom.
 * Asse Y sempre parametrizzato al range reale dei dati.
 * Asse X con date formattate, spaziatura automatica.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Path, Line, Text as SvgText, Defs, LinearGradient, Stop, Rect,
} from 'react-native-svg';
import { COLORS } from '../utils/format';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ChartPoint {
  value: number;
  label: string;
}

interface Props {
  points: ChartPoint[];
  width: number;
  height?: number;
  color?: string;
  formatY?: (v: number) => string;
  showGradient?: boolean;
  yLevels?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function fmtYValue(v: number): string {
  if (!isFinite(v)) return '—';
  const abs = Math.abs(v);
  const s   = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${s}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${s}${(abs / 1_000).toFixed(abs < 10_000 ? 1 : 0)}k`;
  return `${s}${abs.toFixed(0)}`;
}

function safeNum(v: number, fallback = 0): number {
  return isFinite(v) && !isNaN(v) ? v : fallback;
}

function niceStep(rawStep: number): number {
  if (!isFinite(rawStep) || rawStep <= 0) return 1;
  const mag  = Math.pow(10, Math.floor(Math.log10(rawStep)));
  if (!isFinite(mag) || mag === 0) return 1;
  const frac = rawStep / mag;
  if (frac <= 1)  return mag;
  if (frac <= 2)  return 2 * mag;
  if (frac <= 5)  return 5 * mag;
  return 10 * mag;
}

function niceYRange(vals: number[], levels: number) {
  // Filtra valori non validi
  const clean = vals.filter(v => isFinite(v) && !isNaN(v));
  if (clean.length === 0) return { yMin: -1, yMax: 1 };

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (min === max) return { yMin: min - 1, yMax: max + 1 };

  const rawStep = (max - min) / Math.max(levels - 1, 1);
  const step    = niceStep(rawStep);
  const yMin    = Math.floor(min / step) * step;
  const yMax    = Math.ceil(max  / step) * step;

  // Ultima difesa: se per floating point yMin >= yMax usa valori diretti
  if (yMax <= yMin) return { yMin: min - Math.abs(min) * 0.05 - 1, yMax: max + Math.abs(max) * 0.05 + 1 };
  return { yMin, yMax };
}

function smoothPath(pts: { x: number; y: number }[]): string {
  const valid = pts.filter(p => isFinite(p.x) && isFinite(p.y) && !isNaN(p.x) && !isNaN(p.y));
  if (valid.length < 2) return '';
  let d = `M ${valid[0].x.toFixed(1)} ${valid[0].y.toFixed(1)}`;
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1];
    const curr = valid[i];
    const cpX  = ((prev.x + curr.x) / 2).toFixed(1);
    d += ` C ${cpX} ${prev.y.toFixed(1)} ${cpX} ${curr.y.toFixed(1)} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  return d;
}

// ─── Component ───────────────────────────────────────────────────────────────

const PAD = { top: 12, right: 10, bottom: 28, left: 62 };

export default function FinanceChart({
  points,
  width,
  height    = 190,
  color     = COLORS.primary,
  formatY   = fmtYValue,
  showGradient = true,
  yLevels   = 5,
}: Props) {

  const chartW = Math.max(width  - PAD.left - PAD.right,  10);
  const chartH = Math.max(height - PAD.top  - PAD.bottom, 10);

  const { coords, yMin, yMax, yTicks, xLabels } = useMemo(() => {
    if (!points || points.length < 2) {
      return { coords: [], yMin: 0, yMax: 0, yTicks: [], xLabels: [] };
    }

    const vals = points.map(p => (isFinite(p.value) && !isNaN(p.value) ? p.value : 0));
    const { yMin, yMax } = niceYRange(vals, yLevels);
    const range = yMax - yMin;

    const coords = points.map((p, i) => {
      const val = isFinite(p.value) && !isNaN(p.value) ? p.value : 0;
      return {
        x: safeNum(PAD.left + (i / (points.length - 1)) * chartW),
        y: safeNum(PAD.top  + (1 - (val - yMin) / range) * chartH, PAD.top + chartH / 2),
      };
    });

    const step   = range / Math.max(yLevels - 1, 1);
    const yTicks = Array.from({ length: yLevels }, (_, i) => yMin + i * step);

    const maxLabels = 6;
    const lStep     = Math.max(1, Math.ceil(points.length / maxLabels));
    const xLabels   = points
      .map((p, i) => ({
        label: p.label,
        x: safeNum(PAD.left + (i / (points.length - 1)) * chartW),
        show: i % lStep === 0 || i === points.length - 1,
      }))
      .filter(l => l.show);

    return { coords, yMin, yMax, yTicks, xLabels };
  }, [points, chartW, chartH, yLevels]);

  if (!points || points.length < 2) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>Nessun dato disponibile</Text>
      </View>
    );
  }

  const linePath = smoothPath(coords);
  if (!linePath) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>Dati non validi</Text>
      </View>
    );
  }

  const lastC   = coords[coords.length - 1];
  const firstC  = coords[0];
  const fillPath = linePath
    + ` L ${lastC.x.toFixed(1)} ${(PAD.top + chartH).toFixed(1)}`
    + ` L ${firstC.x.toFixed(1)} ${(PAD.top + chartH).toFixed(1)} Z`;

  const safeColor = color && typeof color === 'string' ? color : COLORS.primary;
  const gradId    = `grad_${safeColor.replace(/[^a-zA-Z0-9]/g, '')}`;

  const range = yMax - yMin;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0"   stopColor={safeColor} stopOpacity="0.25" />
          <Stop offset="1"   stopColor={safeColor} stopOpacity="0.02" />
        </LinearGradient>
      </Defs>

      {/* Sfondo */}
      <Rect x={PAD.left} y={PAD.top} width={chartW} height={chartH}
        fill={COLORS.surface} rx={0} />

      {/* Linee orizzontali Y + etichette */}
      {yTicks.map((tick, i) => {
        const py = safeNum(PAD.top + (1 - (tick - yMin) / range) * chartH, PAD.top + chartH / 2);
        return (
          <React.Fragment key={i}>
            <Line
              x1={PAD.left} y1={py} x2={PAD.left + chartW} y2={py}
              stroke={COLORS.border} strokeWidth="0.8"
              strokeDasharray={i === 0 ? undefined : '3 4'}
              opacity={i === 0 ? 0.8 : 0.4}
            />
            <SvgText
              x={PAD.left - 6} y={py + 4}
              fontSize={9} fill={COLORS.subtext}
              textAnchor="end"
            >
              {formatY(tick)}
            </SvgText>
          </React.Fragment>
        );
      })}

      {/* Area fill */}
      {showGradient && <Path d={fillPath} fill={`url(#${gradId})`} />}

      {/* Linea principale */}
      <Path d={linePath} stroke={safeColor} strokeWidth="2" fill="none"
        strokeLinecap="round" strokeLinejoin="round" />

      {/* Punto corrente (ultimo) */}
      {isFinite(lastC.x) && isFinite(lastC.y) && (
        <Path
          d={`M ${lastC.x.toFixed(1)} ${lastC.y.toFixed(1)} m -5 0 a 5 5 0 1 0 10 0 a 5 5 0 1 0 -10 0`}
          fill={COLORS.surface} stroke={safeColor} strokeWidth="2"
        />
      )}

      {/* Etichette asse X */}
      {xLabels.map((l, i) => (
        <SvgText
          key={i}
          x={l.x}
          y={PAD.top + chartH + 18}
          fontSize={9} fill={COLORS.subtext}
          textAnchor="middle"
        >
          {l.label}
        </SvgText>
      ))}

      {/* Bordo sinistro asse Y */}
      <Line
        x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH}
        stroke={COLORS.border} strokeWidth="1"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  empty:     { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.subtext, fontSize: 12 },
});
