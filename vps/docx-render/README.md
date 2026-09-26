# docx-render: the engine that draws the forms

A small HTTP service that runs on a server, listening on `127.0.0.1:8791`
(`DOCX_PORT` changes it), published behind a TLS reverse proxy and called only
by `api/render.js`, which pins its certificate. `npm test` starts a throwaway
copy of it from this directory (see `scripts/with-engine.mjs`).

- `server.mjs` converts .docx to PDF with headless LibreOffice, with a SHA-256
  cache and a profile seeded at start-up.
- `map.mjs` finds the blanks on the drawn page (the named lines and the boxes)
  and returns their positions as **fractions of the page**, never pixels.
- `docx-render.service` is the systemd unit, with an `EnvironmentFile` (mode
  600) that holds `DOCX_KEY`.

## The fonts are not a detail

The forms are set in **Verdana, Arial and Times New Roman**. Without those
exact fonts LibreOffice substitutes others, the lines break in other places and
the page count stops matching the `Page 1 of N` the document prints in its own
footer: the witness form came out with 3 pages where it says 4.

    apt-get install ttf-mscorefonts-installer && fc-cache -f

The service checks this at start-up and says so in its log when one is missing.
The proof that it is right is to compare the number of pages drawn with the
footer field:

    pdftotext -f 1 -l 1 out.pdf - | grep -o "Page 1 of [0-9]*"

## Reading a donation that does not hand over its words

`read.mjs` is the second attempt, and the site only calls it when the first
reading (cheap, on the site itself) comes back with fewer than 200 characters:

- **Scanned PDF**: draw the pages and read them (`pdftoppm` + `tesseract`).
- **Photo**: read it directly; `--psm 1` finds the orientation, `--psm 6` reads
  a plain block, and the one that looks most like words wins.
- **Word from before 2007**: `antiword`, with LibreOffice as the fallback.
- **Spreadsheet**: read the cells.
- **Word file with only a photo inside**: read the photo.

The gatekeeper is the share of real words: a page photographed sideways comes
back as `ouoe (gS mp oomwagoao igi m`, with **0.12** real words against
**0.72 to 0.82** for a page read properly. Below 0.4 it does not go into the
index: nonsense text is worse than an empty file, because search can return it.

    apt-get install tesseract-ocr tesseract-ocr-eng antiword
