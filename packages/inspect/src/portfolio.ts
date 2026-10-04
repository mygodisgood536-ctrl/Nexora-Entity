/**
 * Portfolio extraction (Amendment §5).
 *
 * Extracts readable information from uploaded portfolio files: PDF, DOCX, plain text,
 * Markdown, and images. Everything it finds is user-provided evidence unless independently
 * supported, and provenance is preserved (source = the uploaded file).
 */

import mammoth from 'mammoth';
import { createLogger, normalizeText, sha256Hex } from '@nexora/core';
import type { PortfolioExtraction } from '@nexora/db';

const log = createLogger('inspect:portfolio');

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const DATE_RE = /\b(?:19|20)\d{2}\b(?:\s*[-–—]\s*(?:19|20)?\d{2})?/g;

export interface PortfolioExtractResult {
  status: 'extracted' | 'failed' | 'unsupported';
  kind: string;
  extraction: PortfolioExtraction;
  error?: string;
}

const TEXT_LIKE = /^(text\/|application\/(json|xml))/i;

interface TextAnalysis {
  textLength: number;
  excerpt: string;
  links: string[];
  emails: string[];
  dates: string[];
  sections: { heading: string; text: string }[];
}

function analyseText(text: string): TextAnalysis {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const links = [...new Set((clean.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:]$/, '')))];
  const emails = [...new Set((clean.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];

  // Heuristic sectioning: lines that look like headings become section anchors.
  const sections: { heading: string; text: string }[] = [];
  const lines = clean.split('\n');
  let heading: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (heading && buffer.join(' ').trim()) {
      sections.push({ heading, text: buffer.join(' ').trim().slice(0, 2000) });
    }
    buffer = [];
  };
  for (const line of lines) {
    const t = line.trim();
    const isHeading =
      t.length > 0 &&
      t.length < 90 &&
      (/^(#+\s)/.test(t) ||
        /^[A-Z][A-Za-z0-9 ,&/()'-]{2,60}:$/.test(t) ||
        /^(EXPERIENCE|EDUCATION|PROJECTS|SKILLS|ABOUT|CONTACT|SUMMARY|PUBLICATIONS|AWARDS|CERTIFICATIONS)\b/i.test(t));
    if (isHeading) {
      flush();
      heading = t.replace(/^#+\s*/, '').replace(/:$/, '');
    } else {
      buffer.push(t);
    }
  }
  flush();

  return {
    textLength: clean.length,
    excerpt: clean.slice(0, 1200),
    links: links.slice(0, 80),
    emails: emails.slice(0, 20),
    dates: [...new Set(clean.match(DATE_RE) ?? [])].slice(0, 60),
    sections: sections.slice(0, 60),
  };
}

/** Heuristic extraction of names/organisations from a portfolio. Never asserted as fact. */
function guessNames(text: string): string[] {
  const head = text.slice(0, 600);
  const candidates = new Set<string>();
  const twoToFour = /\b([A-Z][a-z'’-]{1,20}(?:\s+[A-Z][a-z'’-]{1,20}){1,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = twoToFour.exec(head)) !== null) {
    const phrase = m[1] ?? '';
    const stop = /\b(About|Experience|Education|Skills|Projects|Summary|Contact|Resume|CV|Profile|References|Section|Page|Table|Contents)\b/i;
    if (stop.test(phrase)) continue;
    if (phrase.split(' ').length >= 2) candidates.add(phrase);
  }
  return [...candidates].slice(0, 12);
}

function guessOrganisations(text: string): string[] {
  const out = new Set<string>();
  const inc = /\b([A-Z][A-Za-z0-9&.'-]+(?:\s+[A-Z][A-Za-z0-9&.'-]+){0,3}\s+(?:Inc|Ltd|LLC|GmbH|Technologies|Labs|Systems|Software|Foundation|Institute|University|Group|Partners))\b/g;
  let m: RegExpExecArray | null;
  while ((m = inc.exec(text.slice(0, 20000))) !== null) if (m[1]) out.add(m[1]);
  const univ = /\b([A-Z][A-Za-z]+\s+(?:University|College|Polytechnic|Institute|School)\s+of\s+[A-Z][A-Za-z]+)/g;
  while ((m = univ.exec(text.slice(0, 20000))) !== null) if (m[1]) out.add(m[1]);
  return [...out].slice(0, 20);
}

/** Extract from a PDF using pdf.js via unpdf. */
async function extractPdf(buffer: Buffer): Promise<{ text: string; pageCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pageCount = pdf.numPages;
  const { text } = await extractText(pdf, { mergePages: true });
  if (!text.trim()) warnings.push('No selectable text was found. The PDF may be a scan of images and would need OCR, which Nexora Entity does not perform.');
  return { text, pageCount, warnings };
}

export async function extractPortfolio(input: {
  buffer: Buffer;
  filename: string;
  mime: string | null;
}): Promise<PortfolioExtractResult> {
  const mime = input.mime ?? '';
  const name = input.filename.toLowerCase();
  let kind = 'unknown';
  let text = '';
  let pageCount: number | undefined;
  let warnings: string[] = [];
  let images: PortfolioExtraction['images'];

  try {
    if (name.endsWith('.pdf') || mime === 'application/pdf' || input.buffer.subarray(0, 5).toString() === '%PDF-') {
      kind = 'pdf';
      const out = await extractPdf(input.buffer);
      text = out.text;
      pageCount = out.pageCount;
      warnings = out.warnings;
    } else if (name.endsWith('.docx') || mime.includes('wordprocessingml')) {
      kind = 'docx';
      const out = await mammoth.extractRawText({ buffer: input.buffer });
      text = out.value;
      if (out.messages.length) warnings = out.messages.map((m) => m.message).slice(0, 10);
    } else if (name.endsWith('.doc') || mime === 'application/msword') {
      kind = 'legacy-doc';
      warnings.push(
        'This is the legacy .doc format, which cannot be read reliably without conversion. Please upload a PDF or .docx instead.',
      );
    } else if (name.endsWith('.md') || name.endsWith('.markdown')) {
      kind = 'markdown';
      text = input.buffer.toString('utf8');
    } else if (name.endsWith('.csv')) {
      kind = 'csv';
      text = input.buffer.toString('utf8');
    } else if (TEXT_LIKE.test(mime) || mime === '' || name.endsWith('.txt')) {
      kind = 'text';
      text = input.buffer.toString('utf8');
    } else if (/^image\//i.test(mime)) {
      kind = 'image';
      // Images are handled by the photo pipeline; record dimensions only.
      const sharp = (await import('sharp')).default;
      try {
        const meta = await sharp(input.buffer, { failOn: 'none' }).metadata();
        images = [{ name: input.filename, width: meta.width ?? 0, height: meta.height ?? 0 }];
        warnings.push(
          'Images carry no extractable text. This file was recorded, but a text document such as a PDF gives Nexora Entity far more to work with.',
        );
      } catch {
        warnings.push('This image could not be decoded.');
      }
      return {
        status: 'extracted',
        kind,
        extraction: { kind, textLength: 0, excerpt: '', links: [], images, warnings, extractedAt: new Date().toISOString() },
      };
    } else {
      kind = 'unsupported';
      warnings.push(`Nexora Entity cannot read ${mime || name.split('.').pop() || 'this file type'}. Supported: PDF, DOCX, Markdown, plain text, CSV, and images.`);
      return {
        status: 'unsupported',
        kind,
        extraction: { kind, textLength: 0, excerpt: '', links: [], warnings, extractedAt: new Date().toISOString() },
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('portfolio extraction failed', { filename: input.filename, message });
    return {
      status: 'failed',
      kind,
      extraction: { kind, textLength: 0, excerpt: '', links: [], warnings: [message], extractedAt: new Date().toISOString() },
      error: message,
    };
  }

  const analysed = analyseText(text);
  const extraction: PortfolioExtraction = {
    kind,
    textLength: analysed.textLength,
    excerpt: analysed.excerpt,
    links: analysed.links,
    emails: analysed.emails,
    names: guessNames(text),
    organisations: guessOrganisations(text),
    dates: analysed.dates,
    sections: analysed.sections,
    images,
    pageCount,
    warnings: [...warnings, ...(analysed.textLength < 120 ? ['Very little text was found in this file.'] : [])],
    extractedAt: new Date().toISOString(),
  };

  log.info('portfolio extracted', {
    filename: input.filename,
    kind,
    textLength: analysed.textLength,
    links: analysed.links.length,
    sections: analysed.sections.length,
  });

  return { status: 'extracted', kind, extraction };
}

/** Turn portfolio text into candidate claims for the user to review. Never auto-published. */
export function portfolioCandidates(extraction: PortfolioExtraction): {
  kind: 'project' | 'skill' | 'organization' | 'url' | 'date';
  value: string;
  section?: string;
  context: string;
}[] {
  const out: { kind: 'project' | 'skill' | 'organization' | 'url' | 'date'; value: string; section?: string; context: string }[] = [];
  for (const link of extraction.links ?? []) out.push({ kind: 'url', value: link, context: 'Link found in your portfolio.' });
  for (const o of extraction.organisations ?? []) {
    out.push({ kind: 'organization', value: o, context: 'Organisation name found in your portfolio.' });
  }
  const skills = /(^|\n)\s*(skills?|technical skills|core competencies|technologies)\s*:?\s*([^\n]{3,300})/i.exec(
    extraction.excerpt ?? '',
  );
  if (skills?.[3]) {
    for (const s of skills[3].split(/[,;|·•]/)) {
      const v = normalizeText(s);
      if (v.length > 1 && v.length < 40) out.push({ kind: 'skill', value: s.trim(), context: 'Listed under skills in your portfolio.' });
    }
  }
  for (const section of extraction.sections ?? []) {
    if (/project|experience|work|portfolio|built|created|developed/i.test(section.heading)) {
      const firstSentence = section.text.split(/(?<=[.!?])\s/)[0] ?? section.text;
      if (firstSentence.length > 20) {
        out.push({ kind: 'project', value: `${section.heading} — ${firstSentence.slice(0, 200)}`, section: section.heading, context: 'Described in your portfolio.' });
      }
    }
  }
  return out.slice(0, 80);
}

export function portfolioFingerprint(buffer: Buffer): string {
  return sha256Hex(buffer);
}