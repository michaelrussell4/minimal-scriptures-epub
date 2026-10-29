#!/usr/bin/env node
/**
 * Minimal Scriptures EPUB Generator
 * Builds a clean, minimalist, high-contrast EPUB containing the complete LDS Canon:
 *   1. The Old Testament
 *   2. The New Testament
 *   3. The Book of Mormon
 *   4. The Doctrine and Covenants
 *   5. The Pearl of Great Price
 *
 * Optimized specifically for Kindle Paperwhite e-ink reading.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// XML escaping
function escapeXml(unsafe) {
  if (unsafe === undefined || unsafe === null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Generate XHTML template
function renderXhtml(title, bodyContent) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${bodyContent}
</body>
</html>`;
}

// Minimalist, robust ZIP packager
function createZip(entries, outputPath) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const filenameBuf = Buffer.from(entry.name, 'utf8');
    const isStored = entry.store === true;
    let dataBuf = entry.data;
    if (!Buffer.isBuffer(dataBuf)) dataBuf = Buffer.from(dataBuf, 'utf8');

    const crc = zlib.crc32(dataBuf);
    const uncompressedSize = dataBuf.length;

    let compressedBuf = dataBuf;
    let compressionMethod = 0; // Stored

    if (!isStored) {
      compressedBuf = zlib.deflateRawSync(dataBuf, { level: 9 });
      compressionMethod = 8; // Deflated
    }
    const compressedSize = compressedBuf.length;

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30 + filenameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(compressionMethod, 8); // compression method
    localHeader.writeUInt16LE(0, 10); // file last mod time
    localHeader.writeUInt16LE(0x5021, 12); // file last mod date (2020-01-01)
    localHeader.writeUInt32LE(crc, 14); // crc-32
    localHeader.writeUInt32LE(compressedSize, 18); // compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // uncompressed size
    localHeader.writeUInt16LE(filenameBuf.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra field length
    filenameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedBuf);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46 + filenameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0, 8); // general purpose bit flag
    centralHeader.writeUInt16LE(compressionMethod, 10); // compression method
    centralHeader.writeUInt16LE(0, 12); // last mod time
    centralHeader.writeUInt16LE(0x5021, 14); // last mod date
    centralHeader.writeUInt32LE(crc, 16); // crc-32
    centralHeader.writeUInt32LE(compressedSize, 20); // compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24); // uncompressed size
    centralHeader.writeUInt16LE(filenameBuf.length, 28); // file name length
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header
    filenameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + compressedBuf.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const h of centralHeaders) centralDirSize += h.length;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total number of central directory records
  eocd.writeUInt32LE(centralDirSize, 12); // size of central directory
  eocd.writeUInt32LE(centralDirOffset, 16); // offset of start of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  const finalBuf = Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
  fs.writeFileSync(outputPath, finalBuf);
}

// Safe filename slug
function safeSlug(str) {
  return str
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/[^a-z0-9\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

console.log('Generating Minimal LDS Scriptures EPUB...');

// 1. Read source data
const otData = JSON.parse(fs.readFileSync('old-testament.json', 'utf8'));
const ntData = JSON.parse(fs.readFileSync('new-testament.json', 'utf8'));
const bomData = JSON.parse(fs.readFileSync('book-of-mormon.json', 'utf8'));
const dcData = JSON.parse(fs.readFileSync('doctrine-and-covenants.json', 'utf8'));
const pgpData = JSON.parse(fs.readFileSync('pearl-of-great-price.json', 'utf8'));

// Cover image
const coverJpg = fs.readFileSync('cover.jpg');

// Storage for generated files and TOC data
const oebpsFiles = {};
const spineItems = [];
const tocTree = []; // Nested tree for nav.xhtml and toc.ncx

// Stylesheet
const cssContent = `@charset "UTF-8";

/* ==========================================================================
   Minimal Scriptures - Kindle Paperwhite & E-Reader Optimized Stylesheet
   Pure, clean, high-contrast typography. No clutter.
   ========================================================================== */

@page {
  margin: 1.5em 1em;
}

body {
  font-family: serif;
  font-size: 1em;
  line-height: 1.45;
  color: #000;
  background-color: #fff;
  margin: 0;
  padding: 0;
  text-rendering: optimizeLegibility;
  -webkit-hyphens: auto;
  hyphens: auto;
}

/* Links */
a {
  color: inherit;
  text-decoration: none;
}

a:hover, a:active {
  text-decoration: underline;
}

/* Volume / Section / Book Titles */
.volume-page {
  text-align: center;
  padding: 10vh 1em 2em 1em;
}

