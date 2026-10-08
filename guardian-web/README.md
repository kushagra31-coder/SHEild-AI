# SHEild Guardian Web

Small local guardian interface built with Vite, vanilla JavaScript, and Supabase Auth.

## Run locally

1. Copy `.env.example` to `.env.local` and set the Supabase project URL and anon/publishable key. Set the API URL if FastAPI is not at `http://localhost:8000/api/v1`.
2. Install and start:

   ```powershell
   npm install
   npm run dev
   ```

3. Open the local URL printed by Vite. Sign in with a Supabase guardian account that has an accepted, non-revoked link.

Only the Supabase anon/publishable key belongs in this browser app. Never put a service-role key in its environment.
