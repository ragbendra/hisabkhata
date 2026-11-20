import { useState, type InputHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

/** A password box with a Show / Hide button. Takes the same props as an <input>. */
export default function PasswordInput({ className = "field", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...rest} type={shown ? "text" : "password"} className={`${className} pr-16`} />
      <button
        type="button"
        className="absolute inset-y-0 right-0 px-3 text-sm font-medium text-brand"
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
      >
        {shown ? t("hide", { defaultValue: "Hide" }) : t("show", { defaultValue: "Show" })}
      </button>
    </div>
  );
}
