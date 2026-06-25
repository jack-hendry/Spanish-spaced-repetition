# Spanish-spaced-repetition

An Anki-style flashcard application for learning Spanish, built with Angular and Express. Features SM-2 and FSRS scheduling algorithms, note types (basic, cloze, type-in), card browser with search, and statistics tracking.

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Installation

```bash
# Install dependencies for both web and server workspaces
npm install
```

### Running the Application

```bash
# Start the development server and frontend in parallel
npm run dev
```

This starts:
- **Server**: Express API on `http://localhost:3000`
- **Web**: Angular app on `http://localhost:4200` (proxies `/api` requests to the server)

The app will be available at `http://localhost:4200`

### Import Spanish Content

```bash
# Import flashcard data from the source files into the data store
npm run import
```

### Building for Production

```bash
npm run build
```

This builds both the server and web workspaces.

### Running Tests

```bash
npm run test
```

Runs tests for both server and web workspaces.
