"use client";

import { useEffect, useState, type FormEvent } from "react";
import FileUpload from "@/components/FileUpload";
import { loadCertificate, removeCertificate, saveCertificate, type StoredCertificate } from "@/lib/certificateVault";
import {
  MAX_CERT_BYTES,
  MAX_PDF_BYTES,
  MAX_SERVER_BYTES,
  PdfSignerError,
  sanitizeFileName,
  signPdfDocument
} from "@/lib/pdfSigner";

type Notice = { type: "error" | "success" | "info"; message: string } | null;

function isPdf(file: File | null) {
  return file?.type === "application/pdf" || !!file?.name.toLowerCase().endsWith(".pdf");
}

function isCertificate(file: File | null) {
  return !!file && /\.(p12|pfx)$/i.test(file.name);
}

async function downloadBytes(bytes: Uint8Array, filename: string) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function signViaServer(formData: FormData) {
  const response = await fetch("/api/sign", {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { error?: { message?: string } };
      throw new Error(payload.error?.message ?? "Server signing failed.");
    }
    throw new Error("Server signing failed.");
  }

  return new Uint8Array(await response.arrayBuffer());
}

function toBrowserFile(bytes: Uint8Array, fileName: string, type: string) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new File([copy.buffer], fileName, { type });
}

