/** 圖表元件：供 PDF 匯出用，固定尺寸渲染 bar / pie / line */
import {
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
import { getDefaultChartType } from './ChartModal'
import type { ChartData } from './ChartModal'

const CHART_COLORS = ['#4b5563', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']
const FONT_SIZE = 14
const CHART_WIDTH = 520
const CHART_HEIGHT = 280

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

function transformToPieData(data: ChartData): { name: string; value: number }[] {
  const { labels } = data
  const values = data.data ?? []
  return labels.map((name, i) => ({ name, value: values[i] ?? 0 }))
}

interface ChartForPdfProps {
  data: ChartData
}

export default function ChartForPdf({ data }: ChartForPdfProps) {
  const viewType = getDefaultChartType(data)
  const colors = CHART_COLORS
  const isFromPieData = !data.datasets?.length && !!data.data?.length
  const singleDataLabel = data.yAxisLabel || '數值'
  const singleDataSuffix = data.valueSuffix ?? ''
  const effectiveDatasets =
    data.datasets && data.datasets.length > 0
      ? data.datasets
      : data.data
        ? [{ label: singleDataLabel, data: data.data, valueSuffix: singleDataSuffix }]
        : []
  const barLineData = transformToBarLineData(data)
  const pieData = transformToPieData(data)
  const legendPayload =
    viewType === 'pie' || (viewType === 'bar' && isFromPieData)
      ? data.labels.map((l, i) => ({ value: l, color: colors[i % colors.length] }))
      : effectiveDatasets.map((ds, i) => ({ value: ds.label, color: colors[i % colors.length] }))
  const isSingleSeries = effectiveDatasets.length === 1
  const barDataKeys = effectiveDatasets.map((d) => d.label)
  const labelToSuffix: Record<string, string> = {}
  effectiveDatasets.forEach((d) => {
    const ds = d as { label?: string; valueSuffix?: string }
    labelToSuffix[ds.label ?? ''] = ds.valueSuffix ?? ''
  })
  const yAxisLabel = data.yAxisLabel
  const valueSuffix = data.valueSuffix ?? ''

  function formatValue(val: number, datasetLabel?: string): string {
    const s = val % 1 === 0 ? String(val) : val.toFixed(2)
    const suffix = datasetLabel ? (labelToSuffix[datasetLabel] ?? valueSuffix) : valueSuffix
    return suffix ? `${s}${suffix}` : s
  }

  if (viewType === 'bar') {
    return (
      <div className="w-full" style={{ width: CHART_WIDTH, height: CHART_HEIGHT }}>
        {data.title && (
          <h3 className="mb-2 text-base font-semibold text-gray-800">{data.title}</h3>
        )}
        <BarChart width={CHART_WIDTH} height={CHART_HEIGHT - 24} data={barLineData} margin={{ top: 12, right: 20, left: 12, bottom: 40 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#e5e7eb" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#4b5563', fontSize: FONT_SIZE }}
            axisLine={{ stroke: '#374151' }}
            tickLine={false}
            interval={0}
            angle={barLineData.length > 8 ? -35 : 0}
            textAnchor={barLineData.length > 8 ? 'end' : 'middle'}
            dy={barLineData.length > 8 ? 6 : 0}
          />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: FONT_SIZE }}
            axisLine={{ stroke: '#374151' }}
            tickLine={{ stroke: '#374151' }}
            tickFormatter={(v) => (v % 1 === 0 ? String(v) : v.toFixed(2))}
            width={yAxisLabel ? 56 : 48}
          >
            {yAxisLabel && (
              <Label value={yAxisLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: '#6b7280', fontSize: FONT_SIZE }} />
            )}
          </YAxis>
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: FONT_SIZE }}
            formatter={(value, name) => {
              const label = (name === '數值' || !name) && yAxisLabel ? yAxisLabel : String(name ?? '')
              return [formatValue(Number(value ?? 0), String(name ?? '')), label]
            }}
          />
          <Legend
            content={(props) => <DefaultLegendContent {...props} payload={legendPayload} align="center" verticalAlign="bottom" labelStyle={{ fontSize: FONT_SIZE }} />}
            wrapperStyle={{ paddingTop: 8, fontSize: FONT_SIZE }}
          />
          {isSingleSeries && isFromPieData ? (
            <Bar dataKey={barDataKeys[0]} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {barLineData.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Bar>
          ) : (
            barDataKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            ))
          )}
        </BarChart>
      </div>
    )
  }

  if (viewType === 'pie') {
    return (
      <div className="w-full" style={{ width: CHART_WIDTH, height: CHART_HEIGHT }}>
        {data.title && (
          <h3 className="mb-2 text-base font-semibold text-gray-800">{data.title}</h3>
        )}
        <PieChart width={CHART_WIDTH} height={CHART_HEIGHT - 24}>
          <Pie
            data={pieData}
            cx={CHART_WIDTH / 2}
            cy={(CHART_HEIGHT - 48) / 2}
            innerRadius="28%"
            outerRadius="65%"
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
            isAnimationActive={false}
          >
            {pieData.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} stroke="#fff" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: FONT_SIZE }}
            formatter={(value, name, props) => {
              const total = pieData.reduce((a, d) => a + d.value, 0) || 1
              const val = typeof value === 'number' ? value : props?.payload?.value ?? 0
              const pct = ((val / total) * 100).toFixed(1)
              const valStr = valueSuffix ? `${val}${valueSuffix}` : String(val)
              const valueLabel = yAxisLabel ? `${yAxisLabel}：` : ''
              return [`${valueLabel}${valStr} (${pct}%)`, String(name ?? '')]
            }}
          />
          <Legend
            content={(props) => <DefaultLegendContent {...props} payload={legendPayload} align="center" verticalAlign="bottom" labelStyle={{ fontSize: FONT_SIZE }} />}
            wrapperStyle={{ paddingTop: 8, fontSize: FONT_SIZE }}
          />
        </PieChart>
      </div>
    )
  }

  return (
    <div className="w-full" style={{ width: CHART_WIDTH, height: CHART_HEIGHT }}>
      {data.title && (
        <h3 className="mb-2 text-base font-semibold text-gray-800">{data.title}</h3>
      )}
      <LineChart width={CHART_WIDTH} height={CHART_HEIGHT - 24} data={barLineData} margin={{ top: 12, right: 20, left: 12, bottom: 40 }}>
        <CartesianGrid strokeDasharray="4 4" stroke="#e5e7eb" />
        <XAxis
          dataKey="name"
          tick={{ fill: '#4b5563', fontSize: FONT_SIZE }}
          axisLine={{ stroke: '#374151' }}
          tickLine={false}
          interval={0}
          angle={barLineData.length > 8 ? -35 : 0}
          textAnchor={barLineData.length > 8 ? 'end' : 'middle'}
          dy={barLineData.length > 8 ? 6 : 0}
        />
        <YAxis
          tick={{ fill: '#6b7280', fontSize: FONT_SIZE }}
          axisLine={{ stroke: '#374151' }}
          tickLine={{ stroke: '#374151' }}
          tickFormatter={(v) => (v % 1 === 0 ? String(v) : v.toFixed(2))}
          width={yAxisLabel ? 56 : 48}
        >
          {yAxisLabel && (
            <Label value={yAxisLabel} angle={-90} position="insideLeft" style={{ textAnchor: 'middle', fill: '#6b7280', fontSize: FONT_SIZE }} />
          )}
        </YAxis>
        <Tooltip
          contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: FONT_SIZE }}
          formatter={(value, name) => {
            const label = (name === '數值' || !name) && yAxisLabel ? yAxisLabel : String(name ?? '')
            return [formatValue(Number(value ?? 0), String(name ?? '')), label]
          }}
        />
        <Legend
          content={(props) => <DefaultLegendContent {...props} payload={legendPayload} align="center" verticalAlign="bottom" labelStyle={{ fontSize: FONT_SIZE }} />}
          wrapperStyle={{ paddingTop: 8, fontSize: FONT_SIZE }}
        />
        {barDataKeys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={colors[i % colors.length]}
            strokeWidth={2}
            dot={{ fill: colors[i % colors.length], strokeWidth: 1, r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </div>
  )
}