h1.volume-title {
  font-size: 2.1em;
  font-weight: normal;
  text-align: center;
  margin: 1.5em 0 0.3em 0;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

p.volume-subtitle {
  font-size: 1.05em;
  font-style: italic;
  text-align: center;
  margin: 0 0 2em 0;
  color: #333;
}

p.volume-desc {
  max-width: 32em;
  margin: 0 auto 2.5em auto;
  font-size: 0.95em;
  line-height: 1.5;
  text-align: center;
}

h1.book-title {
  font-size: 1.75em;
  font-weight: normal;
  text-align: center;
  margin: 1.5em 0 0.25em 0;
  letter-spacing: 0.04em;
}

p.book-subtitle {
  font-size: 0.95em;
  font-style: italic;
  text-align: center;
  margin: 0 0 1.5em 0;
  color: #444;
}

h2.chapter-title {
  font-size: 1.25em;
  font-weight: bold;
  text-align: center;
  margin: 2em 0 0.8em 0;
  page-break-after: avoid;
  break-after: avoid;
}

/* Chapter Jump Navigation at top of books */
nav.chapter-jump {
  text-align: center;
  font-size: 0.85em;
  font-family: sans-serif;
  margin: 1.2em auto 2.2em auto;
  padding: 0.6em 0;
  border-top: 1px solid #ccc;
  border-bottom: 1px solid #ccc;
  line-height: 2.1;
  page-break-after: avoid;
}

nav.chapter-jump span.jump-label {
  font-weight: bold;
  margin-right: 0.4em;
}

nav.chapter-jump a {
  display: inline-block;
  padding: 0.1em 0.4em;
  margin: 0 0.1em;
  min-width: 1.4em;
  border-radius: 2px;
}

/* Original plate headings */
p.heading {
  font-size: 0.92em;
  font-style: italic;
  line-height: 1.45;
  margin: 1.2em 1.5em;
  text-align: justify;
  color: #222;
}

/* Scripture Verses */
p.v {
  margin: 0.3em 0;
  text-align: justify;
  text-justify: inter-word;
}

span.vn {
  font-family: sans-serif;
  font-weight: bold;
  font-size: 0.72em;
  vertical-align: super;
  line-height: 0;
  margin-right: 0.35em;
  color: #000;
}

/* Signatures & Notes */
p.signature {
  text-align: right;
  font-style: italic;
  margin: 1.5em 1em 2em 0;
}

p.the-end {
  text-align: center;
  font-style: italic;
  font-size: 1.1em;
  margin: 3em 0;
  letter-spacing: 0.05em;
}

p.facsimile-note {
  font-style: italic;
  font-size: 0.9em;
  margin: 1em 0;
}

ol.facsimile-explanations {
  margin: 1em 0 2em 1.5em;
  padding: 0;
  line-height: 1.45;
  font-size: 0.95em;
}

ol.facsimile-explanations li {
  margin-bottom: 0.5em;
}

/* Table of Contents & Navigation Lists */
.toc-container {
  padding: 2em 1em;
}

.toc-container h1 {
  text-align: center;
  font-size: 1.9em;
  font-weight: normal;
  letter-spacing: 0.06em;
  margin-bottom: 1.5em;
}

.toc-volume-block {
  margin: 2em 0;
}

.toc-volume-title {
  font-size: 1.25em;
  font-weight: bold;
  border-bottom: 1px solid #aaa;
  padding-bottom: 0.25em;
  margin-bottom: 0.6em;
}

.toc-book-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4em;
  list-style: none;
  padding: 0;
  margin: 0.5em 0;
}

.toc-book-list li {
  margin: 0.2em;
}

.toc-book-list a {
  display: inline-block;
  padding: 0.25em 0.6em;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 0.9em;
  text-align: center;
}

.section-part-jump {
  text-align: center;
  margin: 1.5em 0 2.5em 0;
  font-size: 0.9em;
}

.section-part-jump a {
  display: inline-block;
  margin: 0.3em;
  padding: 0.3em 0.7em;
  border: 1px solid #ccc;
  border-radius: 3px;
}

/* Cover page */
.cover-page {
  text-align: center;
  margin: 0;
  padding: 0;
}

.cover-image {
  max-width: 100%;
  max-height: 100vh;
  height: auto;
  object-fit: contain;
}

/* Title Page */
.title-page {
  text-align: center;
  padding: 20vh 1.5em 2em 1.5em;
}

.title-page h1 {
  font-size: 2.3em;
  font-weight: normal;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  margin-bottom: 0.3em;
}

.title-page .sub {
  font-size: 1.1em;
  font-style: italic;
  margin-bottom: 2em;
  color: #333;
}

.title-page .desc {
  max-width: 28em;
  margin: 0 auto;
  font-size: 0.95em;
  line-height: 1.55;
  color: #333;
}

.title-page .meta {
  margin-top: 3em;
  font-size: 0.85em;
  color: #666;
}

/* Witness Testimonies */
.testimony-block {
  margin: 3em auto;
  max-width: 32em;
}

.testimony-title {
  text-align: center;
  font-size: 1.3em;
  margin-bottom: 1.2em;
}

.testimony-text {
  text-align: justify;
  line-height: 1.5;
  margin-bottom: 1.5em;
}

.testimony-names {
  text-align: center;
  font-style: italic;
  line-height: 1.6;
}

/* Navigation between parts */
.part-nav {
  text-align: center;
  font-size: 0.95em;
  font-weight: bold;
  margin: 3em 0;
  padding: 1em 0;
  border-top: 1px solid #ddd;
}
`;

oebpsFiles['style.css'] = cssContent;

// 2. Cover Page
oebpsFiles['cover.xhtml'] = renderXhtml(
  'Cover',
  `<div class="cover-page">
  <img src="cover.jpg" alt="The Scriptures - LDS Canon" class="cover-image"/>
</div>`
);
spineItems.push({ id: 'cover', href: 'cover.xhtml' });

// 3. Title Page
oebpsFiles['title.xhtml'] = renderXhtml(
  'Title',
  `<div class="title-page">
  <h1>The Scriptures</h1>
  <p class="sub">The LDS Canon of Holy Scripture</p>
  <p class="desc">
    A minimalist, fast, and high-contrast digital edition of the standard works:
    The Old Testament, The New Testament, The Book of Mormon, The Doctrine and Covenants,
    and The Pearl of Great Price.
  </p>
  <div class="meta">
    <p>Distraction-free typography optimized for Amazon Kindle Paperwhite.</p>
    <p>Public Domain Text • Clean LDS Edition</p>
  </div>
