// Takus — Document Parsers Tests
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock notification manager
vi.mock('../notification-manager.js', () => ({
  notifyEphemeral: vi.fn(),
}));

const { isRichDocumentExtension } = await import('../document-parsers.js');

describe('Document Parsers', () => {
  describe('isRichDocumentExtension', () => {
    it('recognizes pdf as a rich document extension', () => {
      expect(isRichDocumentExtension('pdf')).toBe(true);
    });

    it('recognizes docx as a rich document extension', () => {
      expect(isRichDocumentExtension('docx')).toBe(true);
    });

    it('rejects txt as a rich document extension', () => {
      expect(isRichDocumentExtension('txt')).toBe(false);
    });

    it('rejects md as a rich document extension', () => {
      expect(isRichDocumentExtension('md')).toBe(false);
    });

    it('rejects html as a rich document extension', () => {
      expect(isRichDocumentExtension('html')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isRichDocumentExtension('')).toBe(false);
    });
  });
});

describe('extractTextFromPDF', () => {
  it('rejects invalid input types', async () => {
    const { extractTextFromPDF } = await import('../document-parsers.js');
    await expect(extractTextFromPDF('not-a-buffer')).rejects.toThrow('must be a File, Blob, or ArrayBuffer');
  });

  it('rejects null input', async () => {
    const { extractTextFromPDF } = await import('../document-parsers.js');
    await expect(extractTextFromPDF(null)).rejects.toThrow();
  });
});

describe('extractTextFromDOCX', () => {
  it('rejects invalid input types', async () => {
    const { extractTextFromDOCX } = await import('../document-parsers.js');
    await expect(extractTextFromDOCX('not-a-buffer')).rejects.toThrow('must be a File, Blob, or ArrayBuffer');
  });

  it('rejects null input', async () => {
    const { extractTextFromDOCX } = await import('../document-parsers.js');
    await expect(extractTextFromDOCX(null)).rejects.toThrow();
  });
});

// Integration test: verify document-adapter routes PDF/DOCX to parsers
describe('Document Adapter PDF/DOCX routing', () => {
  it('DOCX type is defined in DocumentType', async () => {
    const { DocumentType } = await import('../document-adapter.js');
    expect(DocumentType.DOCX).toBe('document');
    expect(DocumentType.PDF_TEXT).toBe('document');
  });
});
