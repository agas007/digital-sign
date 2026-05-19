import clsx from "clsx";
import type { ChangeEvent } from "react";

type Props = {
  id: string;
  label: string;
  hint?: string;
  accept: string;
  file?: File | null;
  onChange: (file: File | null) => void;
  error?: string | null;
  required?: boolean;
};

export default function FileUpload({
  id,
  label,
  hint,
  accept,
  file,
  onChange,
  error,
  required
}: Props) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.files?.[0] ?? null);
  }

  return (
    <label className="block">
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <span className="text-sm font-medium text-slate-900">
            {label}
            {required ? " *" : ""}
          </span>
          {hint ? <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p> : null}
        </div>
        {file ? (
          <span className="text-xs text-emerald-700">
            {Math.max(1, Math.round(file.size / 1024))} KB
          </span>
        ) : null}
      </div>
      <div
        className={clsx(
          "rounded-2xl border border-dashed px-4 py-4 transition",
          error
            ? "border-rose-300 bg-rose-50"
            : "border-slate-300 bg-white hover:border-slate-400"
        )}
      >
        <input
          id={id}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-full file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
        />
        <div className="mt-3 space-y-1">
          <p className="text-sm font-medium text-slate-800">
            {file ? file.name : "No file selected"}
          </p>
          <p className="text-xs leading-5 text-slate-500">
            {accept.includes("pdf") ? "PDF only" : "P12 / PFX only"}
          </p>
          {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        </div>
      </div>
    </label>
  );
}
