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

### Running the Server

The production server is hardened by default: it requires HTTP Basic authentication credentials via environment variables and refuses to start without them. Use `DEV_MODE=1` to disable hardening for local development.

**Environment variables** (all optional in dev mode, required in production):

- `AUTH_USER` — HTTP Basic username (default: unset; production required)
- `AUTH_PASSWORD` — HTTP Basic password (default: unset; production required)
- `DEV_MODE=1` — disable all security hardening (auth, HTTPS redirect, CORS, import route blocking)
- `PORT` — server listening port (default: `3000`)
- `BODY_LIMIT` — max request body size (default: `2mb`)
- `DATA_DIR` — path to the data store directory (default: `data/spanish/`)

Example (development):

```bash
DEV_MODE=1 npm run start -w server
```

Example (production — credentials from your platform secrets provider, never hardcoded):

```bash
AUTH_USER=<username> AUTH_PASSWORD=<your-password> npm run start -w server
```

The server will refuse to start in production mode (hardened) without valid credentials set.

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
