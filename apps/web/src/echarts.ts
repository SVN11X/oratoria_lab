import { init, use as registerCharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
registerCharts([
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);
export { init };
