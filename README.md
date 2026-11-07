# Bird ranker

Rank Wingspan birds in head-to-head duels. It is a fully static site: no server, and every
ranking is saved in the browser of the device you use.

## Run on your phone for free (GitHub Pages)

1. Push this repo to GitHub (a free account is enough).
2. In the repo, open Settings, then Pages, and set Source to "GitHub Actions".
3. Push to `master` (or `main`). The workflow in `.github/workflows/pages.yml` publishes the site
   at `https://<your-user>.github.io/<repo>/`.
4. Open that address on your phone. In the browser menu choose "Add to Home Screen" so it opens
   like an app.

Picks live in the phone's browser storage. Use Export on the rankings screen now and then as a
backup, because clearing site data (or iOS clearing storage for sites you haven't opened in a
while) removes them. To merge several people's rankings, open `combine.html` and add their
exported files.

## Save rankings to Google Drive (optional)

The site can back up each person's ranking into one Drive folder through a small Google Apps
Script that you deploy once (it runs as you, so no server is needed):

1. Go to https://script.google.com, create a project, and paste in `apps-script/Code.gs`. The folder
   ID at the top is already set to your shared folder; you need edit access to it.
2. Deploy, New deployment, type "Web app", Execute as "Me", Who has access "Anyone". Approve the
   permission prompt and copy the Web app URL (ends in `/exec`).
3. Paste that URL into `js/config.js` and push again.

Then the rankings screen shows "Save to Drive", and the app also saves automatically every 50
picks. `combine.html` gets a "Load everyone's rankings from Drive" button that builds the combined
ranking from all saved files. Each person has one file, `bird-ranking-<nickname>.birdrank`, which a
new save replaces.

Anyone who finds the Web app URL can write ranking files into that folder, so don't share the
site publicly if that matters. The script only accepts ranking-format files up to 3 MB.

## Run locally

```bash
python3 -m http.server 8137   # http://localhost:8137
npm test
```
