import { Buffer } from "buffer";
import { PDFDocument } from "pdf-lib";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_CERT_BYTES = 1 * 1024 * 1024;
export const MAX_SERVER_BYTES = 4 * 1024 * 1024;

export type SignPdfInput = {
  pdfBytes: Uint8Array;
  certificateBytes: Uint8Array;
  certificatePassword: string;
  signerName: string;
  reason: string;
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
