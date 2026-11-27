# Hosting with Docker (outside Railway)

The game is **one Docker image**: the Node server runs the fights and serves the built pages.

```bash
docker build -t mochi-moon .
docker compose -f deploy/docker-compose.yml up -d        # http://<server-ip>:8787
```

Copy to another server: `docker save mochi-moon -o mochi-moon.tar`, copy it with `deploy/docker-compose.yml`, then
`docker load -i mochi-moon.tar && docker compose up -d`.

- Saved builds, fights, towns and replays live in the `mochi-data` volume (`/app/data/db.json`) and survive updates.
- Update: rebuild the image, then `docker compose -f deploy/docker-compose.yml up -d` again.
- Logs: `docker logs -f mochi-moon`. The container checks its own health every 30 s.
- Plain HTTP only: put a reverse proxy with HTTPS (Caddy, nginx) in front for a public site.
