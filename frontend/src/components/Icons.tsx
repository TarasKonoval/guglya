const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const HeartIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? "currentColor" : "none"} aria-hidden>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
);
export const ChatIcon = () => (
  <svg {...base} aria-hidden><path d="M4 5h16v11H9l-5 4z" /></svg>
);
export const LogoutIcon = () => (
  <svg {...base} aria-hidden><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></svg>
);
export const CheckIcon = () => (
  <svg {...base} strokeWidth={2.4} width={14} height={14} aria-hidden><path d="M5 12l5 5 9-10" /></svg>
);
export const PlusIcon = () => (
  <svg {...base} strokeWidth={2.2} width={14} height={14} aria-hidden><path d="M12 5v14M5 12h14" /></svg>
);
export const BackIcon = () => (
  <svg {...base} aria-hidden><path d="M15 5l-7 7 7 7" /></svg>
);
export const MenuIcon = () => (
  <svg {...base} aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);
export const FilterIcon = () => (
  <svg {...base} width={16} height={16} aria-hidden><path d="M4 6h16M7 12h10M10 18h4" /></svg>
);
export const UserIcon = () => (
  <svg {...base} aria-hidden><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4z" /></svg>
);
export const BagIcon = () => (
  <svg {...base} aria-hidden><path d="M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8" /></svg>
);
