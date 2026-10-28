# AI Loan Assistant

A full-stack chat application for explaining loans, documentation, EMI, and loan affordability in an Indian context. Users can register, log in, and return to their saved chat.

Calculations are informational estimates and do not guarantee loan approval.

## Features

- Email and password registration and login.
- Markdown chat responses, including tables and lists.
- EMI, total interest, and total repayment calculations.
- Affordability estimates using 50% of monthly salary as the limit for combined existing and new EMIs.
- Persistent chat history and a clear-chat action.

## Tech stack

- **Frontend:** React 19, Vite 8, React Markdown, and remark-gfm.
- **Backend:** Node.js and Express 5.
- **Database:** PostgreSQL through `pg`.
- **Authentication:** bcrypt password hashing and JWTs with a one-hour expiry.
- **AI:** Groq's OpenAI-compatible API through the OpenAI JavaScript SDK, using `openai/gpt-oss-20b`.

## Project structure

```text
ai-loan-assistant/
  public/              Static assets
  server/
    db.js              PostgreSQL connection pool
    server.js          Authentication, chat API, and calculation tools
  src/
    assets/            Image assets
    App.jsx            Chat interface and session management
    Login.jsx          Login form
    Register.jsx       Registration form
    main.jsx           React entry point
    *.css              Application styles
  package.json         Dependencies and frontend scripts
  vite.config.js       Vite configuration
```

## Local setup

### Prerequisites

- Node.js 22.13+ on the 22.x release line, or a newer LTS version compatible with the dependencies.
- npm.
- A running PostgreSQL instance and an application database.
- A Groq API key with access to the configured model.

Run the commands below from the `ai-loan-assistant` directory.

### Install dependencies

```sh
npm ci
```

### Configure the environment

Create `.env` in the project root:

```dotenv
GROQ_API_KEY=your_groq_api_key
JWT_SECRET=replace_with_a_long_random_secret
DATABASE_URL=postgresql://username:password@localhost:5432/ai_loan_assistant
```

Replace the placeholders with your values. These variables are used by the backend. `.env` is ignored by Git; keep credentials out of source control.

### Prepare PostgreSQL

The backend expects `users`, `chat_sessions`, and `messages` tables. It does not create them automatically, and no migrations are included.

For a new, empty database, run this minimal schema in your PostgreSQL SQL client. It matches the current backend queries; it is a setup example, not an existing migration.

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_session_created_at_idx
  ON messages (session_id, created_at);
```

The cascading foreign key on `messages.session_id` lets clearing a session delete its messages too. Inspect existing table definitions before making changes to an existing database.

### Run the application

Start the backend in one terminal:

```sh
node server/server.js
```

The API listens at `http://localhost:5000`. Open `http://localhost:5000/api/test-db` to check database connectivity.

Start the frontend in a second terminal:

```sh
npm run dev
```

Open the URL printed by Vite, register an account, and log in.

## Example questions

- What documents are required for a home loan?
- Calculate the EMI for a loan of 20 lakh at 8.5% annual interest for 20 years.
- My monthly salary is 80,000, my existing EMI is 10,000, and my proposed new EMI is 20,000. Is it affordable?

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the frontend development server |
| `node server/server.js` | Start the backend separately |
| `npm run build` | Build the frontend into `dist/` |
| `npm run preview` | Preview the frontend production build locally |
| `npm run lint` | Run ESLint |

Build and preview cover the frontend only. The Express backend must run separately.

## API routes

Protected routes require an `Authorization: Bearer <token>` header.

| Method | Route | Authentication | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | Public | Register with `name`, `email`, and `password` |
| POST | `/api/auth/login` | Public | Log in and receive a JWT |
| GET | `/api/auth/me` | Required | Return decoded token claims |
| GET | `/api/test-db` | Public | Check database connectivity |
| POST | `/api/chat` | Required | Submit `sessionId` and a `messages` array; receive a `reply` |
| GET | `/api/chat/session/:sessionId` | Required | Load messages for an owned session |
| DELETE | `/api/chat/session/:sessionId` | Required | Delete an owned session |

## Current limitations

- Frontend API URLs are hardcoded to `http://localhost:5000`. Update the fetch URLs in `src/App.jsx`, `src/Login.jsx`, and `src/Register.jsx` before hosting elsewhere.
- JWTs and the current session ID are stored in browser local storage. There is no token refresh flow or automatic return to login when a token expires.
- Model context uses the last 10 messages supplied by the frontend rather than rebuilding history from PostgreSQL.
- EMI and affordability calculations use AI tool calls; missing financial details are requested through chat.
- The EMI tool requires a positive interest rate; zero-interest loans are not supported.
- No automated test suite or database migration tooling is included.
