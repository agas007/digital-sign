# Personal PDF Digital Signer

Next.js App Router app for signing PDFs with your own self-signed `.p12/.pfx` certificate.

## What this app does

- Upload or save a personal certificate once in the browser.
- Sign PDFs without a database.
- Keep files out of persistent server storage.
- Return the signed PDF as a download.
- Use local browser signing first, with a server fallback for smaller PDFs.

## Important limitation

This is for personal/internal use only.

Self-signed certificates provide document integrity, but they do not provide legally trusted identity verification like BSrE, Privy, or VIDA.

Adobe Reader may mark the signature as not trusted because the certificate is not issued by a trusted CA/PSrE.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Generate a self-signed `.p12`

The command below creates a private key, a self-signed certificate, and packages them into `.p12`.

```bash
openssl req -x509 -newkey rsa:2048 -keyout private.key -out certificate.crt -days 365 -nodes -subj "/CN=Personal PDF Signer"
openssl pkcs12 -export -out personal-signer.p12 -inkey private.key -in certificate.crt -name "Personal PDF Signer"
```

If you need a `.pfx`, you can usually use the same file content and extension.

## Deploy to Vercel

1. Push the repository to GitHub.
2. Import the repo in Vercel.
3. Use the default Next.js settings.
4. Deploy.

No database or storage service is required.

## Security model

- PDF files are processed only for signing.
- Certificates can be saved in the browser only if you choose to do so.
- Passwords are not stored on the server.
- Nothing is uploaded to third-party signing services.

## Notes on browser certificate storage

The app can remember your certificate in the current browser profile so you do not need to upload it every time.

If you clear browser storage or use another device/browser, you must upload the certificate again.

## Validation limits

- PDF: `application/pdf`, max 10 MB
- Certificate: `.p12` / `.pfx`, max 1 MB

## Troubleshooting

- Wrong certificate password: re-check the password used when exporting the `.p12`.
- Invalid PDF: ensure the PDF opens normally before signing.
- Trust warnings in Adobe Reader: expected for self-signed certificates.
