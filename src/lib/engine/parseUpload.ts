// src/lib/engine/parseUpload.ts
// Import-safe upload text extraction (LIFT V1 app/api/teacher/lessons/parse/route.ts:71–87
// + lib/parsePdf.ts). No next/server, no Supabase — takes a Buffer, returns text.

/** Serverless-safe PDF extraction via unpdf (no canvas/workers) — LIFT V1 lib/parsePdf.ts. */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const { extractText } = await import('unpdf');
  const { text } = await extractText(new Uint8Array(buffer));
  return text.join('\n\n');
}

export async function extractUploadText(
  buffer: Buffer,
  fileType: string,
  fileName: string,
): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (fileType === 'application/pdf' || ext === 'pdf') {
    return extractPdfText(buffer);
  }
  if (
    fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    const mammoth = (await import('mammoth')).default;
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  }
  // txt, md, or other text formats
  return buffer.toString('utf-8');
}
