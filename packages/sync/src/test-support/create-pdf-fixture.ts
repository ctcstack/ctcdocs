/**
 * Writes a small, valid PDF: one page per entry, each line of text set in
 * Helvetica. Tests and the fixture corpus use it instead of a real document,
 * so no real content reaches the repository.
 */
function escapeText(value: string): string {
  return value.replace(/[\\()]/gu, '\\$&');
}

export function createPdfFixture(
  pages: readonly (readonly string[])[],
  /** Bytes of filler in an object nothing refers to, to reach a size. */
  padding = 0,
): Uint8Array {
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, index) => {
    const pageId = pageIds[index] ?? 0;
    const stream = [
      'BT',
      '/F1 12 Tf',
      '14 TL',
      '72 720 Td',
      ...lines.map((line) => `(${escapeText(line)}) Tj T*`),
      'ET',
    ].join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  if (padding > 0) {
    objects.push(
      `<< /Length ${padding} >>\nstream\n${' '.repeat(padding)}\nendstream`,
    );
  }

  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output, 'latin1');
    output += `${id} 0 obj\n${objects[id] ?? 'null'}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    output += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output, 'latin1'));
}
