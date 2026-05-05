/**
 * MultiLineChart — grafico lineare SVG per 3 scenari sovrapposti.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line, Text as SvgText, Rect } from 'react-native-svg';
import { COLORS } from '../utils/format';
import { fmtYValue } from './FinanceChart';

export interface ScenarioLine {
  key: string;
  label: string;
  color: string;
  points: { label: string; value: number }[];
}

interface Props {
  lines: ScenarioLine[];
  width: number;
  height?: number;
  yLevels?: number;
}

function safeNum(v: number, fallback = 0): number {
  return isFinite(v) && !isNaN(v) ? v : fallback;
}

function niceStep(rawStep: number): number {
  if (!isFinite(rawStep) || rawStep <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  if (!isFinite(mag) || mag === 0) return 1;
  const frac = rawStep / mag;
  if (frac <= 1) return mag;
  if (frac <= 2) return 2 * mag;
  if (frac <= 5) return 5 * mag;
  return 10 * mag;
}

function smoothPath(pts: { x: number; y: number }[]): string {
  const v = pts.filter(p => isFinite(p.x) && isFinite(p.y));
  if (v.length < 2) return '';
  let d = `M ${v[0].x.toFixed(1)} ${v[0].y.toFixed(1)}`;
  for (let i = 1; i < v.length; i++) {
    const prev = v[i - 1];
    const curr = v[i];
    const cpX = ((prev.x + curr.x) / 2).toFixed(1);
    d += ` C ${cpX} ${prev.y.toFixed(1)} ${cpX} ${curr.y.toFixed(1)} ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
  }
  return d;
}

const PAD = { top: 12, right: 10, bottom: 28, left: 62 };

export default function MultiLineChart({ lines, width, height = 220, yLevels = 5 }: Props) {
  const chartW = Math.max(width - PAD.left - PAD.right, 10);
  const chartH = Math.max(height - PAD.top - PAD.bottom, 10);

  const { allCoords, yMin, yMax, yTicks, xLabels, range } = useMemo(() => {
    if (!lines || lines.length === 0) return { allCoords: [], yMin: 0, yMax: 0, yTicks: [], xLabels: [], range: 1 };

    const allVals = lines.flatMap(l => l.points.map(p => p.value)).filter(v => isFinite(v));
    if (allVals.length === 0) return { allCoords: [], yMin: 0, yMax: 0, yTicks: [], xLabels: [], range: 1 };

    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const rawStep = (maxV - minV) / Math.max(yLevels - 1, 1);
    const step = niceStep(rawStep || 1);
    const yMin = Math.floor(minV / step) * step;
    const yMax = Math.ceil(maxV / step) * step;
    const range = yMax - yMin || 1;

    const nPoints = lines[0].points.length;

    const allCoords = lines.map(line => ({
      key: line.key,
      color: line.color,
      label: line.label,
      coords: line.points.map((p, i) => ({
        x: safeNum(PAD.left + (i / (nPoints - 1)) * chartW),
        y: safeNum(PAD.top + (1 - (p.value - yMin) / range) * chartH, PAD.top + chartH / 2),
      })),
    }));

    const yTicks = Array.from({ length: yLevels }, (_, i) => yMin + i * step);

    const maxLabels = 7;
    const lStep = Math.max(1, Math.ceil(nPoints / maxLabels));
    const xLabels = lines[0].points
      .map((p, i) => ({
        label: p.label,
        x: safeNum(PAD.left + (i / (nPoints - 1)) * chartW),
        show: i % lStep === 0 || i === nPoints - 1,
      }))
      .filter(l => l.show);

    return { allCoords, yMin, yMax, yTicks, xLabels, range };
  }, [lines, chartW, chartH, yLevels]);

  if (!lines || lines.length === 0) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>Nessun dato disponibile</Text>
      </View>
    );
  }

  return (
    <Svg width={width} height={height}>
      <Rect x={PAD.left} y={PAD.top} width={chartW} height={chartH} fill={COLORS.surface} />

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
            <SvgText x={PAD.left - 6} y={py + 4} fontSize={9} fill={COLORS.subtext} textAnchor="end">
              {fmtYValue(tick)}
            </SvgText>
          </React.Fragment>
        );
      })}

      {allCoords.map(({ key, color, coords }) => {
        const path = smoothPath(coords);
        if (!path) return null;
        const last = coords[coords.length - 1];
        return (
          <React.Fragment key={key}>
            <Path d={path} stroke={color} strokeWidth="2" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
            {isFinite(last.x) && isFinite(last.y) && (
              <Path
                d={`M ${last.x.toFixed(1)} ${last.y.toFixed(1)} m -4 0 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0`}
                fill={COLORS.surface} stroke={color} strokeWidth="2"
              />
            )}
          </React.Fragment>
        );
      })}

      {xLabels.map((l, i) => (
        <SvgText key={i} x={l.x} y={PAD.top + chartH + 18} fontSize={9} fill={COLORS.subtext} textAnchor="middle">
          {l.label}
        </SvgText>
      ))}

      <Line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + chartH} stroke={COLORS.border} strokeWidth="1" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  empty:     { alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.subtext, fontSize: 12 },
});
