import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "./ui";

/**
 * Charts follow one rule set: a single brand hue per chart (every chart here shows one series, so the
 * title names it and no legend is needed), thin marks, recessive grid, one y-axis, and a hover tooltip.
 * Text always uses ink colours, never the series colour.
 */
const SERIES = "#33429b"; // brand-600
const GRID = "#e9ecf2";
const AXIS = { fontSize: 11, fill: "#64748b" };

type Point = { label: string; value: number };

function TooltipBox({ active, payload, label, format, name }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-pop">
      <p className="font-medium text-slate-900">{label}</p>
      <p className="mt-0.5 text-slate-600">
        {name}: <span className="font-semibold text-slate-900 tabular">{format(payload[0].value)}</span>
      </p>
    </div>
  );
}

export function BarSeries({ data, name, format = String, tickFormat = String, height = 220 }: { data: Point[]; name: string; format?: (v: number) => string; tickFormat?: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`${name}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={tickFormat} />
          <Tooltip cursor={{ fill: "#eef1fb" }} content={<TooltipBox format={format} name={name} />} />
          <Bar dataKey="value" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineSeries({ data, name, format = String, tickFormat = String, height = 220 }: { data: Point[]; name: string; format?: (v: number) => string; tickFormat?: (v: number) => string; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label={`${name}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} padding={{ left: 16, right: 16 }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={tickFormat} />
          <Tooltip cursor={{ stroke: "#bcc7ee", strokeWidth: 1 }} content={<TooltipBox format={format} name={name} />} />
          <Line type="monotone" dataKey="value" stroke={SERIES} strokeWidth={2} dot={{ r: 4, fill: SERIES, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Ranked horizontal bars with direct labels — used where the categories have long names. */
export function BarList({ rows, format = String, className }: { rows: { key: string; label: string; value: number; sub?: string }[]; format?: (v: number) => string; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className={cn("space-y-3", className)}>
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-slate-700">{r.label}</span>
            <span className="shrink-0 font-medium text-slate-900 tabular">
              {format(r.value)}
              {r.sub && <span className="ml-1.5 font-normal text-slate-500">{r.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden>
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