</div>`
);
spineItems.push({ id: 'title', href: 'title.xhtml' });

// 4. In-book Table of Contents Page
function generateInBookToc() {
  let html = `<div class="toc-container">
  <h1>Table of Contents</h1>
  
  <div class="toc-volume-block">
    <div class="toc-volume-title"><a href="vol-1-ot.xhtml">The Old Testament</a></div>
    <ul class="toc-book-list">
      ${otData.books.map((b, i) => `<li><a href="ot-${String(i+1).padStart(2, '0')}-${safeSlug(b.book)}.xhtml">${escapeXml(b.book)}</a></li>`).join('\n      ')}
    </ul>
  </div>

  <div class="toc-volume-block">
    <div class="toc-volume-title"><a href="vol-2-nt.xhtml">The New Testament</a></div>
    <ul class="toc-book-list">
      ${ntData.books.map((b, i) => `<li><a href="nt-${String(i+1).padStart(2, '0')}-${safeSlug(b.book)}.xhtml">${escapeXml(b.book)}</a></li>`).join('\n      ')}
    </ul>
  </div>

  <div class="toc-volume-block">
    <div class="toc-volume-title"><a href="vol-3-bom.xhtml">The Book of Mormon</a></div>
    <ul class="toc-book-list">
      <li><a href="bom-00-frontmatter.xhtml">Title Page &amp; Testimonies</a></li>
      ${bomData.books.map((b, i) => {
        const num = String(i+1).padStart(2, '0');
        const href = b.book === 'Alma' ? 'bom-09a-alma.xhtml' : `bom-${num}-${safeSlug(b.book)}.xhtml`;
        return `<li><a href="${href}">${escapeXml(b.book)}</a></li>`;
      }).join('\n      ')}
    </ul>
  </div>

  <div class="toc-volume-block">
    <div class="toc-volume-title"><a href="vol-4-dc.xhtml">The Doctrine and Covenants</a></div>
    <div class="section-part-jump">
      <a href="dc-01.xhtml">Sections 1–25</a>
      <a href="dc-02.xhtml">Sections 26–50</a>
      <a href="dc-03.xhtml">Sections 51–75</a>
      <a href="dc-04.xhtml">Sections 76–100</a>
      <a href="dc-05.xhtml">Sections 101–120</a>
      <a href="dc-06.xhtml">Sections 121–138</a>
    </div>
  </div>

  <div class="toc-volume-block">
    <div class="toc-volume-title"><a href="vol-5-pgp.xhtml">The Pearl of Great Price</a></div>
    <ul class="toc-book-list">
      ${pgpData.books.map((b, i) => `<li><a href="pgp-${String(i+1).padStart(2, '0')}-${safeSlug(b.book)}.xhtml">${escapeXml(b.book)}</a></li>`).join('\n      ')}
    </ul>
  </div>
</div>`;

  return renderXhtml('Table of Contents', html);
}

oebpsFiles['toc.xhtml'] = generateInBookToc();
spineItems.push({ id: 'toc', href: 'toc.xhtml' });

// Build TOC tree for nav.xhtml and toc.ncx
// Root entries
tocTree.push({ title: 'Table of Contents', href: 'toc.xhtml', children: [] });

// -------------------------------------------------------------
// Volume 1: Old Testament
// -------------------------------------------------------------
console.log('Processing Volume 1: Old Testament...');
const otTocChildren = [];

// OT Volume Page
oebpsFiles['vol-1-ot.xhtml'] = renderXhtml(
  'The Old Testament',
  `<div class="volume-page">
  <h1 class="volume-title">The Old Testament</h1>
  <p class="volume-subtitle">The King James Version</p>
  <p class="volume-desc">The sacred record of God's dealings with the patriarchs and prophets from the Creation down to the closing of the prophetic era.</p>
  <ul class="toc-book-list">
    ${otData.books.map((b, i) => `<li><a href="ot-${String(i+1).padStart(2, '0')}-${safeSlug(b.book)}.xhtml">${escapeXml(b.book)}</a></li>`).join('\n    ')}
  </ul>
