import { Buffer } from "buffer";
import { PDFDocument, rgb } from "pdf-lib";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_CERT_BYTES = 1 * 1024 * 1024;
export const MAX_SERVER_BYTES = 4 * 1024 * 1024;
export const MAX_VISIBLE_SIGNATURE_BYTES = 2 * 1024 * 1024;

export type PDFPageSize = {
  width: number;
  height: number;
};

export type VisibleSignaturePlacement = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisibleSignatureImage = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  placement: VisibleSignaturePlacement;
};

export type SignPdfInput = {
  pdfBytes: Uint8Array;
  certificateBytes: Uint8Array;
  certificatePassword: string;
  signerName: string;
  reason: string;
  visibleSignature?: VisibleSignatureImage;
};

export type PdfSignerErrorCode =
  | "INVALID_PDF"
  | "INVALID_CERTIFICATE"
  | "PASSWORD_REQUIRED"
  | "PASSWORD_INCORRECT"
  | "SIGNING_FAILED";

export class PdfSignerError extends Error {
  code: PdfSignerErrorCode;
  stage: "validate" | "pdf-placeholder" | "certificate" | "signing";
  details?: string;

  constructor(
    code: PdfSignerErrorCode,
    message: string,
    stage: "validate" | "pdf-placeholder" | "certificate" | "signing",
    details?: string
  ) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.details = details;
    this.name = "PdfSignerError";
  }
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

function isPasswordError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("invalid password") ||
    message.includes("wrong password") ||
    message.includes("mac could not be verified") ||
    message.includes("unable to decrypt pkcs#8 shroudedkeybag")
  );
}

function isCertificateFormatError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("asn.1") ||
    message.includes("pfx") ||
    message.includes("pkcs#12") ||
    message.includes("pkcs12") ||
    message.includes("certificate") ||
    message.includes("private key")
  );
}

export function sanitizeFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}-signed.pdf`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function applyVisibleSignature(pdfDoc: PDFDocument, visibleSignature: VisibleSignatureImage): Promise<void> {
  if (!visibleSignature.bytes.length) {
    throw new PdfSignerError(
      "INVALID_CERTIFICATE",
      "The signature image file is empty or unreadable.",
      "validate"
    );
  }

  const pages = pdfDoc.getPages();
  const page = pages[visibleSignature.placement.pageIndex] ?? pages[0];
  if (!page) {
    throw new PdfSignerError("INVALID_PDF", "The PDF has no pages.", "validate");
  }

  const pageSize = page.getSize();
  const placement = visibleSignature.placement;
  const width = clamp(placement.width, 24, pageSize.width);
  const height = clamp(placement.height, 24, pageSize.height);
  const x = clamp(placement.x, 0, Math.max(0, pageSize.width - width));
  const yTop = clamp(placement.y, 0, Math.max(0, pageSize.height - height));
  const y = pageSize.height - yTop - height;

  const image =
    visibleSignature.mimeType === "image/png"
      ? await pdfDoc.embedPng(visibleSignature.bytes)
      : await pdfDoc.embedJpg(visibleSignature.bytes);

  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.64, 0.72, 0.84),
    borderWidth: 1,
    color: rgb(1, 1, 1),
    opacity: 0.96
  });
  page.drawImage(image, {
    x,
    y,
    width,
    height
  });
}

export async function signPdfDocument(input: SignPdfInput): Promise<Uint8Array> {
  const signerName = normalizeText(input.signerName);
  const reason = normalizeText(input.reason) || "Signed for personal use";

  if (!input.pdfBytes?.length) {
    throw new PdfSignerError("INVALID_PDF", "The PDF file is empty or unreadable.", "validate");
  }

  if (!input.certificateBytes?.length) {
    throw new PdfSignerError("INVALID_CERTIFICATE", "The certificate file is empty or unreadable.", "validate");
  }

  if (!input.certificatePassword.trim()) {
    throw new PdfSignerError("PASSWORD_REQUIRED", "Certificate password is required.", "validate");
  }

  if (input.visibleSignature?.bytes?.length) {
    if (input.visibleSignature.bytes.length > MAX_VISIBLE_SIGNATURE_BYTES) {
      throw new PdfSignerError(
        "INVALID_CERTIFICATE",
        "The signature image must be 2 MB or smaller.",
        "validate"
      );
    }
    if (!["image/png", "image/jpeg"].includes(input.visibleSignature.mimeType)) {
      throw new PdfSignerError(
        "INVALID_CERTIFICATE",
        "The signature image must be a PNG or JPG file.",
        "validate"
      );
    }
  }

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(input.pdfBytes, {
      ignoreEncryption: false
    });
  } catch {
    throw new PdfSignerError(
      "INVALID_PDF",
      "The selected PDF is invalid or encrypted in a way this tool cannot sign.",
      "validate"
    );
  }

  pdfDoc.setAuthor(signerName || "Personal signer");
  pdfDoc.setSubject(reason);
  pdfDoc.setTitle(pdfDoc.getTitle() ?? "Signed document");

  let preparedPdf: Uint8Array;
  try {
    if (input.visibleSignature) {
      await applyVisibleSignature(pdfDoc, input.visibleSignature);
    }
    pdflibAddPlaceholder({
      pdfDoc,
      reason,
      name: signerName || "Personal signer",
      contactInfo: signerName || "Personal signer",
      location: "Personal use",
      signatureLength: 16384,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED
    });
    preparedPdf = await pdfDoc.save({ useObjectStreams: false });
  } catch (error) {
    throw new PdfSignerError(
      "SIGNING_FAILED",
      "Unable to prepare the PDF for signing.",
      "pdf-placeholder",
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    const signer = new P12Signer(toBuffer(input.certificateBytes), {
      passphrase: input.certificatePassword
    });
    const signpdf = new SignPdf();
    const signedPdf = await signpdf.sign(toBuffer(preparedPdf), signer);
    return new Uint8Array(signedPdf);
  } catch (error) {
    if (isPasswordError(error)) {
      throw new PdfSignerError(
        "PASSWORD_INCORRECT",
        "The certificate password is incorrect.",
        "certificate",
        error instanceof Error ? error.message : String(error)
      );
    }
    if (isCertificateFormatError(error)) {
      throw new PdfSignerError(
        "INVALID_CERTIFICATE",
        "The certificate file is invalid or corrupted.",
        "certificate",
        error instanceof Error ? error.message : String(error)
      );
    }
    throw new PdfSignerError(
      "SIGNING_FAILED",
      "Signing failed. Please verify the PDF and certificate, then try again.",
      "signing",
      error instanceof Error ? error.message : String(error)
    );
  }
}
