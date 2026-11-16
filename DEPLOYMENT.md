# Deployment

Ride Board runs in Docker behind an Nginx reverse proxy at:

```
https://tommcl.co.uk/ride
```

Next.js is configured with `basePath: "/ride"` (see [next.config.ts](next.config.ts)), so all pages, assets and API routes are served under `/ride`. The container uses Next's **standalone** output.

## Build and run from source with Docker Compose (not for the small server)

Create a `.env` file next to `docker-compose.yml` (Compose reads it automatically; it is not copied into the image):

```bash
ADMIN_PASSWORD=choose-a-strong-password
SESSION_SECRET=$(openssl rand -base64 32)   # paste the generated value
# HOST_PORT=3020                            # optional
```

Then:

```bash
docker compose up -d --build
docker compose logs -f
```

- The app is published on `127.0.0.1:3020` only (override with `HOST_PORT`). Nginx is the public entry point.
- A named volume `ride-data` is mounted at `/app/data`, so `rides.json` survives rebuilds and restarts. The data is not part of the image.
- Compose refuses to start if `ADMIN_PASSWORD` or `SESSION_SECRET` is missing.

Stop with `docker compose down`. This keeps the volume; `docker compose down -v` deletes all rides.

Run a single container: the JSON file store does not support several processes writing the same file.

## Deploy from your Mac (prebuilt image)

The server (1 vCPU, 1 GB RAM, nearly full disk) should not build Next.js itself. Build the `linux/amd64` image on your Mac and stream it over SSH:

```bash
cd "/Users/thomasmclaughlin/Documents/Code Projects/ride-page"

# 1. Build for the server's CPU (about 1 minute)
docker buildx build --platform linux/amd64 -t ride-board:latest --load .

# 2. Copy the image (about 80 MB) and the compose file
docker save ride-board:latest | gzip | ssh root@68.183.35.230 'gunzip | docker load'
ssh root@68.183.35.230 'mkdir -p /root/ride-board'
scp docker-compose.prod.yml root@68.183.35.230:/root/ride-board/docker-compose.yml
```

On the server, once:

```bash
cd /root/ride-board
ss -ltn | grep 3020 || echo "3020 free"
printf 'ADMIN_PASSWORD=%s\nSESSION_SECRET=%s\n' 'your-strong-password' "$(openssl rand -base64 32)" > .env
chmod 600 .env
docker compose up -d
curl -I http://127.0.0.1:3020/ride     # expect 200
```

To update later, repeat the three Mac commands, then on the server `cd /root/ride-board && docker compose up -d && docker image prune -f`.

## Nginx reverse proxy

Add this inside the existing `server { ... server_name tommcl.co.uk; }` block, next to `/whist`:

```nginx
location /ride {
    proxy_pass http://127.0.0.1:3020;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Notes:

- It only matches paths starting with `/ride`, so the other apps and the homepage (`location /`) are untouched.
- `proxy_pass` has no URI part, so the full `/ride/...` path reaches Next unchanged.
- Do not add a `return 301 /ride/;` rule. Next redirects `/ride/` to `/ride`, so it would loop.
- The login cookie is `Secure`, so the site must be served over HTTPS (it is).

Back up the config, test and reload (reload does not drop existing connections):

```bash
cp /etc/nginx/sites-available/tommcl.co.uk /root/tommcl.co.uk.bak   # use your actual file name
nginx -t && systemctl reload nginx
curl -I https://tommcl.co.uk/ride
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | none | Admin login password (required) |
| `SESSION_SECRET` | none | Signs the session cookie, 16+ characters (required) |
| `DATA_FILE_PATH` | `/app/data/rides.json` in Docker | Where rides are stored |
| `NEXT_PUBLIC_BASE_PATH` | `/ride` | Base path. Fixed at build time (set in the Dockerfile) |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | Listen address inside the container |
| `HOST_PORT` (compose only) | `3020` | Host port published on localhost |

## Backing up

```bash
docker compose cp ride:/app/data/rides.json ./rides-backup-$(date +%Y%m%d).json
```

Restore:

```bash
docker compose cp ./rides-backup-20260101.json ride:/app/data/rides.json
docker compose restart
```

## Updating

Repeat the three Mac commands in "Deploy from your Mac", then on the server run `docker compose up -d && docker image prune -f`.

## Local development

`npm run dev` serves at `http://localhost:3000/ride`. To run at the site root instead:

```bash
NEXT_PUBLIC_BASE_PATH= npm run dev
```