</div>`
);
spineItems.push({ id: 'vol-1-ot', href: 'vol-1-ot.xhtml' });

otData.books.forEach((book, bIdx) => {
  const fileId = `ot-${String(bIdx + 1).padStart(2, '0')}-${safeSlug(book.book)}`;
  const fileName = `${fileId}.xhtml`;

  let bodyHtml = `<section id="${fileId}" epub:type="part">
  <h1 class="book-title">${escapeXml(book.full_title || book.book)}</h1>`;

  if (book.full_subtitle) {
    bodyHtml += `\n  <p class="book-subtitle">${escapeXml(book.full_subtitle)}</p>`;
  }

  // Chapter jump navigation if more than 1 chapter
  if (book.chapters.length > 1) {
    bodyHtml += `\n  <nav class="chapter-jump" aria-label="Chapters">
    <span class="jump-label">Chapters:</span>`;
    book.chapters.forEach(c => {
      bodyHtml += ` <a href="#ch-${c.chapter}">${c.chapter}</a>`;
    });
    bodyHtml += `\n  </nav>`;
  }

  const bookTocChildren = [];

  book.chapters.forEach(chap => {
    const chapId = `ch-${chap.chapter}`;
    const isPsalm = book.book === 'Psalms';
    const chapTitle = isPsalm ? `Psalm ${chap.chapter}` : `Chapter ${chap.chapter}`;

    bookTocChildren.push({
      title: chapTitle,
      href: `${fileName}#${chapId}`,
      children: []
    });

    bodyHtml += `\n  <section id="${chapId}" epub:type="chapter">`;
    if (book.chapters.length > 1 || !book.full_title) {
      bodyHtml += `\n    <h2 class="chapter-title">${escapeXml(chapTitle)}</h2>`;
    }

    if (chap.heading) {
      bodyHtml += `\n    <p class="heading">${escapeXml(chap.heading)}</p>`;
    }

    chap.verses.forEach(v => {
      bodyHtml += `\n    <p class="v"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`;
    });

    bodyHtml += `\n  </section>`;
  });

  // Old Testament ending note on Malachi
  if (bIdx === otData.books.length - 1 && otData.the_end) {
    bodyHtml += `\n  <p class="the-end">${escapeXml(otData.the_end)}</p>`;
  }

  bodyHtml += `\n</section>`;

  oebpsFiles[fileName] = renderXhtml(book.book, bodyHtml);
  spineItems.push({ id: fileId, href: fileName });

  otTocChildren.push({
    title: book.book,
    href: fileName,
    children: bookTocChildren
  });
});

tocTree.push({
  title: 'The Old Testament',
  href: 'vol-1-ot.xhtml',
  children: otTocChildren
});

// -------------------------------------------------------------
// Volume 2: New Testament
// -------------------------------------------------------------
console.log('Processing Volume 2: New Testament...');
const ntTocChildren = [];

// NT Volume Page
oebpsFiles['vol-2-nt.xhtml'] = renderXhtml(
  'The New Testament',
  `<div class="volume-page">
  <h1 class="volume-title">The New Testament</h1>
  <p class="volume-subtitle">Of Our Lord and Saviour Jesus Christ</p>
  <p class="volume-desc">Translated out of the Original Greek: and with the Former Translations Diligently Compared and Revised, by His Majesty's Special Command.</p>
  <ul class="toc-book-list">
    ${ntData.books.map((b, i) => `<li><a href="nt-${String(i+1).padStart(2, '0')}-${safeSlug(b.book)}.xhtml">${escapeXml(b.book)}</a></li>`).join('\n    ')}
  </ul>
</div>`
);
spineItems.push({ id: 'vol-2-nt', href: 'vol-2-nt.xhtml' });

ntData.books.forEach((book, bIdx) => {
  const fileId = `nt-${String(bIdx + 1).padStart(2, '0')}-${safeSlug(book.book)}`;
  const fileName = `${fileId}.xhtml`;

  let bodyHtml = `<section id="${fileId}" epub:type="part">
  <h1 class="book-title">${escapeXml(book.full_title || book.book)}</h1>`;

  if (book.full_subtitle) {
    bodyHtml += `\n  <p class="book-subtitle">${escapeXml(book.full_subtitle)}</p>`;
  }

  if (book.chapters.length > 1) {
    bodyHtml += `\n  <nav class="chapter-jump" aria-label="Chapters">
    <span class="jump-label">Chapters:</span>`;
    book.chapters.forEach(c => {
      bodyHtml += ` <a href="#ch-${c.chapter}">${c.chapter}</a>`;
    });
    bodyHtml += `\n  </nav>`;
  }

  const bookTocChildren = [];

  book.chapters.forEach(chap => {
    const chapId = `ch-${chap.chapter}`;
    const chapTitle = `Chapter ${chap.chapter}`;

    bookTocChildren.push({
      title: chapTitle,
      href: `${fileName}#${chapId}`,
      children: []
    });

    bodyHtml += `\n  <section id="${chapId}" epub:type="chapter">`;
    if (book.chapters.length > 1) {
      bodyHtml += `\n    <h2 class="chapter-title">${escapeXml(chapTitle)}</h2>`;
    }

    if (chap.heading) {
      bodyHtml += `\n    <p class="heading">${escapeXml(chap.heading)}</p>`;
    }

    chap.verses.forEach(v => {
      bodyHtml += `\n    <p class="v"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`;
    });

    bodyHtml += `\n  </section>`;
  });

  bodyHtml += `\n</section>`;

  oebpsFiles[fileName] = renderXhtml(book.book, bodyHtml);
  spineItems.push({ id: fileId, href: fileName });

  ntTocChildren.push({
    title: book.book,
    href: fileName,
    children: bookTocChildren
  });
});

tocTree.push({
  title: 'The New Testament',
  href: 'vol-2-nt.xhtml',
  children: ntTocChildren
});

// -------------------------------------------------------------
// Volume 3: Book of Mormon
// -------------------------------------------------------------
console.log('Processing Volume 3: Book of Mormon...');
const bomTocChildren = [];

// BOM Volume Page
oebpsFiles['vol-3-bom.xhtml'] = renderXhtml(
  'The Book of Mormon',
  `<div class="volume-page">
  <h1 class="volume-title">The Book of Mormon</h1>
  <p class="volume-subtitle">Another Testament of Jesus Christ</p>
  <p class="volume-desc">An account written by the hand of Mormon upon plates taken from the plates of Nephi, translated by the gift and power of God.</p>
  <ul class="toc-book-list">
    <li><a href="bom-00-frontmatter.xhtml">Title Page &amp; Testimonies</a></li>
    ${bomData.books.map((b, i) => {
      const num = String(i+1).padStart(2, '0');
      const href = b.book === 'Alma' ? 'bom-09a-alma.xhtml' : `bom-${num}-${safeSlug(b.book)}.xhtml`;
      return `<li><a href="${href}">${escapeXml(b.book)}</a></li>`;
    }).join('\n    ')}
  </ul>
</div>`
);
spineItems.push({ id: 'vol-3-bom', href: 'vol-3-bom.xhtml' });

