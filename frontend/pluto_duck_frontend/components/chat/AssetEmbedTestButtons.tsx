'use client';

import { Button } from '@/components/ui/button';
import type { AssetEmbedConfig } from '../editor/nodes/AssetEmbedNode';

interface AssetEmbedTestButtonsProps {
  onEmbed: (analysisId: string, config: AssetEmbedConfig) => void;
}

// Hardcoded test analysis ID
const TEST_ANALYSIS_ID = 'meta_ad_daily_timeseries_with_ma_anomalies';

// Test configurations
const TEST_CONFIGS: Array<{ label: string; config: AssetEmbedConfig }> = [
  {
    label: 'Table',
    config: {
      displayType: 'table',
      tableConfig: { rowsPerPage: 5 },
    },
  },
  {
    label: 'Bar',
    config: {
      displayType: 'chart',
      chartConfig: {
        type: 'bar',
        xColumn: 'date',
        yColumn: 'spend',
      },
    },
  },
  {
    label: 'Line',
    config: {
      displayType: 'chart',
      chartConfig: {
        type: 'line',
        xColumn: 'date',
        yColumn: 'spend',
      },
    },
  },
];

export function AssetEmbedTestButtons({ onEmbed }: AssetEmbedTestButtonsProps) {
  return (
    <div className="flex items-center gap-1">
      {TEST_CONFIGS.map(({ label, config }) => (
        <Button
          key={label}
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => onEmbed(TEST_ANALYSIS_ID, config)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
