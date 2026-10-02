import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export type InkOption<T extends string | number> = { value: T; label: string; sub?: string };

/**
 * A picker drawn in ink instead of the browser's native dropdown: the value
 * sits on a brush underline, and the choices open on a slip of paper laid out
 * as a grid. Arrow keys move around the grid, Enter picks, Escape closes.
 */
export function InkSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  columns = 1,
  placeholder = '择',
  disabled = false,
}: {
  label: string;
  value: T | null;
  options: InkOption<T>[];
  onChange: (value: T) => void;
  columns?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const openList = () => {
    if (disabled) return;
    setFocus(Math.max(selectedIndex, 0));
    setOpen(true);
  };

  // Lay the slip just under the value, or above it when the page runs out.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const up = window.innerHeight - rect.bottom < 300 && rect.top > window.innerHeight - rect.bottom;
    // oxlint-disable-next-line react/react-compiler
    const width = Math.min(360, window.innerWidth - 32);
    setPlace({
      left: Math.max(16, Math.min(rect.left, window.innerWidth - 16 - width)),
      top: up ? rect.top - 8 : rect.bottom + 8,
      up,
    });
  }, [open]);

  // Bring the focused choice into view and give it keyboard focus.
  useEffect(() => {
    if (!open) return;
    const element = list.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  }, [open, focus, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    const onScroll = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) close(false);
    };
    const onResize = () => close(false);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    if (event.key in step) {
      event.preventDefault();
      setFocus((index) => Math.min(options.length - 1, Math.max(0, index + step[event.key])));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setFocus(event.key === 'Home' ? 0 : options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onChange(options[focus].value);
      close();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`ink-select ${current ? '' : 'is-empty'}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openList();
          }
        }}
      >
        {current ? current.label : placeholder}
      </button>
      {open &&
        place &&
        createPortal(
          <div
            ref={list}
            id={id}
            tabIndex={-1}
            // A styled listbox on purpose: it replaces the native select.
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="listbox"
            aria-label={label}
            className={`ink-slip ${place.up ? 'is-up' : ''}`}
            style={{
              left: place.left,
              top: place.top,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
            onKeyDown={onKeyDown}
          >
            {options.map((option, index) => (
              <button
                key={String(option.value)}
                type="button"
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                role="option"
                aria-selected={option.value === value}
                tabIndex={index === focus ? 0 : -1}
                data-index={index}
                className={`ink-option ${option.value === value ? 'is-on' : ''}`}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
                onMouseEnter={() => setFocus(index)}
              >
                <span>{option.label}</span>
                {option.sub && <small>{option.sub}</small>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
