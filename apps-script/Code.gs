// Google Apps Script that lets the bird ranker save rankings into one Drive folder.
// Deploy: script.google.com -> New project -> paste this file -> Deploy -> New deployment ->
// type "Web app", Execute as "Me", Who has access "Anyone" -> copy the /exec URL into
// js/config.js. The script runs as you, so you need edit access to the folder below.
const FOLDER_ID = '18RltIeHC0eB83GNkxEDy7A4CHyJo6-wj';
const MAX_BYTES = 3 * 1024 * 1024;
const PREFIX = 'bird-ranking-';

const out = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const fileName = (nick) => `${PREFIX}${nick.replace(/[^\w\- ]/g, '_')}.birdrank`;

// Files are either gzip (1f 8b) or the raw "BRK1" format. Apps Script bytes are signed.
function looksLikeRanking(b) {
  return (b[0] === 31 && b[1] === -117) || (b[0] === 66 && b[1] === 82 && b[2] === 75 && b[3] === 49);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const nick = String(body.nickname || '').trim();
    if (!nick || nick.length > 30) return out({ error: 'bad nickname' });
    const bytes = Utilities.base64Decode(String(body.data || ''));
    if (bytes.length < 8 || bytes.length > MAX_BYTES || !looksLikeRanking(bytes)) return out({ error: 'not a ranking file' });
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const name = fileName(nick);
    const old = folder.getFilesByName(name);
    while (old.hasNext()) old.next().setTrashed(true);
    const file = folder.createFile(Utilities.newBlob(bytes, 'application/octet-stream', name));
    file.setDescription(nick);
    return out({ ok: true, name });
  } catch (err) {
    return out({ error: 'bad request' });
  }
}

function doGet(e) {
  try {
    const folder = DriveApp.getFolderById(FOLDER_ID);
    if (e.parameter.action === 'list') {
      const files = [];
      const it = folder.getFiles();
      while (it.hasNext()) {
        const f = it.next();
        if (f.getName().indexOf(PREFIX) === 0) files.push({ id: f.getId(), name: f.getName(), updated: f.getLastUpdated().getTime() });
      }
      return out({ files });
    }
    if (e.parameter.action === 'get') {
      const f = DriveApp.getFileById(e.parameter.id);
      const inFolder = f.getParents().hasNext() && f.getParents().next().getId() === FOLDER_ID;
      if (!inFolder || f.getName().indexOf(PREFIX) !== 0) return out({ error: 'not found' });
      return out({ name: f.getName(), data: Utilities.base64Encode(f.getBlob().getBytes()) });
    }
    return out({ error: 'unknown action' });
  } catch (err) {
    return out({ error: 'bad request' });
  }
}
