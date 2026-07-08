import { Component, computed, input } from '@angular/core';

import { buildHeatGrid, type HeatCell, type HeatGrid } from '../../core/heatmap';
import type { Collection } from '../../core/models';

/**
 * `HeatGrid.weeks[i]` rows are Sun-anchored (index 0 = Sun … 6 = Sat, per
 * `core/heatmap.ts`). The design wants weekday labels/rows displayed
 * Mon…Sun, so this maps each Mon..Sun display row to its Sun-anchored source
 * row index.
 */
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DISPLAY_ROWS = [0, 1, 2, 3, 4, 5, 6];

const CELL_PX = 11;
const SPACER_PX = 6;

/** One month's top label, positioned at its CSS grid column. */
interface PositionedMonthLabel {
  name: string;
  column: number;
}

/** Standalone activity heatmap: month/weekday labels, month gaps, per-cell tooltip, blue legend. */
@Component({
  selector: 'app-heatmap',
  imports: [],
  templateUrl: './heatmap.html',
  styleUrl: './heatmap.scss',
})
export class Heatmap {
  readonly reviewDays = input.required<number[]>();
  readonly collection = input.required<Collection | null>();
  readonly year = input.required<number>();

  readonly weekdayLabels = WEEKDAY_LABELS;
  readonly displayRows = DISPLAY_ROWS;

  readonly grid = computed<HeatGrid>(() =>
    buildHeatGrid(this.reviewDays(), this.collection(), this.year()),
  );

  /**
   * 1-based CSS grid column for each week (by index into `grid().weeks`).
   * A narrow spacer track is inserted before every month boundary after the
   * first, so the normal `column-gap` plus that spacer widens into a visible
   * gap between month blocks (Req 10) without touching `core/heatmap.ts`.
   */
  readonly weekColumns = computed<number[]>(() => {
    const monthStartWeeks = new Set(this.grid().months.slice(1).map((m) => m.weekIndex));
    let col = 1;
    return this.grid().weeks.map((_, i) => {
      if (monthStartWeeks.has(i)) col += 1;
      const thisCol = col;
      col += 1;
      return thisCol;
    });
  });

  /** `grid-template-columns` track list matching `weekColumns()` (11px week cols, 6px month-gap spacers). */
  readonly gridTemplateColumns = computed<string>(() => {
    const cols = this.weekColumns();
    const lastCol = cols.length ? cols[cols.length - 1] : 0;
    const cellCols = new Set(cols);
    const tracks: string[] = [];
    for (let c = 1; c <= lastCol; c++) {
      tracks.push(cellCols.has(c) ? `${CELL_PX}px` : `${SPACER_PX}px`);
    }
    return tracks.join(' ');
  });

  readonly monthLabels = computed<PositionedMonthLabel[]>(() => {
    const cols = this.weekColumns();
    return this.grid().months.map((m) => ({ name: m.name, column: cols[m.weekIndex] }));
  });

  /** The cell for a week's Mon..Sun display row (see `ROW_ORDER`). */
  orderedCell(week: HeatCell[], displayRow: number): HeatCell {
    return week[ROW_ORDER[displayRow]];
  }

  cellTitle(cell: HeatCell): string {
    if (!cell.inYear) return '';
    const noun = cell.count === 1 ? 'review' : 'reviews';
    const date = cell.date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${cell.count} ${noun} on ${date}`;
  }
}
