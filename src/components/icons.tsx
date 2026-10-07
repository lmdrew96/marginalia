export function BookmarkIcon({
  filled,
  className,
}: {
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.5}
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h6a1.5 1.5 0 0 1 1.5 1.5v13.25a.5.5 0 0 1-.78.416L10 13.09l-3.72 3.076a.5.5 0 0 1-.78-.416V3.5Z" />
    </svg>
  );
}

export function ChatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 5.75A2.25 2.25 0 0 1 5.25 3.5h9.5A2.25 2.25 0 0 1 17 5.75v4.5A2.25 2.25 0 0 1 14.75 12.5H8l-3.5 3v-3h-.25A2.25 2.25 0 0 1 3 10.25v-4.5Z" />
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

export function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6m-7 0 .6 9.6a1.5 1.5 0 0 0 1.5 1.4h5.8a1.5 1.5 0 0 0 1.5-1.4L15 6" />
    </svg>
  );
}

// Thin-line icons share one frame: 20px box, 1.5px round strokes.
const LineIcon = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const PenNibIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <path d="M10 2.5 15.5 9 12 17.5H8L4.5 9 10 2.5Z" />
    <path d="M10 2.5V9" />
    <circle cx="10" cy="10.5" r="1.25" />
    <path d="M8 17.5h4" />
  </LineIcon>
);

export const SunIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <circle cx="10" cy="10" r="3.25" />
    <path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.24 1.24M14.06 14.06l1.24 1.24M4.7 15.3l1.24-1.24M14.06 5.94l1.24-1.24" />
  </LineIcon>
);

export const MoonIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <path d="M16.5 12.2A6.75 6.75 0 0 1 7.8 3.5a6.75 6.75 0 1 0 8.7 8.7Z" />
  </LineIcon>
);

export const GearIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
    <circle cx="10" cy="10" r="5.25" />
  </LineIcon>
);

export const UploadIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <path d="M10 13V3.5M6.5 7 10 3.5 13.5 7" />
    <path d="M3.5 12.5v2a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-2" />
  </LineIcon>
);

export const ArrowLeftIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <path d="M16 10H4M8.5 5.5 4 10l4.5 4.5" />
  </LineIcon>
);

export const BookOpenIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <path d="M10 5.5C8.5 4 6 3.5 2.5 3.75v11.5C6 15 8.5 15.5 10 17c1.5-1.5 4-2 7.5-1.75V3.75C14 3.5 11.5 4 10 5.5Z" />
    <path d="M10 5.5V17" />
  </LineIcon>
);

export const PlusIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <path d="M10 4.5v11M4.5 10h11" />
  </LineIcon>
);

export const MinusIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <path d="M4.5 10h11" />
  </LineIcon>
);

export const MarginIcon = ({ className }: { className?: string }): React.JSX.Element => (
  <LineIcon className={className}>
    <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
    <path d="M12.5 3.5v13M14.5 7h1M14.5 10h1" />
  </LineIcon>
);
