'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

// Single series props (backward compatible)
interface SingleSeriesProps {
  columns: string[];
  rows: any[][];
  chartType: 'bar' | 'line' | 'pie' | 'area';
  xColumn: string;
  yColumn: string;
  yColumns?: never;
  groupByColumn?: never;
  stacked?: never;
  showDualAxis?: never;
}

// Multi series props (multiple Y columns)
interface MultiYColumnsProps {
  columns: string[];
  rows: any[][];
  chartType: 'bar' | 'line' | 'area' | 'composed';
  xColumn: string;
  yColumn?: never;
  yColumns: string[];
  groupByColumn?: never;
  stacked?: boolean;
  showDualAxis?: boolean;
}

// Group by props (pivot by a column - e.g., source)
interface GroupByProps {
  columns: string[];
  rows: any[][];
  chartType: 'bar' | 'line' | 'area';
  xColumn: string;
  yColumn: string;
  yColumns?: never;
  groupByColumn: string;  // e.g., 'source' to create separate lines for Google/Facebook/Naver
  stacked?: boolean;
  showDualAxis?: never;
}

type AssetChartViewProps = SingleSeriesProps | MultiYColumnsProps | GroupByProps;

// Color palette for charts - extended for more series
const COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#84cc16', // lime
  '#14b8a6', // teal
  '#a855f7', // violet
  '#f43f5e', // rose
];

// Format large numbers
function formatValue(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  if (value % 1 !== 0) return value.toFixed(2);
  return value.toLocaleString();
}

