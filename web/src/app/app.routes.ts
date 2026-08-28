import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/deck-list/deck-list').then((m) => m.DeckList),
  },
  {
    path: 'study/:deckId',
    loadComponent: () => import('./features/review/review').then((m) => m.Review),
  },
  {
    path: 'options/:optionsId',
    loadComponent: () => import('./features/options/options').then((m) => m.Options),
  },
  {
    path: 'browse',
    loadComponent: () => import('./features/browser/browser').then((m) => m.Browser),
  },
  {
    path: 'stats',
    loadComponent: () => import('./features/stats/stats').then((m) => m.Stats),
  },
  { path: '**', redirectTo: '' },
];