// BOM Front Matter (Title Page & Testimonies)
let bomFrontMatterHtml = `<section id="bom-frontmatter">
  <div class="title-page">
    <h1>The Book of Mormon</h1>
    <p class="sub">${escapeXml(bomData.title_page.subtitle)}</p>
    ${bomData.title_page.text.map(p => `<p class="desc">${escapeXml(p)}</p>`).join('\n    ')}
    <p class="signature">${escapeXml(bomData.title_page.translated_by)}</p>
  </div>`;

if (bomData.testimonies) {
  bomData.testimonies.forEach(t => {
    bomFrontMatterHtml += `\n  <div class="testimony-block">
    <h2 class="testimony-title">${escapeXml(t.title)}</h2>
    <p class="testimony-text">${escapeXml(t.text)}</p>
    <div class="testimony-names">
      ${t.witnesses.map(w => `<p>${escapeXml(w)}</p>`).join('\n      ')}
    </div>
  </div>`;
  });
}
bomFrontMatterHtml += `\n</section>`;

oebpsFiles['bom-00-frontmatter.xhtml'] = renderXhtml('Title Page & Testimonies', bomFrontMatterHtml);
spineItems.push({ id: 'bom-00-frontmatter', href: 'bom-00-frontmatter.xhtml' });
bomTocChildren.push({
  title: 'Title Page & Testimonies',
  href: 'bom-00-frontmatter.xhtml',
  children: []
});

// Process BOM Books (Split Alma into 2 parts for Kindle Paperwhite performance)
bomData.books.forEach((book, bIdx) => {
  const bNum = String(bIdx + 1).padStart(2, '0');

  if (book.book === 'Alma') {
    // Split Alma into Alma 1-29 and Alma 30-63
    const alma1Chapters = book.chapters.filter(c => c.chapter <= 29);
    const alma2Chapters = book.chapters.filter(c => c.chapter >= 30);

    // Part 1
    const file1Id = 'bom-09a-alma';
    const file1Name = 'bom-09a-alma.xhtml';
    let body1 = `<section id="${file1Id}" epub:type="part">
  <h1 class="book-title">The Book of Alma</h1>
  <p class="book-subtitle">${escapeXml(book.full_subtitle || 'Chapters 1–29')}</p>`;

    if (book.heading) {
      body1 += `\n  <p class="heading">${escapeXml(book.heading)}</p>`;
    }

    body1 += `\n  <nav class="chapter-jump" aria-label="Chapters">
    <span class="jump-label">Chapters:</span>`;
    alma1Chapters.forEach(c => {
      body1 += ` <a href="#ch-${c.chapter}">${c.chapter}</a>`;
    });
    body1 += `\n  </nav>`;

    const alma1Toc = [];
    alma1Chapters.forEach(chap => {
      const chapId = `ch-${chap.chapter}`;
      const chapTitle = `Chapter ${chap.chapter}`;
      alma1Toc.push({ title: chapTitle, href: `${file1Name}#${chapId}`, children: [] });

      body1 += `\n  <section id="${chapId}" epub:type="chapter">
    <h2 class="chapter-title">${escapeXml(chapTitle)}</h2>`;
      if (chap.heading) {
        body1 += `\n    <p class="heading">${escapeXml(chap.heading)}</p>`;
      }
      chap.verses.forEach(v => {
        body1 += `\n    <p class="v"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`;
      });
      body1 += `\n  </section>`;
    });

    body1 += `\n  <div class="part-nav"><a href="bom-09b-alma.xhtml">Continue to Alma Chapter 30 →</a></div>
</section>`;
    oebpsFiles[file1Name] = renderXhtml('Alma (Part 1, Ch 1–29)', body1);
    spineItems.push({ id: file1Id, href: file1Name });

    // Part 2
    const file2Id = 'bom-09b-alma';
    const file2Name = 'bom-09b-alma.xhtml';
    let body2 = `<section id="${file2Id}" epub:type="part">
  <h1 class="book-title">The Book of Alma (Continued)</h1>
  <p class="book-subtitle">Chapters 30–63</p>`;

    body2 += `\n  <nav class="chapter-jump" aria-label="Chapters">
    <span class="jump-label">Chapters:</span>`;
    alma2Chapters.forEach(c => {
      body2 += ` <a href="#ch-${c.chapter}">${c.chapter}</a>`;
    });
    body2 += `\n  </nav>`;

    const alma2Toc = [];
    alma2Chapters.forEach(chap => {
      const chapId = `ch-${chap.chapter}`;
      const chapTitle = `Chapter ${chap.chapter}`;
      alma2Toc.push({ title: chapTitle, href: `${file2Name}#${chapId}`, children: [] });

      body2 += `\n  <section id="${chapId}" epub:type="chapter">
    <h2 class="chapter-title">${escapeXml(chapTitle)}</h2>`;
      if (chap.heading) {
        body2 += `\n    <p class="heading">${escapeXml(chap.heading)}</p>`;
      }
      chap.verses.forEach(v => {
        body2 += `\n    <p class="v"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`;
      });
      body2 += `\n  </section>`;
    });
    body2 += `\n</section>`;
    oebpsFiles[file2Name] = renderXhtml('Alma (Part 2, Ch 30–63)', body2);
    spineItems.push({ id: file2Id, href: file2Name });

    bomTocChildren.push({
      title: 'Alma',
      href: file1Name,
      children: [...alma1Toc, ...alma2Toc]
    });
    return;
  }

  const fileId = `bom-${bNum}-${safeSlug(book.book)}`;
  const fileName = `${fileId}.xhtml`;

  let bodyHtml = `<section id="${fileId}" epub:type="part">
  <h1 class="book-title">${escapeXml(book.full_title || book.book)}</h1>`;

  if (book.full_subtitle) {
    bodyHtml += `\n  <p class="book-subtitle">${escapeXml(book.full_subtitle)}</p>`;
  }

  if (book.heading) {
    bodyHtml += `\n  <p class="heading">${escapeXml(book.heading)}</p>`;
  }

  if (book.chapters.length > 1) {
    bodyHtml += `\n  <nav class="chapter-jump" aria-label="Chapters">
    <span class="jump-label">Chapters:</span>`;
    book.chapters.forEach(c => {
      bodyHtml += ` <a href="#ch-${c.chapter}">${c.chapter}</a>`;
    });
    bodyHtml += `\n  </nav>`;
  }

  const bookTocChildren = [];

  book.chapters.forEach(chap => {
    const chapId = `ch-${chap.chapter}`;
    const chapTitle = `Chapter ${chap.chapter}`;

    bookTocChildren.push({
      title: chapTitle,
      href: `${fileName}#${chapId}`,
      children: []
    });

    bodyHtml += `\n  <section id="${chapId}" epub:type="chapter">`;
    if (book.chapters.length > 1) {
      bodyHtml += `\n    <h2 class="chapter-title">${escapeXml(chapTitle)}</h2>`;
    }

    if (chap.heading) {
      bodyHtml += `\n    <p class="heading">${escapeXml(chap.heading)}</p>`;
    }

    chap.verses.forEach(v => {
      bodyHtml += `\n    <p class="v"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`;
    });

    bodyHtml += `\n  </section>`;
  });

  bodyHtml += `\n</section>`;

  oebpsFiles[fileName] = renderXhtml(book.book, bodyHtml);
  spineItems.push({ id: fileId, href: fileName });

  bomTocChildren.push({
    title: book.book,
    href: fileName,
    children: bookTocChildren
  });
});