export function AssetChartView(props: AssetChartViewProps) {
  const { columns, rows, chartType, xColumn } = props;
  
  // Determine mode
  const isGroupByMode = 'groupByColumn' in props && props.groupByColumn;
  const isMultiYMode = 'yColumns' in props && props.yColumns && props.yColumns.length > 0;
  const stacked = 'stacked' in props ? props.stacked : false;
  const showDualAxis = 'showDualAxis' in props ? props.showDualAxis : false;

  // Get yColumn for single/groupBy mode
  const yColumn = 'yColumn' in props ? props.yColumn : undefined;
  const yColumns = isMultiYMode ? props.yColumns : undefined;
  const groupByColumn = isGroupByMode ? props.groupByColumn : undefined;

  // Transform data based on mode
  const { chartData, seriesKeys } = useMemo(() => {
    const xIndex = columns.indexOf(xColumn);
    
    // Group By Mode: Pivot data by groupByColumn
    // e.g., { date: '2024-01-01', Google: 2.5, Facebook: 1.8, Naver: 3.1 }
    if (isGroupByMode && groupByColumn && yColumn) {
      const groupIndex = columns.indexOf(groupByColumn);
      const yIndex = columns.indexOf(yColumn);
      
      if (xIndex === -1 || groupIndex === -1 || yIndex === -1) {
        return { chartData: [], seriesKeys: [] };
      }

      // Group by X value, then by group column
      const grouped = new Map<string, Record<string, any>>();
      const uniqueGroups = new Set<string>();

      rows.forEach((row) => {
        const xVal = String(row[xIndex] ?? '');
        const groupVal = String(row[groupIndex] ?? '');
        const yVal = Number(row[yIndex]) || 0;

        uniqueGroups.add(groupVal);

        if (!grouped.has(xVal)) {
          grouped.set(xVal, { name: xVal });
        }
        grouped.get(xVal)![groupVal] = yVal;
      });

      const sortedKeys = Array.from(uniqueGroups).sort();
      const data = Array.from(grouped.values()).slice(0, 100);
      
      return { chartData: data, seriesKeys: sortedKeys };
    }

    // Multi Y Columns Mode
    if (isMultiYMode && yColumns) {
      if (xIndex === -1) {
        return { chartData: [], seriesKeys: yColumns };
      }

      const data = rows.slice(0, 50).map((row) => {
        const dataPoint: Record<string, any> = { name: String(row[xIndex] ?? '') };
        yColumns.forEach((col) => {
          const colIndex = columns.indexOf(col);
          dataPoint[col] = colIndex !== -1 ? Number(row[colIndex]) || 0 : 0;
        });
        return dataPoint;
      });

      return { chartData: data, seriesKeys: yColumns };
    }

    // Single Y Column Mode (backward compatible)
    if (yColumn) {
    const yIndex = columns.indexOf(yColumn);

    if (xIndex === -1 || yIndex === -1) {
        const data = rows.slice(0, 50).map((row, i) => ({
        name: String(row[0] ?? `Item ${i + 1}`),
        value: Number(row[1]) || 0,
      }));
        return { chartData: data, seriesKeys: ['value'] };
    }

      const data = rows.slice(0, 50).map((row) => ({
      name: String(row[xIndex] ?? ''),
      value: Number(row[yIndex]) || 0,
    }));

      return { chartData: data, seriesKeys: ['value'] };
    }

    return { chartData: [], seriesKeys: [] };
  }, [columns, rows, xColumn, yColumn, yColumns, groupByColumn, isGroupByMode, isMultiYMode]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
        No data to display
      </div>
    );
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-3">
          <p className="font-medium text-sm mb-2">{`${xColumn}: ${label}`}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {`${entry.name}: ${formatValue(entry.value)}`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Common axis props
  const xAxisProps = {
    dataKey: 'name',
    tick: { fontSize: 11 },
    tickLine: false,
    axisLine: false,
    interval: 0 as const,
    angle: chartData.length > 10 ? -45 : 0,
    textAnchor: (chartData.length > 10 ? 'end' : 'middle') as 'end' | 'middle',
    height: chartData.length > 10 ? 60 : 30,
  };

  const yAxisProps = {
    tick: { fontSize: 11 },
    tickLine: false,
    axisLine: false,
    tickFormatter: formatValue,
  };

  const renderChart = () => {
    // Pie chart (single series only)
    if (chartType === 'pie') {
      const dataKey = seriesKeys[0] || 'value';
        return (
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) =>
                `${name} (${(percent * 100).toFixed(0)}%)`
              }
              outerRadius={100}
              fill="#8884d8"
            dataKey={dataKey}
            >
              {chartData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
          <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        );
    }

    // Line chart (supports groupBy and multiY)
    if (chartType === 'line') {
        return (
        <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis {...xAxisProps} />
          <YAxis yAxisId="left" {...yAxisProps} />
          {showDualAxis && seriesKeys.length > 1 && (
            <YAxis yAxisId="right" orientation="right" {...yAxisProps} />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {seriesKeys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={COLORS[index % COLORS.length]}
              strokeWidth={2}
              dot={{ fill: COLORS[index % COLORS.length], strokeWidth: 2, r: 3 }}
              yAxisId={showDualAxis && index > 0 ? 'right' : 'left'}
              connectNulls
            />
          ))}
        </LineChart>
      );
    }

    // Bar chart
    if (chartType === 'bar') {
      return (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis {...xAxisProps} />
          <YAxis yAxisId="left" {...yAxisProps} />
          {showDualAxis && seriesKeys.length > 1 && (
            <YAxis yAxisId="right" orientation="right" {...yAxisProps} />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {seriesKeys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              name={key}
              fill={COLORS[index % COLORS.length]}
              radius={[4, 4, 0, 0]}
              yAxisId={showDualAxis && index > 0 ? 'right' : 'left'}
              stackId={stacked ? 'stack' : undefined}
            />
          ))}
        </BarChart>
      );
    }

    // Area chart
    if (chartType === 'area') {
      return (
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis {...xAxisProps} />
          <YAxis yAxisId="left" {...yAxisProps} />
          {showDualAxis && seriesKeys.length > 1 && (
            <YAxis yAxisId="right" orientation="right" {...yAxisProps} />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {seriesKeys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={COLORS[index % COLORS.length]}
              fill={COLORS[index % COLORS.length]}
              fillOpacity={stacked ? 0.6 : 0.3}
              yAxisId={showDualAxis && index > 0 ? 'right' : 'left'}
              stackId={stacked ? 'stack' : undefined}
              connectNulls
            />
          ))}
          </AreaChart>
        );
    }

    // Composed chart (bar + line)
    if (chartType === 'composed') {
      return (
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis {...xAxisProps} />
          <YAxis yAxisId="left" {...yAxisProps} />
          {showDualAxis && seriesKeys.length > 1 && (
            <YAxis yAxisId="right" orientation="right" {...yAxisProps} />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {seriesKeys.map((key, index) => {
            const useBar = index < Math.ceil(seriesKeys.length / 2);
            if (useBar) {
              return (
                <Bar
                  key={key}
                  dataKey={key}
                  name={key}
                  fill={COLORS[index % COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  yAxisId="left"
                />
              );
            }
            return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                dot={{ fill: COLORS[index % COLORS.length], r: 4 }}
                yAxisId={showDualAxis ? 'right' : 'left'}
              />
            );
          })}
        </ComposedChart>
      );
    }

    // Default: bar chart
        return (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
        <XAxis {...xAxisProps} />
        <YAxis yAxisId="left" {...yAxisProps} />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        {seriesKeys.map((key, index) => (
          <Bar
            key={key}
            dataKey={key}
            name={key}
            fill={COLORS[index % COLORS.length]}
            radius={[4, 4, 0, 0]}
            yAxisId="left"
          />
        ))}
          </BarChart>
        );
  };

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}
