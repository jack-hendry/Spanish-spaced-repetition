import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { CollectionStore, type DeckNode } from './core/collection.store';
import { deckColor } from './core/deck-color';
import { PauseService } from './core/pause.service';
import { OutboxService } from './core/outbox/outbox.service';
import { ConflictResolver } from './core/outbox/conflict-resolver';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(window:beforeunload)': 'onBeforeUnload($event)' },
})
export class App {
  protected readonly title = 'Spanish SRS';

  private readonly store = inject(CollectionStore);
  private readonly router = inject(Router);
  private readonly pauseService = inject(PauseService);
  protected readonly outbox = inject(OutboxService);
  private readonly conflictResolver = inject(ConflictResolver);

  readonly loading = this.store.loading;
  readonly error = this.store.error;

  /** Read-only shell banner (R16); the deck-list header button is the only
   * control that toggles pause state. */
  readonly paused = computed(() => this.store.collection()?.pausedAt != null);

  /** Outbox banner text or null if no outbox state to show. */
  readonly outboxBannerText = computed<string | null>(() => {
    const conflicts = this.outbox.conflicts();
    const pendingCount = this.outbox.pendingCount();
    const failed = this.outbox.failed();

    // Conflicts take priority over unsent work because they need action.
    if (conflicts.length > 0) {
      const n = conflicts.length;
      return `${n} ${n === 1 ? 'review' : 'reviews'} could not be merged — answered on another device`;
    }

    if (pendingCount === 0 && failed.length === 0) {
      return null;
    }

    if (this.outbox.status() === 'draining') {
      return `Saving ${pendingCount} ${pendingCount === 1 ? 'review' : 'reviews'}…`;
    }

    if (this.outbox.status() === 'waiting') {
      const total = pendingCount + failed.length;
      return `${total} ${total === 1 ? 'review' : 'reviews'} not yet saved — will retry`;
    }

    if (failed.length > 0) {
      return `${failed.length} ${failed.length === 1 ? 'review' : 'reviews'} could not be saved`;
    }

    return null;
  });

  /** Names of decks whose children are expanded. Top level shown by default. */
  private readonly expanded = signal<Set<string>>(new Set());

  /** Only nodes whose ancestors are all expanded are visible. */
  readonly visibleNodes = computed<DeckNode[]>(() => {
    const exp = this.expanded();
    return this.store.deckTree().filter((node) => {
      const parts = node.deck.name.split('::');
      for (let i = 1; i < parts.length; i++) {
        if (!exp.has(parts.slice(0, i).join('::'))) return false;
      }
      return true;
    });
  });

  /** Total due across every top-level deck (children are already rolled up). */
  readonly totalDue = computed(() => {
    const roots = this.store.deckTree().filter((n) => n.depth === 0);
    return roots.reduce((sum, n) => sum + n.total.new + n.total.learning + n.total.review, 0);
  });

  constructor() {
    if (this.store.collection() === null) {
      void this.store.load().then(() => this.pauseService.recoverOnLoad());
    } else {
      void this.pauseService.recoverOnLoad();
    }
  }

  isExpanded(node: DeckNode): boolean {
    return this.expanded().has(node.deck.name);
  }

  toggle(node: DeckNode): void {
    if (!node.hasChildren) return;
    this.expanded.update((prev) => {
      const next = new Set(prev);
      if (next.has(node.deck.name)) next.delete(node.deck.name);
      else next.add(node.deck.name);
      return next;
    });
  }

  /** Prevent the disclosure twisty from also triggering the row's study link. */
  onToggleClick(event: Event, node: DeckNode): void {
    event.preventDefault();
    event.stopPropagation();
    this.toggle(node);
  }

  /** Prevent the gear affordance from also triggering the row's study link. */
  onGearClick(event: Event, node: DeckNode): void {
    event.preventDefault();
    event.stopPropagation();
    void this.router.navigate(['/options', node.deck.optionsId]);
  }

  /** Leaf label = last segment of the hierarchical name. */
  leafName(node: DeckNode): string {
    const parts = node.deck.name.split('::');
    return parts[parts.length - 1];
  }

  hasDue(node: DeckNode): boolean {
    return node.total.new + node.total.learning + node.total.review > 0;
  }

  /** Deterministic per-deck color dot (see core/deck-color.ts). */
  colorFor(name: string): string {
    return deckColor(name);
  }

  /** Prevent tab close when there are unsaved reviews. */
  onBeforeUnload(event: BeforeUnloadEvent): void {
    // Unsent work only. A parked conflict is surfaced in the banner but must
    // NOT block closing the tab — it is never auto-cleared (critic R-6).
    if (this.outbox.pendingCount() > 0 || this.outbox.failed().length > 0) {
      event.preventDefault();
    }
  }
}
