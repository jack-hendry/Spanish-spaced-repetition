import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { CollectionStore, type DeckNode } from './core/collection.store';
import { deckColor } from './core/deck-color';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly title = 'Spanish SRS';

  private readonly store = inject(CollectionStore);
  private readonly router = inject(Router);

  readonly loading = this.store.loading;
  readonly error = this.store.error;

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
      void this.store.load();
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
}
