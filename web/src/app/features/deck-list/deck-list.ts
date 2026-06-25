import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CollectionStore, type DeckNode } from '../../core/collection.store';

@Component({
  selector: 'app-deck-list',
  imports: [RouterLink],
  templateUrl: './deck-list.html',
  styleUrl: './deck-list.scss',
})
export class DeckList {
  private readonly store = inject(CollectionStore);

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

  constructor() {
    void this.store.load();
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

  /** Leaf label = last segment of the hierarchical name. */
  leafName(node: DeckNode): string {
    const parts = node.deck.name.split('::');
    return parts[parts.length - 1];
  }

  hasDue(node: DeckNode): boolean {
    return node.total.new + node.total.learning + node.total.review > 0;
  }
}
