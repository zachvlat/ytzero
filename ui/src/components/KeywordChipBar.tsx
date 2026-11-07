import type { FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { useI18n } from "../i18n";
import { useHorizontalDragScroll } from "./ui";
// The chip-row layout lives with the tag bar; load it here too so this page works when the tag bar was never shown.
import "./TagFilterBar.css";

/** Horizontal chip bar for user-supplied YouTube search keywords. */
export default function KeywordChipBar({
  keywords,
  onAdd,
  onRemove,
  placeholder,
}: {
  keywords: string[];
  onAdd: (keyword: string) => void;
  onRemove: (keyword: string) => void;
  placeholder: string;
}) {
  const { t } = useI18n();
  const { dragScrollClassName, dragScrollProps } = useHorizontalDragScroll<HTMLDivElement>();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("keyword") as HTMLInputElement;
    const value = input.value.trim();
    if (!value) return;
    onAdd(value);
    input.value = "";
    input.focus();
  };
  return (
    <div className="chip-filter-row">
      <div className="chip-bar-wrap">
        <div className={`chip-bar ${dragScrollClassName}`} {...dragScrollProps}>
          {keywords.map((keyword) => (
            <span key={keyword} className="chip keyword-chip">
              {keyword}
              <button
                type="button"
                className="keyword-chip__x"
                aria-label={`${t("recommendationsKeywordsRemove")}: ${keyword}`}
                onClick={() => onRemove(keyword)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      </div>
      <form className="keyword-add-form" onSubmit={submit}>
        <input
          name="keyword"
          type="text"
          className="chip keyword-add-input"
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <button type="submit" className="chip keyword-add-btn">
          <Plus size={14} aria-hidden="true" />
          {t("recommendationsKeywordsAdd")}
        </button>
      </form>
    </div>
  );
}