tocTree.push({
  title: 'The Book of Mormon',
  href: 'vol-3-bom.xhtml',
  children: bomTocChildren
});

// -------------------------------------------------------------
// Volume 4: Doctrine and Covenants
// -------------------------------------------------------------
console.log('Processing Volume 4: Doctrine and Covenants...');
const dcTocChildren = [];

// D&C Volume Page
oebpsFiles['vol-4-dc.xhtml'] = renderXhtml(
  'The Doctrine and Covenants',
  `<div class="volume-page">
  <h1 class="volume-title">The Doctrine and Covenants</h1>
  <p class="volume-subtitle">Of The Church of Jesus Christ of Latter-day Saints</p>
  <p class="volume-desc">Containing revelations given to Joseph Smith, the Prophet, with some additions by his successors in the Presidency of the Church.</p>
  <div class="section-part-jump">
    <a href="dc-01.xhtml">Sections 1–25</a>
    <a href="dc-02.xhtml">Sections 26–50</a>
    <a href="dc-03.xhtml">Sections 51–75</a>
    <a href="dc-04.xhtml">Sections 76–100</a>
    <a href="dc-05.xhtml">Sections 101–120</a>
    <a href="dc-06.xhtml">Sections 121–138</a>
  </div>
</div>`
);
spineItems.push({ id: 'vol-4-dc', href: 'vol-4-dc.xhtml' });

const dcParts = [
  { id: 'dc-01', start: 1, end: 25, label: 'Sections 1–25' },
  { id: 'dc-02', start: 26, end: 50, label: 'Sections 26–50' },
  { id: 'dc-03', start: 51, end: 75, label: 'Sections 51–75' },
  { id: 'dc-04', start: 76, end: 100, label: 'Sections 76–100' },
  { id: 'dc-05', start: 101, end: 120, label: 'Sections 101–120' },
  { id: 'dc-06', start: 121, end: 138, label: 'Sections 121–138' },
];

dcParts.forEach((part, pIdx) => {
  const fileName = `${part.id}.xhtml`;
  const partSections = dcData.sections.filter(s => s.section >= part.start && s.section <= part.end);

  let bodyHtml = `<section id="${part.id}" epub:type="part">
  <h1 class="book-title">The Doctrine and Covenants</h1>
  <p class="book-subtitle">${escapeXml(part.label)}</p>

  <nav class="chapter-jump" aria-label="Sections">
    <span class="jump-label">Sections:</span>`;
  partSections.forEach(s => {
    bodyHtml += ` <a href="#sec-${s.section}">${s.section}</a>`;
  });
  bodyHtml += `\n  </nav>`;

  const partTocChildren = [];

  partSections.forEach(sec => {
    const secId = `sec-${sec.section}`;
    const secTitle = `Section ${sec.section}`;

    partTocChildren.push({
      title: secTitle,
      href: `${fileName}#${secId}`,
      children: []
    });

    bodyHtml += `\n  <section id="${secId}" epub:type="chapter">
    <h2 class="chapter-title">${escapeXml(secTitle)}</h2>`;

    sec.verses.forEach(v => {
      bodyHtml += `\n    <p class="v"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`;
    });

    if (sec.signature) {
      bodyHtml += `\n    <p class="signature">— ${escapeXml(sec.signature)}</p>`;
    }

    bodyHtml += `\n  </section>`;
  });

  if (pIdx < dcParts.length - 1) {
    const nextPart = dcParts[pIdx + 1];
    bodyHtml += `\n  <div class="part-nav"><a href="${nextPart.id}.xhtml">Continue to ${escapeXml(nextPart.label)} →</a></div>`;
  }

  bodyHtml += `\n</section>`;

  oebpsFiles[fileName] = renderXhtml(`D&C ${part.label}`, bodyHtml);
  spineItems.push({ id: part.id, href: fileName });

  dcTocChildren.push({
    title: part.label,
    href: fileName,
    children: partTocChildren
  });
});

