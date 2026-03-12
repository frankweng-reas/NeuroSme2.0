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

/** 依資料結構回傳可選的圖表類型 */
function getAvailableTypes(data: ChartData): ('bar' | 'pie' | 'line')[] {
  const hasDatasets = data.datasets && data.datasets.length > 0
  const hasPieData = data.data && data.data.length > 0
  if (hasDatasets) return ['bar', 'line']
  if (hasPieData) return ['pie', 'bar']
  return ['bar']
}

/** 取得預設顯示類型 */
function getDefaultType(data: ChartData): 'bar' | 'pie' | 'line' {
  const available = getAvailableTypes(data)
  const suggested = data.chartType ?? (data.data ? 'pie' : 'bar')
  return available.includes(suggested) ? suggested : available[0]
}

/** 將 ChartData 轉成 Recharts Bar/Line 格式 */
function transformToBarLineData(data: ChartData): Record<string, string | number>[] {
  const { labels } = data
  const effectiveDatasets =
    data.datasets && data.datasets.length > 0
      ? data.datasets
      : data.data
        ? [{ label: '數值', data: data.data }]
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

/** 將 ChartData 轉成 Recharts Pie 格式 */
function transformToPieData(data: ChartData): { name: string; value: number }[] {
  const { labels } = data
  const values = data.data ?? []
  return labels.map((name, i) => ({ name, value: values[i] ?? 0 }))
}

export default function ChartModal({ open, data, onClose }: ChartModalProps) {
  const [viewType, setViewType] = useState<'bar' | 'pie' | 'line'>(() => getDefaultType(data))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const availableTypes = getAvailableTypes(data)
  const colors = CHART_COLORS

  const isFromPieData = !data.datasets?.length && !!data.data?.length
  const effectiveDatasets =
    data.datasets && data.datasets.length > 0
      ? data.datasets
      : data.data
        ? [{ label: '數值', data: data.data }]
        : []

  useEffect(() => {
    if (open) {
      setViewType(getDefaultType(data))
      setIsFullscreen(false)
    }
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
  const pieData = transformToPieData(data)

  /** Recharts Legend payload：pie 或 bar(pie-as-bar) 用 labels；否則用 datasets */
  const legendPayload =
    viewType === 'pie' || (viewType === 'bar' && isFromPieData)
      ? data.labels.map((l, i) => ({ value: l, color: colors[i % colors.length] }))
      : effectiveDatasets.map((ds, i) => ({ value: ds.label, color: colors[i % colors.length] }))

  const isSingleSeries = effectiveDatasets.length === 1
  const barDataKeys = effectiveDatasets.map((d) => d.label)

  const chartHeight = isFullscreen ? '100%' : 260
  const chartMinHeight = isFullscreen ? 400 : 260
  const yAxisLabel = data.yAxisLabel
  const valueSuffix = data.valueSuffix ?? ''

  function formatValue(val: number): string {
    const s = val % 1 === 0 ? String(val) : val.toFixed(1)
    return valueSuffix ? `${s}${valueSuffix}` : s
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
            tickFormatter={(v) => (v % 1 === 0 ? String(v) : v.toFixed(1))}
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
              return [formatValue(Number(value ?? 0)), label]
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
            barDataKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} animationDuration={ANIMATION_DURATION} />
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
              const valStr = valueSuffix ? `${val}${valueSuffix}` : String(val)
              return [`${valStr} (${pct}%)`, String(name ?? '')]
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
            tickFormatter={(v) => (v % 1 === 0 ? String(v) : v.toFixed(1))}
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
              return [formatValue(Number(value ?? 0)), label]
            }}
            labelStyle={{ color: '#374151', fontWeight: 600, fontSize: FONT_SIZE }}
          />
          <Legend
            content={(props) => <DefaultLegendContent {...props} payload={legendPayload} align="center" verticalAlign="bottom" labelStyle={{ fontSize: FONT_SIZE }} />}
            wrapperStyle={{ paddingTop: 16, fontSize: FONT_SIZE }}
          />
          {barDataKeys.map((key, i) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[i % colors.length]}
              strokeWidth={3}
              dot={{ fill: colors[i % colors.length], strokeWidth: 2, r: 4 }}
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
        <header className="flex flex-shrink-0 items-center justify-between border-b border-gray-100 bg-gray-50/90 px-6 py-4">
          <h2 className="text-[16px] font-semibold text-gray-800">{data.title ?? '圖表'}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800"
              title={isFullscreen ? '縮小' : '放大至全螢幕'}
              aria-label={isFullscreen ? '縮小' : '放大至全螢幕'}
            >
              {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
            {availableTypes.length > 1 && (
              <div className="flex gap-1 rounded-xl bg-gray-200/70 p-1.5">
                {availableTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setViewType(t)}
                    className={`rounded-lg px-4 py-2 text-[16px] font-medium transition-all ${
                      viewType === t ? 'bg-white text-gray-800 shadow-md' : 'text-gray-600 hover:text-gray-800 hover:bg-white/50'
                    }`}
                  >
                    {CHART_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
          <div className={`flex min-h-0 flex-1 items-center justify-center overflow-auto ${isFullscreen ? 'min-h-[320px]' : 'min-h-[240px]'}`}>
            {viewType === 'bar' && renderBar()}
            {viewType === 'pie' && renderPie()}
            {viewType === 'line' && renderLine()}
          </div>
        </div>
        <footer className="flex flex-shrink-0 justify-end border-t border-gray-100 bg-gray-50/50 px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-[16px] font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          >
            關閉
          </button>
        </footer>
      </div>
    </div>
  )
}
