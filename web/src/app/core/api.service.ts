import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import type {
  Card,
  Collection,
  CollectionBundle,
  Deck,
  DeckOptions,
  Note,
  RevlogEntry,
} from './models';

/** Result of editing a note: the saved note plus its reconciled card set. */
export interface NoteSaveResult {
  note: Note;
  cards: Card[];
  removedIds: string[];
}

/** Typed wrapper over the backend REST API. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api';

  getCollection(): Observable<CollectionBundle> {
    return this.http.get<CollectionBundle>(`${this.base}/collection`);
  }

  getCards(deckId?: string): Observable<Card[]> {
    const url =
      deckId != null && deckId !== ''
        ? `${this.base}/cards?deckId=${encodeURIComponent(deckId)}`
        : `${this.base}/cards`;
    return this.http.get<Card[]>(url);
  }

  getNotes(): Observable<Note[]> {
    return this.http.get<Note[]>(`${this.base}/notes`);
  }

  getNote(id: string): Observable<Note> {
    return this.http.get<Note>(`${this.base}/notes/${id}`);
  }

  /** Edit a note; the server reconciles its cards and returns the new set. */
  patchNote(id: string, patch: Partial<Note>): Observable<NoteSaveResult> {
    return this.http.patch<NoteSaveResult>(`${this.base}/notes/${id}`, patch);
  }

  /** Persist a reviewed card and append its revlog entry in one call. */
  submitReview(card: Card, revlog: RevlogEntry): Observable<Card> {
    return this.http.post<Card>(`${this.base}/review`, { card, revlog });
  }

  patchCard(id: string, patch: Partial<Card>): Observable<Card> {
    return this.http.patch<Card>(`${this.base}/cards/${id}`, patch);
  }

  getRevlog(): Observable<RevlogEntry[]> {
    return this.http.get<RevlogEntry[]>(`${this.base}/revlog`);
  }

  patchDeckOptions(id: string, patch: Partial<DeckOptions>): Observable<DeckOptions> {
    return this.http.patch<DeckOptions>(`${this.base}/deckoptions/${id}`, patch);
  }

  patchCollection(patch: Partial<Collection>): Observable<Collection> {
    return this.http.patch<Collection>(`${this.base}/collection`, patch);
  }

  /** Apply the pre-computed absolute `due` values and clear the pause, server-side. */
  resume(payload: {
    expectedPausedAt: number;
    cardUpdates: { id: string; due: number }[];
  }): Observable<{ applied: boolean }> {
    return this.http.post<{ applied: boolean }>(`${this.base}/collection/resume`, payload);
  }

  patchDeck(id: string, patch: Partial<Deck>): Observable<Deck> {
    return this.http.patch<Deck>(`${this.base}/decks/${id}`, patch);
  }

  /**
   * Generic passthrough used **only** by the outbox, which stores ops as
   * `{ method, path, body }` and cannot call a typed method by name. Prefer a
   * typed method above for anything else.
   */
  send(method: 'POST' | 'PATCH', path: string, body: unknown): Observable<unknown> {
    const url = `${this.base}${path}`;
    return method === 'POST'
      ? this.http.post<unknown>(url, body)
      : this.http.patch<unknown>(url, body);
  }
}
