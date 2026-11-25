import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`

export function CategoryChart({
  data,
  onSelect,
}: {
  data: Array<{ categoryId: number; name: string; amountPaise: number }>
  onSelect: (categoryId: number) => void
}) {
  if (data.length === 0) return <EmptyChart />
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="amountPaise"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={90}
          fill="#047857"
          onClick={(entry) => {
            const payload = (entry as { payload?: { categoryId?: number }; categoryId?: number }).payload
              ?? (entry as { categoryId?: number })
            onSelect(Number(payload.categoryId))
          }}
          label={(entry) => entry.name}
        />
        <Tooltip formatter={(value) => rupees(Number(value))} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function ItemRankingChart({
  data,
  onSelect,
}: {
  data: Array<{ itemId: number; name: string; amountPaise: number }>
  onSelect: (itemId: number) => void
}) {
  if (data.length === 0) return <EmptyChart />
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" tickFormatter={(value) => rupees(Number(value))} />
        <YAxis type="category" dataKey="name" width={90} />
        <Tooltip formatter={(value) => rupees(Number(value))} />
        <Bar
          dataKey="amountPaise"
          fill="#059669"
          radius={[0, 4, 4, 0]}
          onClick={(entry) => {
            const payload = (entry as { payload?: { itemId?: number }; itemId?: number }).payload
              ?? (entry as { itemId?: number })
            onSelect(Number(payload.itemId))
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TrendChart({
  data,
}: {
  data: Array<{ label: string; amountPaise: number }>
}) {
  if (data.length === 0) return <EmptyChart />
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ left: 10, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" />
        <YAxis tickFormatter={(value) => rupees(Number(value))} />
        <Tooltip formatter={(value) => rupees(Number(value))} />
        <Line type="monotone" dataKey="amountPaise" stroke="#047857" strokeWidth={3} dot />
      </LineChart>
    </ResponsiveContainer>
  )
}

function EmptyChart() {
  return (
    <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">
      No spending in this range
    </div>
  )
}