export default function Home() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [signerName, setSignerName] = useState("");
  const [reason, setReason] = useState("Signed for personal use");
  const [savedCertificate, setSavedCertificate] = useState<StoredCertificate | null>(null);
  const [savingCertificate, setSavingCertificate] = useState(false);
  const [signing, setSigning] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadCertificate()
      .then(setSavedCertificate)
      .catch(() => setSavedCertificate(null));
  }, []);

  const hasStoredCertificate = Boolean(savedCertificate);

  async function handleSaveCertificate() {
    setNotice(null);
    setFieldErrors((current) => ({ ...current, certificate: "" }));

    if (!certificateFile) {
      setFieldErrors((current) => ({ ...current, certificate: "Please choose a certificate first." }));
      return;
    }

    if (!isCertificate(certificateFile)) {
      setFieldErrors((current) => ({ ...current, certificate: "Certificate must be a .p12 or .pfx file." }));
      return;
    }

    if (certificateFile.size > MAX_CERT_BYTES) {
      setFieldErrors((current) => ({ ...current, certificate: "Certificate must be 1 MB or smaller." }));
      return;
    }

    try {
      setSavingCertificate(true);
      const stored = await saveCertificate(certificateFile);
      setSavedCertificate(stored);
      setNotice({ type: "success", message: "Certificate saved in this browser for future signings." });
    } catch {
      setNotice({ type: "error", message: "Failed to save certificate in this browser." });
    } finally {
      setSavingCertificate(false);
    }
  }

  async function handleRemoveCertificate() {
    await removeCertificate();
    setSavedCertificate(null);
    setNotice({ type: "info", message: "Saved certificate removed from this browser." });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);

    const errors: Record<string, string> = {};

    if (!pdfFile) {
      errors.pdf = "Please upload a PDF file.";
    } else if (!isPdf(pdfFile)) {
      errors.pdf = "PDF must be application/pdf.";
    } else if (pdfFile.size > MAX_PDF_BYTES) {
      errors.pdf = "PDF must be 10 MB or smaller.";
    }

    if (!signerName.trim()) {
      errors.signerName = "Signer name is required.";
    }

    if (!password.trim()) {
      errors.password = "Certificate password is required.";
    }

    const certificateToUse = certificateFile ?? savedCertificate;

    if (!certificateToUse) {
      errors.certificate = "Save or upload a certificate first.";
    } else if (!savedCertificate) {
      if (!certificateFile) {
        errors.certificate = "Please upload a certificate first.";
      } else if (!isCertificate(certificateFile)) {
        errors.certificate = "Certificate must be a .p12 or .pfx file.";
      } else if (certificateFile.size > MAX_CERT_BYTES) {
        errors.certificate = "Certificate must be 1 MB or smaller.";
      }
    }

    setFieldErrors(errors);

    if (Object.keys(errors).length > 0 || !pdfFile || !certificateToUse) {
      return;
    }

    try {
      setSigning(true);

      const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer());
      const certBytes = certificateFile
        ? new Uint8Array(await certificateFile.arrayBuffer())
        : savedCertificate
          ? savedCertificate.bytes
          : new Uint8Array();

      try {
        const signed = await signPdfDocument({
          pdfBytes,
          certificateBytes: certBytes,
          certificatePassword: password,
          signerName,
          reason
        });

        await downloadBytes(signed, sanitizeFileName(pdfFile.name));
        setNotice({
          type: "success",
          message: "PDF signed locally in your browser."
        });
      } catch (error) {
        if (error instanceof PdfSignerError) {
          setNotice({ type: "error", message: error.message });
          return;
        }

        if (pdfBytes.length <= MAX_SERVER_BYTES) {
          const formData = new FormData();
          formData.set("pdf", pdfFile);
          formData.set(
            "certificate",
            certificateFile
              ? certificateFile
              : savedCertificate
                ? toBrowserFile(savedCertificate.bytes, savedCertificate.fileName, "application/x-pkcs12")
                : new File([], "certificate.p12", { type: "application/x-pkcs12" })
          );
          formData.set("password", password);
          formData.set("signerName", signerName);
          formData.set("reason", reason);

          try {
            const serverSigned = await signViaServer(formData);
            await downloadBytes(serverSigned, sanitizeFileName(pdfFile.name));
            setNotice({
              type: "success",
              message: "PDF signed through the server fallback."
            });
            return;
          } catch (serverError) {
            setNotice({
              type: "error",
              message:
                serverError instanceof Error
                  ? serverError.message
                  : "Signing failed. Please verify the PDF and certificate, then try again."
            });
            return;
          }
        }

        setNotice({
          type: "error",
          message: "Signing failed. Please verify the PDF and certificate, then try again."
        });
      }
    } catch (error) {
      if (error instanceof PdfSignerError) {
        setNotice({ type: "error", message: error.message });
        return;
      }

      setNotice({
        type: "error",
        message: "Signing failed. Please verify the PDF and certificate, then try again."
      });
    } finally {
      setSigning(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 lg:flex-row lg:items-start">
        <section className="lg:sticky lg:top-10 lg:w-[38%]">
          <div className="glass-panel rounded-[2rem] p-8 shadow-soft">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
              Personal PDF Digital Signer
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950">
              Sign PDFs with your own self-signed certificate.
            </h1>
            <p className="mt-5 text-base leading-7 text-slate-600">
              This tool signs PDFs using your own certificate. Files are processed only for signing and are not stored.
            </p>

            <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              <strong className="block">Important disclaimer</strong>
              Self-signed certificates provide document integrity but may not provide legally trusted identity verification.
              Adobe Reader may show the signature as not trusted because it is not issued by a CA/PSrE resmi.
            </div>

            <dl className="mt-6 grid gap-3 text-sm text-slate-600">
              <div className="rounded-2xl bg-white/70 p-4">
                <dt className="font-medium text-slate-900">Stored in browser</dt>
                <dd className="mt-1">
                  {hasStoredCertificate
                    ? `Saved certificate: ${savedCertificate?.fileName}`
                    : "Upload your .p12/.pfx once and save it in this browser."}
                </dd>
              </div>
              <div className="rounded-2xl bg-white/70 p-4">
                <dt className="font-medium text-slate-900">Local-first flow</dt>
                <dd className="mt-1">
                  Large PDFs can be signed locally in the browser to avoid server upload limits.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="flex-1">
          <form
            onSubmit={handleSubmit}
            className="glass-panel rounded-[2rem] p-6 shadow-soft sm:p-8"
          >
            <div className="grid gap-6">
              <FileUpload
                id="pdf"
                label="Upload PDF"
                hint="Maximum 10 MB. Only PDF files are accepted."
                accept="application/pdf,.pdf"
                file={pdfFile}
                onChange={setPdfFile}
                error={fieldErrors.pdf}
                required
              />

              <div className="grid gap-3">
                <FileUpload
                  id="certificate"
                  label="Upload certificate .p12/.pfx"
                  hint="Maximum 1 MB. Save it once to reuse in this browser."
                  accept=".p12,.pfx,application/x-pkcs12"
                  file={certificateFile}
                  onChange={setCertificateFile}
                  error={fieldErrors.certificate}
                  required={!hasStoredCertificate}
                />

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleSaveCertificate}
                    disabled={savingCertificate || !certificateFile}
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingCertificate ? "Saving..." : "Save certificate in browser"}
                  </button>
                  {hasStoredCertificate ? (
                    <button
                      type="button"
                      onClick={handleRemoveCertificate}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-white"
                    >
                      Remove saved certificate
                    </button>
                  ) : null}
                </div>
                {savedCertificate ? (
                  <p className="text-sm text-emerald-700">
                    Active browser certificate: {savedCertificate.fileName}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">
                    Save the certificate once to avoid re-uploading on every sign.
                  </p>
                )}
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-medium text-slate-900">Password *</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-500"
                    placeholder="Certificate password"
                  />
                  {fieldErrors.password ? (
                    <p className="mt-2 text-sm text-rose-700">{fieldErrors.password}</p>
                  ) : null}
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-slate-900">Signer name *</span>
                  <input
                    type="text"
                    value={signerName}
                    onChange={(event) => setSignerName(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-500"
                    placeholder="Your name"
                  />
                  {fieldErrors.signerName ? (
                    <p className="mt-2 text-sm text-rose-700">{fieldErrors.signerName}</p>
                  ) : null}
                </label>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-900">Reason</span>
                <input
                  type="text"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-500"
                  placeholder="Signed for personal use"
                />
              </label>

              <button
                type="submit"
                disabled={signing}
                className="rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {signing ? "Signing..." : "Sign PDF"}
              </button>
            </div>

            <div className="mt-8 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="font-medium text-slate-900">Validation</p>
                <p className="mt-1">PDF: application/pdf, max 10 MB.</p>
                <p>Certificate: .p12/.pfx, max 1 MB.</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="font-medium text-slate-900">Behavior</p>
                <p className="mt-1">Files stay in memory during signing and are not persisted on the server.</p>
              </div>
            </div>

            {notice ? (
              <div
                className={`mt-6 rounded-2xl border p-4 text-sm ${
                  notice.type === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : notice.type === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                {notice.message}
              </div>
            ) : null}
          </form>
        </section>
      </div>
    </main>
  );
}