tocTree.push({
  title: 'The Doctrine and Covenants',
  href: 'vol-4-dc.xhtml',
  children: dcTocChildren
});

// -------------------------------------------------------------
// Volume 5: Pearl of Great Price
// -------------------------------------------------------------
console.log('Processing Volume 5: Pearl of Great Price...');
const pgpTocChildren = [];

// PGP Volume Page
oebpsFiles['vol-5-pgp.xhtml'] = renderXhtml(
  'The Pearl of Great Price',
  `<div class="volume-page">
  <h1 class="volume-title">The Pearl of Great Price</h1>
  <p class="volume-subtitle">Of The Church of Jesus Christ of Latter-day Saints</p>
  <p class="volume-desc">A choice selection from the revelations, translations, and narrations of Joseph Smith, First Prophet, Seer, and Revelator.</p>
  <ul class="toc-book-list">
    ${pgpData.books.map((b, i) => `<li><a href="pgp-${String(i+1).padStart(2, '0')}-${safeSlug(b.book)}.xhtml">${escapeXml(b.book)}</a></li>`).join('\n    ')}
  </ul>
</div>`
);
spineItems.push({ id: 'vol-5-pgp', href: 'vol-5-pgp.xhtml' });

pgpData.books.forEach((book, bIdx) => {
  const fileId = `pgp-${String(bIdx + 1).padStart(2, '0')}-${safeSlug(book.book)}`;
  const fileName = `${fileId}.xhtml`;

  let bodyHtml = `<section id="${fileId}" epub:type="part">
  <h1 class="book-title">${escapeXml(book.full_title || book.book)}</h1>`;

  if (book.full_subtitle) {
    bodyHtml += `\n  <p class="book-subtitle">${escapeXml(book.full_subtitle)}</p>`;
  }

  if (book.chapters.length > 1) {
    bodyHtml += `\n  <nav class="chapter-jump" aria-label="Chapters">
    <span class="jump-label">Chapters:</span>`;
    book.chapters.forEach(c => {
      bodyHtml += ` <a href="#ch-${c.chapter}">${c.chapter}</a>`;
    });
    bodyHtml += `\n  </nav>`;
  }

  const bookTocChildren = [];

  book.chapters.forEach(chap => {
    const chapId = `ch-${chap.chapter}`;
    const chapTitle = book.book === 'Articles of Faith' ? 'The Articles of Faith' : `Chapter ${chap.chapter}`;

    bookTocChildren.push({
      title: chapTitle,
      href: `${fileName}#${chapId}`,
      children: []
    });

    bodyHtml += `\n  <section id="${chapId}" epub:type="chapter">`;
    if (book.chapters.length > 1) {
      bodyHtml += `\n    <h2 class="chapter-title">${escapeXml(chapTitle)}</h2>`;
    }

    if (chap.heading) {
      bodyHtml += `\n    <p class="heading">${escapeXml(chap.heading)}</p>`;
    }

    chap.verses.forEach(v => {
      bodyHtml += `\n    <p class="v"><span class="vn">${v.verse}</span>${escapeXml(v.text)}</p>`;
    });

    bodyHtml += `\n  </section>`;
  });

  // Facsimiles in Abraham
  if (book.facsimiles && book.facsimiles.length > 0) {
    bodyHtml += `\n  <section id="facsimiles" class="facsimiles-section">
    <h2 class="chapter-title">Facsimiles from the Book of Abraham</h2>`;

    bookTocChildren.push({
      title: 'Facsimiles from the Book of Abraham',
      href: `${fileName}#facsimiles`,
      children: []
    });

    book.facsimiles.forEach(f => {
      bodyHtml += `\n    <div class="facsimile-block">
      <h3 style="text-align: center; margin: 1.5em 0 0.5em 0; font-size: 1.1em;">${escapeXml(f.title)}</h3>`;
      if (f.note) {
        bodyHtml += `\n      <p class="facsimile-note" style="text-align: center;">${escapeXml(f.note)}</p>`;
      }
      bodyHtml += `\n      <ol class="facsimile-explanations">
        ${f.explanations.map(e => `<li>${escapeXml(e.replace(/^[0-9]+\.\s*/, ''))}</li>`).join('\n        ')}
      </ol>
    </div>`;
    });
    bodyHtml += `\n  </section>`;
  }

  bodyHtml += `\n</section>`;

  oebpsFiles[fileName] = renderXhtml(book.book, bodyHtml);
  spineItems.push({ id: fileId, href: fileName });

  pgpTocChildren.push({
    title: book.book,
    href: fileName,
    children: bookTocChildren
  });
});

