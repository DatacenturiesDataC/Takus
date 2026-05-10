/**
 * Browser-side PII masking using Transformers.js (WASM).
 * Must run BEFORE any data leaves the device.
 *
 * Usage:
 *   import { maskPII } from '@lib/ai/pii-masker.js';
 *   const safeTranscript = await maskPII(rawTranscript);
 */
import { pipeline } from '@xenova/transformers';

const PATTERNS = [
  { re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, label: '[EMAIL]' },
  { re: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,               label: '[PHONE]' },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g,                       label: '[SSN]' },
  { re: /\b(?:\d[ -]?){13,16}\b/g,                      label: '[CC]' },
];

let _ner = null;

async function getNER() {
  if (!_ner) {
    _ner = await pipeline('token-classification', 'Xenova/bert-base-NER', {
      quantized: true,
    });
  }
  return _ner;
}

/**
 * Mask PII in text. Regex pass is synchronous and guaranteed;
 * NER pass (person names) is async and best-effort.
 */
export async function maskPII(text) {
  if (!text) return text;

  let masked = text;
  for (const { re, label } of PATTERNS) {
    masked = masked.replace(re, label);
  }

  try {
    const ner = await getNER();
    const entities = await ner(masked);
    for (const e of entities) {
      if (e.entity_group === 'PER') {
        masked = masked.replace(e.word, '[PERSON]');
      }
    }
  } catch {
    // NER is best-effort; regex pass already applied
  }

  return masked;
}

/** Synchronous regex-only pass (safe for time-critical paths). */
export function maskPIISync(text) {
  if (!text) return text;
  let masked = text;
  for (const { re, label } of PATTERNS) masked = masked.replace(re, label);
  return masked;
}
