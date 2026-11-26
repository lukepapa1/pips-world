# Pip's World

Pip lives in a small village. The agent server is his schedule and his memory. The world is a window onto that.

## Deploy

Railway’s Railpack builds this repo with no custom builder. The root `package.json` has `engines.node`, `npm run build`, and `npm start`. The server listens on `0.0.0.0` and `PORT`. Leave the service builder on Railpack. A `Dockerfile` is in the repo if you later switch the builder yourself. Do not set one for the normal deploy.

1. Push this repository to GitHub. Do not commit `.env`.
2. In Railway, create a project and deploy from that GitHub repo. Railpack installs dependencies, runs `npm run build`, then `npm start`. The health check is `GET /health`.
3. Add a volume and set its mount path to `/data`.
4. Set the service variables. `PORT` is provided by Railway. Set at least:

   - `DATA_DIR=/data`
   - `OWNER_PASSWORD` to a password of 8 characters or more. This is the only login.
   - `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`
   - `SEARCH_API=tavily` and `SEARCH_API_KEY` if Pip should be able to look things up
   - `WORLD_URL` to the public `https://` address Railway gives the service, so a digest notification opens the right page
   - `NTFY_SERVER` and `NTFY_TOPIC` if you want the daily digest pushed to your phone
   - `SEASON_MODE=real` and `SEASON_HEMISPHERE=south` (or `north`)

   Leave the cap and timing variables empty unless you want to override a default. The full list, with secrets marked, is in `.env.example`.
5. Deploy. Railway builds the image, starts `npm start`, and waits until `/health` returns ok.
6. Open the service URL. The village stays behind the password. After login, the same site approves mailbox requests, pauses Pip, and chats with him.
7. To keep the Pip you already have, copy `data/pips.sqlite`, `memory/`, and `published/` onto the volume before the first boot. An empty volume starts a new database. The files inside `/data` survive redeploys. The container disk does not.

A shutdown (a new deploy, or stopping the service) lets the current hour finish, then closes the database.

To run that same production build on this computer:

```bash
npm run build
OWNER_PASSWORD='choose-a-long-password' npm start
```

Open `http://localhost:3001` and log in. `npm run dev` is the split dev server and does not ask for a password until `OWNER_PASSWORD` is set.
