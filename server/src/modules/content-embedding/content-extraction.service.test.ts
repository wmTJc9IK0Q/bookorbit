import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ZipArchive } from 'archiver';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ContentExtractionService } from './content-extraction.service';

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test</dc:title><dc:identifier id="uid">x</dc:identifier></metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`;

const CH1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head>
<body><p>The dragon awoke in the northern keep.</p></body></html>`;

const CH2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>2</title></head>
<body><p>Second chapter text.</p></body></html>`;

async function buildEpub(path: string): Promise<void> {
  const archive = new ZipArchive({ zlib: { level: 0 } });
  const chunks: Buffer[] = [];
  archive.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve);
    archive.on('error', reject);
  });
  archive.append('application/epub+zip', { name: 'mimetype', store: true });
  archive.append(CONTAINER_XML, { name: 'META-INF/container.xml' });
  archive.append(CONTENT_OPF, { name: 'OEBPS/content.opf' });
  archive.append(CH1, { name: 'OEBPS/text/ch1.xhtml' });
  archive.append(CH2, { name: 'OEBPS/text/ch2.xhtml' });
  await archive.finalize();
  await done;
  await writeFile(path, Buffer.concat(chunks));
}

describe('ContentExtractionService', () => {
  let dir: string;
  let epubPath: string;
  const service = new ContentExtractionService();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-content-'));
    epubPath = join(dir, 'test.epub');
    await buildEpub(epubPath);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('extracts one ordered segment per epub chapter', async () => {
    const segments = await service.extractSegments(epubPath, 'epub');
    expect(segments).toEqual(['The dragon awoke in the northern keep.', 'Second chapter text.']);
  });

  it('reports supported formats', () => {
    expect(service.supports('epub')).toBe(true);
    expect(service.supports('KEPUB')).toBe(true);
    expect(service.supports('pdf')).toBe(true);
    expect(service.supports('mobi')).toBe(false);
    expect(service.supports(null)).toBe(false);
  });

  it('returns no segments for unsupported formats', async () => {
    expect(await service.extractSegments(epubPath, 'mobi')).toEqual([]);
  });
});
