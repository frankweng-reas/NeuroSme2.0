/** 圖表 Modal：支援 bar / pie / line，可切換圖表類型。使用 Recharts 實作 */
import { useEffect, useState, useCallback } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  DefaultLegendContent,
  Label,
} from 'recharts'

/** 圖表資料格式：支援 bar / pie / line */
export interface ChartData {
  chartType?: 'bar' | 'pie' | 'line'
  labels: string[]
  /** bar/line 使用；pie 使用 data */
  datasets?: { label: string; data: number[] }[]
  /** pie 專用：單一數值陣列 */
  data?: number[]
  /** 圖表標題（顯示於 header） */
  title?: string
  /** Y 軸標籤（如「銷售金額」），Bar/Line 使用 */
  yAxisLabel?: string
  /** 數值後綴（如「元」），Tooltip 顯示用 */
  valueSuffix?: string
}

const CHART_COLORS = ['#4b5563', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']
const ANIMATION_DURATION = 400
const FONT_SIZE = 16

const CHART_TYPE_LABELS: Record<'bar' | 'pie' | 'line', string> = {
  bar: '長條圖',
  pie: '圓餅圖',
  line: '折線圖',
}

interface ChartModalProps {
  open: boolean
  data: ChartData
  onClose: () => void
}

type ChartType = 'bar' | 'pie' | 'line'

/**
 * 佔比／結構份額意圖（預設圓餅圖與單序列收窄）。
 * 不含裸「%／％」與「比例」：避免成長率（%）、變化比例等誤判為整體佔比。
 * 「佔比（%）」仍由「佔比」命中。
 */
const PROPORTION_INTENT_RE = /占比|佔比|份額|占有率|佔有率|proport|share of|percentage/i

/** 判斷 labels 是否為時間序列（如 2026-01、2025-Q2、3月、Q1） */
function isTimeSeriesLabels(labels: string[]): boolean {
  if (!labels.length) return false
  const sample = labels[0]
  return (
    /^\d{4}[-/]?\d{1,2}/.test(sample) ||  // 2025-01, 2025/03, 20250301
    /^\d{4}[-/]?Q\d/.test(sample) ||       // 2025-Q1, 2025Q2
    /^\d{1,2}月$/.test(sample) ||          // 3月, 12月（v4 MONTH 分組）
    /^Q\d$/.test(sample)                   // Q1, Q2（v4 QUARTER 分組）
  )
}

/** labels 是否像「指標名」（如 來客數、客單價、營收）→ 不適合 pie */
function looksLikeMetricLabels(labels: string[]): boolean {
  const metricSuffix = /[數價率收額]$/
  return labels.some((l) => metricSuffix.test(String(l).trim()))
}

/**
 * 標題／軸／後綴／序列名是否表達「佔比、比例」→ 預設用圓餅圖，且可略過「指標名」類 labels 的限制。
 */
function suggestsProportionIntent(data: ChartData): boolean {
  const parts: string[] = []
  if (data.title) parts.push(data.title)
  if (data.yAxisLabel) parts.push(data.yAxisLabel)
  if (data.valueSuffix) parts.push(data.valueSuffix)
  data.datasets?.forEach((d) => parts.push(d.label))
  const text = parts.join(' ')
  return PROPORTION_INTENT_RE.test(text)
}

/**
 * 多條序列時，若恰好只有一條的 label 表達佔比，圓餅圖僅使用該序列（避免誤用第一條銷售額）。
 * 單序列或非 datasets 格式回傳 null，由呼叫端沿用原 data。
 */
function narrowToSingleProportionDataset(data: ChartData): ChartData | null {
  const ds = data.datasets
  if (!ds || ds.length <= 1) return null
  const hits = ds.filter((d) => PROPORTION_INTENT_RE.test(String(d.label)))
  if (hits.length !== 1) return null
  return { ...data, datasets: hits }
}

/** 繪製圓餅圖時使用的 ChartData（多序列＋唯一佔比序列時會收窄） */
export function chartDataForPieView(data: ChartData): ChartData {
  return narrowToSingleProportionDataset(data) ?? data
}

/** 判斷此資料分別適合哪些圖表類型（三 flag） */
function getSuitableChartTypes(data: ChartData): { pie: boolean; bar: boolean; line: boolean } {
  const labels = data.labels ?? []
  const count = labels.length
  const hasPieData = !!(data.data && data.data.length > 0)
  const isTime = isTimeSeriesLabels(labels)
  const proportion = suggestsProportionIntent(data)
  const pieContext = chartDataForPieView(data)
  const hasDatasetsCtx = !!(pieContext.datasets && pieContext.datasets.length > 0)

  // pie：單一指標（無論是 data[] 或 datasets[1] 格式）、非時間序列、2 個以上類別、labels 不像指標名稱
  const isSingleMetric =
    (!hasDatasetsCtx && hasPieData) ||
    (hasDatasetsCtx && (pieContext.datasets?.length ?? 0) === 1)
  const labelBlocksPie = looksLikeMetricLabels(labels) && !proportion
  const pie =
    isSingleMetric &&
    !isTime &&
    count >= 2 &&
    !labelBlocksPie

  const line = isTime && count >= 3

  const bar = true

  return { pie, bar, line }
}

/** 依 suitable flags 回傳可選的圖表類型 */
function getAvailableTypes(data: ChartData): ChartType[] {
  const flags = getSuitableChartTypes(data)
  return (['pie', 'bar', 'line'] as const).filter((t) => flags[t])
}

/** 取得預設顯示類型：佔比／比例優先圓餅圖；若有 chartType 且可用則採用，否則 line > pie > bar */
export function getDefaultChartType(data: ChartData): ChartType {
  const available = getAvailableTypes(data)
  const suggested = data.chartType
  if (suggestsProportionIntent(data) && available.includes('pie') && suggested !== 'line') {
    return 'pie'
  }
  const fallback =
    available.includes('line') ? 'line'
    : available.includes('pie') ? 'pie'
    : available[0] ?? 'bar'
  return (suggested && available.includes(suggested)) ? suggested : fallback
}

/** 將 ChartData 轉成 Recharts Bar/Line 格式 */
function transformToBarLineData(data: ChartData): Record<string, string | number>[] {
  const { labels } = data
  const singleDataLabel = data.yAxisLabel || '數值'
  const singleDataSuffix = data.valueSuffix ?? ''
  const effectiveDatasets =
    data.datasets && data.datasets.length > 0
      ? data.datasets
      : data.data
        ? [{ label: singleDataLabel, data: data.data, valueSuffix: singleDataSuffix }]
        : []

  if (labels.length === 0) return []

  return labels.map((name, i) => {
    const row: Record<string, string | number> = { name }
    effectiveDatasets.forEach((ds) => {
      row[ds.label] = ds.data[i] ?? 0
    })
    return row
  })
}

/** 判斷 dataset label 是否為比率型（含 %） */
function isRatioDataset(label: string): boolean {
  return label.includes('（%）') || label.includes('(%)') || label.toLowerCase().endsWith('_pct') || label.toLowerCase().endsWith('_rate')
}

/**
 * 智慧預設：若 datasets 中同時有比率型與非比率型，
 * 預設只顯示比率型（避免量級不同的資料塞在同一圖）；
 * 全為同類型時顯示全部。
 */
export function computeDefaultActiveDatasets(datasets: { label: string }[]): Set<string> {
  if (datasets.length <= 1) return new Set(datasets.map((d) => d.label))
  const ratioLabels = datasets.filter((d) => isRatioDataset(d.label)).map((d) => d.label)
  const nonRatioLabels = datasets.filter((d) => !isRatioDataset(d.label)).map((d) => d.label)
  if (ratioLabels.length > 0 && nonRatioLabels.length > 0) {
    return new Set(ratioLabels)
  }
  return new Set(datasets.map((d) => d.label))
}

/** 將 ChartData 轉成 Recharts Pie 格式 */
function transformToPieData(data: ChartData): { name: string; value: number }[] {
  const { labels } = data
  // data.data（舊格式）或 datasets[0].data（v4 格式）
  const values = data.data ?? data.datasets?.[0]?.data ?? []
  return labels.map((name, i) => ({ name, value: values[i] ?? 0 }))
}

export default function ChartModal({ open, data, onClose }: ChartModalProps) {
  const [viewType, setViewType] = useState<'bar' | 'pie' | 'line'>(() => getDefaultChartType(data))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const colors = CHART_COLORS

  const isFromPieData = !data.datasets?.length && !!data.data?.length
  const singleDataLabel = data.yAxisLabel || '數值'
  const singleDataSuffix = data.valueSuffix ?? ''
  const allDatasets =
    data.datasets && data.datasets.length > 0
      ? data.datasets
      : data.data
        ? [{ label: singleDataLabel, data: data.data, valueSuffix: singleDataSuffix }]
        : []

  const [activeDatasets, setActiveDatasets] = useState<Set<string>>(
    () => computeDefaultActiveDatasets(allDatasets)
  )

  // 目前可見的 datasets
  const effectiveDatasets = allDatasets.filter((d) => activeDatasets.has(d.label))

  // 可用圖表類型：若 activeDatasets 篩選後只剩 1 個 dataset，以有效資料判斷 pie 可用性
  const availableTypes = getAvailableTypes(
    effectiveDatasets.length === 1 ? { ...data, datasets: effectiveDatasets } : data
  )

  useEffect(() => {
    if (open) {
      setViewType(getDefaultChartType(data))
      setIsFullscreen(false)
      setActiveDatasets(computeDefaultActiveDatasets(allDatasets))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isFullscreen) setIsFullscreen(false)
        else handleClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, handleClose, isFullscreen])

  const barLineData = transformToBarLineData(data)
  const effectiveDataForPie =
    data.datasets && data.datasets.length > 0 ? { ...data, datasets: effectiveDatasets } : data
  const pieSource = chartDataForPieView(effectiveDataForPie)
  const pieData = transformToPieData(pieSource)
  const valueSuffixForPie =
    (pieSource.datasets?.[0] as { valueSuffix?: string } | undefined)?.valueSuffix ?? data.valueSuffix ?? ''

  const allColorMap = Object.fromEntries(allDatasets.map((d, i) => [d.label, colors[i % colors.length]]))

  /** Recharts Legend payload：pie 或 bar(pie-as-bar) 用 labels；否則用 datasets */
  const legendPayload =
    viewType === 'pie' || (viewType === 'bar' && isFromPieData)
      ? data.labels.map((l, i) => ({ value: l, color: colors[i % colors.length] }))
      : effectiveDatasets.map((ds) => ({ value: ds.label, color: allColorMap[ds.label] ?? colors[0] }))

  const isSingleSeries = effectiveDatasets.length === 1
  const barDataKeys = effectiveDatasets.map((d) => d.label)
  const labelToSuffix: Record<string, string> = {}
  effectiveDatasets.forEach((d) => {
    const ds = d as { label?: string; valueSuffix?: string }
    labelToSuffix[ds.label ?? ''] = ds.valueSuffix ?? ''
  })

  const chartHeight = isFullscreen ? '100%' : 260
  const chartMinHeight = isFullscreen ? 400 : 260
  const yAxisLabel = data.yAxisLabel
  const valueSuffix = data.valueSuffix ?? ''

  function formatValue(val: number, datasetLabel?: string): string {
    const s = val % 1 === 0 ? String(val) : val.toFixed(2)
    const suffix = datasetLabel ? (labelToSuffix[datasetLabel] ?? valueSuffix) : valueSuffix
    return suffix ? `${s}${suffix}` : s
  }

  function renderBar() {
    return (
      <ResponsiveContainer width="100%" height={chartHeight} minHeight={chartMinHeight}>
        <BarChart data={barLineData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#4b5563', fontSize: FONT_SIZE }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
            interval={0}
            angle={barLineData.length > 8 ? -35 : 0}
            textAnchor={barLineData.length > 8 ? 'end' : 'middle'}
            dy={barLineData.length > 8 ? 8 : 0}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: FONT_SIZE }}
            axisLine={{ stroke: '#374151' }}
            tickLine={{ stroke: '#374151' }}
            tickFormatter={(v) => (v % 1 === 0 ? String(v) : v.toFixed(2))}
            width={yAxisLabel ? 72 : 60}
          >
            {yAxisLabel && (
              <Label value={yAxisLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: '#6b7280', fontSize: FONT_SIZE }} />
            )}
          </YAxis>
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: FONT_SIZE }}
            formatter={(value, name) => {
              const label = (name === '數值' || !name) && yAxisLabel ? yAxisLabel : String(name ?? '')
              return [formatValue(Number(value ?? 0), String(name ?? '')), label]
            }}
            labelStyle={{ color: '#374151', fontWeight: 600, fontSize: FONT_SIZE }}
          />
          <Legend
            content={(props) => <DefaultLegendContent {...props} payload={legendPayload} align="center" verticalAlign="bottom" labelStyle={{ fontSize: FONT_SIZE }} />}
            wrapperStyle={{ paddingTop: 16, fontSize: FONT_SIZE }}
          />
          {isSingleSeries && isFromPieData ? (
            <Bar dataKey={barDataKeys[0]} radius={[4, 4, 0, 0]} animationDuration={ANIMATION_DURATION}>
              {barLineData.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Bar>
          ) : (
            barDataKeys.map((key) => (
              <Bar key={key} dataKey={key} fill={allColorMap[key] ?? colors[0]} radius={[4, 4, 0, 0]} animationDuration={ANIMATION_DURATION} />
            ))
          )}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  function renderPie() {
    return (
      <ResponsiveContainer width="100%" height={chartHeight} minHeight={chartMinHeight}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius="30%"
            outerRadius="70%"
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            label={({ percent, x, y, textAnchor }) =>
              percent != null && percent >= 0.04 ? (
                <text x={x} y={y} textAnchor={textAnchor} dominantBaseline="middle" style={{ fontSize: FONT_SIZE }}>
                  {`${(percent * 100).toFixed(1)}%`}
                </text>
              ) : null
            }
            labelLine={false}
            animationDuration={ANIMATION_DURATION}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} stroke="#fff" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: FONT_SIZE }}
            formatter={(value, name, props) => {
              const total = pieData.reduce((a, d) => a + d.value, 0) || 1
              const val = typeof value === 'number' ? value : props?.payload?.value ?? 0
              const pct = ((val / total) * 100).toFixed(1)
              const valStr = valueSuffixForPie ? `${val}${valueSuffixForPie}` : String(val)
              const valueLabel = yAxisLabel ? `${yAxisLabel}：` : ''
              return [`${valueLabel}${valStr} (${pct}%)`, String(name ?? '')]
            }}
          />
          <Legend
            content={(props) => <DefaultLegendContent {...props} payload={legendPayload} align="center" verticalAlign="bottom" labelStyle={{ fontSize: FONT_SIZE }} />}
            wrapperStyle={{ paddingTop: 16, fontSize: FONT_SIZE }}
          />
        </PieChart>
      </ResponsiveContainer>
    )
  }

  function renderLine() {
    return (
      <ResponsiveContainer width="100%" height={chartHeight} minHeight={chartMinHeight}>
        <LineChart data={barLineData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#4b5563', fontSize: FONT_SIZE }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
            interval={0}
            angle={barLineData.length > 8 ? -35 : 0}
            textAnchor={barLineData.length > 8 ? 'end' : 'middle'}
            dy={barLineData.length > 8 ? 8 : 0}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: FONT_SIZE }}
            axisLine={{ stroke: '#374151' }}
            tickLine={{ stroke: '#374151' }}
            tickFormatter={(v) => (v % 1 === 0 ? String(v) : v.toFixed(2))}
            width={yAxisLabel ? 72 : 60}
          >
            {yAxisLabel && (
              <Label value={yAxisLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: '#6b7280', fontSize: FONT_SIZE }} />
            )}
          </YAxis>
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: FONT_SIZE }}
            formatter={(value, name) => {
              const label = (name === '數值' || !name) && yAxisLabel ? yAxisLabel : String(name ?? '')
              return [formatValue(Number(value ?? 0), String(name ?? '')), label]
            }}
            labelStyle={{ color: '#374151', fontWeight: 600, fontSize: FONT_SIZE }}
          />
          <Legend
            content={(props) => <DefaultLegendContent {...props} payload={legendPayload} align="center" verticalAlign="bottom" labelStyle={{ fontSize: FONT_SIZE }} />}
            wrapperStyle={{ paddingTop: 16, fontSize: FONT_SIZE }}
          />
          {barDataKeys.map((key) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={allColorMap[key] ?? colors[0]}
              strokeWidth={3}
              dot={{ fill: allColorMap[key] ?? colors[0], strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6 }}
              animationDuration={ANIMATION_DURATION}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    )
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="圖表"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className={`relative z-10 flex flex-col overflow-hidden border border-gray-200/80 bg-white shadow-2xl transition-all rounded-2xl ${
          isFullscreen ? 'h-[min(92vh,960px)] w-[min(94vw,1400px)]' : 'h-[min(68vh,580px)] w-[min(78vw,620px)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-shrink-0 flex-col gap-2 border-b border-slate-200 bg-slate-100 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-slate-800">{data.title ?? '圖表'}</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="rounded-2xl p-2 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-800"
                title={isFullscreen ? '縮小' : '放大至全螢幕'}
                aria-label={isFullscreen ? '縮小' : '放大至全螢幕'}
              >
                {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
              {availableTypes.length > 1 && (
                <div className="flex gap-1 rounded-2xl bg-slate-200/80 p-1.5">
                  {availableTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setViewType(t)}
                      className={`rounded-2xl px-4 py-2 text-[16px] font-medium transition-all ${
                        viewType === t ? 'bg-white text-slate-800 shadow-md' : 'text-slate-600 hover:text-slate-800 hover:bg-white/60'
                      }`}
                    >
                      {CHART_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* 多 dataset 時顯示切換 chips */}
          {allDatasets.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {allDatasets.map((ds, i) => {
                const active = activeDatasets.has(ds.label)
                return (
                  <button
                    key={ds.label}
                    type="button"
                    onClick={() => {
                      setActiveDatasets((prev) => {
                        const next = new Set(prev)
                        if (active && next.size > 1) next.delete(ds.label)
                        else next.add(ds.label)
                        return next
                      })
                    }}
                    className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[13px] font-medium transition-all ${
                      active
                        ? 'border-transparent text-white'
                        : 'border-slate-300 bg-white text-slate-400 line-through'
                    }`}
                    style={active ? { backgroundColor: colors[i % colors.length], borderColor: colors[i % colors.length] } : undefined}
                    title={active ? '點擊隱藏' : '點擊顯示'}
                  >
                    {ds.label}
                  </button>
                )
              })}
            </div>
          )}
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          <div className={`flex min-h-0 flex-1 items-center justify-center overflow-auto ${isFullscreen ? 'min-h-[320px]' : 'min-h-[240px]'}`}>
            {viewType === 'bar' && renderBar()}
            {viewType === 'pie' && renderPie()}
            {viewType === 'line' && renderLine()}
          </div>
        </div>
        <footer className="flex flex-shrink-0 justify-end border-t border-slate-200 bg-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-[16px] font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            關閉
          </button>
        </footer>
      </div>
    </div>
  )
}
