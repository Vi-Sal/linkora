"use client";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import {
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { X } from "lucide-react";
const button = cva("btn", {
  variants: { variant: { primary: "primary", secondary: "secondary" } },
  defaultVariants: { variant: "secondary" },
});
export function GlassButton({
  variant,
  asChild = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "primary" | "secondary";
}) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={button({ variant, className })} {...props} />;
}
export function Segments({
  items,
  value,
  onChange,
  label,
  disabled = false,
}: {
  items: [string, string, ReactNode?][];
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="segments" role="group" aria-label={label}>
      {items.map(([k, l, icon]) => (
        <button
          type="button"
          key={k}
          disabled={disabled}
          aria-pressed={k === value}
          onClick={() => onChange(k)}
        >
          {icon}
          {l}
        </button>
      ))}
    </div>
  );
}
export function GlassDialog({
  title,
  close,
  children,
  menu = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  menu?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"glass " + (menu ? "quick-menu" : "")}
      aria-labelledby="dialog-title"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="title-row">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={close}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