tocTree.push({
  title: 'The Pearl of Great Price',
  href: 'vol-5-pgp.xhtml',
  children: pgpTocChildren
});

// -------------------------------------------------------------
// Build EPUB 3 Navigation Document (nav.xhtml)
// -------------------------------------------------------------
console.log('Generating EPUB 3 nav.xhtml...');
function renderNavOl(items) {
  let s = '<ol>\n';
  for (const item of items) {
    s += `  <li><a href="${escapeXml(item.href)}">${escapeXml(item.title)}</a>`;
    if (item.children && item.children.length > 0) {
      s += '\n' + renderNavOl(item.children).split('\n').map(l => '  ' + l).join('\n');
    }
    s += '</li>\n';
  }
  s += '</ol>';
  return s;
}

const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Table of Contents</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1 style="text-align: center; margin-bottom: 1em;">Table of Contents</h1>
    ${renderNavOl(tocTree)}
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <ol>
      <li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
      <li><a epub:type="toc" href="toc.xhtml">Table of Contents</a></li>
      <li><a epub:type="bodymatter" href="vol-1-ot.xhtml">Scriptures</a></li>
    </ol>
  </nav>
</body>
</html>`;

oebpsFiles['nav.xhtml'] = navXhtml;

// -------------------------------------------------------------
// Build EPUB 2 NCX Document (toc.ncx)
// -------------------------------------------------------------
console.log('Generating EPUB 2 toc.ncx for Kindle Paperwhite...');
let playOrder = 1;
function renderNcxNavPoints(items) {
  let xml = '';
  for (const item of items) {
    const curOrder = playOrder++;
    xml += `    <navPoint id="np-${curOrder}" playOrder="${curOrder}">\n`;
    xml += `      <navLabel><text>${escapeXml(item.title)}</text></navLabel>\n`;
    xml += `      <content src="${escapeXml(item.href)}"/>\n`;
    if (item.children && item.children.length > 0) {
      xml += renderNcxNavPoints(item.children);
    }
    xml += `    </navPoint>\n`;
  }
  return xml;
}

const ncxXml = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:scriptures-lds-canon-minimal-2026"/>
    <meta name="dtb:depth" content="4"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>The Scriptures</text></docTitle>
  <docAuthor><text>The Church of Jesus Christ of Latter-day Saints</text></docAuthor>
  <navMap>
${renderNcxNavPoints(tocTree)}  </navMap>
</ncx>`;

oebpsFiles['toc.ncx'] = ncxXml;

// -------------------------------------------------------------
// Build Package Document (content.opf)
// -------------------------------------------------------------
console.log('Generating Package Document content.opf...');
const manifestItems = [
  { id: 'style', href: 'style.css', mediaType: 'text/css' },
  { id: 'cover-image', href: 'cover.jpg', mediaType: 'image/jpeg', properties: 'cover-image' },
  { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' },
  { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
  ...spineItems.map(item => ({
    id: item.id,
    href: item.href,
    mediaType: 'application/xhtml+xml'
  }))
];

const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:scriptures-lds-canon-minimal-2026</dc:identifier>
    <dc:title id="title">The Scriptures</dc:title>
    <meta refines="#title" property="title-type">main</meta>
    <dc:title id="subtitle">The LDS Canon of Holy Scripture</dc:title>
    <meta refines="#subtitle" property="title-type">subtitle</meta>
    <dc:language>en</dc:language>
    <dc:creator>The Church of Jesus Christ of Latter-day Saints</dc:creator>
    <dc:publisher>Minimal Scriptures</dc:publisher>
    <dc:description>A clean, minimalist EPUB edition of the LDS canon of scriptures: The Old Testament, The New Testament, The Book of Mormon, The Doctrine and Covenants, and The Pearl of Great Price. Formatted with high-contrast typography, rapid chapter jumping, and optimized specifically for e-ink reading on Amazon Kindle Paperwhite.</dc:description>
    <dc:rights>Public Domain</dc:rights>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.[0-9]+Z$/, 'Z')}</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
${manifestItems.map(m => `    <item id="${m.id}" href="${m.href}" media-type="${m.mediaType}"${m.properties ? ` properties="${m.properties}"` : ''}/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.map(s => `    <itemref idref="${s.id}"/>`).join('\n')}
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="cover.xhtml"/>
    <reference type="toc" title="Table of Contents" href="toc.xhtml"/>
    <reference type="text" title="Beginning of Text" href="vol-1-ot.xhtml"/>
  </guide>
</package>`;

oebpsFiles['content.opf'] = opfXml;

// -------------------------------------------------------------
// Package into scriptures.epub
// -------------------------------------------------------------
console.log('Packaging scriptures.epub archive...');

const zipEntries = [
  // 1. mimetype MUST be first and STORED (uncompressed)
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  // 2. META-INF/container.xml
  {
    name: 'META-INF/container.xml',
    data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  },
  // 3. Cover image binary
  { name: 'OEBPS/cover.jpg', data: coverJpg }
];

// 4. All OEBPS text files
for (const [name, content] of Object.entries(oebpsFiles)) {
  zipEntries.push({ name: `OEBPS/${name}`, data: content });
}

createZip(zipEntries, 'scriptures.epub');

const epubStats = fs.statSync('scriptures.epub');
console.log(`\nSUCCESS! Created scriptures.epub (${(epubStats.size / (1024 * 1024)).toFixed(2)} MB)`);
console.log(`Total files inside EPUB: ${zipEntries.length}`);
console.log(`Total spine items: ${spineItems.length}`);
