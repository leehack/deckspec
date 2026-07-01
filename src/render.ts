import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import type { RenderReport } from './types.js';
import { ensureDir } from './io.js';

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error) throw new Error(`Failed to run ${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status}: ${result.stderr || result.stdout}`);
}

export async function createContactSheet(pngFiles: string[], output: string): Promise<string> {
  if (pngFiles.length === 0) throw new Error('No PNG files for contact sheet.');
  ensureDir(path.dirname(output));
  const thumbW = 960;
  const thumbH = 540;
  const labelH = 34;
  const gap = 30;
  const cols = Math.min(2, pngFiles.length);
  const rows = Math.ceil(pngFiles.length / cols);
  const sheetW = cols * thumbW + (cols + 1) * gap;
  const sheetH = rows * (thumbH + labelH) + (rows + 1) * gap;
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let i = 0; i < pngFiles.length; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = gap + col * (thumbW + gap);
    const top = gap + row * (thumbH + labelH + gap);
    const image = await sharp(pngFiles[i])
      .resize({ width: thumbW, height: thumbH, fit: 'contain', background: '#07111F' })
      .png()
      .toBuffer();
    const label = Buffer.from(
      `<svg width="${thumbW}" height="${labelH}"><rect width="${thumbW}" height="${labelH}" fill="#020817"/><text x="18" y="23" fill="#B8C3D4" font-family="Arial, sans-serif" font-size="18" font-weight="700">Slide ${i + 1}</text></svg>`,
    );
    composites.push({ input: label, left, top });
    composites.push({ input: image, left, top: top + labelH });
  }
  await sharp({ create: { width: sheetW, height: sheetH, channels: 3, background: '#0B1020' } })
    .composite(composites)
    .jpeg({ quality: 92 })
    .toFile(output);
  return output;
}

export async function renderPptx(
  pptxFile: string,
  outDir = 'render/deckspec',
): Promise<RenderReport> {
  const cwd = process.cwd();
  const absPptx = path.resolve(pptxFile);
  const absOut = path.resolve(outDir);
  const pdfDir = path.join(absOut, 'pdf');
  const pngDir = path.join(absOut, 'png');
  const contactDir = path.join(absOut, 'contact');
  ensureDir(pdfDir);
  ensureDir(pngDir);
  ensureDir(contactDir);
  run('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', pdfDir, absPptx], cwd);
  const pdf = path.join(pdfDir, `${path.basename(absPptx, '.pptx')}.pdf`);
  if (!fs.existsSync(pdf)) throw new Error(`LibreOffice did not produce expected PDF: ${pdf}`);
  for (const file of fs.readdirSync(pngDir))
    if (file.endsWith('.png')) fs.unlinkSync(path.join(pngDir, file));
  const prefix = path.join(pngDir, path.basename(absPptx, '.pptx'));
  run('pdftoppm', ['-png', '-r', '160', pdf, prefix], cwd);
  const pngFiles = fs
    .readdirSync(pngDir)
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => path.join(pngDir, file));
  const contactSheet = await createContactSheet(
    pngFiles,
    path.join(contactDir, `${path.basename(absPptx, '.pptx')}-contact-sheet.jpg`),
  );
  return { status: 'DECKSPEC_RENDER_PASS', pptx: absPptx, pdf, pngFiles, contactSheet };
}
