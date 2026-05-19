import { Buffer } from "buffer";
import { NextResponse } from "next/server";
import {
  signPdfDocument,
  sanitizeFileName,
  MAX_SERVER_BYTES,
  MAX_PDF_BYTES,
  MAX_CERT_BYTES,
  PdfSignerError
} from "@/lib/pdfSigner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get("pdf");
    const certFile = formData.get("certificate");
    const password = String(formData.get("password") ?? "");
    const signerName = String(formData.get("signerName") ?? "");
    const reason = String(formData.get("reason") ?? "Signed for personal use");

    if (!(pdfFile instanceof File) || pdfFile.type !== "application/pdf") {
      return jsonError(400, "INVALID_PDF", "Please upload a valid PDF file.");
    }

    if (pdfFile.size > MAX_PDF_BYTES) {
      return jsonError(413, "PDF_TOO_LARGE", "PDF must be 10 MB or smaller.");
    }

    if (pdfFile.size > MAX_SERVER_BYTES) {
      return jsonError(
        413,
        "PDF_TOO_LARGE_FOR_SERVER",
        "This PDF is too large for server signing. Use the browser signing flow."
      );
    }

    if (!(certFile instanceof File) || !/\.(p12|pfx)$/i.test(certFile.name)) {
      return jsonError(400, "INVALID_CERTIFICATE", "Please upload a valid .p12 or .pfx certificate.");
    }

    if (certFile.size > MAX_CERT_BYTES) {
      return jsonError(413, "CERTIFICATE_TOO_LARGE", "Certificate must be 1 MB or smaller.");
    }

    const signed = await signPdfDocument({
      pdfBytes: new Uint8Array(await pdfFile.arrayBuffer()),
      certificateBytes: new Uint8Array(await certFile.arrayBuffer()),
      certificatePassword: password,
      signerName,
      reason
    });

    return new NextResponse(Buffer.from(signed), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${sanitizeFileName(pdfFile.name)}"`,
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    if (error instanceof PdfSignerError) {
      return jsonError(
        error.code === "PASSWORD_INCORRECT" ? 401 : 400,
        error.code,
        error.message
      );
    }

    return jsonError(500, "SIGNING_FAILED", "Signing failed unexpectedly.");
  }
}
