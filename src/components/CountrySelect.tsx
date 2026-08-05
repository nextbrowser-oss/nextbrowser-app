import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { countryFlag, filterCountryList, ROTATION_COUNTRIES, type RotationCountry } from "../lib/countryFlag";
import { Icon } from "./Icon";

interface CountrySelectProps {
  value: string;
  onChange: (country: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  countries?: RotationCountry[];
}

export function CountrySelect({ value, onChange, disabled = false, ariaLabel, countries = ROTATION_COUNTRIES }: CountrySelectProps) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedCountry = countries.find((country) => country.code === value.toUpperCase());
  const results = useMemo(() => filterCountryList(countries, query), [countries, query]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const show = () => {
    if (disabled) return;
    const selectedIndex = countries.findIndex((country) => country.code === value.toUpperCase());
    setQuery("");
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  };

  const select = (country: string) => {
    onChange(country);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => searchRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    show();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
      return;
    }
    if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      select(results[activeIndex].code);
    }
  };

  return (
    <div className="country-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`country-select-trigger${open ? " is-open" : ""}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => open ? close() : show()}
        onKeyDown={handleTriggerKeyDown}
      >
        {selectedCountry ? (
          <>
            <span className="country-select-flag" aria-hidden="true">{countryFlag(selectedCountry.code)}</span>
            <span className="country-select-name">{selectedCountry.name}</span>
            <span className="country-select-code">{selectedCountry.code}</span>
          </>
        ) : (
          <span className="country-select-placeholder">Choose a country</span>
        )}
        <Icon name="chevron.down" size={14} className="country-select-chevron" />
      </button>

      {open && (
        <div className="country-select-dropdown">
          <div className="country-select-search">
            <Icon name="magnifyingglass" size={13} className="muted" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search countries…"
              aria-label="Search countries"
              aria-controls={`${id}-listbox`}
              aria-activedescendant={results[activeIndex] ? `${id}-${results[activeIndex].code}` : undefined}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div id={`${id}-listbox`} className="country-select-options" role="listbox" aria-label="Countries">
            {results.map((country, index) => {
              const selected = country.code === value.toUpperCase();
              return (
                <button
                  ref={(element) => { optionRefs.current[index] = element; }}
                  id={`${id}-${country.code}`}
                  key={country.code}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`country-select-option${selected ? " is-selected" : ""}${activeIndex === index ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(country.code)}
                >
                  <span className="country-select-flag" aria-hidden="true">{countryFlag(country.code)}</span>
                  <span className="country-select-name">{country.name}</span>
                  <span className="country-select-code">{country.code}</span>
                  {selected && <Icon name="checkmark" size={14} className="country-select-check" />}
                </button>
              );
            })}
            {results.length === 0 && <div className="country-select-empty">No countries found</div>}
          </div>
        </div>
      )}
    </div>
  );
}
