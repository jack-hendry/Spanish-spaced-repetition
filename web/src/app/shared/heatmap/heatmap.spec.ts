import { TestBed } from '@angular/core/testing';

import type { Collection } from '../../core/models';
import { Heatmap } from './heatmap';

describe('Heatmap', () => {
  const collection: Collection = {
    schemaVersion: 1,
    created: new Date('2024-01-01T00:00:00Z').getTime(),
    modified: Date.now(),
    dayCutoffHour: 4,
    defaultDeckOptionsId: '1',
    tags: [],
    pausedAt: null,
  };

  function render(reviewDays: number[], coll: Collection | null, year: number) {
    const fixture = TestBed.createComponent(Heatmap);
    fixture.componentRef.setInput('reviewDays', reviewDays);
    fixture.componentRef.setInput('collection', coll);
    fixture.componentRef.setInput('year', year);
    fixture.detectChanges();
    return fixture;
  }

  it('renders weekday labels Mon..Sun and a 5-swatch legend', () => {
    const fixture = render([], collection, 2024);
    const compiled = fixture.nativeElement as HTMLElement;

    const weekdayLabels = Array.from(compiled.querySelectorAll('.heatmap__weekday-label')).map(
      (el) => el.textContent,
    );
    expect(weekdayLabels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

    expect(compiled.querySelectorAll('.heatmap__legend-swatch').length).toBe(5);
    const legendLabels = Array.from(compiled.querySelectorAll('.heatmap__legend-label')).map(
      (el) => el.textContent,
    );
    expect(legendLabels).toEqual(['0', '1–9', '10–19', '20–39', '40+']);
  });

  it('renders month labels and day cells with a tooltip', () => {
    const fixture = render([0], collection, 2024);
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('.heatmap__month-label').length).toBe(12);

    const cells = compiled.querySelectorAll('.heatmap__cell');
    expect(cells.length).toBeGreaterThan(0);
    const first = cells[0] as HTMLElement;
    expect(first.className).toMatch(/level-\d/);
  });

  it('renders nothing in the grid when collection is null', () => {
    const fixture = render([], null, 2024);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.heatmap__cell').length).toBe(0);
    expect(compiled.querySelectorAll('.heatmap__month-label').length).toBe(0);
  });
});
